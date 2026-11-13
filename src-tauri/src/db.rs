use crate::models::*;
use crate::paths;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

pub fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

pub fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

/* ------------------------------------------------------------------ */
/* 打开数据库 + 迁移                                                    */
/* ------------------------------------------------------------------ */

const MIGRATIONS: &[&str] = &[
    // v1 —— 初始结构
    r#"
    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'custom',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      root_path      TEXT NOT NULL,
      project_type   TEXT NOT NULL DEFAULT 'other',
      category_id    TEXT,
      icon           TEXT,
      is_favorite    INTEGER NOT NULL DEFAULT 0,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      path_status    TEXT NOT NULL DEFAULT 'ok',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      last_opened_at TEXT,
      last_run_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id);

    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_tags (
      project_id TEXT NOT NULL,
      tag_id     TEXT NOT NULL,
      PRIMARY KEY (project_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS launch_configurations (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL,
      name           TEXT NOT NULL,
      runtime_type   TEXT NOT NULL,
      executable_path TEXT,
      entry_path     TEXT,
      working_directory TEXT,
      arguments      TEXT NOT NULL DEFAULT '[]',
      env_vars       TEXT NOT NULL DEFAULT '[]',
      command        TEXT,
      launch_mode    TEXT NOT NULL DEFAULT 'terminal',
      port           INTEGER,
      url            TEXT,
      open_browser   INTEGER NOT NULL DEFAULT 0,
      keep_window    INTEGER NOT NULL DEFAULT 1,
      unbuffered     INTEGER NOT NULL DEFAULT 1,
      is_default     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_configs_project ON launch_configurations(project_id);

    CREATE TABLE IF NOT EXISTS run_history (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      config_id     TEXT,
      config_name   TEXT,
      runtime_type  TEXT NOT NULL,
      command       TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      status        TEXT NOT NULL,
      exit_code     INTEGER,
      error         TEXT,
      pid           INTEGER,
      log_path      TEXT NOT NULL,
      task_dir      TEXT NOT NULL,
      pid_file      TEXT NOT NULL,
      exit_file     TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      ended_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_project ON run_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON run_history(started_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    "#,
    // v2 —— 运行配置支持"允许并发启动"
    r#"
    ALTER TABLE launch_configurations ADD COLUMN allow_concurrent INTEGER NOT NULL DEFAULT 0;
    "#,
    // v3 —— 记录被删除的内置分类，避免 seed() 在下次启动时把它们重新建回来
    r#"
    CREATE TABLE IF NOT EXISTS removed_builtin_categories (
      id         TEXT PRIMARY KEY,
      removed_at TEXT NOT NULL
    );
    "#,
    // v4 —— 运行配置来源标记：来自 launcher.json 的配置在重新扫描时可安全覆盖
    r#"
    ALTER TABLE launch_configurations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE launch_configurations ADD COLUMN source_config_id TEXT;
    ALTER TABLE launch_configurations ADD COLUMN config_type TEXT NOT NULL DEFAULT 'task';
    ALTER TABLE launch_configurations ADD COLUMN stop_strategy TEXT NOT NULL DEFAULT 'process_tree';
    ALTER TABLE launch_configurations ADD COLUMN startup_timeout INTEGER;
    CREATE INDEX IF NOT EXISTS idx_configs_project_source ON launch_configurations(project_id, source);
    "#,
];

pub fn open(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建数据目录：{}", e))?;
    }
    let conn = Connection::open(db_path).map_err(|e| format!("无法打开数据库：{}", e))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn user_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

pub fn migrate(conn: &Connection) -> Result<(), String> {
    let mut version = user_version(conn)?;
    while (version as usize) < MIGRATIONS.len() {
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        match conn.execute_batch(MIGRATIONS[version as usize]) {
            Ok(_) => {
                conn.execute_batch(&format!("PRAGMA user_version = {}", version + 1))
                    .map_err(|e| e.to_string())?;
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                version += 1;
            }
            Err(err) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(format!("数据库迁移失败（v{}）：{}", version + 1, err));
            }
        }
    }
    seed(conn)?;
    Ok(())
}

fn seed(conn: &Connection) -> Result<(), String> {
    let builtins = [
        ("cat_web", "Web 应用", "web", 0),
        ("cat_python", "Python 工具", "python", 1),
        ("cat_automation", "自动化工具", "automation", 2),
        ("cat_other", "其他项目", "other", 3),
    ];
    let ts = now_iso();
    for (id, name, kind, order) in builtins {
        // 已被用户删除的内置分类不再自动重建
        let removed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM removed_builtin_categories WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if removed > 0 {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO categories (id, name, kind, sort_order, is_builtin, created_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params![id, name, kind, order, ts],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

pub fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "theme": "system",
        "view": "list",
        "startup": "last",
        "restoreWorkspace": true,
        "sidebarWidth": 236,
        "listWidth": 348,
        "showDetail": true,
        "sort": "recent",
        "lastProjectId": null,
        "lastNav": "all",
        "pythonInterpreters": [],
        "defaultTerminal": "Terminal",
        "defaultPort": 8000,
        "keepWindow": true,
        "checkPathsOnLaunch": true,
        "missingStrategy": "keep",
        "collapsedCategories": [],
        "sortDirection": "desc"
    })
}

pub fn get_settings(conn: &Connection) -> serde_json::Value {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'app'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let mut base = default_settings();
    if let Some(text) = raw {
        if let Ok(saved) = serde_json::from_str::<serde_json::Value>(&text) {
            merge_json(&mut base, saved);
        }
    }
    base
}

pub fn save_settings(conn: &Connection, value: &serde_json::Value) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('app', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value.to_string()],
    )
    .map_err(|e| format!("保存设置失败：{}", e))?;
    Ok(())
}

fn merge_json(base: &mut serde_json::Value, patch: serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                match b.get_mut(&k) {
                    Some(slot) => merge_json(slot, v),
                    None => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (slot, v) => *slot = v,
    }
}

/* ------------------------------------------------------------------ */
/* 分类                                                                */
/* ------------------------------------------------------------------ */

pub fn list_categories(conn: &Connection) -> Result<Vec<Category>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.kind, c.sort_order, c.is_builtin,
                    (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id) AS cnt
             FROM categories c ORDER BY c.sort_order ASC, c.created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                sort_order: r.get(3)?,
                is_builtin: r.get::<_, i64>(4)? == 1,
                project_count: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn category_by_kind(conn: &Connection, kind: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM categories WHERE kind = ?1 AND is_builtin = 1 LIMIT 1",
        params![kind],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn create_category(conn: &Connection, name: &str) -> Result<Category, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".into());
    }
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_some() {
        return Err(format!("分类「{}」已存在", name));
    }
    let max: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM categories", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    let cat = Category {
        id: new_id("cat"),
        name: name.to_string(),
        kind: "custom".into(),
        sort_order: max + 1,
        is_builtin: false,
        project_count: 0,
    };
    conn.execute(
        "INSERT INTO categories (id, name, kind, sort_order, is_builtin, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![cat.id, cat.name, cat.kind, cat.sort_order, now_iso()],
    )
    .map_err(|e| format!("创建分类失败：{}", e))?;
    Ok(cat)
}

pub fn rename_category(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名称不能为空".into());
    }
    let dup: Option<String> = conn
        .query_row(
            "SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
            params![name, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if dup.is_some() {
        return Err(format!("分类「{}」已存在", name));
    }
    conn.execute(
        "UPDATE categories SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_category(conn: &Connection, id: &str) -> Result<(), String> {
    let builtin: i64 = conn
        .query_row(
            "SELECT is_builtin FROM categories WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    // 内置分类允许删除：记一条移除记录，避免下次启动被 seed() 重建
    if builtin == 1 {
        conn.execute(
            "INSERT OR IGNORE INTO removed_builtin_categories (id, removed_at) VALUES (?1, ?2)",
            params![id, now_iso()],
        )
        .map_err(|e| e.to_string())?;
    }
    // 分类内的项目回到「未分类」，不删除任何项目记录
    conn.execute(
        "UPDATE projects SET category_id = NULL WHERE category_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 标签                                                                */
/* ------------------------------------------------------------------ */

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name FROM tags t
             ORDER BY (SELECT COUNT(*) FROM project_tags pt WHERE pt.tag_id = t.id) DESC, t.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn ensure_tag(conn: &Connection, name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("标签不能为空".into());
    }
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
            params![trimmed],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }
    let id = new_id("tag");
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, trimmed, now_iso()],
    )
    .map_err(|e| format!("创建标签失败：{}", e))?;
    Ok(id)
}

pub fn set_project_tags(conn: &Connection, project_id: &str, names: &[String]) -> Result<(), String> {
    conn.execute(
        "DELETE FROM project_tags WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;
    for name in names {
        if name.trim().is_empty() {
            continue;
        }
        let tag_id = ensure_tag(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?1, ?2)",
            params![project_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    // 清理孤立标签
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)",
        [],
    )
    .ok();
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 项目                                                                */
/* ------------------------------------------------------------------ */

const PROJECT_COLUMNS: &str = "p.id, p.name, p.root_path, p.project_type, p.category_id, p.icon,
     p.is_favorite, p.sort_order, p.notes, p.path_status, p.created_at, p.updated_at,
     p.last_opened_at, p.last_run_at,
     (SELECT group_concat(t.name, char(31)) FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.project_id = p.id) AS tag_names,
     (SELECT COUNT(*) FROM launch_configurations c WHERE c.project_id = p.id) AS config_count";

fn row_to_project(r: &Row) -> rusqlite::Result<Project> {
    let tag_blob: Option<String> = r.get(14)?;
    let tags = tag_blob
        .map(|blob| {
            blob.split('\u{1f}')
                .filter(|s| !s.is_empty())
                .map(|name| Tag {
                    id: String::new(),
                    name: name.to_string(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        root_path: r.get(2)?,
        project_type: r.get(3)?,
        category_id: r.get(4)?,
        icon: r.get(5)?,
        is_favorite: r.get::<_, i64>(6)? == 1,
        sort_order: r.get(7)?,
        notes: r.get(8)?,
        path_status: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        last_opened_at: r.get(12)?,
        last_run_at: r.get(13)?,
        tags,
        config_count: r.get(15)?,
    })
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let sql = format!(
        "SELECT {} FROM projects p ORDER BY p.sort_order ASC, p.created_at DESC",
        PROJECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_project).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_project(conn: &Connection, id: &str) -> Option<Project> {
    let sql = format!("SELECT {} FROM projects p WHERE p.id = ?1", PROJECT_COLUMNS);
    conn.query_row(&sql, params![id], row_to_project).ok()
}

pub fn find_project_by_key(conn: &Connection, key: &str) -> Option<Project> {
    let projects = list_projects(conn).ok()?;
    projects
        .into_iter()
        .find(|p| paths::compare_key(&p.root_path) == key)
}

pub struct NewProject {
    pub name: String,
    pub root_path: String,
    pub project_type: String,
    pub category_id: Option<String>,
    pub icon: Option<String>,
}

pub fn insert_project(conn: &Connection, new: &NewProject) -> Result<Project, String> {
    let ts = now_iso();
    let id = new_id("prj");
    let max: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM projects", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO projects (id, name, root_path, project_type, category_id, icon, is_favorite,
            sort_order, notes, path_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, NULL, 'ok', ?8, ?8)",
        params![
            id,
            new.name,
            new.root_path,
            new.project_type,
            new.category_id,
            new.icon,
            max + 1,
            ts
        ],
    )
    .map_err(|e| format!("添加项目失败：{}", e))?;
    get_project(conn, &id).ok_or_else(|| "项目写入后读取失败".to_string())
}

pub fn update_project(conn: &Connection, id: &str, patch: &ProjectPatch) -> Result<Project, String> {
    let current = get_project(conn, id).ok_or_else(|| "项目不存在".to_string())?;
    let name = patch.name.clone().unwrap_or(current.name);
    if name.trim().is_empty() {
        return Err("项目名称不能为空".into());
    }
    let project_type = patch
        .project_type
        .clone()
        .unwrap_or(current.project_type);
    let category_id = match &patch.category_id {
        Some(v) => v.clone(),
        None => current.category_id.clone(),
    };
    let icon = match &patch.icon {
        Some(v) => v.clone(),
        None => current.icon.clone(),
    };
    let notes = match &patch.notes {
        Some(v) => v.clone(),
        None => current.notes.clone(),
    };
    let is_favorite = patch.is_favorite.unwrap_or(current.is_favorite);
    let sort_order = patch.sort_order.unwrap_or(current.sort_order);
    conn.execute(
        "UPDATE projects SET name = ?1, project_type = ?2, category_id = ?3, icon = ?4,
            notes = ?5, is_favorite = ?6, sort_order = ?7, updated_at = ?8 WHERE id = ?9",
        params![
            name.trim(),
            project_type,
            category_id,
            icon,
            notes,
            is_favorite as i64,
            sort_order,
            now_iso(),
            id
        ],
    )
    .map_err(|e| format!("更新项目失败：{}", e))?;
    if let Some(tags) = &patch.tags {
        set_project_tags(conn, id, tags)?;
    }
    get_project(conn, id).ok_or_else(|| "项目更新后读取失败".to_string())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM project_tags WHERE project_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM launch_configurations WHERE project_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_project_path(conn: &Connection, id: &str, root_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET root_path = ?1, path_status = 'ok', updated_at = ?2 WHERE id = ?3",
        params![root_path, now_iso(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_path_status(conn: &Connection, id: &str, status: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET path_status = ?1 WHERE id = ?2",
        params![status, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按给定顺序重排项目（仅影响应用内排序权重，不触碰磁盘）
pub fn reorder_projects(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
            params![((index as i64) + 1) * 10, id],
        )
        .map_err(|e| format!("调整排序失败：{}", e))?;
    }
    Ok(())
}

pub fn touch_opened(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
        params![now_iso(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn touch_run(conn: &Connection, id: &str) -> Result<(), String> {
    let ts = now_iso();
    conn.execute(
        "UPDATE projects SET last_run_at = ?1, last_opened_at = ?1 WHERE id = ?2",
        params![ts, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 运行配置                                                            */
/* ------------------------------------------------------------------ */

const CONFIG_COLUMNS: &str = "id, project_id, name, runtime_type, executable_path, entry_path,
  working_directory, arguments, env_vars, command, launch_mode, port, url, open_browser,
  keep_window, unbuffered, is_default, allow_concurrent, created_at, updated_at,
  source, source_config_id, config_type, stop_strategy, startup_timeout";

fn row_to_config(r: &Row) -> rusqlite::Result<LaunchConfig> {
    let args_blob: String = r.get(7)?;
    let env_blob: String = r.get(8)?;
    Ok(LaunchConfig {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        runtime_type: r.get(3)?,
        executable_path: r.get(4)?,
        entry_path: r.get(5)?,
        working_directory: r.get(6)?,
        arguments: serde_json::from_str(&args_blob).unwrap_or_default(),
        env_vars: serde_json::from_str(&env_blob).unwrap_or_default(),
        command: r.get(9)?,
        launch_mode: r.get(10)?,
        port: r.get::<_, Option<i64>>(11)?.map(|v| v as u16),
        url: r.get(12)?,
        open_browser: r.get::<_, i64>(13)? == 1,
        keep_window: r.get::<_, i64>(14)? == 1,
        unbuffered: r.get::<_, i64>(15)? == 1,
        is_default: r.get::<_, i64>(16)? == 1,
        allow_concurrent: r.get::<_, i64>(17)? == 1,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
        source: r.get(20)?,
        source_config_id: r.get(21)?,
        config_type: r.get(22)?,
        stop_strategy: r.get(23)?,
        startup_timeout: r.get::<_, Option<i64>>(24)?.map(|v| v as u64),
    })
}

pub fn list_configs(conn: &Connection, project_id: &str) -> Result<Vec<LaunchConfig>, String> {
    let sql = format!(
        "SELECT {} FROM launch_configurations WHERE project_id = ?1 ORDER BY is_default DESC, created_at ASC",
        CONFIG_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], row_to_config)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_config(conn: &Connection, id: &str) -> Option<LaunchConfig> {
    let sql = format!("SELECT {} FROM launch_configurations WHERE id = ?1", CONFIG_COLUMNS);
    conn.query_row(&sql, params![id], row_to_config).ok()
}

pub fn insert_config(conn: &Connection, project_id: &str, input: &ConfigInput) -> Result<LaunchConfig, String> {
    insert_config_full(conn, project_id, input, None, None, None, None)
}

/// 完整插入：可携带 launcher.json 来源信息
pub fn insert_config_full(
    conn: &Connection,
    project_id: &str,
    input: &ConfigInput,
    source: Option<&str>,
    source_config_id: Option<&str>,
    config_type: Option<&str>,
    startup_timeout: Option<u64>,
) -> Result<LaunchConfig, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("运行配置名称不能为空".into());
    }
    let ts = now_iso();
    let id = new_id("cfg");
    let is_default = input.is_default.unwrap_or(false);
    if is_default {
        conn.execute(
            "UPDATE launch_configurations SET is_default = 0 WHERE project_id = ?1",
            params![project_id],
        )
        .ok();
    }
    conn.execute(
        "INSERT INTO launch_configurations (id, project_id, name, runtime_type, executable_path,
            entry_path, working_directory, arguments, env_vars, command, launch_mode, port, url,
            open_browser, keep_window, unbuffered, is_default, allow_concurrent, created_at, updated_at,
            source, source_config_id, config_type, stop_strategy, startup_timeout)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19,
            ?20, ?21, ?22, ?23, ?24)",
        params![
            id,
            project_id,
            name,
            input.runtime_type,
            input.executable_path,
            input.entry_path,
            input.working_directory,
            serde_json::to_string(&input.arguments).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&input.env_vars).unwrap_or_else(|_| "[]".into()),
            input.command,
            input.launch_mode.clone().unwrap_or_else(|| "terminal".into()),
            input.port.map(|p| p as i64),
            input.url,
            input.open_browser.unwrap_or(false) as i64,
            input.keep_window.unwrap_or(true) as i64,
            input.unbuffered.unwrap_or(true) as i64,
            is_default as i64,
            input.allow_concurrent.unwrap_or(false) as i64,
            ts,
            source.unwrap_or("manual"),
            source_config_id,
            config_type.unwrap_or("task"),
            "process_tree",
            startup_timeout.map(|v| v as i64),
        ],
    )
    .map_err(|e| format!("保存运行配置失败：{}", e))?;
    get_config(conn, &id).ok_or_else(|| "运行配置写入后读取失败".to_string())
}

/// 删除某项目下所有来自 launcher.json 的配置（保留用户手动创建的）
pub fn delete_manifest_configs(conn: &Connection, project_id: &str) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM launch_configurations WHERE project_id = ?1 AND source = 'manifest'",
        params![project_id],
    )
    .map_err(|e| e.to_string())
}

pub fn update_config(conn: &Connection, id: &str, input: &ConfigInput) -> Result<LaunchConfig, String> {
    let current = get_config(conn, id).ok_or_else(|| "运行配置不存在".to_string())?;
    let name = if input.name.trim().is_empty() {
        current.name.clone()
    } else {
        input.name.clone()
    };
    let is_default = input.is_default.unwrap_or(current.is_default);
    if is_default && !current.is_default {
        conn.execute(
            "UPDATE launch_configurations SET is_default = 0 WHERE project_id = ?1",
            params![current.project_id],
        )
        .ok();
    }
    conn.execute(
        "UPDATE launch_configurations SET name = ?1, runtime_type = ?2, executable_path = ?3,
            entry_path = ?4, working_directory = ?5, arguments = ?6, env_vars = ?7, command = ?8,
            launch_mode = ?9, port = ?10, url = ?11, open_browser = ?12, keep_window = ?13,
            unbuffered = ?14, is_default = ?15, allow_concurrent = ?16, updated_at = ?17 WHERE id = ?18",
        params![
            name.trim(),
            input.runtime_type,
            input.executable_path,
            input.entry_path,
            input.working_directory,
            serde_json::to_string(&input.arguments).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&input.env_vars).unwrap_or_else(|_| "[]".into()),
            input.command,
            input.launch_mode.clone().unwrap_or(current.launch_mode),
            input.port.map(|p| p as i64),
            input.url.clone(),
            input.open_browser.unwrap_or(current.open_browser) as i64,
            input.keep_window.unwrap_or(current.keep_window) as i64,
            input.unbuffered.unwrap_or(current.unbuffered) as i64,
            is_default as i64,
            input.allow_concurrent.unwrap_or(current.allow_concurrent) as i64,
            now_iso(),
            id
        ],
    )
    .map_err(|e| format!("更新运行配置失败：{}", e))?;
    get_config(conn, id).ok_or_else(|| "运行配置更新后读取失败".to_string())
}

pub fn delete_config(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM launch_configurations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* 运行记录                                                            */
/* ------------------------------------------------------------------ */

const RUN_COLUMNS: &str = "r.id, r.project_id, COALESCE(p.name, '(已移除项目)'), r.config_id,
  r.config_name, r.runtime_type, r.command, r.working_directory, r.status, r.exit_code, r.error,
  r.pid, r.log_path, r.task_dir, r.started_at, r.ended_at, r.pid_file, r.exit_file";

fn row_to_run(r: &Row) -> rusqlite::Result<RunRecord> {
    Ok(RunRecord {
        id: r.get(0)?,
        project_id: r.get(1)?,
        project_name: r.get(2)?,
        config_id: r.get(3)?,
        config_name: r.get(4)?,
        runtime_type: r.get(5)?,
        command: r.get(6)?,
        working_directory: r.get(7)?,
        status: r.get(8)?,
        exit_code: r.get(9)?,
        error: r.get(10)?,
        pid: r.get(11)?,
        log_path: r.get(12)?,
        task_dir: r.get(13)?,
        started_at: r.get(14)?,
        ended_at: r.get(15)?,
        pid_file: r.get(16)?,
        exit_file: r.get(17)?,
    })
}

pub fn list_runs(conn: &Connection, project_id: Option<&str>, limit: i64) -> Result<Vec<RunRecord>, String> {
    let sql = format!(
        "SELECT {} FROM run_history r LEFT JOIN projects p ON p.id = r.project_id
         {} ORDER BY r.started_at DESC LIMIT ?1",
        RUN_COLUMNS,
        if project_id.is_some() { "WHERE r.project_id = ?2" } else { "" }
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = if let Some(pid) = project_id {
        stmt.query_map(params![limit, pid], row_to_run)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
    } else {
        stmt.query_map(params![limit], row_to_run)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
    };
    rows.map_err(|e| e.to_string())
}

pub fn get_run(conn: &Connection, id: &str) -> Option<RunRecord> {
    let sql = format!(
        "SELECT {} FROM run_history r LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = ?1",
        RUN_COLUMNS
    );
    conn.query_row(&sql, params![id], row_to_run).ok()
}

pub struct NewRun {
    pub id: String,
    pub project_id: String,
    pub config_id: Option<String>,
    pub config_name: Option<String>,
    pub runtime_type: String,
    pub command: String,
    pub working_directory: String,
    pub status: String,
    pub log_path: String,
    pub task_dir: String,
    pub pid_file: String,
    pub exit_file: String,
    pub started_at: String,
}

pub fn insert_run(conn: &Connection, new: &NewRun) -> Result<(), String> {
    conn.execute(
        "INSERT INTO run_history (id, project_id, config_id, config_name, runtime_type, command,
            working_directory, status, exit_code, error, pid, log_path, task_dir, pid_file,
            exit_file, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9, ?10, ?11, ?12, ?13, NULL)",
        params![
            new.id,
            new.project_id,
            new.config_id,
            new.config_name,
            new.runtime_type,
            new.command,
            new.working_directory,
            new.status,
            new.log_path,
            new.task_dir,
            new.pid_file,
            new.exit_file,
            new.started_at
        ],
    )
    .map_err(|e| format!("写入运行记录失败：{}", e))?;
    Ok(())
}

pub fn update_run_state(
    conn: &Connection,
    id: &str,
    status: &str,
    exit_code: Option<i64>,
    pid: Option<i64>,
    error: Option<&str>,
    ended_at: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE run_history SET status = ?1,
            exit_code = COALESCE(?2, exit_code),
            pid = COALESCE(?3, pid),
            error = COALESCE(?4, error),
            ended_at = COALESCE(?5, ended_at)
         WHERE id = ?6",
        params![status, exit_code, pid, error, ended_at, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_runs(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM run_history WHERE status NOT IN ('running','started','requested')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn manifest_configs_tracked_and_removable() {
        let conn = mem();
        let p = insert_project(
            &conn,
            &NewProject {
                name: "示例".into(),
                root_path: "/tmp/demo".into(),
                project_type: "web".into(),
                category_id: None,
                icon: None,
            },
        )
        .unwrap();

        // 用户手动创建的配置
        let manual = insert_config(
            &conn,
            &p.id,
            &ConfigInput {
                name: "手动配置".into(),
                runtime_type: "custom".into(),
                command: Some("/bin/echo".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(manual.source, "manual");

        // 来自 launcher.json 的配置
        let from_manifest = insert_config_full(
            &conn,
            &p.id,
            &ConfigInput {
                name: "运行项目".into(),
                runtime_type: "custom".into(),
                command: Some("npm".into()),
                arguments: vec!["run".into(), "dev".into()],
                is_default: Some(true),
                ..Default::default()
            },
            Some("manifest"),
            Some("dev"),
            Some("service"),
            Some(30),
        )
        .unwrap();
        assert_eq!(from_manifest.source, "manifest");
        assert_eq!(from_manifest.source_config_id.as_deref(), Some("dev"));
        assert_eq!(from_manifest.config_type, "service");
        assert_eq!(from_manifest.startup_timeout, Some(30));

        // 重新同步只删 manifest 来源，手动配置必须保留
        let removed = delete_manifest_configs(&conn, &p.id).unwrap();
        assert_eq!(removed, 1);
        let left = list_configs(&conn, &p.id).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].name, "手动配置");
    }

    #[test]
    fn builtin_category_can_be_deleted_and_stays_deleted() {        let conn = mem();
        // 内置分类允许删除
        delete_category(&conn, "cat_python").unwrap();
        let cats = list_categories(&conn).unwrap();
        assert_eq!(cats.len(), 3);
        assert!(!cats.iter().any(|c| c.id == "cat_python"));
        // 再次执行 seed（模拟下次启动）不应把它重建回来
        seed(&conn).unwrap();
        let after = list_categories(&conn).unwrap();
        assert_eq!(after.len(), 3);
        assert!(!after.iter().any(|c| c.id == "cat_python"));
    }

    #[test]
    fn deleting_category_keeps_projects_as_uncategorized() {
        let conn = mem();
        let p = insert_project(
            &conn,
            &NewProject {
                name: "示例".into(),
                root_path: "/tmp/demo".into(),
                project_type: "python".into(),
                category_id: Some("cat_python".into()),
                icon: None,
            },
        )
        .unwrap();
        delete_category(&conn, "cat_python").unwrap();
        let found = get_project(&conn, &p.id).unwrap();
        assert_eq!(found.category_id, None, "项目应回到未分类而不是被删除");
    }

    #[test]
    fn migration_creates_builtin_categories() {
        let conn = mem();
        let cats = list_categories(&conn).unwrap();
        assert_eq!(cats.len(), 4);
        assert!(cats.iter().any(|c| c.kind == "python"));

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = mem();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(list_categories(&conn).unwrap().len(), 4);
    }

    #[test]
    fn project_crud_and_tags() {
        let conn = mem();
        let p = insert_project(
            &conn,
            &NewProject {
                name: "品牌配色实验室".into(),
                root_path: "/tmp/color-generator".into(),
                project_type: "web".into(),
                category_id: Some("cat_web".into()),
                icon: None,
            },
        )
        .unwrap();
        assert_eq!(p.name, "品牌配色实验室");
        let updated = update_project(
            &conn,
            &p.id,
            &ProjectPatch {
                name: Some("设计配色工具".into()),
                tags: Some(vec!["设计".into(), "颜色".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.name, "设计配色工具");
        assert_eq!(updated.root_path, "/tmp/color-generator");
        assert_eq!(updated.tags.len(), 2);
        assert_eq!(list_tags(&conn).unwrap().len(), 2);
    }

    #[test]
    fn settings_merge_keeps_defaults() {
        let conn = mem();
        let mut v = get_settings(&conn);
        assert_eq!(v["theme"], "system");
        v["theme"] = serde_json::json!("dark");
        save_settings(&conn, &v).unwrap();
        let again = get_settings(&conn);
        assert_eq!(again["theme"], "dark");
        assert_eq!(again["sidebarWidth"], 236);
    }

    #[test]
    fn duplicate_path_detection() {
        let conn = mem();
        insert_project(
            &conn,
            &NewProject {
                name: "a".into(),
                root_path: "/tmp/dup-test".into(),
                project_type: "other".into(),
                category_id: None,
                icon: None,
            },
        )
        .unwrap();
        let key = paths::compare_key("/tmp/dup-test/");
        assert!(find_project_by_key(&conn, &key).is_some());
    }
}
