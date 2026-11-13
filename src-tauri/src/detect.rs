use crate::models::{Detection, PythonInfo};
use crate::paths;
use crate::shellenv;
use std::fs;
use std::path::{Path, PathBuf};

struct Entry {
    name: String,
    is_dir: bool,
}

fn read_top(path: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(path) {
        for item in rd.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if name == ".DS_Store" {
                continue;
            }
            let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
            out.push(Entry { name, is_dir });
        }
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    out
}

fn has_file(entries: &[Entry], name: &str) -> bool {
    entries
        .iter()
        .any(|e| !e.is_dir && e.name.to_lowercase() == name.to_lowercase())
}

fn has_dir(entries: &[Entry], name: &str) -> bool {
    entries
        .iter()
        .any(|e| e.is_dir && e.name.to_lowercase() == name.to_lowercase())
}

fn first_file(entries: &[Entry], names: &[&str]) -> Option<String> {
    for want in names {
        if let Some(e) = entries
            .iter()
            .find(|e| !e.is_dir && e.name.to_lowercase() == want.to_lowercase())
        {
            return Some(e.name.clone());
        }
    }
    None
}

/// 根目录下的静态页面：index.html 优先，其余按名称排序
fn html_files(entries: &[Entry]) -> Vec<String> {
    let mut out: Vec<String> = entries
        .iter()
        .filter(|e| {
            if e.is_dir {
                return false;
            }
            let n = e.name.to_lowercase();
            n.ends_with(".html") || n.ends_with(".htm")
        })
        .map(|e| e.name.clone())
        .collect();
    out.sort_by(|a, b| {
        let ai = a.to_lowercase() == "index.html";
        let bi = b.to_lowercase() == "index.html";
        bi.cmp(&ai).then(a.cmp(b))
    });
    out
}

fn python_files(entries: &[Entry]) -> Vec<String> {
    let priority = ["main.py", "app.py", "run.py", "manage.py", "cli.py", "start.py"];
    let mut found: Vec<String> = Vec::new();
    for want in priority {
        if let Some(e) = entries
            .iter()
            .find(|e| !e.is_dir && e.name.to_lowercase() == want)
        {
            found.push(e.name.clone());
        }
    }
    let others: Vec<String> = entries
        .iter()
        .filter(|e| !e.is_dir && e.name.to_lowercase().ends_with(".py"))
        .map(|e| e.name.clone())
        .filter(|n| !found.contains(n))
        .collect();
    if found.is_empty() && others.len() == 1 {
        found.push(others[0].clone());
    }
    found
}

/// 查找项目内自带的虚拟环境解释器
fn project_venv(root: &Path) -> Option<String> {
    for rel in [
        ".venv/bin/python",
        "venv/bin/python",
        "env/bin/python",
        ".env/bin/python",
        ".venv/bin/python3",
        "venv/bin/python3",
    ] {
        let p = root.join(rel);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn prettify_name(folder: &str) -> String {
    let replaced = folder.replace(['-', '_'], " ");
    let trimmed = replaced.trim();
    if trimmed.is_empty() {
        return folder.to_string();
    }
    // 纯 ASCII 小写名称做首字母大写，其余（含中文）保持原样
    if trimmed.chars().all(|c| c.is_ascii()) {
        trimmed
            .split_whitespace()
            .map(|w| {
                let mut chars = w.chars();
                match chars.next() {
                    Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        trimmed.to_string()
    }
}

fn read_package_scripts(root: &Path) -> (Vec<String>, Option<String>) {
    let pkg = root.join("package.json");
    let text = match fs::read_to_string(&pkg) {
        Ok(t) => t,
        Err(_) => return (Vec::new(), None),
    };
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (Vec::new(), None),
    };
    let mut scripts: Vec<String> = json
        .get("scripts")
        .and_then(|s| s.as_object())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    scripts.sort();
    let main_entry = json
        .get("main")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());
    (scripts, main_entry)
}

pub fn detect(path: &str) -> Result<Detection, String> {
    let root = paths::resolve_dir(path)?;
    let entries = read_top(&root);
    let mut signals: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let pkg_scripts = if has_file(&entries, "package.json") {
        let (scripts, main_entry) = read_package_scripts(&root);
        signals.push("package.json".into());
        Some((scripts, main_entry))
    } else {
        None
    };

    let html_entries = html_files(&entries);
    let has_pyproject = has_file(&entries, "pyproject.toml");
    let has_requirements = has_file(&entries, "requirements.txt");
    let py_entries = python_files(&entries);
    let node_modules = has_dir(&entries, "node_modules");
    let sh_entry = first_file(&entries, &["start.sh", "run.sh", "install.sh"]);

    if let Some(first) = html_entries.first() {
        signals.push(format!("静态页面 {}", first));
    }
    if has_pyproject {
        signals.push("pyproject.toml".into());
    }
    if has_requirements {
        signals.push("requirements.txt".into());
    }
    if has_file(&entries, "README.md") {
        signals.push("README.md".into());
    }
    if node_modules {
        signals.push("node_modules".into());
    }
    if !py_entries.is_empty() {
        signals.push(py_entries.join(", "));
    }
    if let Some(s) = &sh_entry {
        signals.push(s.clone());
    }

    let venv = project_venv(&root);
    if let Some(v) = &venv {
        signals.push(format!("自带虚拟环境 {}", paths::pretty(v)));
    }

    let mut det = Detection {
        root_path: root.to_string_lossy().to_string(),
        suggested_name: prettify_name(
            root.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "未命名项目".into())
                .as_str(),
        ),
        project_type: "other".into(),
        category_kind: "other".into(),
        runtime_type: "custom".into(),
        entry_path: None,
        executable_path: None,
        working_directory: None,
        command: None,
        port: None,
        signals: signals.clone(),
        warnings: Vec::new(),
        scripts: pkg_scripts.as_ref().map(|(s, _)| s.clone()).unwrap_or_default(),
        top_level: entries.iter().take(14).map(|e| {
            if e.is_dir {
                format!("{}/", e.name)
            } else {
                e.name.clone()
            }
        }).collect(),
        manifest: None,
        source: "auto".into(),
    };

    let dev_script = pkg_scripts.as_ref().and_then(|(scripts, _)| {
        ["dev", "start", "serve", "dev:web", "preview"]
            .iter()
            .find(|want| scripts.iter().any(|s| s == *want))
            .map(|s| s.to_string())
            .or_else(|| {
                scripts
                    .iter()
                    .find(|s| s.starts_with("dev"))
                    .cloned()
            })
    });

    if dev_script.is_some() {
        let script = dev_script.unwrap();
        det.project_type = "web".into();
        det.category_kind = "web".into();
        det.runtime_type = "web".into();
        det.command = Some(format!("npm run {}", script));
        det.executable_path = shellenv::which("npm");
        det.working_directory = Some(det.root_path.clone());
        warnings.push(
            "检测到前端开发脚本。应用不会自动安装依赖，请确认已执行过 npm install。".into(),
        );
        warnings.push("本地服务端口请按项目实际配置填写（如 5173 / 3000），便于占用检测。".into());
        if det.executable_path.is_none() {
            warnings.push("未找到 npm，可在运行配置中手动指定可执行文件路径。".into());
        }
    } else if let Some(entry) = py_entries.first() {
        det.project_type = "python".into();
        det.category_kind = "python".into();
        det.runtime_type = "python".into();
        det.entry_path = Some(entry.clone());
        det.executable_path = venv.clone();
        det.working_directory = Some(det.root_path.clone());
        if py_entries.len() > 1 {
            warnings.push(format!(
                "检测到多个 Python 入口（{}），已默认选择 {}，可在添加时修改。",
                py_entries.join(" / "),
                entry
            ));
        }
        if has_requirements || has_pyproject {
            warnings.push("项目包含依赖声明，应用不会自动安装依赖。".into());
        }
        if det.executable_path.is_none() {
            warnings.push("未找到项目自带虚拟环境，请在添加时选择 Python 解释器。".into());
        }
    } else if !html_entries.is_empty() {
        det.project_type = "web".into();
        det.category_kind = "web".into();
        det.runtime_type = "html".into();
        det.entry_path = html_entries.first().cloned();
        det.working_directory = Some(det.root_path.clone());
        if html_entries.len() > 1 {
            warnings.push(format!(
                "根目录有多个 HTML 文件（{}），已默认选择 {}，可在添加时修改。",
                html_entries.join(" / "),
                html_entries[0]
            ));
        }
        warnings.push(
            "静态页面会直接用浏览器打开（不启动进程）；若依赖 fetch / 模块加载等 HTTP 特性，请改用本地 Web 服务。".into(),
        );
    } else if let Some((_, main_entry)) = pkg_scripts.as_ref() {
        det.project_type = "node".into();
        det.category_kind = "web".into();
        det.runtime_type = "node".into();
        det.entry_path = main_entry.clone().or_else(|| first_file(&entries, &["index.js", "server.js", "app.js"]));
        det.executable_path = shellenv::which("node");
        det.working_directory = Some(det.root_path.clone());
        if det.entry_path.is_none() {
            warnings.push("未找到明确的 Node 入口文件，请手动指定。".into());
        }
    } else if !py_entries.is_empty() {
        det.project_type = "python".into();
        det.category_kind = "python".into();
        det.runtime_type = "python".into();
        det.entry_path = py_entries.first().cloned();
        det.executable_path = venv.clone();
        det.working_directory = Some(det.root_path.clone());
    } else if has_pyproject || has_requirements {
        det.project_type = "python".into();
        det.category_kind = "python".into();
        det.runtime_type = "python".into();
        det.executable_path = venv.clone();
        det.working_directory = Some(det.root_path.clone());
        warnings.push("检测到 Python 依赖声明，但没有找到入口文件，请手动配置。".into());
    } else if let Some(sh) = sh_entry {
        det.project_type = "shell".into();
        det.category_kind = "automation".into();
        det.runtime_type = "shell".into();
        det.entry_path = Some(sh);
        det.working_directory = Some(det.root_path.clone());
    } else if has_file(&entries, "README.md") && entries.iter().all(|e| !e.name.ends_with(".py")) {
        det.project_type = "other".into();
        det.category_kind = "other".into();
        det.runtime_type = "custom".into();
        warnings.push("只识别到 README，无法推断运行方式，可稍后手动配置。".into());
    } else {
        warnings.push("没有识别到常见项目特征，可先添加目录，稍后配置运行方式。".into());
    }

    if det.category_kind == "python" && det.executable_path.is_none() {
        if let Some(py) = shellenv::which("python3") {
            det.executable_path = Some(py);
            warnings.push("已回退到系统 python3，建议在运行配置中指定项目专用解释器。".into());
        }
    }

    det.warnings = warnings;

    // launcher.json 优先级高于自动识别：
    // 存在且校验通过 → 用它覆盖项目类型与默认运行方式
    let mut signals = signals;
    let report = crate::manifest::read_manifest(&det.root_path);
    if report.found {
        signals.push("launcher.json".into());
        if report.valid {
            if let Some(name) = &report.project_name {
                det.suggested_name = name.clone();
            }
            if let Some(pt) = &report.project_type {
                let (proj_type, cat_kind) = match pt.as_str() {
                    "web" => ("web", "web"),
                    "script" => ("shell", "automation"),
                    "application" => ("other", "other"),
                    _ => ("other", "other"),
                };
                det.project_type = proj_type.into();
                det.category_kind = cat_kind.into();
            }
            // 用 defaultConfig 对应的配置填充默认运行方式
            if let Some(def_id) = &report.default_config {
                if let Some(cfg) = report.configurations.iter().find(|c| &c.id == def_id) {
                    let ci = &cfg.config_input;
                    det.runtime_type = ci.runtime_type.clone();
                    det.command = ci.command.clone();
                    det.entry_path = ci.entry_path.clone();
                    det.working_directory = ci.working_directory.clone();
                    det.port = ci.port;
                }
            }
            det.source = "manifest".into();
            det.warnings.extend(report.warnings.clone());
        } else {
            // 存在但不合规：明确提示，不静默忽略
            det.source = "auto".into();
            det.warnings.push(format!(
                "检测到 {} 但配置有问题，已回退到自动识别：{}",
                crate::manifest::FILE_NAME,
                report.errors.join("；")
            ));
        }
    } else {
        det.source = "auto".into();
    }
    // signals 在结构体里是克隆，写入后同步回去
    det.signals = signals;
    det.manifest = Some(report);

    Ok(det)
}

/* ------------------------------------------------------------------ */
/* Python 解释器发现                                                    */
/* ------------------------------------------------------------------ */

fn python_kind(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.contains("/.venv/") || lower.contains("/venv/") || lower.contains("/env/") || lower.contains("/.virtualenvs/") {
        "虚拟环境"
    } else if lower.contains("conda") || lower.contains("miniforge") {
        "conda"
    } else if lower.contains("/.pyenv/") {
        "pyenv"
    } else if lower.starts_with("/usr/bin/") {
        "系统"
    } else {
        "自定义"
    }
}

fn push_py(out: &mut Vec<PythonInfo>, seen: &mut Vec<String>, path: PathBuf, source: &str) {
    let p = path.to_string_lossy().to_string();
    if !path.is_file() {
        return;
    }
    if seen.contains(&p) {
        return;
    }
    // 过滤非 python 可执行文件
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !name.starts_with("python") {
        return;
    }
    seen.push(p.clone());
    let version = shellenv::interpreter_version(&p);
    if version.is_none() {
        return;
    }
    out.push(PythonInfo {
        label: format!(
            "Python {} · {}",
            version.clone().unwrap_or_default(),
            python_kind(&p)
        ),
        path: p,
        version,
        source: source.to_string(),
    });
}

fn collect_from_dir(out: &mut Vec<PythonInfo>, seen: &mut Vec<String>, dir: &Path, source: &str) {
    if !dir.is_dir() {
        return;
    }
    if let Ok(rd) = fs::read_dir(dir) {
        let mut items: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        items.sort();
        for p in items {
            push_py(out, seen, p, source);
        }
    }
}

/// 扫描常见 Python 安装位置 + 项目自带环境
pub fn detect_python(project_root: Option<&str>) -> Vec<PythonInfo> {
    let mut out: Vec<PythonInfo> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let home = paths::home_dir().unwrap_or_default();

    // 1. 登录 shell PATH 中的 python3 / python
    for cmd in ["python3", "python"] {
        if let Some(p) = shellenv::which(cmd) {
            push_py(&mut out, &mut seen, PathBuf::from(p), "PATH");
        }
    }

    // 2. 常见目录
    for dir in [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        home.join("miniconda3/bin"),
        home.join("anaconda3/bin"),
        home.join("opt/anaconda3/bin"),
        home.join("miniforge3/bin"),
        home.join("micromamba/bin"),
    ] {
        collect_from_dir(&mut out, &mut seen, &dir, "常见位置");
    }

    // 3. pyenv / virtualenvs / venvs 子目录
    for (base, source) in [
        (home.join(".pyenv/versions"), "pyenv"),
        (home.join("venvs"), "venvs"),
        (home.join(".virtualenvs"), "virtualenvs"),
        (home.join("Envs"), "Envs"),
    ] {
        if let Ok(rd) = fs::read_dir(&base) {
            for item in rd.flatten() {
                let bin = item.path().join("bin");
                collect_from_dir(&mut out, &mut seen, &bin, source);
            }
        }
    }

    // 4. 当前项目自带环境优先
    if let Some(root) = project_root {
        let root = PathBuf::from(root);
        for rel in [".venv/bin", "venv/bin", "env/bin"] {
            let dir = root.join(rel);
            if dir.is_dir() {
                let mut project_out: Vec<PythonInfo> = Vec::new();
                collect_from_dir(&mut project_out, &mut seen, &dir, "项目虚拟环境");
                if !project_out.is_empty() {
                    out.extend(project_out);
                }
            }
        }
    }

    // 项目环境排在最前
    out.sort_by_key(|p| if p.source == "项目虚拟环境" { 0 } else { 1 });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_project(name: &str) -> PathBuf {
        crate::testutil::tmp_dir(&format!("detect-{}", name))
    }

    #[test]
    fn detects_static_html() {
        let dir = tmp_project("html");
        fs::write(dir.join("index.html"), "<html></html>").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.runtime_type, "html");
        assert_eq!(det.entry_path.as_deref(), Some("index.html"));
        assert_eq!(det.project_type, "web");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_html_with_custom_name() {
        // 单个 html 文件不叫 index.html 时也要能识别（如「收藏夹导航.html」）
        let dir = tmp_project("html-custom");
        fs::write(dir.join("收藏夹导航.html"), "<html></html>").unwrap();
        fs::write(dir.join("收藏夹导航.data.js"), "[]").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.runtime_type, "html");
        assert_eq!(det.entry_path.as_deref(), Some("收藏夹导航.html"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn index_html_wins_when_multiple() {
        let dir = tmp_project("html-multi");
        fs::write(dir.join("a.html"), "<html></html>").unwrap();
        fs::write(dir.join("index.html"), "<html></html>").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.entry_path.as_deref(), Some("index.html"));
        assert!(det.warnings.iter().any(|w| w.contains("多个 HTML")));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_python_entry() {
        let dir = tmp_project("py");
        fs::write(dir.join("main.py"), "print('hi')").unwrap();
        fs::write(dir.join("requirements.txt"), "requests").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.runtime_type, "python");
        assert_eq!(det.entry_path.as_deref(), Some("main.py"));
        assert!(det.warnings.iter().any(|w| w.contains("依赖")));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_npm_dev_script() {
        let dir = tmp_project("npm");
        fs::write(
            dir.join("package.json"),
            r#"{"name":"x","scripts":{"dev":"vite","build":"vite build"}}"#,
        )
        .unwrap();
        fs::write(dir.join("index.html"), "<html></html>").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.runtime_type, "web");
        assert_eq!(det.command.as_deref(), Some("npm run dev"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unknown_project_still_detects() {
        let dir = tmp_project("empty");
        fs::write(dir.join("notes.txt"), "hello").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.project_type, "other");
        assert!(!det.warnings.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prettify_converts_slug() {
        assert_eq!(prettify_name("color-generator"), "Color Generator");
        assert_eq!(prettify_name("品牌配色"), "品牌配色");
    }

    /// launcher.json 中的项目名与类型应覆盖自动识别结果
    #[test]
    fn manifest_overrides_auto_detection() {
        let dir = tmp_project("manifest-wins");
        // 自动识别会认为是 python
        fs::write(dir.join("main.py"), "print('hi')").unwrap();
        fs::write(dir.join("requirements.txt"), "requests").unwrap();
        // 但 launcher.json 声明它是 web
        fs::write(
            dir.join("launcher.json"),
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "真实名字", "type": "web" },
              "defaultConfig": "dev",
              "configurations": [
                { "id": "dev", "name": "运行项目", "type": "service", "runtime": "command",
                  "workingDirectory": ".", "command": "/bin/echo", "args": ["hi"],
                  "url": null, "startupTimeout": 30, "stopStrategy": "process_tree" }
              ]
            }"#,
        )
        .unwrap();

        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.source, "manifest");
        assert_eq!(det.suggested_name, "真实名字");
        assert_eq!(det.project_type, "web");
        // 默认配置应覆盖运行方式
        assert_eq!(det.runtime_type, "custom");
        assert_eq!(det.command.as_deref(), Some("/bin/echo"));
        assert!(det.signals.iter().any(|s| s == "launcher.json"));
        fs::remove_dir_all(&dir).ok();
    }

    /// 无 launcher.json 时应回退到自动识别，source=auto
    #[test]
    fn no_manifest_falls_back_to_auto() {
        let dir = tmp_project("no-manifest");
        fs::write(dir.join("main.py"), "print('hi')").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.source, "auto");
        assert_eq!(det.runtime_type, "python");
        assert!(det.manifest.as_ref().map(|m| !m.found).unwrap_or(false));
        fs::remove_dir_all(&dir).ok();
    }

    /// launcher.json 存在但格式错误：回退自动识别 + 明确报错，不静默忽略
    #[test]
    fn broken_manifest_falls_back_with_error() {
        let dir = tmp_project("broken-manifest");
        fs::write(dir.join("main.py"), "print('hi')").unwrap();
        fs::write(dir.join("launcher.json"), "{ broken").unwrap();
        let det = detect(dir.to_str().unwrap()).unwrap();
        assert_eq!(det.source, "auto", "不合规时回退自动识别");
        assert_eq!(det.runtime_type, "python");
        assert!(
            det.warnings.iter().any(|w| w.contains("launcher.json")),
            "必须提示配置有问题：{:?}",
            det.warnings
        );
        fs::remove_dir_all(&dir).ok();
    }
}
