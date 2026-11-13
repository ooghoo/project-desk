#![cfg(test)]

use std::path::PathBuf;

/// 测试用临时目录。放在 target/ 下，避免依赖系统临时目录的权限。
pub fn tmp_dir(tag: &str) -> PathBuf {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test-tmp");
    let dir = base.join(format!("{}-{}", tag, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).expect("无法创建测试目录");
    dir
}
