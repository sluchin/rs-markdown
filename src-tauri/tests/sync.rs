// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 同期 (`sync`) のテスト. HackMD の API は, テスト用の HTTP サーバー (mockito) で代わりにする.

use mockito::{Matcher, Server, ServerGuard};
use serde_json::json;
use tempfile::{TempDir, tempdir};

use rs_markdown_lib::hackmd::Client;
use rs_markdown_lib::store::{HackmdLink, Store, content_hash};
use rs_markdown_lib::sync::{
    self, SyncError, SyncState, keep_both, pull, push, remote_list, state_of,
};

/// テストの準備: ノートの保存先と, HackMD の代わりのサーバー.
async fn setup() -> (TempDir, Store, ServerGuard, Client) {
    let dir = tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let server = Server::new_async().await;
    let client = Client::new(&server.url(), "tok").unwrap();
    (dir, store, server, client)
}

/// HackMD のノートの取得の応答を作る.
async fn remote(server: &mut ServerGuard, id: &str, content: &str) -> mockito::Mock {
    server
        .mock("GET", format!("/notes/{}", id).as_str())
        .with_body(json!({"id": id, "title": "t", "content": content}).to_string())
        .create_async()
        .await
}

/// 同期した状態のノートを作る.
fn synced_note(store: &Store, note_id: &str, content: &str) -> String {
    let link = HackmdLink {
        note_id: note_id.to_string(),
        synced_hash: content_hash(content),
        publish_link: None,
    };
    store.create(content, Some(link), 1).unwrap().id
}

#[test]
fn test_state_of() {
    assert_eq!(state_of("s", "s", "s"), SyncState::Synced);
    assert_eq!(state_of("s", "l", "s"), SyncState::LocalChanged);
    assert_eq!(state_of("s", "s", "r"), SyncState::RemoteChanged);
    assert_eq!(state_of("s", "l", "r"), SyncState::Conflict);
    // 両方が同じに変わったなら, 同じ
    assert_eq!(state_of("s", "x", "x"), SyncState::Synced);
}

#[test]
fn test_error_messages() {
    for e in [
        SyncError::Conflict,
        SyncError::NotLinked,
        SyncError::Io(std::io::Error::other("x")),
        SyncError::Api(rs_markdown_lib::hackmd::ApiError::NotFound),
    ] {
        assert!(!e.to_string().is_empty());
    }
}

#[tokio::test]
async fn test_status() {
    let (_dir, store, mut server, client) = setup().await;
    let unlinked = store.create("a", None, 1).unwrap().id;
    assert_eq!(
        sync::status(&store, &client, &unlinked).await.unwrap(),
        SyncState::Unlinked
    );
    let id = synced_note(&store, "n1", "base");
    remote(&mut server, "n1", "changed").await;
    assert_eq!(
        sync::status(&store, &client, &id).await.unwrap(),
        SyncState::RemoteChanged
    );
}

#[tokio::test]
async fn test_push_creates_a_note() {
    let (_dir, store, mut server, client) = setup().await;
    let id = store.create("# New", None, 1).unwrap().id;
    server
        .mock("POST", "/notes")
        .with_status(201)
        .with_body(json!({"id": "n9", "publishLink": "https://hackmd.io/n9"}).to_string())
        .create_async()
        .await;
    let meta = push(&store, &client, &id, false).await.unwrap();
    let link = meta.hackmd.unwrap();
    assert_eq!(link.note_id, "n9");
    assert_eq!(link.synced_hash, content_hash("# New"));
    assert_eq!(link.publish_link.as_deref(), Some("https://hackmd.io/n9"));
}

#[tokio::test]
async fn test_push_updates_the_note() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    store.save(&id, "local", 2).unwrap();
    remote(&mut server, "n1", "base").await;
    let patch = server
        .mock("PATCH", "/notes/n1")
        .match_body(Matcher::Json(json!({"content": "local"})))
        .with_status(202)
        .create_async()
        .await;
    let meta = push(&store, &client, &id, false).await.unwrap();
    assert_eq!(meta.hackmd.unwrap().synced_hash, content_hash("local"));
    patch.assert_async().await;
}

#[tokio::test]
async fn test_push_skips_when_synced() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "same");
    remote(&mut server, "n1", "same").await;
    let patch = server
        .mock("PATCH", "/notes/n1")
        .expect(0)
        .create_async()
        .await;
    push(&store, &client, &id, false).await.unwrap();
    patch.assert_async().await;
}

#[tokio::test]
async fn test_push_conflict_and_force() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    store.save(&id, "local", 2).unwrap();
    remote(&mut server, "n1", "remote").await;
    assert!(matches!(
        push(&store, &client, &id, false).await.unwrap_err(),
        SyncError::Conflict
    ));
    server
        .mock("PATCH", "/notes/n1")
        .with_status(202)
        .create_async()
        .await;
    let meta = push(&store, &client, &id, true).await.unwrap();
    assert_eq!(meta.hackmd.unwrap().synced_hash, content_hash("local"));
}

#[tokio::test]
async fn test_pull() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    remote(&mut server, "n1", "remote").await;
    let meta = pull(&store, &client, &id, false, 5).await.unwrap();
    assert_eq!(store.read(&id).unwrap(), "remote");
    assert_eq!(meta.updated_at, 5);
    assert_eq!(meta.hackmd.unwrap().synced_hash, content_hash("remote"));
    // 同じなら, 日時を変えない
    server.reset();
    remote(&mut server, "n1", "remote").await;
    let meta = pull(&store, &client, &id, false, 9).await.unwrap();
    assert_eq!(meta.updated_at, 5);
}

#[tokio::test]
async fn test_pull_conflict_and_force() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    store.save(&id, "local", 2).unwrap();
    remote(&mut server, "n1", "base").await;
    assert!(matches!(
        pull(&store, &client, &id, false, 3).await.unwrap_err(),
        SyncError::Conflict
    ));
    pull(&store, &client, &id, true, 3).await.unwrap();
    assert_eq!(store.read(&id).unwrap(), "base");
}

#[tokio::test]
async fn test_pull_not_linked() {
    let (_dir, store, _server, client) = setup().await;
    let id = store.create("a", None, 1).unwrap().id;
    assert!(matches!(
        pull(&store, &client, &id, false, 2).await.unwrap_err(),
        SyncError::NotLinked
    ));
    assert!(matches!(
        keep_both(&store, &client, &id, 2).await.unwrap_err(),
        SyncError::NotLinked
    ));
}

#[tokio::test]
async fn test_pull_missing_content_is_empty() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    server
        .mock("GET", "/notes/n1")
        .with_body(json!({"id": "n1"}).to_string())
        .create_async()
        .await;
    pull(&store, &client, &id, false, 2).await.unwrap();
    assert_eq!(store.read(&id).unwrap(), "");
}

#[tokio::test]
async fn test_keep_both() {
    let (_dir, store, mut server, client) = setup().await;
    let id = synced_note(&store, "n1", "base");
    store.save(&id, "local", 2).unwrap();
    remote(&mut server, "n1", "remote").await;
    let created = keep_both(&store, &client, &id, 3).await.unwrap();
    assert_eq!(store.read(&created.id).unwrap(), "remote");
    assert_eq!(created.hackmd.unwrap().note_id, "n1");
    assert_eq!(store.meta(&id).unwrap().hackmd, None);
    assert_eq!(store.read(&id).unwrap(), "local");
}

#[tokio::test]
async fn test_import() {
    let (_dir, store, mut server, client) = setup().await;
    let get = remote(&mut server, "n1", "# Imported").await;
    let first = sync::import(&store, &client, "n1", 4).await.unwrap();
    assert_eq!(first.title, "Imported");
    // 2 回目は, 取り込んだノートを返す (取得しない)
    let second = sync::import(&store, &client, "n1", 5).await.unwrap();
    assert_eq!(second.id, first.id);
    get.expect(1).assert_async().await;
}

#[tokio::test]
async fn test_remote_list() {
    let (_dir, store, mut server, client) = setup().await;
    let local = synced_note(&store, "n2", "x");
    server
        .mock("GET", "/notes")
        .with_body(
            json!([
                {"id": "n1", "title": "old", "lastChangedAt": 1},
                {"id": "n2", "title": "new", "lastChangedAt": 9}
            ])
            .to_string(),
        )
        .create_async()
        .await;
    let entries = remote_list(&store, &client).await.unwrap();
    assert_eq!(entries[0].id, "n2");
    assert_eq!(entries[0].local_id.as_deref(), Some(local.as_str()));
    assert_eq!(entries[1].local_id, None);
}
