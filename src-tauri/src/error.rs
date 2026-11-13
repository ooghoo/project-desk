use crate::models::Project;

/// 统一的命令错误：前端可依据 code 做分支处理（如重复路径、任务已在运行）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            project_id: None,
            run_id: None,
        }
    }

    pub fn duplicate(project: &Project) -> Self {
        Self {
            code: "duplicate_path".into(),
            message: format!("该文件夹已注册为项目「{}」", project.name),
            project_id: Some(project.id.clone()),
            run_id: None,
        }
    }

    pub fn with_run(mut self, run_id: &str) -> Self {
        self.run_id = Some(run_id.to_string());
        self
    }

    pub fn with_project(mut self, project_id: &str) -> Self {
        self.project_id = Some(project_id.to_string());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        AppError::new("error", value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        AppError::new("error", value)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        AppError::new("db_error", format!("数据库操作失败：{}", value))
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::new("io_error", format!("文件操作失败：{}", value))
    }
}
