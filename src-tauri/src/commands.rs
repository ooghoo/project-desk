use crate::db;
use crate::detect;
use crate::error::AppError;
use crate::launcher;
use crate::manifest;
use crate::models::*;
use crate::paths;
use crate::runs;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    /// 内嵌终端会话（run_id → pty）
    pub pty: crate::pty::PtyStore,
}

fn conn(state: &AppState) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
    state
        .conn
        .lock()
        .map_err(|_| AppError::new("db_locked", "数据库忙碌，请稍后重试"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropItem {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub exists: bool,
}

/* ------------------------------------------------------------------ */
/* 启动数据                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, AppError> {
    let c = conn(&state)?;
    let projects = db::list_projects(&c)?;
    // 启动时校验一次路径可用性（不自动删除任何记录）
    for p in &projects {
        let status = if Path::new(&p.root_path).is_dir() { "ok" } else { "missing" };
        if status != p.path_status {
            db::set_path_status(&c, &p.id, status)?;
        }
    }
    let projects = db::list_projects(&c)?;
    Ok(Bootstrap {
        projects,
        categories: db::list_categories(&c)?,
        tags: db::list_tags(&c)?,
        runs: runs::refresh_list(&c, None, 120)?,
        settings: db::get_settings(&c),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        db_path: state.db_path.to_string_lossy().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        login_path: crate::shellenv::login_path(),
    })
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, AppError> {
    let c = conn(&state)?;
    db::list_projects(&c).map_err(AppError::from)
}

/* ------------------------------------------------------------------ */
/* 项目识别与添加                                                       */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn detect_project(path: String) -> Result<Detection, AppError> {
    detect::detect(&path).map_err(AppError::from)
}

#[tauri::command]
pub fn inspect_drop_paths(paths_in: Vec<String>) -> Vec<DropItem> {
    paths_in
        .into_iter()
        .map(|raw| {
            let p = paths::absolute(&raw);
            DropItem {
                name: p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| raw.clone()),
                path: p.to_string_lossy().to_string(),
                is_dir: p.is_dir(),
                exists: p.exists(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn add_project(state: State<'_, AppState>, input: AddProjectInput) -> Result<Project, AppError> {
    let c = conn(&state)?;
    let root = paths::resolve_dir(&input.root_path)?;
    let root_str = root.to_string_lossy().to_string();
    let key = paths::compare_key(&root_str);
    if let Some(existing) = db::find_project_by_key(&c, &key) {
        return Err(AppError::duplicate(&existing));
    }

    let name = input.name.trim();
    let name = if name.is_empty() {
        root.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "未命名项目".into())
    } else {
        name.to_string()
    };

    let category_id = input.category_id.clone().or_else(|| {
        let kind = match input.project_type.as_str() {
            "web" | "node" => "web",
            "python" => "python",
            "shell" => "automation",
            _ => "other",
        };
        db::category_by_kind(&c, kind)
    });

    let project = db::insert_project(
        &c,
        &db::NewProject {
            name,
            root_path: root_str.clone(),
            project_type: input.project_type.clone(),
            category_id,
            icon: input.icon.clone(),
        },
    )?;

    if !input.tags.is_empty() {
        db::set_project_tags(&c, &project.id, &input.tags)?;
    }
    // launcher.json 优先：存在且校验通过时导入其中全部运行配置
    let report = manifest::read_manifest(&root_str);
    if report.found && report.valid {
        let def = report.default_config.clone();
        for mc in &report.configurations {
            let mut ci = mc.config_input.clone();
            ci.is_default = Some(def.as_deref() == Some(mc.id.as_str()));
            db::insert_config_full(
                &c,
                &project.id,
                &ci,
                Some("manifest"),
                Some(&mc.id),
                Some(&mc.config_type),
                mc.startup_timeout,
            )?;
        }
    } else if let Some(cfg) = &input.config {
        db::insert_config(&c, &project.id, cfg)?;
    }

    db::get_project(&c, &project.id).ok_or_else(|| AppError::new("error", "项目写入后读取失败"))
}

/// 读取项目根目录的 launcher.json（不修改任何数据）
#[tauri::command]
pub fn read_launcher_config(path: String) -> Result<crate::manifest::ManifestReport, AppError> {
    Ok(manifest::read_manifest(&path))
}

/// 重新从 launcher.json 同步运行配置。
/// 用户手动创建的配置（source=manual）不会被删除；仅刷新 manifest 来源的配置。
#[tauri::command]
pub fn sync_launcher_config(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::manifest::ManifestReport, AppError> {
    let c = conn(&state)?;
    let p = db::get_project(&c, &id).ok_or_else(|| AppError::new("not_found", "项目不存在"))?;
    let report = manifest::read_manifest(&p.root_path);
    if !report.found || !report.valid {
        return Ok(report);
    }
    let def = report.default_config.clone();
    db::delete_manifest_configs(&c, &id)?;
    for mc in &report.configurations {
        let mut ci = mc.config_input.clone();
        ci.is_default = Some(def.as_deref() == Some(mc.id.as_str()));
        db::insert_config_full(
            &c,
            &id,
            &ci,
            Some("manifest"),
            Some(&mc.id),
            Some(&mc.config_type),
            mc.startup_timeout,
        )?;
    }
    Ok(report)
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    id: String,
    patch: ProjectPatch,
) -> Result<Project, AppError> {
    let c = conn(&state)?;
    db::update_project(&c, &id, &patch).map_err(AppError::from)
}

#[tauri::command]
pub fn reorder_projects(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), AppError> {
    let c = conn(&state)?;
    db::reorder_projects(&c, &ids).map_err(AppError::from)
}

/// 记录项目最近打开时间（用于「最近使用」排序）
#[tauri::command]
pub fn touch_project(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let c = conn(&state)?;
    db::touch_opened(&c, &id).map_err(AppError::from)
}

#[tauri::command]
pub fn rename_project(state: State<'_, AppState>, id: String, name: String) -> Result<Project, AppError> {
    let c = conn(&state)?;
    db::update_project(
        &c,
        &id,
        &ProjectPatch {
            name: Some(name),
            ..Default::default()
        },
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn set_project_tags(
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<Project, AppError> {
    let c = conn(&state)?;
    db::set_project_tags(&c, &id, &tags)?;
    db::get_project(&c, &id).ok_or_else(|| AppError::new("not_found", "项目不存在"))
}

#[tauri::command]
pub fn remove_project(
    state: State<'_, AppState>,
    id: String,
    stop_running: bool,
) -> Result<Vec<String>, AppError> {
    let c = conn(&state)?;
    let active = runs::active_runs(&c)
        .into_iter()
        .filter(|r| r.project_id == id)
        .collect::<Vec<_>>();
    if !active.is_empty() && !stop_running {
        return Err(AppError::new(
            "has_running",
            format!(
                "该项目有 {} 个任务在运行，移除项目记录前需要先停止它们。",
                active.len()
            ),
        )
        .with_project(&id));
    }
    let notices = if active.is_empty() {
        Vec::new()
    } else {
        runs::stop_for_project(&c, &id)
    };
    db::delete_project(&c, &id)?;
    Ok(notices)
}

#[tauri::command]
pub fn relocate_project(
    state: State<'_, AppState>,
    id: String,
    new_path: String,
) -> Result<Project, AppError> {
    let c = conn(&state)?;
    let project = db::get_project(&c, &id).ok_or_else(|| AppError::new("not_found", "项目不存在"))?;
    let new_root = paths::resolve_dir(&new_path)?;
    let new_root_str = new_root.to_string_lossy().to_string();
    let key = paths::compare_key(&new_root_str);
    if let Some(existing) = db::find_project_by_key(&c, &key) {
        if existing.id != id {
            return Err(AppError::duplicate(&existing));
        }
    }
    let old_root = project.root_path.clone();
    db::set_project_path(&c, &id, &new_root_str)?;

    // 旧路径下的绝对工作目录跟随迁移，相对路径保持不变
    for cfg in db::list_configs(&c, &id)? {
        if let Some(wd) = cfg.working_directory.as_deref() {
            if wd.starts_with(&old_root) {
                let suffix = wd.trim_start_matches(&old_root).trim_start_matches('/');
                let updated = if suffix.is_empty() {
                    new_root_str.clone()
                } else {
                    new_root.join(suffix).to_string_lossy().to_string()
                };
                let input = ConfigInput {
                    name: cfg.name.clone(),
                    runtime_type: cfg.runtime_type.clone(),
                    executable_path: cfg.executable_path.clone(),
                    entry_path: cfg.entry_path.clone(),
                    working_directory: Some(updated),
                    arguments: cfg.arguments.clone(),
                    env_vars: cfg.env_vars.clone(),
                    command: cfg.command.clone(),
                    launch_mode: Some(cfg.launch_mode.clone()),
                    port: cfg.port,
                    url: cfg.url.clone(),
                    open_browser: Some(cfg.open_browser),
                    keep_window: Some(cfg.keep_window),
                    unbuffered: Some(cfg.unbuffered),
                    is_default: Some(cfg.is_default),
                    allow_concurrent: Some(cfg.allow_concurrent),
                };
                let _ = db::update_config(&c, &cfg.id, &input);
            }
        }
    }

    db::get_project(&c, &id).ok_or_else(|| AppError::new("error", "项目更新后读取失败"))
}

#[tauri::command]
pub fn check_project_paths(state: State<'_, AppState>) -> Result<Vec<PathIssue>, AppError> {
    let c = conn(&state)?;
    let mut issues = Vec::new();
    for p in db::list_projects(&c)? {
        let status = if Path::new(&p.root_path).is_dir() { "ok" } else { "missing" };
        if status != p.path_status {
            db::set_path_status(&c, &p.id, status)?;
        }
        if status != "ok" {
            issues.push(PathIssue {
                project_id: p.id,
                name: p.name,
                root_path: p.root_path,
                status: status.into(),
            });
        }
    }
    Ok(issues)
}

/* ------------------------------------------------------------------ */
/* 分类 / 标签                                                          */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, AppError> {
    let c = conn(&state)?;
    db::list_categories(&c).map_err(AppError::from)
}

#[tauri::command]
pub fn create_category(state: State<'_, AppState>, name: String) -> Result<Vec<Category>, AppError> {
    let c = conn(&state)?;
    db::create_category(&c, &name)?;
    db::list_categories(&c).map_err(AppError::from)
}

#[tauri::command]
pub fn rename_category(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Vec<Category>, AppError> {
    let c = conn(&state)?;
    db::rename_category(&c, &id, &name)?;
    db::list_categories(&c).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: String) -> Result<Vec<Category>, AppError> {
    let c = conn(&state)?;
    db::delete_category(&c, &id)?;
    db::list_categories(&c).map_err(AppError::from)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    let c = conn(&state)?;
    db::list_tags(&c).map_err(AppError::from)
}

/* ------------------------------------------------------------------ */
/* 文件系统                                                            */
/* ------------------------------------------------------------------ */

fn ensure_inside_project(c: &Connection, path: &Path) -> Result<(), AppError> {
    let projects = db::list_projects(c)?;
    let ok = projects
        .iter()
        .any(|p| paths::is_within(Path::new(&p.root_path), path));
    if ok {
        Ok(())
    } else {
        Err(AppError::new(
            "forbidden",
            "该路径不在任何已注册的项目目录内，已拒绝访问。",
        ))
    }
}

#[tauri::command]
pub fn read_directory(state: State<'_, AppState>, path: String) -> Result<Vec<FileEntry>, AppError> {
    let c = conn(&state)?;
    let dir = paths::absolute(&path);
    if !dir.is_dir() {
        return Err(AppError::new("not_found", "目录不存在或不可访问"));
    }
    ensure_inside_project(&c, &dir)?;

    let rd = std::fs::read_dir(&dir).map_err(|e| AppError::new("io_error", format!("读取目录失败：{}", e)))?;
    let mut out: Vec<FileEntry> = Vec::new();
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        let path_buf = item.path();
        let link_meta = std::fs::symlink_metadata(&path_buf).ok();
        let is_symlink = link_meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
        let meta = std::fs::metadata(&path_buf).ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.with_timezone(&chrono::Local).to_rfc3339()
            });
        let has_children = if is_dir {
            std::fs::read_dir(&path_buf)
                .map(|mut it| it.next().is_some())
                .unwrap_or(false)
        } else {
            false
        };
        out.push(FileEntry {
            name,
            path: path_buf.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            size,
            modified,
            has_children,
        });
        if out.len() >= 3000 {
            break;
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub fn open_path(state: State<'_, AppState>, path: String, reveal: bool) -> Result<(), AppError> {
    let target = paths::absolute(&path);
    if !target.exists() {
        return Err(AppError::new("not_found", "目标不存在，可能已被移动或删除"));
    }
    {
        let c = conn(&state)?;
        if target.is_dir() {
            // 项目根目录本身允许打开
            if !db::list_projects(&c)?.iter().any(|p| paths::compare_key(&p.root_path) == paths::compare_key(&target.to_string_lossy())) {
                ensure_inside_project(&c, &target)?;
            }
        } else {
            ensure_inside_project(&c, &target)?;
        }
    }
    if reveal {
        launcher::reveal_in_finder(&target).map_err(AppError::from)
    } else {
        launcher::open_with_default(&target).map_err(AppError::from)
    }
}

#[tauri::command]
pub fn reveal_project(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let c = conn(&state)?;
    let p = db::get_project(&c, &id).ok_or_else(|| AppError::new("not_found", "项目不存在"))?;
    let path = PathBuf::from(&p.root_path);
    if !path.is_dir() {
        return Err(AppError::new(
            "path_missing",
            format!("项目目录不存在：{}\n请重新定位项目。", p.root_path),
        ));
    }
    launcher::open_in_finder(&path).map_err(AppError::from)
}

#[tauri::command]
pub fn open_project_terminal(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let c = conn(&state)?;
    let p = db::get_project(&c, &id).ok_or_else(|| AppError::new("not_found", "项目不存在"))?;
    let path = PathBuf::from(&p.root_path);
    if !path.is_dir() {
        return Err(AppError::new(
            "path_missing",
            format!("项目目录不存在：{}\n请重新定位项目。", p.root_path),
        ));
    }
    let line = format!("cd -- {}", paths::sh_quote(&p.root_path));
    launcher::open_in_terminal(&line, &format!("{} · 终端", p.name), true).map_err(AppError::from)
}

/* ------------------------------------------------------------------ */
/* 运行配置                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn list_configs(state: State<'_, AppState>, project_id: String) -> Result<Vec<LaunchConfig>, AppError> {
    let c = conn(&state)?;
    db::list_configs(&c, &project_id).map_err(AppError::from)
}

#[tauri::command]
pub fn save_config(
    state: State<'_, AppState>,
    project_id: String,
    config_id: Option<String>,
    input: ConfigInput,
) -> Result<LaunchConfig, AppError> {
    let c = conn(&state)?;
    match config_id {
        Some(id) => db::update_config(&c, &id, &input).map_err(AppError::from),
        None => db::insert_config(&c, &project_id, &input).map_err(AppError::from),
    }
}

#[tauri::command]
pub fn delete_config(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let c = conn(&state)?;
    db::delete_config(&c, &id).map_err(AppError::from)
}

#[tauri::command]
pub fn list_python_interpreters(
    _state: State<'_, AppState>,
    project_id: Option<String>,
) -> Vec<PythonInfo> {
    detect::detect_python(project_id.as_deref())
}

/* ------------------------------------------------------------------ */
/* 运行控制                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn run_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    config_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<LaunchOutcome, AppError> {
    let c = conn(&state)?;
    runs::launch(
        &app,
        &c,
        &state.data_dir,
        &state.pty,
        &project_id,
        config_id.as_deref(),
        cols.unwrap_or(100),
        rows.unwrap_or(30),
    )
}

/// 向内嵌终端写入按键（含交互式提示的输入）
#[tauri::command]
pub fn run_input(state: State<'_, AppState>, run_id: String, data: String) -> Result<(), AppError> {
    crate::pty::write_input(&state.pty, &run_id, &data).map_err(|m| AppError::new("pty_error", m))
}

/// 调整内嵌终端的行列数
#[tauri::command]
pub fn resize_pty(
    state: State<'_, AppState>,
    run_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    crate::pty::resize(&state.pty, &run_id, cols, rows).map_err(|m| AppError::new("pty_error", m))
}

/// 读取项目根目录的 README（不递归，大小写不敏感）
#[tauri::command]
pub fn read_project_readme(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<ReadmePayload>, AppError> {
    let c = conn(&state)?;
    let project = db::get_project(&c, &project_id)
        .ok_or_else(|| AppError::new("not_found", "项目不存在，可能已被移除"))?;
    let root = PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return Ok(None);
    }

    let mut found: Option<PathBuf> = None;
    if let Ok(rd) = std::fs::read_dir(&root) {
        for item in rd.flatten() {
            if !item.path().is_file() {
                continue;
            }
            let name = item.file_name().to_string_lossy().to_lowercase();
            if matches!(name.as_str(), "readme.md" | "readme.markdown" | "readme.mdx" | "说明.md") {
                found = Some(item.path());
                break;
            }
        }
    }
    let Some(path) = found else {
        return Ok(None);
    };

    let data = std::fs::read(&path)
        .map_err(|e| AppError::new("io_error", format!("读取 README 失败：{}", e)))?;
    let limit = 256 * 1024;
    let truncated = data.len() > limit;
    let slice = if truncated { &data[..limit] } else { &data[..] };
    Ok(Some(ReadmePayload {
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "README.md".into()),
        path: path.to_string_lossy().to_string(),
        content: String::from_utf8_lossy(slice).to_string(),
        truncated,
    }))
}

/// 回放历史输出（打开已结束任务的终端时用）
#[tauri::command]
pub fn read_run_log(
    state: State<'_, AppState>,
    run_id: String,
    max_bytes: Option<usize>,
) -> Result<String, AppError> {
    let c = conn(&state)?;
    let run = db::get_run(&c, &run_id).ok_or_else(|| AppError::new("not_found", "运行记录不存在"))?;
    let path = Path::new(&run.log_path);
    let data = std::fs::read(path).map_err(|e| AppError::new("no_log", format!("读取日志失败：{}", e)))?;
    let limit = max_bytes.unwrap_or(240_000);
    let start = data.len().saturating_sub(limit);
    Ok(String::from_utf8_lossy(&data[start..]).to_string())
}

#[tauri::command]
pub fn stop_run(state: State<'_, AppState>, run_id: String) -> Result<RunRecord, AppError> {
    let c = conn(&state)?;
    let result = runs::stop(&c, &run_id);
    crate::pty::close(&state.pty, &run_id);
    result
}

#[tauri::command]
pub fn list_runs(
    state: State<'_, AppState>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RunRecord>, AppError> {
    let c = conn(&state)?;
    runs::refresh_list(&c, project_id.as_deref(), limit.unwrap_or(120)).map_err(AppError::from)
}

#[tauri::command]
pub fn open_run_folder(state: State<'_, AppState>, run_id: String) -> Result<(), AppError> {
    let c = conn(&state)?;
    let run = db::get_run(&c, &run_id).ok_or_else(|| AppError::new("not_found", "运行记录不存在"))?;
    let dir = PathBuf::from(&run.task_dir);
    if !dir.is_dir() {
        return Err(AppError::new("not_found", "任务目录不存在，可能已被清理"));
    }
    launcher::open_in_finder(&dir).map_err(AppError::from)
}

/// 已探测到的运行时（node / npm / python3 / shell），用于设置页展示
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePath {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn runtime_paths() -> Vec<RuntimePath> {
    ["python3", "node", "npm", "pnpm", "zsh"]
        .iter()
        .filter_map(|name| {
            crate::shellenv::which(name).map(|path| RuntimePath {
                name: (*name).to_string(),
                path,
            })
        })
        .collect()
}

#[tauri::command]
pub fn clear_run_history(state: State<'_, AppState>) -> Result<(), AppError> {
    let c = conn(&state)?;
    db::clear_runs(&c).map_err(AppError::from)
}

/* ------------------------------------------------------------------ */
/* 设置 / 数据管理                                                      */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let c = conn(&state)?;
    db::save_settings(&c, &settings)?;
    Ok(db::get_settings(&c))
}

#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>) -> Result<(), AppError> {
    launcher::open_in_finder(&state.data_dir).map_err(AppError::from)
}

/// 复制文本到系统剪贴板（走 pbcopy，避免 WebView 的剪贴板权限限制）
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), AppError> {
    use std::io::Write;
    let mut child = std::process::Command::new("/usr/bin/pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::new("io_error", format!("无法访问剪贴板：{}", e)))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| AppError::new("io_error", format!("写入剪贴板失败：{}", e)))?;
    }
    child
        .wait()
        .map_err(|e| AppError::new("io_error", format!("剪贴板进程异常：{}", e)))?;
    Ok(())
}

/// 轻量诊断日志：写入数据目录下的 debug.log，用于排查拖拽等前端事件问题
#[tauri::command]
pub fn debug_log(state: State<'_, AppState>, text: String) -> Result<(), AppError> {
    use std::io::Write;
    let path = state.data_dir.join("debug.log");
    if std::fs::metadata(&path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let stamp = chrono::Local::now().format("%m-%d %H:%M:%S%.3f");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| AppError::new("io_error", format!("无法写入诊断日志：{}", e)))?;
    writeln!(file, "[{}] {}", stamp, text)
        .map_err(|e| AppError::new("io_error", e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn export_manifest(state: State<'_, AppState>, path: String) -> Result<String, AppError> {    let c = conn(&state)?;
    let projects = db::list_projects(&c)?;
    let categories = db::list_categories(&c)?;
    let mut items = Vec::new();
    for p in &projects {
        let configs = db::list_configs(&c, &p.id)?;
        let category_name = p
            .category_id
            .as_ref()
            .and_then(|cid| categories.iter().find(|c| &c.id == cid))
            .map(|c| c.name.clone());
        items.push(serde_json::json!({
            "name": p.name,
            "rootPath": p.root_path,
            "projectType": p.project_type,
            "category": category_name,
            "tags": p.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            "isFavorite": p.is_favorite,
            "notes": p.notes,
            "pathStatus": p.path_status,
            "configs": configs.iter().map(|cfg| serde_json::json!({
                "name": cfg.name,
                "runtimeType": cfg.runtime_type,
                "executablePath": cfg.executable_path,
                "entryPath": cfg.entry_path,
                "workingDirectory": cfg.working_directory,
                "arguments": cfg.arguments,
                "envVars": cfg.env_vars,
                "command": cfg.command,
                "launchMode": cfg.launch_mode,
                "port": cfg.port,
                "url": cfg.url,
                "openBrowser": cfg.open_browser,
                "keepWindow": cfg.keep_window,
                "unbuffered": cfg.unbuffered,
                "isDefault": cfg.is_default,
                "allowConcurrent": cfg.allow_concurrent
            })).collect::<Vec<_>>()
        }));
    }
    let doc = serde_json::json!({
        "app": "project-desk",
        "schemaVersion": 1,
        "exportedAt": db::now_iso(),
        "projects": items,
        "categories": categories.iter()
            .filter(|c| !c.is_builtin)
            .map(|c| serde_json::json!({"name": c.name, "kind": c.kind}))
            .collect::<Vec<_>>()
    });
    let out = paths::absolute(&path);
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&out, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?)
        .map_err(|e| AppError::new("io_error", format!("写入导出文件失败：{}", e)))?;
    Ok(out.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_manifest(state: State<'_, AppState>, path: String) -> Result<ImportReport, AppError> {
    let c = conn(&state)?;
    let raw = std::fs::read_to_string(paths::absolute(&path))
        .map_err(|e| AppError::new("io_error", format!("读取导入文件失败：{}", e)))?;
    let doc: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::new("bad_json", format!("不是有效的项目清单文件：{}", e)))?;
    let projects = doc
        .get("projects")
        .and_then(|p| p.as_array())
        .ok_or_else(|| AppError::new("bad_json", "清单中缺少 projects 数组"))?;

    let mut report = ImportReport::default();

    if let Some(cats) = doc.get("categories").and_then(|c| c.as_array()) {
        for cat in cats {
            if let Some(name) = cat.get("name").and_then(|n| n.as_str()) {
                if !db::list_categories(&c)?.iter().any(|x| x.name == name) {
                    if db::create_category(&c, name).is_ok() {
                        report.categories_created += 1;
                    }
                }
            }
        }
    }

    for item in projects {
        let root_raw = item.get("rootPath").and_then(|v| v.as_str()).unwrap_or_default();
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("未命名项目");
        if root_raw.is_empty() {
            report.errors.push(format!("「{}」缺少 rootPath，已跳过", name));
            continue;
        }
        let abs = paths::absolute(root_raw);
        let key = paths::compare_key(&abs.to_string_lossy());
        if let Some(existing) = db::find_project_by_key(&c, &key) {
            report.skipped_existing += 1;
            report
                .errors
                .push(format!("「{}」与已有项目「{}」路径相同，已跳过", name, existing.name));
            continue;
        }
        let exists = abs.is_dir();
        if !exists {
            report.missing_paths.push(abs.to_string_lossy().to_string());
        }
        let category_id = item
            .get("category")
            .and_then(|v| v.as_str())
            .and_then(|name| {
                db::list_categories(&c)
                    .ok()?
                    .into_iter()
                    .find(|c| c.name == name)
                    .map(|c| c.id)
            });
        let project_type = item
            .get("projectType")
            .and_then(|v| v.as_str())
            .unwrap_or("other");
        let project = db::insert_project(
            &c,
            &db::NewProject {
                name: name.to_string(),
                root_path: abs.to_string_lossy().to_string(),
                project_type: project_type.to_string(),
                category_id,
                icon: None,
            },
        )?;
        if !exists {
            db::set_path_status(&c, &project.id, "missing")?;
        }
        if let Some(tags) = item.get("tags").and_then(|v| v.as_array()) {
            let names: Vec<String> = tags
                .iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect();
            let _ = db::set_project_tags(&c, &project.id, &names);
        }
        if item.get("isFavorite").and_then(|v| v.as_bool()).unwrap_or(false) {
            let _ = db::update_project(
                &c,
                &project.id,
                &ProjectPatch {
                    is_favorite: Some(true),
                    ..Default::default()
                },
            );
        }
        if let Some(notes) = item.get("notes").and_then(|v| v.as_str()) {
            let _ = db::update_project(
                &c,
                &project.id,
                &ProjectPatch {
                    notes: Some(Some(notes.to_string())),
                    ..Default::default()
                },
            );
        }
        if let Some(configs) = item.get("configs").and_then(|v| v.as_array()) {
            for cfg in configs {
                let mut executable = cfg
                    .get("executablePath")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(exe) = &executable {
                    if !Path::new(exe).exists() {
                        report.errors.push(format!(
                            "「{}」的运行配置解释器/运行时不存在：{}（已清空，请重新指定）",
                            name, exe
                        ));
                        executable = None;
                    }
                }
                let input = ConfigInput {
                    name: cfg.get("name").and_then(|v| v.as_str()).unwrap_or("默认").to_string(),
                    runtime_type: cfg
                        .get("runtimeType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("custom")
                        .to_string(),
                    executable_path: executable,
                    entry_path: cfg.get("entryPath").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    working_directory: cfg
                        .get("workingDirectory")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    arguments: cfg
                        .get("arguments")
                        .and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                        .unwrap_or_default(),
                    env_vars: cfg
                        .get("envVars")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default(),
                    command: cfg.get("command").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    launch_mode: cfg.get("launchMode").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    port: cfg.get("port").and_then(|v| v.as_u64()).map(|p| p as u16),
                    url: cfg.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    open_browser: cfg.get("openBrowser").and_then(|v| v.as_bool()),
                    keep_window: cfg.get("keepWindow").and_then(|v| v.as_bool()),
                    unbuffered: cfg.get("unbuffered").and_then(|v| v.as_bool()),
                    is_default: cfg.get("isDefault").and_then(|v| v.as_bool()),
                    allow_concurrent: cfg.get("allowConcurrent").and_then(|v| v.as_bool()),
                };
                if let Err(e) = db::insert_config(&c, &project.id, &input) {
                    report.errors.push(format!("「{}」的配置「{}」导入失败：{}", name, input.name, e));
                }
            }
        }
        report.imported += 1;
    }

    Ok(report)
}
