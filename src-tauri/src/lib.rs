// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! Markdown のエディタとビューア. ノートはローカルに保存して, HackMD のノートと同期する.
//!
//! ノートの保存 ([`store`]), HackMD の API ([`hackmd`]), 同期 ([`sync`]), 取り込んだファイルとの同期
//! ([`filesync`]), 設定 ([`settings`]), ログ ([`logging`]), 画面から呼ぶコマンド ([`commands`]) を受け持つ. 編集と表示は, フロントエンド.

pub mod commands;
pub mod errors;
pub mod files;
pub mod filesync;
pub mod hackmd;
pub mod images;
pub mod logging;
pub mod settings;
pub mod store;
pub mod sync;

use tauri::{Manager, State};
use tokio::sync::Mutex;

use commands::{AppState, SettingsView};
use errors::CommandError;
use store::{NoteMeta, Store};
use sync::{RemoteEntry, SyncState};

// 画面から呼ぶコマンド. 中身は `commands` にあり, ここでは, アプリの状態を渡すだけ.

/// ノートの一覧を, 新しく変えた順に返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteMeta>, CommandError> {
    commands::list_notes(&state).await
}

/// ノートの本文を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn read_note(state: State<'_, AppState>, id: String) -> Result<String, CommandError> {
    commands::read_note(&state, &id).await
}

/// ノートを作る.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn create_note(
    state: State<'_, AppState>,
    content: String,
) -> Result<NoteMeta, CommandError> {
    commands::create_note(&state, &content).await
}

/// ノートの本文を保存する.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn save_note(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<NoteMeta, CommandError> {
    commands::save_note(&state, &id, &content).await
}

/// ノートを消す (ローカルだけ).
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn delete_note(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    commands::delete_note(&state, &id).await
}

/// ノートと HackMD のノートのつながりを外す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn unlink_note(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    commands::unlink_note(&state, &id).await
}

/// ノートの同期の状態を, HackMD に問い合わせて返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn note_status(state: State<'_, AppState>, id: String) -> Result<SyncState, CommandError> {
    commands::note_status(&state, &id).await
}

/// ノートを HackMD に送る.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn push_note(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    commands::push_note(&state, &id, force).await
}

/// HackMD のノートを, ローカルのノートに取り込む.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn pull_note(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    commands::pull_note(&state, &id, force).await
}

/// 衝突したときに, 両方を残す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn keep_both(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    commands::keep_both(&state, &id).await
}

/// HackMD のノートの一覧を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn list_remote(state: State<'_, AppState>) -> Result<Vec<RemoteEntry>, CommandError> {
    commands::list_remote(&state).await
}

/// HackMD のノートを, ローカルに取り込む.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn import_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteMeta, CommandError> {
    commands::import_note(&state, &note_id).await
}

/// 外の Markdown のファイルを, ファイルとつないだノートとして取り込む.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn import_file(state: State<'_, AppState>, path: String) -> Result<NoteMeta, CommandError> {
    commands::import_file(&state, &path).await
}

/// ノートと元のファイルの同期の状態を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn file_status(state: State<'_, AppState>, id: String) -> Result<SyncState, CommandError> {
    commands::file_status(&state, &id).await
}

/// ノートの本文を, 元のファイルに書く.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn push_file(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    commands::push_file(&state, &id, force).await
}

/// 元のファイルの本文を, ノートに取り込み直す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn pull_file(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    commands::pull_file(&state, &id, force).await
}

/// ファイルとの衝突で, 両方を残す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn keep_both_file(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    commands::keep_both_file(&state, &id).await
}

/// ノートと元のファイルのつながりを外す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn unlink_file(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    commands::unlink_file(&state, &id).await
}

/// 貼り付けた画像を置く. 中身は, 呼び出しの本体 (バイト列) で受け取る. 置いたファイルの名前を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn save_image(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, CommandError> {
    commands::save_image(&state, request.body())
}

/// 落とした画像のファイルを, 写して置く.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn import_image(state: State<'_, AppState>, path: String) -> Result<String, CommandError> {
    commands::import_image(&state, &path)
}

/// 画像を置くディレクトリを返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn images_dir(state: State<'_, AppState>) -> String {
    commands::images_dir(&state)
}

/// 設定を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> SettingsView {
    commands::get_settings(&state)
}

/// HackMD の API のトークンを保存する (空なら, 消す).
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn set_token(state: State<'_, AppState>, token: Option<String>) -> Result<(), CommandError> {
    commands::set_token(&state, token.as_deref())
}

/// トークンを確かめる. 持ち主の名前を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn check_token(state: State<'_, AppState>) -> Result<String, CommandError> {
    commands::check_token(&state).await
}

/// アプリのログの末尾を返す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
async fn read_log(state: State<'_, AppState>) -> Result<String, CommandError> {
    commands::read_log(&state)
}

/// アプリのログを消す.
#[cfg(not(tarpaulin_include))]
#[tauri::command]
fn clear_log(state: State<'_, AppState>) -> Result<(), CommandError> {
    commands::clear_log(&state)
}

/// アプリの状態を作る (ディレクトリを決めて, ログを始める).
#[cfg(not(tarpaulin_include))]
fn setup(app: &tauri::App) -> Result<AppState, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let config_dir = app.path().app_config_dir()?;
    logging::init_logging(&logging::log_path(&data_dir));
    log::info!("Starting rs-mdnote {}", env!("CARGO_PKG_VERSION"));
    let store = Store::open(&data_dir.join("notes"))?;
    Ok(AppState {
        store: Mutex::new(store),
        data_dir,
        settings_path: settings::settings_path(&config_dir),
        api_base: hackmd::API_BASE.to_string(),
        env_token: std::env::var(settings::TOKEN_ENV).ok(),
    })
}

/// アプリを起動する.
#[cfg(not(tarpaulin_include))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = setup(app)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            read_note,
            create_note,
            save_note,
            delete_note,
            unlink_note,
            note_status,
            push_note,
            pull_note,
            keep_both,
            list_remote,
            import_note,
            get_settings,
            set_token,
            check_token,
            read_log,
            clear_log,
            import_file,
            file_status,
            push_file,
            pull_file,
            keep_both_file,
            unlink_file,
            save_image,
            import_image,
            images_dir,
            logging::log_frontend_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
