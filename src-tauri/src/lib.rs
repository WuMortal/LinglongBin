use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::Manager;

mod lcsc;

/// 导出离线模式 SQLite 数据库文件到指定路径
#[tauri::command]
fn export_db(app: tauri::AppHandle, target_path: String) -> Result<u64, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let src = config_dir.join("data.db");
    if !src.exists() {
        return Err("数据库文件不存在，请先在离线模式下创建一些数据".into());
    }
    let bytes = std::fs::copy(&src, &target_path)
        .map_err(|e| format!("复制文件失败: {}", e))?;
    Ok(bytes)
}

/// 导入 SQLite 数据库文件（覆盖当前离线 db）
#[tauri::command]
fn import_db(app: tauri::AppHandle, source_path: String) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    // 确保目录存在
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("创建配置目录失败: {}", e))?;
    let dst = config_dir.join("data.db");
    std::fs::copy(&source_path, &dst)
        .map_err(|e| format!("导入文件失败: {}", e))?;
    Ok(())
}

/// 保存文件（图片/手册等）到程序 resource 目录：resources/images/<yyyyMMdd>/ 或 resources/files/<yyyyMMdd>/
/// 前端传入相对路径（如 images/20260824/uuid.png）与 base64 内容，返回写入的相对路径。
/// 数据库中仅存储该相对路径，跨机器/导入导出不受绝对路径影响。
#[tauri::command]
fn save_file(app: tauri::AppHandle, rel_path: String, data: String) -> Result<String, String> {
    let rel = rel_path.replace('\\', "/");
    // 安全校验：仅允许 images/ 或 files/ 下的相对路径，禁止目录穿越与盘符
    let valid_prefix = rel.starts_with("images/") || rel.starts_with("files/");
    if !valid_prefix || rel.contains("..") || rel.contains(':') {
        return Err("非法的文件路径".into());
    }
    let resource_dir = resource_dir(&app)?;
    let full = resource_dir.join(&rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|e| format!("文件内容解码失败: {}", e))?;
    std::fs::write(&full, bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(rel)
}

/// 获取程序 resource 目录绝对路径（前端拼接图片 asset URL 用）
#[tauri::command]
fn get_resource_dir(app: tauri::AppHandle) -> Result<String, String> {
    resource_dir(&app).map(|d| {
        let s = d.to_string_lossy().into_owned();
        // Windows canonicalize 会加 \\?\ verbatim 前缀，去掉避免前端拼出 //?/E:/... 这类非法路径
        s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
    })
}

fn resource_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))
}

/// 自动更新插件：桌面端使用 tauri-plugin-updater，移动端不注册（无该插件）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    // 自动更新仅在桌面端注册（移动端无 updater 插件）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            export_db,
            import_db,
            save_file,
            get_resource_dir,
            lcsc::lcsc_lookup,
            lcsc::lcsc_search,
            lcsc::lcsc_fetch_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
