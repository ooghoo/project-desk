mod commands;
mod db;
mod detect;
mod error;
mod launcher;
pub mod manifest;
mod models;
mod paths;
mod pty;
mod runs;
mod shellenv;
#[cfg(test)]
mod testutil;

use commands::AppState;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

/// 数据目录名（位于「文档」下）
const DATA_DIR_NAME: &str = "项目台";
/// 数据库文件名
const DB_FILE_NAME: &str = "project-desk.sqlite3";

/// 目录是否可写（创建目录 + 写探针文件）
fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 数据目录：默认放在「文档/项目台」，不可用时回退到应用数据目录。
fn resolve_data_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    if let Ok(docs) = app.path().document_dir() {
        let dir = docs.join(DATA_DIR_NAME);
        if is_writable(&dir) {
            return Ok(dir);
        }
    }
    let fallback = app.path().app_data_dir()?;
    std::fs::create_dir_all(&fallback)?;
    Ok(fallback)
}

/// 旧版本把数据库放在 Application Support，首次启动时迁移到文档目录。
/// 只在目标库不存在且源库存在时执行，源文件保留不删。
fn migrate_legacy_db(old_dir: &Path, new_dir: &Path) {
    let old_db = old_dir.join(DB_FILE_NAME);
    let new_db = new_dir.join(DB_FILE_NAME);
    if new_db.exists() || !old_db.exists() {
        return;
    }
    // 连同 -wal 一起复制，保证未落盘的事务不丢；-shm 由 SQLite 自行重建
    let mut copied = false;
    for suffix in ["", "-wal"] {
        let from = old_dir.join(format!("{}{}", DB_FILE_NAME, suffix));
        if from.exists() && std::fs::copy(&from, new_dir.join(format!("{}{}", DB_FILE_NAME, suffix))).is_ok() {
            copied = true;
        }
    }
    if copied {
        eprintln!("[项目台] 数据库已从 {} 迁移到 {}", old_dir.display(), new_dir.display());
    }
}

/// macOS 菜单栏：全部中文，并把「设置 / 关于」交回前端处理
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(app, "about", "关于项目台", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, "quit", "退出项目台", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        "项目台",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;

    let help_item = MenuItem::with_id(app, "help", "项目说明", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "帮助", true, &[&help_item])?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu, &help_menu])
}


/// 诊断日志目录（与数据库同目录）
fn log_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let mut path = std::path::PathBuf::from(home);
    path.push("Library/Application Support/com.nathan.projectdesk");
    Some(path)
}

fn append_log(file: &str, text: &str) {
    use std::io::Write;
    let Some(dir) = log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut handle) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(file))
    {
        let _ = writeln!(
            handle,
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            text
        );
    }
}

/// panic 时留下现场：崩溃后能看到具体位置，而不是只看到"闪退"
fn install_hooks() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "未知位置".into());
        let message = format!("PANIC {} @ {}", info, location);
        append_log("panic.log", &message);
        eprintln!("{}", message);
    }));
}

pub fn run() {
    install_hooks();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二次打开时不再起新实例（两个实例抢同一个 SQLite 会互相拖死）
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "about" | "help" => {
                let _ = app.emit("menu://about", ());
            }
            "settings" => {
                let _ = app.emit("menu://settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle())?;
            std::fs::create_dir_all(&data_dir)?;
            // 从旧的 Application Support 位置迁移数据库
            if let Ok(old_dir) = app.path().app_data_dir() {
                if old_dir != data_dir {
                    migrate_legacy_db(&old_dir, &data_dir);
                }
            }
            let db_path = data_dir.join(DB_FILE_NAME);
            let connection = db::open(&db_path)
                .map_err(|e| -> Box<dyn std::error::Error> { format!("数据库初始化失败：{}", e).into() })?;
            app.manage(AppState {
                conn: Mutex::new(connection),
                data_dir,
                db_path,
                pty: pty::new_store(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::list_projects,
            commands::detect_project,
            commands::read_launcher_config,
            commands::sync_launcher_config,
            commands::inspect_drop_paths,
            commands::add_project,
            commands::update_project,
            commands::rename_project,
            commands::reorder_projects,
            commands::touch_project,
            commands::set_project_tags,
            commands::remove_project,
            commands::relocate_project,
            commands::check_project_paths,
            commands::list_categories,
            commands::create_category,
            commands::rename_category,
            commands::delete_category,
            commands::list_tags,
            commands::read_directory,
            commands::open_path,
            commands::reveal_project,
            commands::open_project_terminal,
            commands::list_configs,
            commands::save_config,
            commands::delete_config,
            commands::list_python_interpreters,
            commands::run_project,
            commands::run_input,
            commands::resize_pty,
            commands::read_project_readme,
            commands::read_run_log,
            commands::stop_run,
            commands::list_runs,
            commands::open_run_folder,
            commands::runtime_paths,
            commands::clear_run_history,
            commands::save_settings,
            commands::open_data_dir,
            commands::copy_text,
            commands::debug_log,
            commands::export_manifest,
            commands::import_manifest,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // 不再静默退出：写日志 + 弹原生提示，方便定位
        let message = format!("{}", err);
        append_log("startup-error.log", &message);
        let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display alert \"项目台无法启动\" message \"{}\" as critical",
            escaped
        );
        let _ = std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .status();
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pd-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn migrate_moves_db_and_keeps_source() {
        let root = tmpdir("migrate");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        // 造一个真实可用的旧库
        let old_db = old.join(DB_FILE_NAME);
        db::open(&old_db).unwrap();
        std::fs::write(old.join(format!("{}-wal", DB_FILE_NAME)), b"").unwrap();

        migrate_legacy_db(&old, &new);

        assert!(new.join(DB_FILE_NAME).exists(), "数据库应被复制到新目录");
        assert!(old_db.exists(), "源文件应保留不删除");
        // 新库可正常打开并完成迁移
        let conn = db::open(&new.join(DB_FILE_NAME)).unwrap();
        assert_eq!(db::list_categories(&conn).unwrap().len(), 4);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_does_not_overwrite_existing_target() {
        let root = tmpdir("nooverwrite");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        db::open(&old.join(DB_FILE_NAME)).unwrap();
        db::open(&new.join(DB_FILE_NAME)).unwrap();

        migrate_legacy_db(&old, &new);

        // 目标已存在时不应被覆盖，两个库都能独立打开
        assert!(db::open(&new.join(DB_FILE_NAME)).is_ok());
        assert!(db::open(&old.join(DB_FILE_NAME)).is_ok());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_no_source_is_noop() {
        let root = tmpdir("nosource");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        migrate_legacy_db(&old, &new);
        assert!(!new.join(DB_FILE_NAME).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn writable_detects_real_dir() {
        let root = tmpdir("writable");
        assert!(is_writable(&root));
        let _ = std::fs::remove_dir_all(&root);
    }
}
