// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  #[cfg(target_os = "linux")]
  {
    std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
  }
  app_lib::run();
}
