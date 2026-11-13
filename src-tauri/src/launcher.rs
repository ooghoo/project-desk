use crate::models::{EnvPair, LaunchConfig, Project};
use crate::paths;
use crate::shellenv;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 一次运行所对应的全部落盘文件
#[derive(Clone, Debug)]
pub struct TaskFiles {
    pub dir: PathBuf,
    pub script: PathBuf,
    pub pid: PathBuf,
    pub exit: PathBuf,
    pub log: PathBuf,
}

impl TaskFiles {
    pub fn new(base: &Path, run_id: &str) -> Result<Self, String> {
        let dir = base.join("runs").join(run_id);
        fs::create_dir_all(&dir).map_err(|e| format!("无法创建任务目录：{}", e))?;
        Ok(TaskFiles {
            script: dir.join("task.sh"),
            pid: dir.join("task.pid"),
            exit: dir.join("task.exit"),
            log: dir.join("task.log"),
            dir,
        })
    }
}

#[derive(Debug, Clone)]
pub struct TaskSpec {
    /// 展示给用户的命令（不含内部包装）
    pub command_display: String,
    /// 终端中实际执行的命令行
    pub exec_line: String,
    pub working_directory: PathBuf,
    pub envs: Vec<EnvPair>,
    pub open_url: Option<String>,
    pub runtime_label: String,
    /// html 直接打开无需终端
    pub browser_only: bool,
    pub entry_file: Option<PathBuf>,
}

fn runtime_label(runtime: &str) -> &'static str {
    match runtime {
        "python" => "Python 脚本",
        "html" => "静态 HTML",
        "web" => "本地 Web 服务",
        "node" => "Node.js",
        "shell" => "Shell 脚本",
        _ => "自定义命令",
    }
}

fn join_args(args: &[String]) -> String {
    args.iter()
        .filter(|a| !a.is_empty())
        .map(|a| paths::sh_quote(a))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 校验并生成运行参数。任何前置条件不满足都返回可读错误，不做"假启动"。
pub fn build_spec(project: &Project, config: &LaunchConfig) -> Result<TaskSpec, String> {
    let root = PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return Err(format!(
            "项目目录不存在或不可访问：{}\n请使用「重新定位项目」修正路径。",
            project.root_path
        ));
    }

    let working_directory = match config.working_directory.as_deref() {
        Some(wd) if !wd.trim().is_empty() => paths::resolve_against(&root, wd),
        _ => root.clone(),
    };
    if !working_directory.is_dir() {
        return Err(format!(
            "运行配置中的工作目录不可用：{}\n请在项目设置中修改工作目录。",
            working_directory.display()
        ));
    }

    let entry = config
        .entry_path
        .as_deref()
        .filter(|e| !e.trim().is_empty())
        .map(|e| paths::resolve_against(&root, e));
    if let Some(path) = &entry {
        if !path.exists() {
            return Err(format!(
                "入口文件不存在：{}\n请检查运行配置中的入口路径。",
                path.display()
            ));
        }
    }

    let args = join_args(&config.arguments);
    let mut envs = config.env_vars.clone();
    if config.runtime_type == "python" && config.unbuffered {
        envs.push(EnvPair {
            key: "PYTHONUNBUFFERED".into(),
            value: "1".into(),
        });
    }

    let mut spec = TaskSpec {
        command_display: String::new(),
        exec_line: String::new(),
        working_directory: working_directory.clone(),
        envs,
        open_url: config.url.clone().filter(|u| !u.trim().is_empty()),
        runtime_label: runtime_label(&config.runtime_type).to_string(),
        browser_only: false,
        entry_file: entry.clone(),
    };

    match config.runtime_type.as_str() {
        "python" => {
            let entry = entry.ok_or_else(|| "Python 运行配置缺少入口文件".to_string())?;
            let python = config
                .executable_path
                .as_deref()
                .filter(|p| !p.trim().is_empty())
                .map(|p| p.to_string())
                .or_else(|| crate::detect::detect_python(Some(&project.root_path)).first().map(|p| p.path.clone()))
                .ok_or_else(|| {
                    "未指定 Python 解释器，且未能在系统中检测到可用的 Python。\n请在运行配置中手动选择解释器。".to_string()
                })?;
            let py = PathBuf::from(&python);
            if !py.exists() {
                return Err(format!(
                    "Python 解释器路径失效：{}\n请在运行配置中重新选择解释器。",
                    python
                ));
            }
            let unbuffered = if config.unbuffered { " -u" } else { "" };
            let mut line = format!("{}{} {}", paths::sh_quote(&python), unbuffered, paths::sh_quote(
                &entry.to_string_lossy()
            ));
            if !args.is_empty() {
                line.push(' ');
                line.push_str(&args);
            }
            spec.command_display = line.clone();
            spec.exec_line = line;
            // 解释器所在目录优先于 PATH，避免依赖 Terminal 环境
            if let Some(dir) = py.parent() {
                spec.envs.push(EnvPair {
                    key: "VIRTUAL_ENV".into(),
                    value: dir.parent().unwrap_or(dir).to_string_lossy().to_string(),
                });
            }
        }
        "node" | "shell" | "custom" | "web" => {
            if config.runtime_type == "custom" || config.runtime_type == "web" {
                let cmd = config
                    .command
                    .as_deref()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let cmd = match cmd {
                    Some(c) => c,
                    None => {
                        // Web 服务未填命令时，用 python http.server 兜底
                        let entry = entry.clone();
                        let port = config.port.unwrap_or(8000);
                        let python = config
                            .executable_path
                            .clone()
                            .or_else(|| shellenv::which("python3"))
                            .ok_or_else(|| {
                                "该 Web 配置既没有启动命令，也没有可用的 Python 解释器。\n请输入完整的启动命令（例如 npm run dev）。".to_string()
                            })?;
                        let dir = entry
                            .as_ref()
                            .and_then(|e| e.parent().map(|p| p.to_path_buf()))
                            .unwrap_or(working_directory);
                        format!(
                            "{} -m http.server {} --bind 127.0.0.1 --directory {}",
                            paths::sh_quote(&python),
                            port,
                            paths::sh_quote(&dir.to_string_lossy())
                        )
                    }
                };
                let mut line = cmd;
                if !args.is_empty() {
                    line.push(' ');
                    line.push_str(&args);
                }
                spec.command_display = line.clone();
                spec.exec_line = line;
            } else if config.runtime_type == "node" {
                let node = config
                    .executable_path
                    .clone()
                    .filter(|p| !p.trim().is_empty())
                    .or_else(|| shellenv::which("node"))
                    .ok_or_else(|| "未找到 node，请在运行配置中指定可执行文件路径。".to_string())?;
                if !Path::new(&node).exists() {
                    return Err(format!("node 路径失效：{}", node));
                }
                let mut line = paths::sh_quote(&node);
                if let Some(e) = &entry {
                    line.push(' ');
                    line.push_str(&paths::sh_quote(&e.to_string_lossy()));
                }
                if !args.is_empty() {
                    line.push(' ');
                    line.push_str(&args);
                }
                spec.command_display = line.clone();
                spec.exec_line = line;
            } else {
                // shell
                let entry = entry.ok_or_else(|| "Shell 运行配置缺少脚本文件".to_string())?;
                let mut line = format!("/bin/bash {}", paths::sh_quote(&entry.to_string_lossy()));
                if !args.is_empty() {
                    line.push(' ');
                    line.push_str(&args);
                }
                spec.command_display = line.clone();
                spec.exec_line = line;
            }
        }
        "html" => {
            let entry = entry.ok_or_else(|| "静态页面运行配置缺少 HTML 文件".to_string())?;
            spec.command_display = format!("/usr/bin/open {}", paths::sh_quote(&entry.to_string_lossy()));
            spec.exec_line = spec.command_display.clone();
            spec.browser_only = true;
        }
        other => {
            return Err(format!("暂不支持的运行类型：{}", other));
        }
    }

    if config.port.is_some() && config.runtime_type == "web" {
        let port = config.port.unwrap();
        if port_in_use(port) {
            return Err(format!(
                "端口 {} 已被占用，无法启动该服务。\n可修改运行配置中的端口，或先停止占用该端口的进程。",
                port
            ));
        }
    }

    Ok(spec)
}

/// 生成可读、可复现、对空格与特殊字符安全的运行脚本
pub fn write_script(files: &TaskFiles, spec: &TaskSpec, title: &str, project: &Project) -> Result<(), String> {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut s = String::new();
    s.push_str("#!/bin/bash\n");
    s.push_str("# 本文件由「项目台」自动生成，仅用于本次运行，可安全删除。\n");
    s.push_str(&format!("# 项目：{}\n", project.name));
    s.push_str(&format!("# 任务：{}\n", title));
    s.push_str(&format!("# 生成时间：{}\n\n", ts));
    s.push_str(&format!("__pd_pid_file={}\n", paths::sh_quote(&files.pid.to_string_lossy())));
    s.push_str(&format!("__pd_exit_file={}\n", paths::sh_quote(&files.exit.to_string_lossy())));
    s.push_str(&format!("__pd_log={}\n\n", paths::sh_quote(&files.log.to_string_lossy())));
    s.push_str("echo $$ > \"$__pd_pid_file\"\n\n");
    s.push_str(&format!("echo \"项目台 · {}\"\n", escape_dq(title)));
    s.push_str(&format!("echo \"运行方式：{}\"\n", escape_dq(&spec.runtime_label)));
    s.push_str(&format!(
        "echo \"工作目录：{}\"\n",
        escape_dq(&spec.working_directory.to_string_lossy())
    ));
    s.push_str(&format!("echo \"执行命令：{}\"\n", escape_dq(&spec.command_display)));
    s.push_str(&format!("echo \"启动时间：{}\"\n", ts));
    s.push_str("echo \"────────────────────────────────────────\"\n\n");

    s.push_str("export PATH=");
    s.push_str(&paths::sh_quote(&shellenv::login_path()));
    s.push_str(":\"$PATH\"\n");
    for env in &spec.envs {
        if env.key.trim().is_empty() {
            continue;
        }
        s.push_str(&format!(
            "export {}={}\n",
            env.key.trim(),
            paths::sh_quote(&env.value)
        ));
    }
    s.push('\n');

    s.push_str(&format!(
        "cd -- {} || {{ __pd=$?; echo \"[项目台] 工作目录不可用：{}\"; echo \"$__pd\" > \"$__pd_exit_file\"; exit \"$__pd\"; }}\n\n",
        paths::sh_quote(&spec.working_directory.to_string_lossy()),
        escape_dq(&spec.working_directory.to_string_lossy())
    ));

    if let Some(url) = &spec.open_url {
        s.push_str(&format!(
            "# 服务启动后打开浏览器\n( sleep 2; /usr/bin/open {} ) >/dev/null 2>&1 &\n\n",
            paths::sh_quote(url)
        ));
    }

    s.push_str(&spec.exec_line);
    s.push_str("\n__pd=$?\n\n");
    s.push_str("echo \"────────────────────────────────────────\"\n");
    s.push_str("if [ \"$__pd\" -eq 0 ]; then\n");
    s.push_str("  echo \"[项目台] 任务结束（退出码 0）\"\n");
    s.push_str("else\n");
    s.push_str("  echo \"[项目台] 任务结束（退出码 $__pd）\"\n");
    s.push_str("fi\n");
    s.push_str("echo \"$__pd\" > \"$__pd_exit_file\"\n");

    let mut file = fs::File::create(&files.script)
        .map_err(|e| format!("无法写入任务脚本：{}", e))?;
    file.write_all(s.as_bytes())
        .map_err(|e| format!("无法写入任务脚本：{}", e))?;
    drop(file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&files.script, fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

fn escape_dq(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('$', "\\$").replace('`', "\\`")
}

fn applescript_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 在 Terminal.app 中打开一个带标题的新窗口并执行命令
pub fn open_in_terminal(exec_line: &str, title: &str, keep_window: bool) -> Result<(), String> {
    let suffix = if keep_window {
        "; echo; echo \"[项目台] 任务已结束，此窗口保留以便查看输出（可直接关闭）。\"; exec \"${SHELL:-/bin/zsh}\" -l"
    } else {
        ""
    };
    let line = format!("{}{}", exec_line, suffix);
    let script = format!(
        "tell application \"Terminal\"\n  activate\n  set theTab to do script \"{}\"\n  set custom title of theTab to \"{}\"\nend tell",
        applescript_quote(&line),
        applescript_quote(title)
    );
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("无法调用 Terminal.app：{}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.contains("-1743") || err.to_lowercase().contains("not authorized") {
            return Err(
                "没有获得控制 Terminal.app 的权限。\n请前往「系统设置 → 隐私与安全性 → 自动化」允许本应用控制 Terminal。".into(),
            );
        }
        return Err(format!("Terminal.app 启动失败：{}", err));
    }
    Ok(())
}

pub fn open_in_finder(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .map_err(|e| format!("无法调用 Finder：{}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Finder 打开失败：{}", path.display()))
    }
}

pub fn reveal_in_finder(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| format!("无法调用 Finder：{}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Finder 定位失败：{}", path.display()))
    }
}

pub fn open_with_default(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .map_err(|e| format!("无法打开文件：{}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("没有可用于打开该文件的默认应用：{}", path.display()))
    }
}

/* ------------------------------------------------------------------ */
/* 进程状态与停止                                                       */
/* ------------------------------------------------------------------ */

pub fn read_pid(pid_file: &Path) -> Option<i64> {
    let text = fs::read_to_string(pid_file).ok()?;
    text.trim().parse::<i64>().ok().filter(|p| *p > 0)
}

pub fn read_exit_code(exit_file: &Path) -> Option<i64> {
    if !exit_file.exists() {
        return None;
    }
    fs::read_to_string(exit_file)
        .ok()
        .and_then(|t| t.trim().parse::<i64>().ok())
}

pub fn pid_alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

fn process_table() -> Vec<(i64, i64)> {
    let out = match Command::new("/bin/ps").args(["-axo", "pid=,ppid="]).output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse::<i64>().ok()?;
            let ppid = parts.next()?.parse::<i64>().ok()?;
            Some((pid, ppid))
        })
        .collect()
}

/// 递归收集子进程（深度优先，返回 [子, 孙, ...]）
fn descendants(pid: i64) -> Vec<i64> {
    let table = process_table();
    let mut out = Vec::new();
    let mut stack = vec![pid];
    while let Some(current) = stack.pop() {
        for (child, parent) in &table {
            if *parent == current && *child != current {
                out.push(*child);
                stack.push(*child);
            }
        }
    }
    out
}

fn signal(pid: i64, sig: i32) {
    unsafe {
        libc::kill(pid as libc::pid_t, sig);
    }
}

/// 停止任务：先 SIGTERM 整个进程树，等待后 SIGKILL 残留进程，
/// 避免只杀父进程导致 node/npm 子进程继续占用端口。
pub fn stop_process_tree(pid: i64) -> Result<String, String> {
    if !pid_alive(pid) {
        return Ok("进程已不存在".into());
    }
    let children = descendants(pid);
    // 先子后父，确保信号覆盖整棵树
    for child in children.iter().rev() {
        signal(*child, libc::SIGTERM);
    }
    signal(pid, libc::SIGTERM);

    let mut waited = 0;
    while waited < 20 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited += 1;
        if !pid_alive(pid) {
            break;
        }
    }

    let mut killed = 0;
    if pid_alive(pid) {
        for child in descendants(pid).iter().rev() {
            if pid_alive(*child) {
                signal(*child, libc::SIGKILL);
                killed += 1;
            }
        }
        signal(pid, libc::SIGKILL);
        killed += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(120));

    if pid_alive(pid) {
        Err("进程未能停止，可能已被系统或其他进程接管，请在终端中手动结束。".into())
    } else if killed > 0 {
        Ok(format!("已强制结束 {}{} 个进程", children.len(), if killed > 1 { " 及残留" } else { "" }))
    } else {
        Ok(format!("已结束进程（含 {} 个子进程）", children.len()))
    }
}

pub fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{LaunchConfig, Project};

    fn project(root: &str) -> Project {
        Project {
            id: "p1".into(),
            name: "测试".into(),
            root_path: root.into(),
            project_type: "python".into(),
            path_status: "ok".into(),
            ..Default::default()
        }
    }

    fn config(runtime: &str, entry: Option<&str>) -> LaunchConfig {
        LaunchConfig {
            id: "c1".into(),
            project_id: "p1".into(),
            name: "默认".into(),
            runtime_type: runtime.into(),
            entry_path: entry.map(|s| s.to_string()),
            keep_window: true,
            unbuffered: true,
            ..Default::default()
        }
    }

    #[test]
    fn rejects_missing_project_dir() {
        let err = build_spec(&project("/definitely/not/here"), &config("python", Some("main.py")))
            .unwrap_err();
        assert!(err.contains("项目目录不存在"));
    }

    #[test]
    fn rejects_missing_entry_file() {
        let dir = crate::testutil::tmp_dir("launcher-missing");
        let err = build_spec(
            &project(dir.to_str().unwrap()),
            &config("python", Some("not-exist-xyz.py")),
        )
        .unwrap_err();
        assert!(err.contains("入口文件不存在"));
    }

    #[test]
    fn script_quotes_paths_with_spaces() {
        let tmp = crate::testutil::tmp_dir("launcher space 空格");
        fs::write(tmp.join("main.py"), "print(1)").unwrap();
        let files = TaskFiles::new(&crate::testutil::tmp_dir("launcher-task"), "test-run").unwrap();
        let spec = build_spec(
            &project(tmp.to_str().unwrap()),
            &LaunchConfig {
                runtime_type: "python".into(),
                entry_path: Some("main.py".into()),
                executable_path: Some("/usr/bin/python3".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(spec.command_display.contains("main.py"));
        write_script(&files, &spec, "任务 标题", &project(tmp.to_str().unwrap())).unwrap();
        let content = fs::read_to_string(&files.script).unwrap();
        assert!(content.contains("cd -- '"));
        assert!(content.contains("PIPESTATUS"));
        assert!(!content.contains("\\n"), "脚本里不应出现字面量 \\n");
        assert!(content.contains("# 项目：测试"));
    }

    #[test]
    fn port_check_works() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_in_use(port));
    }

    #[test]
    fn pid_alive_self() {
        assert!(pid_alive(std::process::id() as i64));
        assert!(!pid_alive(999_999));
    }
}
