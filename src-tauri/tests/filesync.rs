// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 取り込んだファイルとの同期 (`filesync`) のテスト.

use std::fs;
use std::path::PathBuf;

use tempfile::{TempDir, tempdir};

use rs_mdnote_lib::filesync::{self, FileSyncError, keep_both, pull, push, status};
use rs_mdnote_lib::store::{Store, content_hash};
use rs_mdnote_lib::sync::SyncState;

/// テストの準備: ノートの保存先と, 取り込むファイル (`a.md`).
fn setup(content: &str) -> (TempDir, Store, PathBuf) {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("notes")).unwrap();
    let path = dir.path().join("a.md");
    fs::write(&path, content).unwrap();
    (dir, store, path)
}

#[test]
fn test_import_links_the_note_to_the_file_once() {
    let (_dir, store, path) = setup("# t\r\nbody\r\n");
    let meta = filesync::import(&store, &path, 1).unwrap();
    let link = meta.file.clone().unwrap();
    assert_eq!(PathBuf::from(&link.path), fs::canonicalize(&path).unwrap());
    assert_eq!(link.synced_hash, content_hash("# t\nbody\n"));
    assert_eq!(store.read(&meta.id).unwrap(), "# t\nbody\n");
    assert_eq!(status(&store, &meta.id).unwrap(), SyncState::Synced);

    // 同じファイルは, 同じノートを返す
    assert_eq!(filesync::import(&store, &path, 2).unwrap(), meta);
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn test_import_rejects_unreadable_files() {
    let (dir, store, _) = setup("x");
    let missing = filesync::import(&store, &dir.path().join("none.md"), 1);
    assert!(matches!(missing, Err(FileSyncError::File(_))));
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn test_status_of_unlinked_and_changed_notes() {
    let (_dir, store, path) = setup("a");
    let plain = store.create("x", None, 1).unwrap();
    assert_eq!(status(&store, &plain.id).unwrap(), SyncState::Unlinked);

    let meta = filesync::import(&store, &path, 1).unwrap();
    store.save(&meta.id, "b", 2).unwrap();
    assert_eq!(status(&store, &meta.id).unwrap(), SyncState::LocalChanged);
    fs::write(&path, "c").unwrap();
    assert_eq!(status(&store, &meta.id).unwrap(), SyncState::Conflict);
    store.save(&meta.id, "a", 3).unwrap();
    assert_eq!(status(&store, &meta.id).unwrap(), SyncState::RemoteChanged);
}

#[test]
fn test_push_writes_the_note_only_when_asked() {
    let (_dir, store, path) = setup("a\n");
    let meta = filesync::import(&store, &path, 1).unwrap();
    store.save(&meta.id, "b\n", 2).unwrap();
    // 保存しただけでは, ファイルは変わらない
    assert_eq!(fs::read_to_string(&path).unwrap(), "a\n");

    let pushed = push(&store, &meta.id, false).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "b\n");
    assert_eq!(pushed.file.unwrap().synced_hash, content_hash("b\n"));
    assert_eq!(status(&store, &meta.id).unwrap(), SyncState::Synced);

    // 同じなら, 書かない (ファイルの変更の日時も変えない)
    let before = fs::metadata(&path).unwrap().modified().unwrap();
    push(&store, &meta.id, false).unwrap();
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
}

#[test]
fn test_push_stops_when_the_file_changed_unless_forced() {
    let (_dir, store, path) = setup("a");
    let meta = filesync::import(&store, &path, 1).unwrap();
    store.save(&meta.id, "b", 2).unwrap();
    fs::write(&path, "c").unwrap();
    assert!(matches!(
        push(&store, &meta.id, false),
        Err(FileSyncError::Conflict)
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "c");

    push(&store, &meta.id, true).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "b");
}

#[test]
fn test_pull_reads_the_file_and_stops_on_local_changes() {
    let (_dir, store, path) = setup("a");
    let meta = filesync::import(&store, &path, 1).unwrap();
    fs::write(&path, "c").unwrap();
    let pulled = pull(&store, &meta.id, false, 5).unwrap();
    assert_eq!(store.read(&meta.id).unwrap(), "c");
    assert_eq!(pulled.updated_at, 5);

    // 同じなら, 保存しない
    assert_eq!(pull(&store, &meta.id, false, 9).unwrap().updated_at, 5);

    store.save(&meta.id, "b", 6).unwrap();
    assert!(matches!(
        pull(&store, &meta.id, false, 7),
        Err(FileSyncError::Conflict)
    ));
    pull(&store, &meta.id, true, 8).unwrap();
    assert_eq!(store.read(&meta.id).unwrap(), "c");
}

#[test]
fn test_keep_both_moves_the_link_to_a_new_note() {
    let (_dir, store, path) = setup("a");
    let meta = filesync::import(&store, &path, 1).unwrap();
    store.save(&meta.id, "b", 2).unwrap();
    fs::write(&path, "c").unwrap();

    let created = keep_both(&store, &meta.id, 3).unwrap();
    assert_eq!(store.read(&created.id).unwrap(), "c");
    assert_eq!(created.file.unwrap().synced_hash, content_hash("c"));
    assert!(store.meta(&meta.id).unwrap().file.is_none());
    assert_eq!(store.read(&meta.id).unwrap(), "b");
}

#[test]
fn test_actions_need_a_link_and_the_file() {
    let (_dir, store, path) = setup("a");
    let plain = store.create("x", None, 1).unwrap();
    assert!(matches!(
        push(&store, &plain.id, false),
        Err(FileSyncError::NotLinked)
    ));
    assert!(matches!(
        pull(&store, &plain.id, false, 1),
        Err(FileSyncError::NotLinked)
    ));
    assert!(matches!(
        keep_both(&store, &plain.id, 1),
        Err(FileSyncError::NotLinked)
    ));

    let meta = filesync::import(&store, &path, 1).unwrap();
    fs::remove_file(&path).unwrap();
    assert!(matches!(
        push(&store, &meta.id, false),
        Err(FileSyncError::File(_))
    ));
    assert!(!path.exists());
    assert!(status(&store, &meta.id).is_err());
}

#[test]
fn test_old_index_without_the_file_field() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("index.json"),
        r#"[{"id":"00000000-0000-0000-0000-000000000001","title":"t","updatedAt":1,"hackmd":null}]"#,
    )
    .unwrap();
    let store = Store::open(dir.path()).unwrap();
    assert!(store.list().unwrap()[0].file.is_none());
}
