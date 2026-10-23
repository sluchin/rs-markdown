// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面 (フロントエンド) から呼ぶコマンドの本体. Tauri に依存する部分 (`State` を受け取る関数) は
//! `lib.rs` に薄く置いて, ここでは, アプリの状態 ([`AppState`]) を受け取る普通の関数にする.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::InvokeBody;
use tokio::sync::Mutex;

use crate::errors::{CommandError, ErrorKind};
use crate::settings::{self, TokenSource};
use crate::store::{NoteMeta, Store};
use crate::sync::{self, RemoteEntry, SyncState};
use crate::{filesync, hackmd, images, logging};

/// アプリの状態.
pub struct AppState {
    /// ノートの保存先. 一覧の読み書きが重ならないように, 1 つずつ使う.
    pub store: Mutex<Store>,
    /// アプリのデータのディレクトリ (ログ, 画像).
    pub data_dir: PathBuf,
    /// 設定のファイル.
    pub settings_path: PathBuf,
    /// HackMD の API の URL (テストでは, テスト用のサーバー).
    pub api_base: String,
    /// 起動したときの環境変数のトークン (保存したトークンがないときに使う).
    pub env_token: Option<String>,
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
    settings::effective_token(&saved, state.env_token.as_deref())
}

/// HackMD の API の呼び出しを作る. トークンがなければ, エラー.
fn client(state: &AppState) -> Result<hackmd::Client, CommandError> {
    let (Some(token), _) = token(state) else {
        return Err(CommandError::no_token());
    };
    Ok(hackmd::Client::new(&state.api_base, &token)?)
}

/// 失敗をログに書いて, 画面に返すエラーにする.
fn report(context: &str, e: impl Into<CommandError>) -> CommandError {
    let e = e.into();
    log::warn!("{} failed: {}", context, e.message);
    e
}

/// ノートの一覧を, 新しく変えた順に返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// ノートの一覧.
pub async fn list_notes(state: &AppState) -> Result<Vec<NoteMeta>, CommandError> {
    let store = state.store.lock().await;
    store.list().map_err(|e| report("list_notes", e))
}

/// ノートの本文を返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 本文.
pub async fn read_note(state: &AppState, id: &str) -> Result<String, CommandError> {
    let store = state.store.lock().await;
    store.read(id).map_err(|e| report("read_note", e))
}

/// ノートを作る.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `content` - 本文.
///
/// # Returns
///
/// 作ったノート.
pub async fn create_note(state: &AppState, content: &str) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    let meta = store
        .create(content, None, now_millis())
        .map_err(|e| report("create_note", e))?;
    log::info!("Created the note {}", meta.id);
    Ok(meta)
}

/// ノートの本文を保存する.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
/// * `content` - 本文.
///
/// # Returns
///
/// 保存したノート.
pub async fn save_note(
    state: &AppState,
    id: &str,
    content: &str,
) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    store
        .save(id, content, now_millis())
        .map_err(|e| report("save_note", e))
}

/// ノートを消す (ローカルだけ).
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 成功したかどうか.
pub async fn delete_note(state: &AppState, id: &str) -> Result<(), CommandError> {
    let store = state.store.lock().await;
    store.delete(id).map_err(|e| report("delete_note", e))?;
    log::info!("Deleted the note {}", id);
    Ok(())
}

/// ノートと HackMD のノートのつながりを外す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 外したあとのノート.
pub async fn unlink_note(state: &AppState, id: &str) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    store
        .set_link(id, None)
        .map_err(|e| report("unlink_note", e))
}

/// ノートの同期の状態を, HackMD に問い合わせて返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 同期の状態.
pub async fn note_status(state: &AppState, id: &str) -> Result<SyncState, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::status(&store, &client, id)
        .await
        .map_err(|e| report("note_status", e))
}

/// ノートを HackMD に送る.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
/// * `force` - HackMD の側が変わっていても, 上書きするかどうか.
///
/// # Returns
///
/// 送ったあとのノート.
pub async fn push_note(state: &AppState, id: &str, force: bool) -> Result<NoteMeta, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::push(&store, &client, id, force)
        .await
        .map_err(|e| report("push_note", e))
}

/// HackMD のノートを, ローカルのノートに取り込む.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
/// * `force` - ローカルの側が変わっていても, 上書きするかどうか.
///
/// # Returns
///
/// 取り込んだあとのノート.
pub async fn pull_note(state: &AppState, id: &str, force: bool) -> Result<NoteMeta, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::pull(&store, &client, id, force, now_millis())
        .await
        .map_err(|e| report("pull_note", e))
}

/// 衝突したときに, 両方を残す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// HackMD の内容で作ったノート.
pub async fn keep_both(state: &AppState, id: &str) -> Result<NoteMeta, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::keep_both(&store, &client, id, now_millis())
        .await
        .map_err(|e| report("keep_both", e))
}

/// HackMD のノートの一覧を返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// HackMD のノートの一覧.
pub async fn list_remote(state: &AppState) -> Result<Vec<RemoteEntry>, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::remote_list(&store, &client)
        .await
        .map_err(|e| report("list_remote", e))
}

/// HackMD のノートを, ローカルに取り込む.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `note_id` - HackMD のノートの ID.
///
/// # Returns
///
/// 取り込んだノート.
pub async fn import_note(state: &AppState, note_id: &str) -> Result<NoteMeta, CommandError> {
    let client = client(state)?;
    let store = state.store.lock().await;
    sync::import(&store, &client, note_id, now_millis())
        .await
        .map_err(|e| report("import_note", e))
}

/// 外の Markdown のファイルを, ファイルとつないだノートとして取り込む (もう取り込んであれば, そのノート).
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `path` - ファイルのパス.
///
/// # Returns
///
/// 取り込んだノート.
pub async fn import_file(state: &AppState, path: &str) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    let meta = filesync::import(&store, Path::new(path), now_millis())
        .map_err(|e| report("import_file", e))?;
    // パスと本文は, ログに書かない
    log::info!("Imported a file as the note {}", meta.id);
    Ok(meta)
}

/// ノートと元のファイルの同期の状態を返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 同期の状態.
pub async fn file_status(state: &AppState, id: &str) -> Result<SyncState, CommandError> {
    let store = state.store.lock().await;
    filesync::status(&store, id).map_err(|e| report("file_status", e))
}

/// ノートの本文を, 元のファイルに書く.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
/// * `force` - ファイルの側が変わっていても, 上書きするかどうか.
///
/// # Returns
///
/// 書いたあとのノート.
pub async fn push_file(state: &AppState, id: &str, force: bool) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    filesync::push(&store, id, force).map_err(|e| report("push_file", e))
}

/// 元のファイルの本文を, ノートに取り込み直す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
/// * `force` - ノートの側が変わっていても, 上書きするかどうか.
///
/// # Returns
///
/// 取り込んだあとのノート.
pub async fn pull_file(state: &AppState, id: &str, force: bool) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    filesync::pull(&store, id, force, now_millis()).map_err(|e| report("pull_file", e))
}

/// ファイルとの衝突で, 両方を残す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// ファイルの内容で作ったノート.
pub async fn keep_both_file(state: &AppState, id: &str) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    filesync::keep_both(&store, id, now_millis()).map_err(|e| report("keep_both_file", e))
}

/// ノートと元のファイルのつながりを外す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 外したあとのノート.
pub async fn unlink_file(state: &AppState, id: &str) -> Result<NoteMeta, CommandError> {
    let store = state.store.lock().await;
    store
        .set_file(id, None)
        .map_err(|e| report("unlink_file", e))
}

/// 貼り付けた画像を置く. 中身は, 呼び出しの本体 (バイト列) で受け取る.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `body` - 呼び出しの本体.
///
/// # Returns
///
/// 置いたファイルの名前 (ノートには `images/<名前>` と書く).
pub fn save_image(state: &AppState, body: &InvokeBody) -> Result<String, CommandError> {
    let InvokeBody::Raw(bytes) = body else {
        return Err(report(
            "save_image",
            CommandError::new(ErrorKind::InvalidImage, "the image must be sent as bytes"),
        ));
    };
    let name = images::save(&images::images_dir(&state.data_dir), bytes)
        .map_err(|e| report("save_image", e))?;
    log::info!("Saved the image {}", name);
    Ok(name)
}

/// 落とした画像のファイルを, 写して置く.
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `path` - 画像のファイルのパス.
///
/// # Returns
///
/// 置いたファイルの名前.
pub fn import_image(state: &AppState, path: &str) -> Result<String, CommandError> {
    let name = images::import(&images::images_dir(&state.data_dir), Path::new(path))
        .map_err(|e| report("import_image", e))?;
    log::info!("Imported the image {}", name);
    Ok(name)
}

/// 画像を置くディレクトリを返す (表示で, 画像を読むのに使う).
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// ディレクトリのパス.
pub fn images_dir(state: &AppState) -> String {
    images::images_dir(&state.data_dir)
        .to_string_lossy()
        .into_owned()
}

/// 画面に返す, 設定 (トークンそのものは返さない).
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    /// トークンの取り元.
    pub token_source: TokenSource,
}

/// 設定を返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// 設定.
pub fn get_settings(state: &AppState) -> SettingsView {
    SettingsView {
        token_source: token(state).1,
    }
}

/// HackMD の API のトークンを保存する (空なら, 消す).
///
/// # Arguments
///
/// * `state` - アプリの状態.
/// * `token` - トークン.
///
/// # Returns
///
/// 成功したかどうか.
pub fn set_token(state: &AppState, token: Option<&str>) -> Result<(), CommandError> {
    let saved = settings::load(&state.settings_path);
    settings::save(&state.settings_path, &settings::with_token(&saved, token))
        .map_err(|e| report("set_token", e))?;
    log::info!("Saved the HackMD settings");
    Ok(())
}

/// トークンを確かめる.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// トークンの持ち主の名前.
pub async fn check_token(state: &AppState) -> Result<String, CommandError> {
    let me = client(state)?
        .me()
        .await
        .map_err(|e| report("check_token", e))?;
    Ok(me.name)
}

/// アプリのログの末尾を返す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// ログの末尾.
pub fn read_log(state: &AppState) -> Result<String, CommandError> {
    let path = logging::log_path(&state.data_dir);
    logging::read_tail(&path, logging::MAX_BACKUPS, logging::MAX_READ_BYTES)
        .map_err(|e| report("read_log", e))
}

/// アプリのログを消す.
///
/// # Arguments
///
/// * `state` - アプリの状態.
///
/// # Returns
///
/// 成功したかどうか.
pub fn clear_log(state: &AppState) -> Result<(), CommandError> {
    logging::clear_logs(&logging::log_path(&state.data_dir), logging::MAX_BACKUPS)
        .map_err(|e| report("clear_log", e))?;
    log::info!("Cleared the log");
    Ok(())
}
