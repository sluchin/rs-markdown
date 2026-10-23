// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面から呼ぶコマンド (`commands`) のテスト. HackMD の API は, テスト用の HTTP サーバー (mockito) で代わりにする.

use std::fs;
use std::path::Path;

use mockito::{Server, ServerGuard};
use serde_json::json;
use tauri::ipc::InvokeBody;
use tempfile::{TempDir, tempdir};
use tokio::sync::Mutex;

use rs_mdnote_lib::commands::{self, AppState, SettingsView};
use rs_mdnote_lib::errors::ErrorKind;
use rs_mdnote_lib::settings::TokenSource;
use rs_mdnote_lib::store::Store;
use rs_mdnote_lib::sync::SyncState;
use rs_mdnote_lib::{images, logging};

/// PNG の始めのバイト (形式は, 中身で決める).
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000";

/// アプリの状態を作る. ノート, 設定, ログは, 一時的なディレクトリに置く.
///
/// # Arguments
///
/// * `api_base` - HackMD の API の URL.
/// * `env_token` - 環境変数のトークン.
fn state(api_base: &str, env_token: Option<&str>) -> (TempDir, AppState) {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("notes")).unwrap();
    let state = AppState {
        store: Mutex::new(store),
        data_dir: dir.path().to_path_buf(),
        settings_path: dir.path().join("config").join("settings.json"),
        api_base: api_base.to_string(),
        env_token: env_token.map(str::to_string),
    };
    (dir, state)
}

/// HackMD の代わりのサーバーと, トークンのあるアプリの状態を作る.
async fn with_server() -> (TempDir, AppState, ServerGuard) {
    let server = Server::new_async().await;
    let (dir, state) = state(&server.url(), Some("tok"));
    (dir, state, server)
}

/// HackMD のノートの取得の応答を作る.
async fn remote(server: &mut ServerGuard, id: &str, content: &str) -> mockito::Mock {
    server
        .mock("GET", format!("/notes/{}", id).as_str())
        .with_body(json!({"id": id, "title": "t", "content": content}).to_string())
        .create_async()
        .await
}

#[tokio::test]
async fn test_notes_create_read_save_list_delete() {
    let (_dir, state) = state("http://127.0.0.1:1", None);
    let meta = commands::create_note(&state, "# a").await.unwrap();
    assert_eq!(commands::read_note(&state, &meta.id).await.unwrap(), "# a");
    let saved = commands::save_note(&state, &meta.id, "# b").await.unwrap();
    assert_eq!(saved.id, meta.id);
    assert_eq!(commands::list_notes(&state).await.unwrap().len(), 1);
    commands::delete_note(&state, &meta.id).await.unwrap();
    assert!(commands::list_notes(&state).await.unwrap().is_empty());
}

#[tokio::test]
async fn test_notes_report_the_errors() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    let id = commands::create_note(&state, "x").await.unwrap().id;
    // 正しくない ID
    for e in [
        commands::read_note(&state, "../x").await.unwrap_err(),
        commands::save_note(&state, "../x", "y").await.unwrap_err(),
        commands::delete_note(&state, "../x").await.unwrap_err(),
        commands::unlink_note(&state, "../x").await.unwrap_err(),
        commands::unlink_file(&state, "../x").await.unwrap_err(),
    ] {
        assert!(
            matches!(e.kind, ErrorKind::Io | ErrorKind::NotFound),
            "{:?}",
            e
        );
    }
    // 保存先がなくなった
    fs::remove_dir_all(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes"), "not a directory").unwrap();
    assert_eq!(
        commands::list_notes(&state).await.unwrap_err().kind,
        ErrorKind::Io
    );
    assert_eq!(
        commands::create_note(&state, "y").await.unwrap_err().kind,
        ErrorKind::Io
    );
    assert_eq!(
        commands::read_note(&state, &id).await.unwrap_err().kind,
        ErrorKind::Io
    );
}

#[tokio::test]
async fn test_hackmd_commands_need_a_token() {
    let (_dir, state) = state("http://127.0.0.1:1", None);
    let id = commands::create_note(&state, "x").await.unwrap().id;
    for e in [
        commands::note_status(&state, &id).await.unwrap_err(),
        commands::push_note(&state, &id, false).await.unwrap_err(),
        commands::pull_note(&state, &id, false).await.unwrap_err(),
        commands::keep_both(&state, &id).await.unwrap_err(),
        commands::list_remote(&state).await.unwrap_err(),
        commands::import_note(&state, "abc").await.unwrap_err(),
        commands::check_token(&state).await.unwrap_err(),
    ] {
        assert_eq!(e.kind, ErrorKind::NoToken);
    }
}

#[tokio::test]
async fn test_hackmd_commands_reject_a_token_that_cannot_be_sent() {
    // 改行を含むトークンは, HTTP のヘッダーに入れられない
    let (_dir, state) = state("http://127.0.0.1:1", Some("a\nb"));
    assert!(commands::check_token(&state).await.is_err());
}

#[tokio::test]
async fn test_push_status_pull_and_unlink() {
    let (_dir, state, mut server) = with_server().await;
    let id = commands::create_note(&state, "# a").await.unwrap().id;
    assert_eq!(
        commands::note_status(&state, &id).await.unwrap(),
        SyncState::Unlinked
    );
    let _create = server
        .mock("POST", "/notes")
        .with_body(json!({"id": "n1", "title": "a", "content": "# a"}).to_string())
        .create_async()
        .await;
    let pushed = commands::push_note(&state, &id, false).await.unwrap();
    assert_eq!(pushed.hackmd.unwrap().note_id, "n1");
    let _get = remote(&mut server, "n1", "# a").await;
    assert_eq!(
        commands::note_status(&state, &id).await.unwrap(),
        SyncState::Synced
    );
    assert!(commands::pull_note(&state, &id, false).await.is_ok());
    let kept = commands::keep_both(&state, &id).await.unwrap();
    assert_ne!(kept.id, id);
    let unlinked = commands::unlink_note(&state, &id).await.unwrap();
    assert!(unlinked.hackmd.is_none());
    // つないでいないノートは, 送れるが, 取り込めない
    assert_eq!(
        commands::pull_note(&state, &id, false)
            .await
            .unwrap_err()
            .kind,
        ErrorKind::NotLinked
    );
    assert_eq!(
        commands::keep_both(&state, &id).await.unwrap_err().kind,
        ErrorKind::NotLinked
    );
}

#[tokio::test]
async fn test_push_reports_the_api_errors() {
    let (_dir, state, mut server) = with_server().await;
    let id = commands::create_note(&state, "# a").await.unwrap().id;
    let _create = server
        .mock("POST", "/notes")
        .with_status(401)
        .create_async()
        .await;
    assert_eq!(
        commands::push_note(&state, &id, false)
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Unauthorized
    );
}

#[tokio::test]
async fn test_list_remote_and_import_note() {
    let (_dir, state, mut server) = with_server().await;
    let _list = server
        .mock("GET", "/notes")
        .with_body(json!([{"id": "n1", "title": "t"}]).to_string())
        .create_async()
        .await;
    let entries = commands::list_remote(&state).await.unwrap();
    assert_eq!(entries[0].id, "n1");
    let _get = remote(&mut server, "n1", "# t").await;
    let meta = commands::import_note(&state, "n1").await.unwrap();
    assert_eq!(commands::read_note(&state, &meta.id).await.unwrap(), "# t");
    // 一覧の取得の失敗
    let _fail = server
        .mock("GET", "/notes")
        .with_status(429)
        .create_async()
        .await;
    assert_eq!(
        commands::list_remote(&state).await.unwrap_err().kind,
        ErrorKind::RateLimited
    );
    assert_eq!(
        commands::import_note(&state, "missing")
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Other
    );
}

#[tokio::test]
async fn test_check_token() {
    let (_dir, state, mut server) = with_server().await;
    let _me = server
        .mock("GET", "/me")
        .with_body(json!({"name": "me"}).to_string())
        .create_async()
        .await;
    assert_eq!(commands::check_token(&state).await.unwrap(), "me");
    let _fail = server
        .mock("GET", "/me")
        .with_status(401)
        .create_async()
        .await;
    assert_eq!(
        commands::check_token(&state).await.unwrap_err().kind,
        ErrorKind::Unauthorized
    );
}

#[tokio::test]
async fn test_file_commands() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    let path = dir.path().join("a.md");
    fs::write(&path, "# file").unwrap();
    let path = path.to_str().unwrap();
    let meta = commands::import_file(&state, path).await.unwrap();
    assert_eq!(
        commands::file_status(&state, &meta.id).await.unwrap(),
        SyncState::Synced
    );
    commands::save_note(&state, &meta.id, "# note")
        .await
        .unwrap();
    commands::push_file(&state, &meta.id, false).await.unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), "# note");
    fs::write(path, "# changed").unwrap();
    commands::pull_file(&state, &meta.id, false).await.unwrap();
    assert_eq!(
        commands::read_note(&state, &meta.id).await.unwrap(),
        "# changed"
    );
    let kept = commands::keep_both_file(&state, &meta.id).await.unwrap();
    assert_ne!(kept.id, meta.id);
    let unlinked = commands::unlink_file(&state, &meta.id).await.unwrap();
    assert!(unlinked.file.is_none());
}

#[tokio::test]
async fn test_file_commands_report_the_errors() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    let id = commands::create_note(&state, "x").await.unwrap().id;
    let txt = dir.path().join("a.png");
    fs::write(&txt, "x").unwrap();
    assert_eq!(
        commands::import_file(&state, txt.to_str().unwrap())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::InvalidFile
    );
    assert_eq!(
        commands::file_status(&state, "../x")
            .await
            .unwrap_err()
            .kind,
        ErrorKind::NotFound
    );
    for e in [
        commands::push_file(&state, &id, false).await.unwrap_err(),
        commands::pull_file(&state, &id, false).await.unwrap_err(),
        commands::keep_both_file(&state, &id).await.unwrap_err(),
    ] {
        assert_eq!(e.kind, ErrorKind::FileNotLinked);
    }
}

#[test]
fn test_images() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    let images_dir = commands::images_dir(&state);
    assert_eq!(
        Path::new(&images_dir),
        images::images_dir(dir.path()).as_path()
    );
    let name = commands::save_image(&state, &InvokeBody::Raw(PNG.to_vec())).unwrap();
    assert!(Path::new(&images_dir).join(&name).is_file());
    // バイト列でない本体, 置けない形式
    assert_eq!(
        commands::save_image(&state, &InvokeBody::Json(json!("x")))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidImage
    );
    assert_eq!(
        commands::save_image(&state, &InvokeBody::Raw(b"text".to_vec()))
            .unwrap_err()
            .kind,
        ErrorKind::InvalidImage
    );
    let source = dir.path().join("a.png");
    fs::write(&source, PNG).unwrap();
    let imported = commands::import_image(&state, source.to_str().unwrap()).unwrap();
    assert!(Path::new(&images_dir).join(imported).is_file());
    assert!(commands::import_image(&state, "/nonexistent/a.png").is_err());
}

#[test]
fn test_settings_and_token() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    assert_eq!(
        commands::get_settings(&state),
        SettingsView {
            token_source: TokenSource::None
        }
    );
    commands::set_token(&state, Some("tok")).unwrap();
    assert_eq!(
        commands::get_settings(&state).token_source,
        TokenSource::Saved
    );
    commands::set_token(&state, None).unwrap();
    assert_eq!(
        commands::get_settings(&state).token_source,
        TokenSource::None
    );
    let (_dir2, env) = state_with_env();
    assert_eq!(commands::get_settings(&env).token_source, TokenSource::Env);
    // 設定のディレクトリを作れない
    fs::remove_dir_all(dir.path().join("config")).unwrap();
    fs::write(dir.path().join("config"), "not a directory").unwrap();
    assert_eq!(
        commands::set_token(&state, Some("tok")).unwrap_err().kind,
        ErrorKind::Io
    );
}

/// 環境変数のトークンだけがある, アプリの状態.
fn state_with_env() -> (TempDir, AppState) {
    state("http://127.0.0.1:1", Some("env"))
}

#[test]
fn test_read_and_clear_log() {
    let (dir, state) = state("http://127.0.0.1:1", None);
    let path = logging::log_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "line\n").unwrap();
    assert_eq!(commands::read_log(&state).unwrap(), "line\n");
    commands::clear_log(&state).unwrap();
    assert!(commands::read_log(&state).unwrap().is_empty());
    // ログのパスがディレクトリなら, 読めず, 消せない
    let _ = fs::remove_file(&path);
    fs::create_dir_all(&path).unwrap();
    assert_eq!(commands::read_log(&state).unwrap_err().kind, ErrorKind::Io);
    assert_eq!(commands::clear_log(&state).unwrap_err().kind, ErrorKind::Io);
}
