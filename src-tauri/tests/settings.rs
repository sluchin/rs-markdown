// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 設定 (`settings`) のテスト.

use std::fs;

use tempfile::tempdir;

use rs_mdnote_lib::settings::{
    Settings, TokenSource, effective_token, load, save, settings_path, with_token,
};

#[test]
fn test_load_and_save() {
    let dir = tempdir().unwrap();
    let path = settings_path(&dir.path().join("config"));
    assert_eq!(load(&path), Settings::default());

    let settings = Settings {
        token: Some("secret".to_string()),
    };
    save(&path, &settings).unwrap();
    assert_eq!(load(&path), settings);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // 読めない内容は, 初期値
    fs::write(&path, "not json").unwrap();
    assert_eq!(load(&path), Settings::default());
}

#[test]
fn test_effective_token() {
    let saved = Settings {
        token: Some(" saved ".to_string()),
    };
    assert_eq!(
        effective_token(&saved, Some("env")),
        (Some("saved".to_string()), TokenSource::Saved)
    );
    let empty = Settings {
        token: Some("  ".to_string()),
    };
    assert_eq!(
        effective_token(&empty, Some("env")),
        (Some("env".to_string()), TokenSource::Env)
    );
    assert_eq!(
        effective_token(&Settings::default(), Some("")),
        (None, TokenSource::None)
    );
    assert_eq!(
        effective_token(&Settings::default(), None),
        (None, TokenSource::None)
    );
}

#[test]
fn test_with_token() {
    let settings = Settings::default();
    assert_eq!(
        with_token(&settings, Some(" t ")).token,
        Some("t".to_string())
    );
    assert_eq!(with_token(&settings, Some("")).token, None);
    assert_eq!(with_token(&settings, None).token, None);
}
