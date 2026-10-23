// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 外の Markdown のファイルを読む (`files`) のテスト.

use std::fs;
use std::path::Path;

use tempfile::tempdir;

use rs_mdnote_lib::errors::{CommandError, ErrorKind};
use rs_mdnote_lib::files::{
    FileError, MAX_FILE_BYTES, is_markdown_file, read_markdown, remove_on_error, write_markdown,
};

#[test]
fn test_is_markdown_file_by_the_extension() {
    assert!(is_markdown_file(Path::new("/a/b.md")));
    assert!(is_markdown_file(Path::new("/a/b.MarkDown")));
    assert!(is_markdown_file(Path::new("b.txt")));
    assert!(!is_markdown_file(Path::new("b.png")));
    assert!(!is_markdown_file(Path::new("README")));
}

#[test]
fn test_read_markdown_returns_the_text_without_the_bom() {
    let dir = tempdir().unwrap();
    let plain = dir.path().join("a.md");
    fs::write(&plain, "# 見出し\n本文").unwrap();
    assert_eq!(read_markdown(&plain).unwrap(), "# 見出し\n本文");

    let bom = dir.path().join("b.md");
    fs::write(&bom, "\u{feff}# t").unwrap();
    assert_eq!(read_markdown(&bom).unwrap(), "# t");
}

#[test]
fn test_read_markdown_rejects_other_types_large_files_and_non_utf8() {
    let dir = tempdir().unwrap();
    let image = dir.path().join("a.png");
    fs::write(&image, "x").unwrap();
    assert!(matches!(read_markdown(&image), Err(FileError::Unsupported)));

    let large = dir.path().join("large.md");
    fs::File::create(&large)
        .unwrap()
        .set_len(MAX_FILE_BYTES + 1)
        .unwrap();
    assert!(matches!(read_markdown(&large), Err(FileError::TooLarge)));

    let binary = dir.path().join("bin.txt");
    fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
    assert!(matches!(read_markdown(&binary), Err(FileError::NotText)));

    assert!(matches!(
        read_markdown(&dir.path().join("none.md")),
        Err(FileError::Io(_))
    ));
}

#[test]
fn test_file_error_to_command_error() {
    for (error, text) in [
        (FileError::Unsupported, "unsupported"),
        (FileError::TooLarge, "larger than"),
        (FileError::NotText, "UTF-8"),
    ] {
        let e = CommandError::from(error);
        assert_eq!(e.kind, ErrorKind::InvalidFile);
        assert!(e.message.contains(text));
    }
    let missing = CommandError::from(FileError::Io(std::io::Error::from(
        std::io::ErrorKind::NotFound,
    )));
    assert_eq!(missing.kind, ErrorKind::NotFound);
}

#[test]
fn test_read_markdown_normalizes_crlf() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("a.md");
    fs::write(&path, "\u{feff}a\r\nb\r\n").unwrap();
    assert_eq!(read_markdown(&path).unwrap(), "a\nb\n");
}

#[test]
fn test_write_markdown_keeps_the_bom_and_the_line_endings() {
    let dir = tempdir().unwrap();
    let lf = dir.path().join("lf.md");
    fs::write(&lf, "old\n").unwrap();
    write_markdown(&lf, "new\nline\n").unwrap();
    assert_eq!(fs::read_to_string(&lf).unwrap(), "new\nline\n");

    let crlf = dir.path().join("crlf.md");
    fs::write(&crlf, "\u{feff}old\r\n").unwrap();
    write_markdown(&crlf, "new\nline\n").unwrap();
    assert_eq!(
        fs::read_to_string(&crlf).unwrap(),
        "\u{feff}new\r\nline\r\n"
    );
    // 一時的なファイルは残らない
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[cfg(unix)]
#[test]
fn test_write_markdown_follows_symlinks_and_keeps_the_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let real = dir.path().join("real.md");
    fs::write(&real, "old").unwrap();
    fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
    let link = dir.path().join("link.md");
    std::os::unix::fs::symlink(&real, &link).unwrap();

    write_markdown(&link, "new").unwrap();
    assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(
        fs::metadata(&real).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn test_write_markdown_does_not_create_or_write_other_files() {
    let dir = tempdir().unwrap();
    assert!(matches!(
        write_markdown(&dir.path().join("none.md"), "x"),
        Err(FileError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound
    ));
    assert!(!dir.path().join("none.md").exists());

    let image = dir.path().join("a.png");
    fs::write(&image, "x").unwrap();
    assert!(matches!(
        write_markdown(&image, "y"),
        Err(FileError::Unsupported)
    ));
    assert_eq!(fs::read_to_string(&image).unwrap(), "x");

    let md = dir.path().join("a.md");
    fs::write(&md, "x").unwrap();
    let huge = "a".repeat(usize::try_from(MAX_FILE_BYTES).unwrap() + 1);
    assert!(matches!(
        write_markdown(&md, &huge),
        Err(FileError::TooLarge)
    ));
    assert_eq!(fs::read_to_string(&md).unwrap(), "x");
}

#[test]
fn test_remove_on_error_removes_the_temporary_file_only_on_failure() {
    let dir = tempdir().unwrap();
    let tmp = dir.path().join("a.md.tmp");
    fs::write(&tmp, "x").unwrap();
    assert!(remove_on_error(&tmp, Ok(())).is_ok());
    assert!(tmp.exists());
    let e = remove_on_error(&tmp, Err(std::io::Error::other("rename"))).unwrap_err();
    assert_eq!(e.to_string(), "rename");
    assert!(!tmp.exists());
    // 消せなくても (もうない), 元の失敗を返す
    assert!(remove_on_error(&tmp, Err(std::io::Error::other("rename"))).is_err());
}
