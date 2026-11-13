// macOS 发布构建下不弹出多余的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    project_desk_lib::run()
}
