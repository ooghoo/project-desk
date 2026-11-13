use crate::models::ConfigInput;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 当前支持的配置规范版本（主版本 1）
pub const SUPPORTED_MAJOR: u32 = 1;
pub const SUPPORTED_VERSION: &str = "1.0.0";
/// 配置文件名（只认根目录，不递归）
pub const FILE_NAME: &str = "launcher.json";

/* ------------------------------------------------------------------ */
/* 原始结构（严格对应模板）                                             */
/* ------------------------------------------------------------------ */

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawProject {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    #[serde(rename = "type")]
    pub project_type: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// open | task | service
    #[serde(default, rename = "type")]
    pub config_type: String,
    /// open | static_web | command | terminal
    #[serde(default)]
    pub runtime: String,
    #[serde(default)]
    pub working_directory: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub startup_timeout: Option<u64>,
    /// none | process | process_tree
    #[serde(default)]
    pub stop_strategy: String,
    /// 可选扩展：入口文件（open / static_web 用）
    #[serde(default)]
    pub entry: Option<String>,
    /// 可选扩展：静态服务端口
    #[serde(default)]
    pub port: Option<u16>,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawManifest {
    #[serde(default)]
    pub schema_version: String,
    #[serde(default)]
    pub project: RawProject,
    #[serde(default)]
    pub default_config: String,
    #[serde(default)]
    pub configurations: Vec<RawConfig>,
}

/* ------------------------------------------------------------------ */
/* 解析结果                                                            */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestConfig {
    pub id: String,
    pub name: String,
    /// open | task | service
    pub config_type: String,
    /// open | static_web | command | terminal
    pub runtime: String,
    pub working_directory: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    /// 空表示没有固定地址（启动台需从实际运行结果获取）
    pub url: Option<String>,
    pub startup_timeout: Option<u64>,
    pub stop_strategy: String,
    pub entry: Option<String>,
    pub port: Option<u16>,
    /// 转成启动台内部运行配置
    pub config_input: ConfigInput,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestReport {
    /// 根目录是否存在 launcher.json
    pub found: bool,
    /// 存在且通过全部校验
    pub valid: bool,
    pub path: Option<String>,
    pub schema_version: Option<String>,
    pub project_name: Option<String>,
    /// web | script | application | other
    pub project_type: Option<String>,
    pub default_config: Option<String>,
    pub configurations: Vec<ManifestConfig>,
    /// 阻断性问题：必须提示用户修复，不静默忽略
    pub errors: Vec<String>,
    /// 非阻断提醒
    pub warnings: Vec<String>,
}

impl ManifestReport {
    fn absent() -> Self {
        Self {
            found: false,
            valid: false,
            ..Default::default()
        }
    }
}

/* ------------------------------------------------------------------ */
/* 校验工具                                                            */
/* ------------------------------------------------------------------ */

fn is_one_of(v: &str, allowed: &[&str]) -> bool {
    allowed.iter().any(|a| *a == v)
}

/// 相对路径不得逃逸出项目根目录；绝对路径允许但给出提醒
fn check_working_dir(root: &Path, wd: &str, label: &str, errors: &mut Vec<String>, warnings: &mut Vec<String>) -> PathBuf {
    let raw = wd.trim();
    if raw.is_empty() || raw == "." {
        return root.to_path_buf();
    }
    let candidate = paths::resolve_against(root, raw);
    if !candidate.is_dir() {
        errors.push(format!("{}：工作目录不存在（{}）", label, raw));
        return candidate;
    }
    // 相对路径逃逸检查
    if !Path::new(raw).is_absolute() && !paths::is_within(root, &candidate) {
        errors.push(format!("{}：工作目录超出项目根目录（{}）", label, raw));
    } else if Path::new(raw).is_absolute() && !paths::is_within(root, &candidate) {
        warnings.push(format!("{}：工作目录指向项目根目录之外（{}）", label, raw));
    }
    candidate
}

fn check_entry(root: &Path, entry: &Option<String>, label: &str, errors: &mut Vec<String>, warnings: &mut Vec<String>) -> Option<String> {
    let raw = match entry {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => return None,
    };
    let candidate = paths::resolve_against(root, &raw);
    if !candidate.exists() {
        errors.push(format!("{}：入口文件不存在（{}）", label, raw));
        return Some(raw);
    }
    if !Path::new(&raw).is_absolute() && !paths::is_within(root, &candidate) {
        errors.push(format!("{}：入口文件超出项目根目录（{}）", label, raw));
        warnings.push(format!("{}：入口指向项目根目录之外（{}）", label, raw));
    }
    Some(raw)
}

/* ------------------------------------------------------------------ */
/* 核心：读取 + 校验                                                   */
/* ------------------------------------------------------------------ */

/// 只在项目根目录查找 launcher.json。不存在时返回 found=false，交给自动识别。
pub fn read_manifest(root: &str) -> ManifestReport {
    let root_path = match paths::resolve_dir(root) {
        Ok(p) => p,
        Err(e) => {
            let mut r = ManifestReport::absent();
            r.errors.push(e);
            return r;
        }
    };
    let file = root_path.join(FILE_NAME);
    if !file.is_file() {
        return ManifestReport::absent();
    }

    let mut report = ManifestReport {
        found: true,
        valid: false,
        path: Some(file.to_string_lossy().to_string()),
        ..Default::default()
    };

    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) => {
            report.errors.push(format!("无法读取 {}：{}", FILE_NAME, e));
            return report;
        }
    };

    // 格式错误必须显式提示，不静默忽略
    let raw: RawManifest = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            report.errors.push(format!("{} 格式错误：{}", FILE_NAME, e));
            return report;
        }
    };

    // 版本校验
    report.schema_version = Some(raw.schema_version.clone());
    let version_ok = match parse_version(&raw.schema_version) {
        Some((major, _minor)) if major == SUPPORTED_MAJOR => true,
        Some((major, minor)) => {
            report.errors.push(format!(
                "配置规范版本 {} 不受支持，当前仅支持 {}.x",
                raw.schema_version, SUPPORTED_MAJOR
            ));
            let _ = (major, minor);
            false
        }
        None => {
            report.errors.push(format!(
                "schemaVersion 无效：{}，应为 {}",
                raw.schema_version, SUPPORTED_VERSION
            ));
            false
        }
    };

    // 项目级字段
    let project_type = normalize_project_type(&raw.project.project_type, &mut report.errors);
    if !raw.project.name.trim().is_empty() {
        report.project_name = Some(raw.project.name.trim().to_string());
    }
    report.project_type = Some(project_type.clone());

    if raw.configurations.is_empty() {
        report.errors.push("configurations 至少需要一个运行配置".into());
    }

    // ID 唯一性
    let mut seen: Vec<&str> = Vec::new();
    let mut dup: Vec<String> = Vec::new();
    for c in &raw.configurations {
        let id = c.id.trim();
        if !id.is_empty() && seen.contains(&id) && !dup.contains(&id.to_string()) {
            dup.push(id.to_string());
        }
        if !id.is_empty() {
            seen.push(id);
        }
    }
    for d in &dup {
        report.errors.push(format!("配置 id 重复：{}", d));
    }

    // defaultConfig 必须引用有效配置
    let default_id = raw.default_config.trim().to_string();
    if !default_id.is_empty() && !seen.iter().any(|s| *s == default_id) {
        report.errors.push(format!(
            "defaultConfig 引用了不存在的配置 id：{}",
            default_id
        ));
    }
    report.default_config = if default_id.is_empty() { None } else { Some(default_id.clone()) };

    // 逐个配置校验并转换
    for c in &raw.configurations {
        let label = if c.name.trim().is_empty() {
            format!("配置 {}", c.id.trim())
        } else {
            format!("配置「{}」", c.name.trim())
        };
        let mut errs: Vec<String> = Vec::new();
        let mut warns: Vec<String> = Vec::new();

        if c.id.trim().is_empty() {
            errs.push(format!("{}：缺少 id", label));
        }
        if c.name.trim().is_empty() {
            errs.push(format!("{}：缺少 name", label));
        }
        if !is_one(&c.config_type, &["open", "task", "service"]) {
            errs.push(format!("{}：type 只能是 open / task / service", label));
        }
        if !c.stop_strategy.trim().is_empty()
            && !is_one(&c.stop_strategy, &["none", "process", "process_tree"])
        {
            errs.push(format!("{}：stopStrategy 只能是 none / process / process_tree", label));
        }

        let wd = check_working_dir(&root_path, &c.working_directory, &label, &mut errs, &mut warns);
        let entry = check_entry(&root_path, &c.entry, &label, &mut errs, &mut warns);

        let command = c.command.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        // runtime 省略时按已有字段推断，避免因缺字段整份配置不可用
        let runtime = if c.runtime.trim().is_empty() {
            let inferred = infer_runtime(command.is_some(), entry.is_some(), &c.config_type);
            warns.push(format!(
                "{}：未填写 runtime，已按现有字段推断为 {}",
                label, inferred
            ));
            inferred.to_string()
        } else if !is_one(&c.runtime, &["open", "static_web", "command", "terminal"]) {
            errs.push(format!("{}：runtime 只能是 open / static_web / command / terminal", label));
            c.runtime.trim().to_string()
        } else {
            c.runtime.trim().to_string()
        };

        // command 校验：command / terminal 模式必须有命令
        let needs_command = is_one(&runtime, &["command", "terminal"]);
        if needs_command && command.is_none() {
            errs.push(format!("{}：runtime 为 {} 时必须填写 command", label, runtime));
        }
        // 运行前检查：命令是否在 PATH 中
        if let Some(cmd) = &command {
            let base = cmd.split_whitespace().next().unwrap_or("");
            let resolved = paths::absolute(base);
            if !resolved.exists() && !base.contains('/') && crate::shellenv::which(base).is_none() {
                warns.push(format!(
                    "{}：未找到命令 {}，请确认已安装或改用绝对路径",
                    label, base
                ));
            }
        }
        // open / static_web 未指定目标
        if runtime == "open" && command.is_none() && entry.is_none() {
            warns.push(format!("{}：未指定要打开的文件或应用", label));
        }
        // 动态地址提醒
        if c.url.as_ref().map(|u| u.trim().is_empty()).unwrap_or(true) {
            if c.config_type.trim() == "service" || runtime == "static_web" {
                warns.push(format!("{}：url 为空，启动后需从实际运行结果获取访问地址", label));
            }
        }

        let config_input =
            to_config_input(&root_path, &wd, c, &runtime, command.clone(), entry.clone());
        if !errs.is_empty() {
            report.errors.extend(errs);
            continue;
        }
        report.warnings.extend(warns);
        report.configurations.push(ManifestConfig {
            id: c.id.trim().to_string(),
            name: c.name.trim().to_string(),
            config_type: if c.config_type.trim().is_empty() { "task".into() } else { c.config_type.trim().to_string() },
            runtime,
            working_directory: c.working_directory.trim().to_string(),
            command,
            args: c.args.clone(),
            url: c.url.as_ref().map(|u| u.trim().to_string()).filter(|u| !u.is_empty()),
            startup_timeout: c.startup_timeout,
            stop_strategy: if c.stop_strategy.trim().is_empty() { "process_tree".into() } else { c.stop_strategy.trim().to_string() },
            entry,
            port: c.port,
            config_input,
        });
    }

    // 未指定 defaultConfig 但有配置时，取第一个作为默认
    if report.default_config.is_none() && !report.configurations.is_empty() {
        report.default_config = Some(report.configurations[0].id.clone());
        report
            .warnings
            .push("未指定 defaultConfig，已自动使用第一个运行配置".into());
    }

    report.valid = version_ok && report.errors.is_empty() && !report.configurations.is_empty();
    report
}

fn is_one(v: &str, allowed: &[&str]) -> bool {
    is_one_of(v.trim(), allowed)
}

/// runtime 缺省时的推断规则：
/// 有 command → command；无 command 但有 entry → open；
/// 无 command 无 entry 但声明是服务 → static_web；其余按 task 处理（走 command 执行）。
fn infer_runtime(has_command: bool, has_entry: bool, config_type: &str) -> &'static str {
    if has_command {
        "command"
    } else if has_entry {
        "open"
    } else if config_type.trim() == "service" {
        "static_web"
    } else {
        "command"
    }
}

/// 解析 "1.0.0" -> (1, 0)
fn parse_version(v: &str) -> Option<(u32, u32)> {
    let mut it = v.trim().split('.');
    let major = it.next()?.parse::<u32>().ok()?;
    let minor = it.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor))
}

fn normalize_project_type(v: &str, errors: &mut Vec<String>) -> String {
    let t = v.trim();
    if t.is_empty() {
        return "other".into();
    }
    if is_one(t, &["web", "script", "application", "other"]) {
        t.to_string()
    } else {
        errors.push(format!("project.type 只能是 web / script / application / other（收到 {}）", t));
        "other".into()
    }
}

/// 把 launcher.json 的运行方式映射到启动台内部模型
fn to_config_input(
    root: &Path,
    wd: &Path,
    c: &RawConfig,
    runtime: &str,
    command: Option<String>,
    entry: Option<String>,
) -> ConfigInput {
    let url = c.url.as_ref().map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    let port = c.port.or_else(|| {
        url.as_deref()
            .and_then(extract_port)
    });

    // runtime → (runtime_type, launch_mode)
    let (runtime_type, launch_mode) = match runtime {
        // 启动台直接用浏览器打开文件，不需要终端
        "open" => ("html".to_string(), "browser".to_string()),
        // 由启动台提供静态 HTTP 服务
        "static_web" => ("web".to_string(), "terminal".to_string()),
        // 后台执行命令
        "command" => ("custom".to_string(), "terminal".to_string()),
        // 在 macOS 终端中执行
        "terminal" => ("custom".to_string(), "terminal".to_string()),
        other => (other.to_string(), "terminal".to_string()),
    };

    // 静态服务需要入口目录信息，交给内部 web 兜底逻辑
    let effective_command = match runtime {
        "static_web" => None,
        _ => command,
    };

    ConfigInput {
        name: c.name.trim().to_string(),
        runtime_type,
        executable_path: None,
        entry_path: entry,
        // 存相对路径，便于项目整体移动后仍可用
        working_directory: Some(relative_to(root, wd)),
        arguments: c.args.clone(),
        env_vars: Vec::new(),
        command: effective_command,
        launch_mode: Some(launch_mode),
        port,
        url: url.clone(),
        open_browser: Some(runtime == "static_web" || runtime == "open"),
        keep_window: Some(runtime == "terminal"),
        unbuffered: Some(true),
        is_default: None,
        allow_concurrent: Some(false),
    }
}

/// 尽量转成相对项目根的路径；失败则回退绝对路径
fn relative_to(root: &Path, target: &Path) -> String {
    match target.strip_prefix(root) {
        Ok(rel) if rel.as_os_str().is_empty() => ".".to_string(),
        Ok(rel) => rel.to_string_lossy().to_string(),
        Err(_) => target.to_string_lossy().to_string(),
    }
}

/// 从 URL 里提取显式端口，如 http://127.0.0.1:8080/ -> 8080
fn extract_port(url: &str) -> Option<u16> {
    let after_scheme = url.split("://").last()?;
    let host_part = after_scheme.split('/').next()?;
    let port = host_part.rsplit(':').next()?;
    // 必须真的带端口
    if !host_part.contains(':') {
        return None;
    }
    port.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, content: &str) {
        std::fs::write(root.join(FILE_NAME), content).unwrap();
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pd-manifest-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const GOOD: &str = r#"{
  "schemaVersion": "1.0.0",
  "project": { "name": "演示项目", "type": "web" },
  "defaultConfig": "dev",
  "configurations": [
    {
      "id": "dev",
      "name": "运行项目",
      "type": "service",
      "runtime": "command",
      "workingDirectory": ".",
      "command": "/bin/echo",
      "args": ["hello"],
      "url": null,
      "startupTimeout": 30,
      "stopStrategy": "process_tree"
    }
  ]
}"#;

    #[test]
    fn absent_when_no_file() {
        let d = tmp("absent");
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.found);
        assert!(r.configurations.is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn parses_valid_manifest() {
        let d = tmp("valid");
        write(&d, GOOD);
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.found && r.valid, "应当通过校验：{:?}", r.errors);
        assert_eq!(r.project_name.as_deref(), Some("演示项目"));
        assert_eq!(r.project_type.as_deref(), Some("web"));
        assert_eq!(r.default_config.as_deref(), Some("dev"));
        assert_eq!(r.configurations.len(), 1);
        let c = &r.configurations[0];
        assert_eq!(c.runtime, "command");
        assert_eq!(c.config_type, "service");
        assert_eq!(c.args, vec!["hello".to_string()]);
        assert!(c.url.is_none(), "url: null 应表示无固定地址");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn malformed_json_is_reported_not_ignored() {
        let d = tmp("bad");
        write(&d, "{ not json ");
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.found);
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("格式错误")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn unsupported_version_is_rejected() {
        let d = tmp("ver");
        write(&d, &GOOD.replace("1.0.0", "2.0.0"));
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.found && !r.valid);
        assert!(r.errors.iter().any(|e| e.contains("不受支持")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn duplicate_ids_rejected() {
        let d = tmp("dup");
        let body = GOOD.replace(
            "  ]\n}",
            ",\n    {\n      \"id\": \"dev\",\n      \"name\": \"第二个\",\n      \"type\": \"task\",\n      \"runtime\": \"command\",\n      \"workingDirectory\": \".\",\n      \"command\": \"/bin/echo\",\n      \"args\": [],\n      \"url\": null,\n      \"startupTimeout\": 5,\n      \"stopStrategy\": \"process\"\n    }\n  ]\n}",
        );
        write(&d, &body);
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("重复")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn dangling_default_config_rejected() {
        let d = tmp("dangling");
        write(&d, &GOOD.replace("\"defaultConfig\": \"dev\"", "\"defaultConfig\": \"nope\""));
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("defaultConfig")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_working_dir_rejected() {
        let d = tmp("wd");
        write(&d, &GOOD.replace("\"workingDirectory\": \".\"", "\"workingDirectory\": \"nope\""));
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("工作目录不存在")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn relative_escape_rejected() {
        let d = tmp("escape");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        write(&d.join("sub"), &GOOD.replace("\"workingDirectory\": \".\"", "\"workingDirectory\": \"../..\""));
        let r = read_manifest(&d.join("sub").to_string_lossy());
        assert!(!r.valid, "逃逸出根目录必须被拒绝：{:?}", r.errors);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn command_runtime_requires_command() {
        let d = tmp("nocmd");
        write(
            &d,
            &GOOD
                .replace("\"command\": \"/bin/echo\"", "\"command\": null")
                .replace("\"args\": [\"hello\"]", "\"args\": []"),
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("必须填写 command")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn invalid_enum_values_rejected() {
        let d = tmp("enum");
        write(&d, &GOOD.replace("\"type\": \"service\"", "\"type\": \"weird\""));
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("type 只能是")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn url_port_is_extracted() {
        assert_eq!(extract_port("http://127.0.0.1:8080/"), Some(8080));
        assert_eq!(extract_port("http://localhost:3000"), Some(3000));
        assert_eq!(extract_port("http://127.0.0.1/"), None);
    }

    #[test]
    fn runtime_maps_to_internal_model() {
        let d = tmp("map");
        write(&d, &GOOD);
        let r = read_manifest(&d.to_string_lossy());
        let ci = &r.configurations[0].config_input;
        assert_eq!(ci.runtime_type, "custom");
        assert_eq!(ci.command.as_deref(), Some("/bin/echo"));
        assert_eq!(ci.working_directory.as_deref(), Some("."));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_runtime_is_inferred_from_command() {
        let d = tmp("infer-cmd");
        // 省略 runtime：只要有 command 就应推断为 command
        write(
            &d,
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "推断测试", "type": "web" },
              "defaultConfig": "run",
              "configurations": [
                { "id": "run", "name": "运行", "type": "service",
                  "workingDirectory": ".", "command": "python3", "args": ["x.py"],
                  "url": "http://127.0.0.1:8080" }
              ]
            }"#,
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.valid, "省略 runtime 不应导致失败：{:?}", r.errors);
        assert_eq!(r.configurations[0].runtime, "command");
        assert!(r.warnings.iter().any(|w| w.contains("推断")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_runtime_with_entry_infers_open() {
        let d = tmp("infer-open");
        std::fs::write(d.join("index.html"), "<html></html>").unwrap();
        write(
            &d,
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "打开测试", "type": "web" },
              "defaultConfig": "open-it",
              "configurations": [
                { "id": "open-it", "name": "打开页面", "type": "open",
                  "workingDirectory": ".", "entry": "index.html" }
              ]
            }"#,
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.valid, "有 entry 应推断为 open：{:?}", r.errors);
        assert_eq!(r.configurations[0].runtime, "open");
        assert_eq!(r.configurations[0].config_input.runtime_type, "html");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_runtime_service_without_command_infers_static_web() {
        let d = tmp("infer-web");
        write(
            &d,
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "静态服务", "type": "web" },
              "defaultConfig": "serve",
              "configurations": [
                { "id": "serve", "name": "启动服务", "type": "service",
                  "workingDirectory": ".", "url": "http://127.0.0.1:9000" }
              ]
            }"#,
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.valid, "服务型无 command 应推断为 static_web：{:?}", r.errors);
        assert_eq!(r.configurations[0].runtime, "static_web");
        assert_eq!(r.configurations[0].config_input.runtime_type, "web");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn explicit_invalid_runtime_still_rejected() {
        let d = tmp("bad-runtime");
        write(&d, &GOOD.replace("\"runtime\": \"command\"", "\"runtime\": \"weird\""));
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.valid, "写了非法 runtime 仍必须报错");
        assert!(r.errors.iter().any(|e| e.contains("runtime 只能是")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn extra_unknown_fields_are_ignored() {
        let d = tmp("extra");
        // description / version 等未定义字段不应导致失败
        write(
            &d,
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "带描述", "type": "web", "description": "说明", "version": "0.2.0" },
              "defaultConfig": "dev",
              "configurations": [
                { "id": "dev", "name": "运行项目", "type": "service", "runtime": "command",
                  "workingDirectory": ".", "command": "/bin/echo", "args": [],
                  "url": null, "startupTimeout": 30, "stopStrategy": "process_tree" }
              ]
            }"#,
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.valid, "多余字段应被忽略：{:?}", r.errors);
        assert_eq!(r.project_name.as_deref(), Some("带描述"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn url_without_port_and_port_in_url() {
        let d = tmp("port");
        write(
            &d,
            r#"{
              "schemaVersion": "1.0.0",
              "project": { "name": "端口", "type": "web" },
              "defaultConfig": "dev",
              "configurations": [
                { "id": "dev", "name": "运行", "type": "service", "runtime": "command",
                  "workingDirectory": ".", "command": "/bin/echo", "args": [],
                  "url": "http://127.0.0.1:8080", "stopStrategy": "process_tree" }
              ]
            }"#,
        );
        let r = read_manifest(&d.to_string_lossy());
        assert!(r.valid);
        // 顶层 port 只反映显式声明；自动提取的端口落在 config_input 上
        assert_eq!(r.configurations[0].port, None);
        assert_eq!(r.configurations[0].config_input.port, Some(8080), "应从 url 提取端口");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn only_root_is_checked_not_recursive() {        let d = tmp("recursive");
        let sub = d.join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        write(&sub, GOOD);
        let r = read_manifest(&d.to_string_lossy());
        assert!(!r.found, "子目录不应被搜索");
        let _ = std::fs::remove_dir_all(&d);
    }
}
