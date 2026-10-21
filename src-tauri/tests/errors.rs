// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面に返すエラー (`errors`) のテスト.

use std::io;

use rs_markdown_lib::errors::{CommandError, ErrorKind};
use rs_markdown_lib::hackmd::ApiError;
use rs_markdown_lib::sync::SyncError;

#[test]
fn test_from_api_error() {
    let cases = [
        (ApiError::Unauthorized, ErrorKind::Unauthorized),
        (ApiError::NotFound, ErrorKind::NotFound),
        (ApiError::RateLimited, ErrorKind::RateLimited),
        (ApiError::Network("x".into()), ErrorKind::Network),
        (ApiError::Status(500), ErrorKind::Other),
        (ApiError::Decode("x".into()), ErrorKind::Other),
        (ApiError::InvalidId, ErrorKind::Other),
    ];
    for (api, kind) in cases {
        assert_eq!(CommandError::from(api).kind, kind);
    }
}

#[test]
fn test_from_io_error() {
    assert_eq!(
        CommandError::from(io::Error::from(io::ErrorKind::NotFound)).kind,
        ErrorKind::NotFound
    );
    assert_eq!(
        CommandError::from(io::Error::other("x")).kind,
        ErrorKind::Io
    );
}

#[test]
fn test_from_sync_error() {
    assert_eq!(
        CommandError::from(SyncError::Conflict).kind,
        ErrorKind::Conflict
    );
    assert_eq!(
        CommandError::from(SyncError::NotLinked).kind,
        ErrorKind::NotLinked
    );
    assert_eq!(
        CommandError::from(SyncError::Api(ApiError::RateLimited)).kind,
        ErrorKind::RateLimited
    );
    assert_eq!(
        CommandError::from(SyncError::Io(io::Error::other("x"))).kind,
        ErrorKind::Io
    );
    assert_eq!(CommandError::no_token().kind, ErrorKind::NoToken);
}

#[test]
fn test_serialized_shape() {
    let json = serde_json::to_value(CommandError::from(SyncError::Conflict)).unwrap();
    assert_eq!(json["kind"], "conflict");
    assert!(json["message"].is_string());
}
