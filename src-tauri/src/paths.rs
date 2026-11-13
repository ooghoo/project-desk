use std::path::{Component, Path, PathBuf};

/// 展开 `~` 与 `~/xxx`
pub fn expand_tilde(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// 词法规范化：去掉 `.` / `..` / 重复分隔符，但保留符号链接原样（用于路径不存在时）
fn lexical_clean(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 返回用于"是否为同一目录"比较的键。
///
/// macOS 默认文件系统大小写不敏感（APFS case-insensitive），且用户可能通过
/// 符号链接 / `/private/var` vs `/var` / 结尾斜杠等不同形式给出同一路径。
/// 因此：能 canonicalize 就 canonicalize（会解析符号链接），再统一小写。
pub fn compare_key(input: &str) -> String {
    let p = expand_tilde(input);
    let resolved = std::fs::canonicalize(&p).unwrap_or_else(|_| lexical_clean(&p));
    let mut s = resolved.to_string_lossy().to_string();
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s.to_lowercase()
}

/// 绝对化（不要求路径存在）
pub fn absolute(input: &str) -> PathBuf {
    let p = expand_tilde(input);
    if p.is_absolute() {
        lexical_clean(&p)
    } else {
        std::env::current_dir()
            .map(|cwd| lexical_clean(&cwd.join(&p)))
            .unwrap_or(p)
    }
}

/// 解析为真实绝对路径；用于写入数据库前
pub fn resolve_dir(input: &str) -> Result<PathBuf, String> {
    let p = absolute(input);
    let canon = std::fs::canonicalize(&p).map_err(|e| format!("无法访问路径 {}：{}", p.display(), e))?;
    if !canon.is_dir() {
        return Err(format!("{} 不是一个文件夹", canon.display()));
    }
    Ok(canon)
}

/// 把 `candidate` 解析为绝对路径（相对路径则拼接到 `base`）
pub fn resolve_against(base: &Path, candidate: &str) -> PathBuf {
    let raw = expand_tilde(candidate);
    if raw.is_absolute() {
        lexical_clean(&raw)
    } else {
        lexical_clean(&base.join(raw))
    }
}

/// 确保路径位于某个项目根目录内（含自身），用于限制文件树读取范围
pub fn is_within(root: &Path, target: &Path) -> bool {
    let root_key = compare_key(&root.to_string_lossy());
    let target_key = compare_key(&target.to_string_lossy());
    target_key == root_key || target_key.starts_with(&format!("{}/", root_key))
}

/// 单引号安全的 shell 片段：'  ->  '\''
pub fn sh_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// 显示用路径：把 home 替换为 `~`
pub fn pretty(path: &str) -> String {
    if let Some(home) = home_dir() {
        let h = home.to_string_lossy().to_string();
        if path == h {
            return "~".into();
        }
        if let Some(rest) = path.strip_prefix(&(h.clone() + "/")) {
            return format!("~/{}", rest);
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilde_expands() {
        let home = home_dir().unwrap();
        assert_eq!(expand_tilde("~/a/b"), home.join("a/b"));
        assert_eq!(expand_tilde("/tmp/x"), PathBuf::from("/tmp/x"));
    }

    #[test]
    fn quote_handles_spaces_and_quotes() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
        assert_eq!(sh_quote("中文 路径"), "'中文 路径'");
    }

    #[test]
    fn trailing_slash_is_same_dir() {
        assert_eq!(compare_key("/tmp/"), compare_key("/tmp"));
        assert_eq!(compare_key("/Users/../tmp"), compare_key("/tmp"));
    }

    #[test]
    fn within_checks_prefix() {
        let root = Path::new("/tmp/foo");
        assert!(is_within(root, Path::new("/tmp/foo/bar.txt")));
        assert!(is_within(root, Path::new("/tmp/foo")));
        assert!(!is_within(root, Path::new("/tmp/foobar/x")));
    }
}
