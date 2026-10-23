// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! HackMD の API (`hackmd`) のテスト. テスト用の HTTP サーバー (mockito) を使う.

use mockito::{Matcher, Server};
use serde_json::json;

use rs_mdnote_lib::hackmd::{ApiError, Client, USER_AGENT, check_status, is_valid_note_id};

#[test]
fn test_check_status() {
    assert_eq!(check_status(200), Ok(()));
    assert_eq!(check_status(202), Ok(()));
    assert_eq!(check_status(401), Err(ApiError::Unauthorized));
    assert_eq!(check_status(403), Err(ApiError::Unauthorized));
    assert_eq!(check_status(404), Err(ApiError::NotFound));
    assert_eq!(check_status(429), Err(ApiError::RateLimited));
    assert_eq!(check_status(500), Err(ApiError::Status(500)));
}

#[test]
fn test_is_valid_note_id() {
    assert!(is_valid_note_id("MqZqMWTvTwejz1kMxZwnKw"));
    assert!(is_valid_note_id("a-b_c"));
    assert!(!is_valid_note_id(""));
    assert!(!is_valid_note_id("../me"));
    assert!(!is_valid_note_id("a?b"));
    assert!(!is_valid_note_id(&"a".repeat(65)));
}

#[test]
fn test_error_messages() {
    for e in [
        ApiError::Unauthorized,
        ApiError::NotFound,
        ApiError::RateLimited,
        ApiError::Status(500),
        ApiError::Network("down".into()),
        ApiError::Decode("bad".into()),
        ApiError::InvalidId,
    ] {
        assert!(!e.to_string().is_empty());
    }
}

#[tokio::test]
async fn test_me_sends_the_token() {
    let mut server = Server::new_async().await;
    let mock = server
        .mock("GET", "/me")
        .match_header("authorization", "Bearer tok")
        .match_header("user-agent", USER_AGENT)
        .with_body(json!({"name": "Me", "userPath": "me"}).to_string())
        .create_async()
        .await;
    let client = Client::new(&format!("{}/", server.url()), "tok").unwrap();
    let me = client.me().await.unwrap();
    assert_eq!(me.name, "Me");
    assert_eq!(me.user_path, "me");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_list_and_get() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/notes")
        .with_body(
            json!([{"id": "n1", "title": "T", "lastChangedAt": 5}, {"id": "n2"}]).to_string(),
        )
        .create_async()
        .await;
    server
        .mock("GET", "/notes/n1")
        .with_body(
            json!({"id": "n1", "title": "T", "content": "# T", "publishLink": "https://hackmd.io/x"})
                .to_string(),
        )
        .create_async()
        .await;
    let client = Client::new(&server.url(), "tok").unwrap();
    let list = client.list().await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].last_changed_at, Some(5));
    assert_eq!(list[1].title, "");
    let note = client.get("n1").await.unwrap();
    assert_eq!(note.content.as_deref(), Some("# T"));
    assert_eq!(note.publish_link.as_deref(), Some("https://hackmd.io/x"));
}

#[tokio::test]
async fn test_create_is_private() {
    let mut server = Server::new_async().await;
    let mock = server
        .mock("POST", "/notes")
        .match_body(Matcher::Json(json!({
            "content": "# New",
            "readPermission": "owner",
            "writePermission": "owner",
            "commentPermission": "disabled",
        })))
        .with_status(201)
        .with_body(json!({"id": "n9", "title": "New", "content": "# New"}).to_string())
        .create_async()
        .await;
    let client = Client::new(&server.url(), "tok").unwrap();
    assert_eq!(client.create("# New").await.unwrap().id, "n9");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_update() {
    let mut server = Server::new_async().await;
    let mock = server
        .mock("PATCH", "/notes/n1")
        .match_body(Matcher::Json(json!({"content": "body"})))
        .with_status(202)
        .create_async()
        .await;
    let client = Client::new(&server.url(), "tok").unwrap();
    client.update("n1", "body").await.unwrap();
    mock.assert_async().await;
}

#[tokio::test]
async fn test_errors() {
    let mut server = Server::new_async().await;
    server
        .mock("GET", "/me")
        .with_status(401)
        .create_async()
        .await;
    server
        .mock("GET", "/notes/gone")
        .with_status(404)
        .create_async()
        .await;
    server
        .mock("PATCH", "/notes/busy")
        .with_status(429)
        .create_async()
        .await;
    server
        .mock("GET", "/notes")
        .with_body("not json")
        .create_async()
        .await;
    let client = Client::new(&server.url(), "bad").unwrap();
    assert_eq!(client.me().await.unwrap_err(), ApiError::Unauthorized);
    assert_eq!(client.get("gone").await.unwrap_err(), ApiError::NotFound);
    assert_eq!(
        client.update("busy", "x").await.unwrap_err(),
        ApiError::RateLimited
    );
    assert!(matches!(
        client.list().await.unwrap_err(),
        ApiError::Decode(_)
    ));
    assert_eq!(client.get("../x").await.unwrap_err(), ApiError::InvalidId);
    assert_eq!(
        client.update("../x", "x").await.unwrap_err(),
        ApiError::InvalidId
    );
    // つながらない
    let offline = Client::new("http://127.0.0.1:1", "tok").unwrap();
    assert!(matches!(
        offline.me().await.unwrap_err(),
        ApiError::Network(_)
    ));
}
