// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! Markdown のエディタとビューア. ノートはローカルに保存して, HackMD のノートと同期する.
//!
//! ノートの保存 ([`store`]), HackMD の API ([`hackmd`]), 同期 ([`sync`]), 設定 ([`settings`]),
//! ログ ([`logging`]) を受け持つ. 編集と表示は, フロントエンド.

pub mod errors;
pub mod hackmd;
pub mod logging;
pub mod settings;
pub mod store;
pub mod sync;

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Manager, State};
use tokio::sync::Mutex;

use errors::CommandError;
use settings::TokenSource;
use store::{NoteMeta, Store};
use sync::{RemoteEntry, SyncState};

/// アプリの状態.
struct AppState {
    /// ノートの保存先. 一覧の読み書きが重ならないように, 1 つずつ使う.
    store: Mutex<Store>,
    /// アプリのデータのディレクトリ (ログ).
    data_dir: PathBuf,
    /// 設定のファイル.
    settings_path: PathBuf,
}

/// 今の日時 (UNIX 時間のミリ秒) を返す.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// 使う HackMD の API のトークンと, その取り元を返す.
fn token(state: &AppState) -> (Option<String>, TokenSource) {
    let saved = settings::load(&state.settings_path);
    let env = std::env::var(settings::TOKEN_ENV).ok();
    settings::effective_token(&saved, env.as_deref())
}

/// HackMD の API の呼び出しを作る. トークンがなければ, エラー.
fn client(state: &AppState) -> Result<hackmd::Client, CommandError> {
    let (Some(token), _) = token(state) else {
        return Err(CommandError::no_token());
    };
    Ok(hackmd::Client::new(hackmd::API_BASE, &token)?)
}

/// 失敗をログに書いて, 画面に返すエラーにする.
fn report(context: &str, e: impl Into<CommandError>) -> CommandError {
    let e = e.into();
    log::warn!("{} failed: {}", context, e.message);
    e
}

/// ノートの一覧を, 新しく変えた順に返す.
#[tauri::command]
async fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteMeta>, CommandError> {
    let store = state.store.lock().await;
    store.list().map_err(|e| report("list_notes", e))
}

/// ノートの本文を返す.
#[tauri::command]
async fn read_note(state: State<'_, AppState>, id: String) -> Result<String, CommandError> {
    let store = state.store.lock().await;
    store.read(&id).map_err(|e| report("read_note", e))
}

/// ノートを作る.
#[tauri::command]
async fn create_note(
    state: State<'_, AppState>,
    content: String,
) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    let meta = store
        .create(&content, None, now_millis())
        .map_err(|e| report("create_note", e))?;
    log::info!("Created the note {}", meta.id);
    Ok(meta)
}

/// ノートの本文を保存する.
#[tauri::command]
async fn save_note(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    store
        .save(&id, &content, now_millis())
        .map_err(|e| report("save_note", e))
}

/// ノートを消す (ローカルだけ).
#[tauri::command]
async fn delete_note(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let store = state.store.lock().await;
    store.delete(&id).map_err(|e| report("delete_note", e))?;
    log::info!("Deleted the note {}", id);
    Ok(())
}

/// ノートと HackMD のノートのつながりを外す.
#[tauri::command]
async fn unlink_note(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    store
        .set_link(&id, None)
        .map_err(|e| report("unlink_note", e))
}

/// ノートの同期の状態を, HackMD に問い合わせて返す.
#[tauri::command]
async fn note_status(state: State<'_, AppState>, id: String) -> Result<SyncState, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::status(&store, &client, &id)
        .await
        .map_err(|e| report("note_status", e))
}

/// ノートを HackMD に送る.
#[tauri::command]
async fn push_note(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::push(&store, &client, &id, force)
        .await
        .map_err(|e| report("push_note", e))
}

/// HackMD のノートを, ローカルのノートに取り込む.
#[tauri::command]
async fn pull_note(
    state: State<'_, AppState>,
    id: String,
    force: bool,
) -> Result<NoteMeta, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::pull(&store, &client, &id, force, now_millis())
        .await
        .map_err(|e| report("pull_note", e))
}

/// 衝突したときに, 両方を残す.
#[tauri::command]
async fn keep_both(state: State<'_, AppState>, id: String) -> Result<NoteMeta, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::keep_both(&store, &client, &id, now_millis())
        .await
        .map_err(|e| report("keep_both", e))
}

/// HackMD のノートの一覧を返す.
#[tauri::command]
async fn list_remote(state: State<'_, AppState>) -> Result<Vec<RemoteEntry>, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::remote_list(&store, &client)
        .await
        .map_err(|e| report("list_remote", e))
}

/// HackMD のノートを, ローカルに取り込む.
#[tauri::command]
async fn import_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteMeta, CommandError> {
    let client = client(&state)?;
    let store = state.store.lock().await;
    sync::import(&store, &client, &note_id, now_millis())
        .await
        .map_err(|e| report("import_note", e))
}

/// 画面に返す, 設定 (トークンそのものは返さない).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    /// トークンの取り元.
    token_source: TokenSource,
}

/// 設定を返す.
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> SettingsView {
    SettingsView {
        token_source: token(&state).1,
    }
}

/// HackMD の API のトークンを保存する (空なら, 消す).
#[tauri::command]
fn set_token(state: State<'_, AppState>, token: Option<String>) -> Result<(), CommandError> {
    let saved = settings::load(&state.settings_path);
    settings::save(
        &state.settings_path,
        &settings::with_token(&saved, token.as_deref()),
    )
    .map_err(|e| report("set_token", e))?;
    log::info!("Saved the HackMD settings");
    Ok(())
}

/// トークンを確かめる. 持ち主の名前を返す.
#[tauri::command]
async fn check_token(state: State<'_, AppState>) -> Result<String, CommandError> {
    let me = client(&state)?
        .me()
        .await
        .map_err(|e| report("check_token", e))?;
    Ok(me.name)
}

/// アプリのログの末尾を返す.
#[tauri::command]
async fn read_log(state: State<'_, AppState>) -> Result<String, CommandError> {
    let path = logging::log_path(&state.data_dir);
    logging::read_tail(&path, logging::MAX_BACKUPS, logging::MAX_READ_BYTES)
        .map_err(|e| report("read_log", e))
}

/// アプリのログを消す.
#[tauri::command]
fn clear_log(state: State<'_, AppState>) -> Result<(), CommandError> {
    logging::clear_logs(&logging::log_path(&state.data_dir), logging::MAX_BACKUPS)
        .map_err(|e| report("clear_log", e))?;
    log::info!("Cleared the log");
    Ok(())
}

/// アプリの状態を作る (ディレクトリを決めて, ログを始める).
#[cfg(not(tarpaulin_include))]
fn setup(app: &tauri::App) -> Result<AppState, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let config_dir = app.path().app_config_dir()?;
    logging::init_logging(&logging::log_path(&data_dir));
    log::info!("Starting rs-markdown {}", env!("CARGO_PKG_VERSION"));
    let store = Store::open(&data_dir.join("notes"))?;
    Ok(AppState {
        store: Mutex::new(store),
        data_dir,
        settings_path: settings::settings_path(&config_dir),
    })
}

/// アプリを起動する.
#[cfg(not(tarpaulin_include))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            logging::log_frontend_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
