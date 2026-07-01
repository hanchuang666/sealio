use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeFilePayload {
    path: String,
    name: String,
    ext: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryStamp {
    id: String,
    original_name: String,
    stored_path: String,
    mime_type: String,
    created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStampPayload {
    id: String,
    original_name: String,
    stored_path: String,
    mime_type: String,
    created_at: u64,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickExportPathPayload {
    default_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteExportPayload {
    path: String,
    bytes: Vec<u8>,
}

fn app_storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn stamp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app)?.join("stamps"))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_storage_dir(app)?.join("stamp-history.json"))
}

#[cfg(target_os = "macos")]
fn legacy_history_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Sealio 图章工具")
            .join("stamp-history.json")
    })
}

#[cfg(not(target_os = "macos"))]
fn legacy_history_path() -> Option<PathBuf> {
    None
}

fn ensure_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(stamp_dir(app)?).map_err(|error| error.to_string())?;
    let history = history_path(app)?;

    if history.exists() {
        return Ok(());
    }

    if let Some(legacy) = legacy_history_path() {
        if legacy.exists() {
            fs::copy(legacy, &history).map_err(|error| error.to_string())?;
            return Ok(());
        }
    }

    fs::write(history, "[]").map_err(|error| error.to_string())
}

fn read_history(app: &AppHandle) -> Result<Vec<HistoryStamp>, String> {
    ensure_storage(app)?;
    let raw = fs::read_to_string(history_path(app)?).map_err(|error| error.to_string())?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write_history(app: &AppHandle, history: &[HistoryStamp]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(history).map_err(|error| error.to_string())?;
    fs::write(history_path(app)?, raw).map_err(|error| error.to_string())
}

fn path_file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn path_extension(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn read_file_payload(path: &Path) -> Result<NativeFilePayload, String> {
    Ok(NativeFilePayload {
        path: path.to_string_lossy().into_owned(),
        name: path_file_name(path),
        ext: path_extension(path),
        bytes: fs::read(path).map_err(|error| error.to_string())?,
    })
}

fn stamp_payload(stamp: &HistoryStamp) -> Result<NativeStampPayload, String> {
    Ok(NativeStampPayload {
        id: stamp.id.clone(),
        original_name: stamp.original_name.clone(),
        stored_path: stamp.stored_path.clone(),
        mime_type: stamp.mime_type.clone(),
        created_at: stamp.created_at,
        bytes: fs::read(&stamp.stored_path).map_err(|error| error.to_string())?,
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn reveal_in_folder(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg("-R").arg(path).spawn();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("explorer").arg("/select,").arg(path).spawn();
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            let _ = Command::new("xdg-open").arg(parent).spawn();
        }
    }
}

#[tauri::command]
fn open_document() -> Result<Option<Vec<NativeFilePayload>>, String> {
    let Some(paths) = FileDialog::new()
        .set_title("打开文件")
        .add_filter("支持的文件", &["pdf", "png", "jpg", "jpeg"])
        .add_filter("PDF", &["pdf"])
        .add_filter("图片", &["png", "jpg", "jpeg"])
        .pick_files()
    else {
        return Ok(None);
    };

    let files = paths
        .iter()
        .map(|path| read_file_payload(path))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(files))
}

#[tauri::command]
fn upload_stamp(app: AppHandle) -> Result<Vec<NativeStampPayload>, String> {
    let Some(paths) = FileDialog::new()
        .set_title("上传图章图片")
        .add_filter("图章图片", &["png", "jpg", "jpeg"])
        .pick_files()
    else {
        return Ok(Vec::new());
    };

    ensure_storage(&app)?;
    let mut history = read_history(&app)?;
    let mut imported = Vec::new();

    for path in paths {
        let ext = path_extension(&path);
        let id = uuid::Uuid::new_v4().to_string();
        let stored_path = stamp_dir(&app)?.join(format!("{id}.{ext}"));
        fs::copy(&path, &stored_path).map_err(|error| error.to_string())?;

        let stamp = HistoryStamp {
            id,
            original_name: path_file_name(&path),
            stored_path: stored_path.to_string_lossy().into_owned(),
            mime_type: if ext == "png" {
                "image/png".to_string()
            } else {
                "image/jpeg".to_string()
            },
            created_at: now_millis(),
        };

        history.insert(0, stamp.clone());
        imported.push(stamp);
    }

    write_history(&app, &history)?;
    imported.iter().map(stamp_payload).collect()
}

#[tauri::command]
fn list_stamps(app: AppHandle) -> Result<Vec<NativeStampPayload>, String> {
    read_history(&app)?
        .iter()
        .filter(|stamp| Path::new(&stamp.stored_path).exists())
        .map(stamp_payload)
        .collect()
}

#[tauri::command]
fn pick_export_path(payload: PickExportPathPayload) -> Result<Option<String>, String> {
    Ok(FileDialog::new()
        .set_title("导出新文件")
        .set_file_name(&payload.default_name)
        .add_filter("PDF", &["pdf"])
        .add_filter("PNG 图片", &["png"])
        .add_filter("JPG 图片", &["jpg"])
        .add_filter("JPEG 图片", &["jpeg"])
        .save_file()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn write_export(payload: WriteExportPayload) -> Result<String, String> {
    let path = PathBuf::from(payload.path);
    fs::write(&path, payload.bytes).map_err(|error| error.to_string())?;
    reveal_in_folder(&path);
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_document,
            upload_stamp,
            list_stamps,
            pick_export_path,
            write_export
        ])
        .setup(|app| {
            ensure_storage(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Sealio");
}
