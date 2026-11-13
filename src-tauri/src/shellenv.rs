use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

/// GUI 应用由 launchd 启动时 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，
/// 这会导致 npm / node / python 等工具找不到。这里读取用户登录 shell 的 PATH，
/// 并在生成的运行脚本中显式注入，避免依赖 Terminal 的当前环境。
static LOGIN_PATH: OnceLock<String> = OnceLock::new();
static WHICH_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

const FALLBACK_PATH: &str = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

pub fn login_path() -> String {
    LOGIN_PATH
        .get_or_init(|| {
            for args in [["-lic", "print -r -- $PATH"], ["-lc", "print -r -- $PATH"]] {
                let out = Command::new("/bin/zsh")
                    .args(args)
                    .stdin(Stdio::null())
                    .output();
                if let Ok(out) = out {
                    let text = String::from_utf8_lossy(&out.stdout).to_string();
                    // 取最后一行形似 PATH 的内容，忽略 shell 启动脚本的杂音
                    let candidate = text
                        .lines()
                        .rev()
                        .map(|l| l.trim())
                        .find(|l| l.starts_with('/') && l.contains(':'));
                    if let Some(line) = candidate {
                        if !line.is_empty() {
                            return line.to_string();
                        }
                    }
                }
            }
            FALLBACK_PATH.to_string()
        })
        .clone()
}

fn which_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    WHICH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 在登录 shell 的 PATH 中查找可执行文件（带缓存）
pub fn which(cmd: &str) -> Option<String> {
    if let Ok(cache) = which_cache().lock() {
        if let Some(hit) = cache.get(cmd) {
            return hit.clone();
        }
    }
    let mut found: Option<String> = None;
    for dir in login_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = std::path::Path::new(dir).join(cmd);
        if candidate.is_file() {
            found = Some(candidate.to_string_lossy().to_string());
            break;
        }
    }
    if found.is_none() {
        // 兜底：直接问登录 shell
        if let Ok(out) = Command::new("/bin/zsh")
            .args(["-lic", &format!("command -v {}", cmd)])
            .stdin(Stdio::null())
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if text.starts_with('/') && std::path::Path::new(&text).exists() {
                found = Some(text);
            }
        }
    }
    if let Ok(mut cache) = which_cache().lock() {
        cache.insert(cmd.to_string(), found.clone());
    }
    found
}

/// 读取解释器版本；失败返回 None
pub fn interpreter_version(path: &str) -> Option<String> {
    let out = Command::new(path)
        .args(["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}
