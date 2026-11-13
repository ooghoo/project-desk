use crate::db::{self, NewRun};
use crate::error::AppError;
use crate::launcher::{self, TaskFiles};
use crate::models::{LaunchConfig, LaunchOutcome, Project, RunRecord};
use rusqlite::Connection;
use std::path::Path;

fn now() -> String {
    db::now_iso()
}

fn age_seconds(started_at: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .map(|t| {
            chrono::Local::now()
                .signed_duration_since(t.with_timezone(&chrono::Local))
                .num_seconds()
        })
        .unwrap_or(9999)
}

/// 依据真实的 pid 文件 / 退出码文件推导状态，而不是沿用数据库里的旧值。
pub fn refresh(conn: &Connection, mut run: RunRecord) -> RunRecord {
    if matches!(run.status.as_str(), "exited" | "stopped" | "failed") {
        // 已结束的任务仍尝试补全退出码
        if run.exit_code.is_none() {
            if let Some(code) = launcher::read_exit_code(Path::new(&run.exit_file)) {
                run.exit_code = Some(code);
                let _ = db::update_run_state(conn, &run.id, "exited", Some(code), None, None, run.ended_at.as_deref());
                run.status = "exited".into();
            }
        }
        return run;
    }

    let pid = launcher::read_pid(Path::new(&run.pid_file)).or(run.pid);
    let exit_code = launcher::read_exit_code(Path::new(&run.exit_file));
    let alive = pid.map(launcher::pid_alive).unwrap_or(false);
    let age = age_seconds(&run.started_at);

    let mut status = run.status.clone();
    let mut ended = run.ended_at.clone();
    let mut new_pid: Option<i64> = None;

    if alive {
        status = "running".into();
        if let Some(p) = pid {
            if run.pid != Some(p) {
                new_pid = Some(p);
            }
        }
    } else if let Some(code) = exit_code {
        status = "exited".into();
        run.exit_code = Some(code);
        if ended.is_none() {
            ended = Some(now());
        }
    } else {
        match run.status.as_str() {
            "requested" | "started" => {
                // 终端窗口可能还在打开，留出缓冲时间
                status = if age > 12 { "unknown".into() } else { "requested".into() };
            }
            _ => {
                if age > 12 {
                    status = "unknown".into();
                }
            }
        }
    }

    if status != run.status || new_pid.is_some() || ended != run.ended_at {
        let _ = db::update_run_state(
            conn,
            &run.id,
            &status,
            run.exit_code,
            new_pid,
            None,
            ended.as_deref(),
        );
    }

    run.status = status;
    run.ended_at = ended;
    if let Some(p) = new_pid {
        run.pid = Some(p);
    }
    run
}

pub fn refresh_list(conn: &Connection, project_id: Option<&str>, limit: i64) -> Result<Vec<RunRecord>, String> {
    let runs = db::list_runs(conn, project_id, limit)?;
    Ok(runs.into_iter().map(|r| refresh(conn, r)).collect())
}

pub fn active_runs(conn: &Connection) -> Vec<RunRecord> {
    let runs = db::list_runs(conn, None, 200).unwrap_or_default();
    runs.into_iter()
        .map(|r| refresh(conn, r))
        .filter(|r| matches!(r.status.as_str(), "requested" | "started" | "running"))
        .collect()
}

fn pick_config(conn: &Connection, project_id: &str, config_id: Option<&str>) -> Result<LaunchConfig, AppError> {
    let configs = db::list_configs(conn, project_id)?;
    if configs.is_empty() {
        return Err(AppError::new(
            "no_config",
            "该项目还没有运行配置。\n请先在「运行配置」中添加运行方式（Python / HTML / Web 服务等）。",
        )
        .with_project(project_id));
    }
    if let Some(id) = config_id {
        return configs
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::new("no_config", "运行配置不存在或已被删除"));
    }
    let fallback = configs
        .iter()
        .find(|c| c.is_default)
        .cloned()
        .or_else(|| configs.first().cloned());
    fallback.ok_or_else(|| AppError::new("no_config", "运行配置不存在"))
}

/// 启动任务。所有前置校验（目录 / 入口 / 解释器 / 端口）都在这里完成，
/// 校验失败直接返回错误，不会出现"界面上显示在运行、实际没跑起来"的情况。
/// 进程跑在应用内嵌的 pty 里，输出通过事件推给前端终端。
#[allow(clippy::too_many_arguments)]
pub fn launch(
    app: &tauri::AppHandle,
    conn: &Connection,
    data_dir: &Path,
    pty: &crate::pty::PtyStore,
    project_id: &str,
    config_id: Option<&str>,
    cols: u16,
    rows: u16,
) -> Result<LaunchOutcome, AppError> {
    let project: Project = db::get_project(conn, project_id)
        .ok_or_else(|| AppError::new("not_found", "项目不存在，可能已被移除"))?;
    let config = pick_config(conn, project_id, config_id)?;

    if !config.allow_concurrent {
        let existing = active_runs(conn)
            .into_iter()
            .find(|r| r.project_id == project_id && r.config_id.as_deref() == Some(config.id.as_str()));
        if let Some(run) = existing {
            return Err(AppError::new(
                "already_running",
                "该运行配置已有任务在运行。\n如需重复启动，可在运行配置中开启「允许并发启动」，或先停止当前任务。",
            )
            .with_run(&run.id)
            .with_project(project_id));
        }
    }

    let spec = launcher::build_spec(&project, &config)
        .map_err(|msg| AppError::new("launch_failed", msg).with_project(project_id))?;

    // 静态页面直接用浏览器打开：不创建运行记录、不启动进程
    if spec.browser_only {
        let entry = spec
            .entry_file
            .clone()
            .ok_or_else(|| AppError::new("no_entry", "缺少要打开的 HTML 文件"))?;
        if !entry.is_file() {
            return Err(
                AppError::new("no_entry", format!("找不到要打开的文件：{}", entry.display()))
                    .with_project(project_id),
            );
        }
        launcher::open_with_default(&entry).map_err(|msg| AppError::new("open_failed", msg))?;
        db::touch_opened(conn, project_id)?;
        return Ok(LaunchOutcome::Opened {
            path: entry.to_string_lossy().to_string(),
        });
    }

    let run_id = db::new_id("run");
    let files = TaskFiles::new(data_dir, &run_id)
        .map_err(|msg| AppError::new("launch_failed", msg).with_project(project_id))?;
    let title = format!("{} · {}", project.name, config.name);
    launcher::write_script(&files, &spec, &title, &project)?;

    let new_run = NewRun {
        id: run_id.clone(),
        project_id: project_id.to_string(),
        config_id: Some(config.id.clone()),
        config_name: Some(config.name.clone()),
        runtime_type: config.runtime_type.clone(),
        command: spec.command_display.clone(),
        working_directory: spec.working_directory.to_string_lossy().to_string(),
        status: "requested".into(),
        log_path: files.log.to_string_lossy().to_string(),
        task_dir: files.dir.to_string_lossy().to_string(),
        pid_file: files.pid.to_string_lossy().to_string(),
        exit_file: files.exit.to_string_lossy().to_string(),
        started_at: now(),
    };
    db::insert_run(conn, &new_run)?;

    let envs: Vec<(String, String)> = spec
        .envs
        .iter()
        .map(|e| (e.key.clone(), e.value.clone()))
        .collect();
    match crate::pty::spawn(
        app.clone(),
        pty.clone(),
        crate::pty::SpawnArgs {
            run_id: run_id.clone(),
            program: "/bin/bash".into(),
            args: vec![files.script.to_string_lossy().to_string()],
            cwd: spec.working_directory.clone(),
            envs,
            log_path: files.log.clone(),
            rows,
            cols,
        },
    ) {
        Ok(pid) => {
            if pid > 0 {
                db::update_run_state(
                    conn,
                    &run_id,
                    "requested",
                    None,
                    Some(pid as i64),
                    None,
                    None,
                )?;
            }
            db::touch_run(conn, project_id)?;
        }
        Err(msg) => {
            db::update_run_state(conn, &run_id, "failed", None, None, Some(&msg), Some(&now()))?;
            return Err(AppError::new("launch_failed", msg).with_run(&run_id));
        }
    }

    let run = db::get_run(conn, &run_id).ok_or_else(|| AppError::new("error", "运行记录写入后读取失败"))?;
    Ok(LaunchOutcome::Run {
        run: refresh(conn, run),
    })
}

/// 停止任务：按进程树终止，避免 npm / node 等子进程继续占用端口
pub fn stop(conn: &Connection, run_id: &str) -> Result<RunRecord, AppError> {
    let run = db::get_run(conn, run_id).ok_or_else(|| AppError::new("not_found", "运行记录不存在"))?;
    let refreshed = refresh(conn, run);
    if matches!(refreshed.status.as_str(), "exited" | "stopped" | "failed" | "unknown") {
        return Ok(refreshed);
    }
    let pid = launcher::read_pid(Path::new(&refreshed.pid_file)).or(refreshed.pid);
    let note: Option<String> = match pid {
        Some(p) => match launcher::stop_process_tree(p) {
            Ok(info) => Some(info),
            Err(msg) => {
                db::update_run_state(conn, run_id, "running", None, None, Some(&msg), None)?;
                return Err(AppError::new("stop_failed", msg).with_run(run_id));
            }
        },
        None => Some("未找到任务进程（可能尚未启动完成或已退出），已标记为停止。".into()),
    };
    db::update_run_state(conn, run_id, "stopped", None, None, note.as_deref(), Some(&now()))?;
    let run = db::get_run(conn, run_id).ok_or_else(|| AppError::new("error", "运行记录读取失败"))?;
    Ok(run)
}

pub fn stop_for_project(conn: &Connection, project_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    for run in active_runs(conn).into_iter().filter(|r| r.project_id == project_id) {
        if let Err(err) = stop(conn, &run.id) {
            out.push(format!("{}：{}", run.config_name.unwrap_or_else(|| "任务".into()), err.message));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    fn fake_run(conn: &Connection, dir: &Path, status: &str) -> String {
        let run_id = "run_test".to_string();
        db::insert_run(
            conn,
            &NewRun {
                id: run_id.clone(),
                project_id: "p1".into(),
                config_id: Some("c1".into()),
                config_name: Some("默认".into()),
                runtime_type: "python".into(),
                command: "python main.py".into(),
                working_directory: "/tmp".into(),
                status: status.into(),
                log_path: dir.join("task.log").to_string_lossy().to_string(),
                task_dir: dir.to_string_lossy().to_string(),
                pid_file: dir.join("task.pid").to_string_lossy().to_string(),
                exit_file: dir.join("task.exit").to_string_lossy().to_string(),
                started_at: db::now_iso(),
            },
        )
        .unwrap();
        run_id
    }

    #[test]
    fn exit_file_marks_task_exited() {
        let conn = mem();
        let dir = crate::testutil::tmp_dir("run");
        let id = fake_run(&conn, &dir, "running");
        std::fs::write(dir.join("task.exit"), "0").unwrap();
        let run = db::get_run(&conn, &id).unwrap();
        let refreshed = refresh(&conn, run);
        assert_eq!(refreshed.status, "exited");
        assert_eq!(refreshed.exit_code, Some(0));
        // 已持久化
        let again = db::get_run(&conn, &id).unwrap();
        assert_eq!(again.status, "exited");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dead_pid_without_exit_marker_is_unknown() {
        let conn = mem();
        let dir = crate::testutil::tmp_dir("run");
        let id = fake_run(&conn, &dir, "running");
        std::fs::write(dir.join("task.pid"), "999999").unwrap();
        // 把启动时间往前推，越过 12 秒的「终端正在打开」缓冲窗口
        let past = (chrono::Local::now() - chrono::Duration::seconds(60)).to_rfc3339();
        conn.execute(
            "UPDATE run_history SET started_at = ?1 WHERE id = ?2",
            rusqlite::params![past, id],
        )
        .unwrap();
        let run = db::get_run(&conn, &id).unwrap();
        let refreshed = refresh(&conn, run);
        assert_eq!(refreshed.status, "unknown");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fresh_task_without_pid_shows_requested() {
        let conn = mem();
        let dir = crate::testutil::tmp_dir("run-fresh");
        let id = fake_run(&conn, &dir, "started");
        let run = db::get_run(&conn, &id).unwrap();
        // 终端窗口还没起来时，不应直接判定为未知
        assert_eq!(refresh(&conn, run).status, "requested");
        std::fs::remove_dir_all(&dir).ok();
    }
}
