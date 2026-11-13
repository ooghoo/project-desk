use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 一个内嵌终端会话：pty 主端 + 写入端 + 子进程
pub struct Session {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
}

pub type PtyStore = Arc<Mutex<HashMap<String, Session>>>;

pub fn new_store() -> PtyStore {
    Arc::new(Mutex::new(HashMap::new()))
}

pub struct SpawnArgs {
    pub run_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub envs: Vec<(String, String)>,
    pub log_path: PathBuf,
    pub rows: u16,
    pub cols: u16,
}

/// 在应用内创建 pty 并启动命令；输出通过 `run://output` 事件推给前端
pub fn spawn(app: AppHandle, store: PtyStore, args: SpawnArgs) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows.max(8),
            cols: args.cols.max(32),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法创建终端会话：{}", e))?;

    let mut cmd = CommandBuilder::new(&args.program);
    for a in &args.args {
        cmd.arg(a);
    }
    cmd.cwd(&args.cwd);
    for (k, v) in &args.envs {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "ProjectDesk");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("无法启动进程：{}", e))?;
    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("无法读取终端输出：{}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("无法写入终端：{}", e))?;

    store.lock().unwrap().insert(
        args.run_id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    // 读取线程：同时写入日志文件 + 推给前端
    let run_id = args.run_id.clone();
    let log_path = args.log_path.clone();
    let app_reader = app.clone();
    std::thread::spawn(move || {
        let mut log = std::fs::File::create(&log_path).ok();
        let engine = base64::engine::general_purpose::STANDARD;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Some(file) = log.as_mut() {
                        let _ = file.write_all(&buf[..n]);
                        let _ = file.flush();
                    }
                    let payload = json!({
                        "runId": run_id.clone(),
                        "data": engine.encode(&buf[..n]),
                    });
                    let _ = app_reader.emit("run://output", payload);
                }
                Err(_) => break,
            }
        }
        let _ = app_reader.emit("run://eof", json!({ "runId": run_id }));
    });

    spawn_waiter(app, store, args.run_id);

    Ok(pid)
}

/// 等待子进程退出，通知前端并回收会话
fn spawn_waiter(app: AppHandle, store: PtyStore, run_id: String) {
    std::thread::spawn(move || {
        let code: Option<i32> = loop {
            std::thread::sleep(Duration::from_millis(120));
            let mut guard = match store.lock() {
                Ok(g) => g,
                Err(_) => break None,
            };
            let Some(session) = guard.get_mut(&run_id) else {
                break None;
            };
            match session.child.try_wait() {
                Ok(Some(status)) => break Some(status.exit_code() as i32),
                Ok(None) => {}
                Err(_) => break None,
            }
        };

        // 留出时间让读取线程把剩余输出刷完
        std::thread::sleep(Duration::from_millis(120));
        let _ = app.emit("run://exit", json!({ "runId": run_id, "exitCode": code }));
        if let Ok(mut guard) = store.lock() {
            guard.remove(&run_id);
        }
    });
}

pub fn write_input(store: &PtyStore, run_id: &str, data: &str) -> Result<(), String> {
    let mut guard = store.lock().map_err(|_| "终端会话不可用".to_string())?;
    let session = guard
        .get_mut(run_id)
        .ok_or_else(|| "该任务没有可交互的终端会话（可能已结束）".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入终端失败：{}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("写入终端失败：{}", e))?;
    Ok(())
}

pub fn resize(store: &PtyStore, run_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let guard = store.lock().map_err(|_| "终端会话不可用".to_string())?;
    let session = guard
        .get(run_id)
        .ok_or_else(|| "该任务没有可交互的终端会话".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(32),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整终端尺寸失败：{}", e))
}

pub fn close(store: &PtyStore, run_id: &str) {
    if let Ok(mut guard) = store.lock() {
        guard.remove(run_id);
    }
}
