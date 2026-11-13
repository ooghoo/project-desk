use serde::{Deserialize, Serialize};

/* ------------------------------------------------------------------ */
/* 基础实体                                                            */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    /// web | python | automation | other | custom
    pub kind: String,
    pub sort_order: i64,
    pub is_builtin: bool,
    #[serde(default)]
    pub project_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    /// 应用内显示名称，与磁盘目录名完全解耦
    pub name: String,
    /// 真实项目目录（绝对路径）
    pub root_path: String,
    /// web | python | node | shell | other
    pub project_type: String,
    pub category_id: Option<String>,
    pub icon: Option<String>,
    pub is_favorite: bool,
    pub sort_order: i64,
    pub notes: Option<String>,
    /// ok | missing
    pub path_status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub config_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvPair {
    pub key: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// python | html | web | node | shell | custom
    pub runtime_type: String,
    /// 解释器 / 运行时绝对路径
    pub executable_path: Option<String>,
    /// 入口文件，相对项目根目录
    pub entry_path: Option<String>,
    /// 工作目录，绝对路径或相对项目根目录；为空表示项目根目录
    pub working_directory: Option<String>,
    pub arguments: Vec<String>,
    pub env_vars: Vec<EnvPair>,
    /// 自定义命令（web / custom 使用）
    pub command: Option<String>,
    /// terminal | browser
    pub launch_mode: String,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub open_browser: bool,
    pub keep_window: bool,
    pub unbuffered: bool,
    pub is_default: bool,
    /// 是否允许同一配置并发启动（默认不允许，避免误启动重复任务）
    pub allow_concurrent: bool,
    /// manual | manifest：来源为 manifest 的配置在重新扫描 launcher.json 时可被覆盖
    #[serde(default = "default_source")]
    pub source: String,
    /// 在 launcher.json 中对应的配置 id
    #[serde(default)]
    pub source_config_id: Option<String>,
    /// open | task | service（来自 launcher.json）
    #[serde(default)]
    pub config_type: String,
    /// none | process | process_tree（来自 launcher.json）
    #[serde(default)]
    pub stop_strategy: String,
    /// 启动超时（秒）
    #[serde(default)]
    pub startup_timeout: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_source() -> String {
    "manual".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub config_id: Option<String>,
    pub config_name: Option<String>,
    pub runtime_type: String,
    pub command: String,
    pub working_directory: String,
    /// requested | started | running | exited | stopped | unknown
    pub status: String,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub pid: Option<i64>,
    pub log_path: String,
    pub task_dir: String,
    pub pid_file: String,
    pub exit_file: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

/* ------------------------------------------------------------------ */
/* 输入 / 输出载荷                                                     */
/* ------------------------------------------------------------------ */

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInput {
    pub name: String,
    pub runtime_type: String,
    pub executable_path: Option<String>,
    pub entry_path: Option<String>,
    pub working_directory: Option<String>,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub env_vars: Vec<EnvPair>,
    pub command: Option<String>,
    pub launch_mode: Option<String>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub open_browser: Option<bool>,
    pub keep_window: Option<bool>,
    pub unbuffered: Option<bool>,
    pub is_default: Option<bool>,
    pub allow_concurrent: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectInput {
    pub name: String,
    pub root_path: String,
    pub project_type: String,
    pub category_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub icon: Option<String>,
    pub config: Option<ConfigInput>,
}

/// 项目根目录的 README 内容
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReadmePayload {
    pub path: String,
    pub file_name: String,
    pub content: String,
    pub truncated: bool,
}

/// 点击「运行」后的结果：真正起进程，还是直接用浏览器打开了文件
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchOutcome {
    /// 已启动任务，返回运行记录
    Run { run: RunRecord },
    /// 静态页面：直接打开，不产生运行记录
    Opened { path: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub project_type: Option<String>,
    /// 使用 double option 语义：字段缺省 = 不修改，显式 null = 清空
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub icon: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub sort_order: Option<i64>,
}

/// 让 `Option<Option<T>>` 能区分「字段缺失」与「显式 null」
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub root_path: String,
    pub suggested_name: String,
    /// web | python | node | shell | other
    pub project_type: String,
    /// 建议分类 kind
    pub category_kind: String,
    pub runtime_type: String,
    pub entry_path: Option<String>,
    pub executable_path: Option<String>,
    pub working_directory: Option<String>,
    pub command: Option<String>,
    pub port: Option<u16>,
    pub signals: Vec<String>,
    pub warnings: Vec<String>,
    pub scripts: Vec<String>,
    pub top_level: Vec<String>,
    /// launcher.json 解析结果（存在且校验通过时用于覆盖自动识别）
    #[serde(default)]
    pub manifest: Option<crate::manifest::ManifestReport>,
    /// 数据来源：manifest（配置文件）| auto（自动识别）
    #[serde(default)]
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: i64,
    pub modified: Option<String>,
    /// 目录是否含子项（用于懒加载提示）
    pub has_children: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PathIssue {
    pub project_id: String,
    pub name: String,
    pub root_path: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PythonInfo {
    pub path: String,
    pub version: Option<String>,
    pub label: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: i64,
    pub skipped_existing: i64,
    pub missing_paths: Vec<String>,
    pub errors: Vec<String>,
    pub categories_created: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub projects: Vec<Project>,
    pub categories: Vec<Category>,
    pub tags: Vec<Tag>,
    pub runs: Vec<RunRecord>,
    pub settings: serde_json::Value,
    pub data_dir: String,
    pub db_path: String,
    pub app_version: String,
    pub login_path: String,
}
