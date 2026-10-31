// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ノートの保存 (`store`) のテスト.

use std::fs;

use tempfile::tempdir;

use rs_markdown_lib::store::{
    HackmdLink, MAX_TITLE_CHARS, Store, content_hash, is_valid_id, title_of,
};

/// テスト用のつながり.
fn link(note_id: &str) -> HackmdLink {
    HackmdLink {
        note_id: note_id.to_string(),
        synced_hash: content_hash("x"),
        publish_link: None,
    }
}

#[test]
fn test_content_hash_is_sha256_hex() {
    assert_eq!(
        content_hash(""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_ne!(content_hash("a"), content_hash("b"));
}

#[test]
fn test_title_of_heading_and_first_line() {
    assert_eq!(title_of("intro\n# Heading \nbody"), "Heading");
    assert_eq!(title_of("\n\n  first line \nsecond"), "first line");
    assert_eq!(title_of(""), "");
    assert_eq!(title_of("#nospace"), "#nospace");
}

#[test]
fn test_title_of_front_matter() {
    assert_eq!(
        title_of("---\ntags: a\ntitle: \"Front\"\n---\n# Heading"),
        "Front"
    );
    // title が空なら, 見出しを使う
    assert_eq!(title_of("---\ntitle:\n---\n# Heading"), "Heading");
    // 閉じていない YAML は, 全部を YAML とみなす
    assert_eq!(title_of("---\ntitle: Open"), "Open");
}

#[test]
fn test_title_of_truncates() {
    let long = "あ".repeat(MAX_TITLE_CHARS + 10);
    assert_eq!(title_of(&long).chars().count(), MAX_TITLE_CHARS);
}

#[test]
fn test_is_valid_id() {
    assert!(is_valid_id("0f8fad5b-d9cb-469f-a165-70867728950e"));
    assert!(!is_valid_id("../../etc/passwd-aaaaaaaaaaaaaaaaaaaaa"));
    assert!(!is_valid_id("short"));
}

#[test]
fn test_create_read_save_list() {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("notes")).unwrap();
    assert!(store.list().unwrap().is_empty());

    let a = store.create("# A", None, 10).unwrap();
    let b = store.create("# B", Some(link("remote")), 20).unwrap();
    assert_eq!(a.title, "A");
    assert_eq!(store.read(&a.id).unwrap(), "# A");

    // 新しく変えた順
    let ids: Vec<String> = store.list().unwrap().into_iter().map(|n| n.id).collect();
    assert_eq!(ids, vec![b.id.clone(), a.id.clone()]);

    let saved = store.save(&a.id, "# A2\nbody", 30).unwrap();
    assert_eq!(saved.title, "A2");
    assert_eq!(saved.updated_at, 30);
    assert_eq!(store.read(&a.id).unwrap(), "# A2\nbody");
    assert_eq!(store.list().unwrap()[0].id, a.id);
    assert_eq!(store.meta(&b.id).unwrap().hackmd, Some(link("remote")));
    // 一時的なファイルは残らない
    let names: Vec<String> = fs::read_dir(dir.path().join("notes"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|n| !n.ends_with(".tmp")));
}

#[test]
fn test_find_and_set_link() {
    let dir = tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let a = store.create("a", None, 1).unwrap();
    assert_eq!(store.find_by_remote("remote").unwrap(), None);
    store.set_link(&a.id, Some(link("remote"))).unwrap();
    assert_eq!(store.find_by_remote("remote").unwrap().unwrap().id, a.id);
    let unlinked = store.set_link(&a.id, None).unwrap();
    assert_eq!(unlinked.hackmd, None);
}

#[test]
fn test_delete() {
    let dir = tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let a = store.create("a", None, 1).unwrap();
    store.delete(&a.id).unwrap();
    assert!(store.list().unwrap().is_empty());
    assert!(store.read(&a.id).is_err());
    // もうないノートを消しても, 成功
    store.delete(&a.id).unwrap();
}

#[test]
fn test_errors() {
    let dir = tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let missing = "0f8fad5b-d9cb-469f-a165-70867728950e";
    assert_eq!(
        store.meta(missing).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    assert_eq!(
        store.save(missing, "x", 1).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    assert_eq!(
        store.set_link(missing, None).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );
    for bad in ["../x", ""] {
        assert_eq!(
            store.read(bad).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert_eq!(
            store.save(bad, "x", 1).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert_eq!(
            store.delete(bad).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
    }
    // 壊れた一覧
    fs::write(dir.path().join("index.json"), "{").unwrap();
    assert!(store.list().is_err());
}
