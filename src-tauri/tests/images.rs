// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画像の保存 (`images`) のテスト.

use std::fs;
use std::path::Path;

use tempfile::tempdir;

use rs_markdown_lib::errors::{CommandError, ErrorKind};
use rs_markdown_lib::images::{
    ImageError, MAX_IMAGE_BYTES, detect_format, images_dir, import, is_valid_name, save,
};

/// PNG の始めのバイト.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";

#[test]
fn test_images_dir_is_under_the_data() {
    assert_eq!(images_dir(Path::new("/data")), Path::new("/data/images"));
}

#[test]
fn test_detect_format_by_the_bytes() {
    assert_eq!(detect_format(PNG), Some("png"));
    assert_eq!(detect_format(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
    assert_eq!(detect_format(b"GIF87a..."), Some("gif"));
    assert_eq!(detect_format(b"GIF89a..."), Some("gif"));
    assert_eq!(detect_format(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
    assert_eq!(detect_format(b"RIFF\0\0\0\0WAVE"), None);
    assert_eq!(detect_format(b"RIFF"), None);
    assert_eq!(detect_format(b"<svg></svg>"), None);
    assert_eq!(detect_format(b""), None);
}

#[test]
fn test_is_valid_name() {
    assert!(is_valid_name("0f8fad5b-d9cb-469f-a165-70867728950e.png"));
    assert!(is_valid_name("0f8fad5b-d9cb-469f-a165-70867728950e.webp"));
    assert!(!is_valid_name("0f8fad5b-d9cb-469f-a165-70867728950e.svg"));
    assert!(!is_valid_name("../x.png"));
    assert!(!is_valid_name("noextension"));
}

#[test]
fn test_save_writes_a_new_file_with_the_detected_format() {
    let dir = tempdir().unwrap();
    let images = dir.path().join("images");

    let name = save(&images, PNG).unwrap();

    assert!(is_valid_name(&name));
    assert!(name.ends_with(".png"));
    assert_eq!(fs::read(images.join(&name)).unwrap(), PNG);
    assert_ne!(save(&images, PNG).unwrap(), name);
}

#[test]
fn test_save_rejects_other_formats_and_large_images() {
    let dir = tempdir().unwrap();
    assert!(matches!(
        save(dir.path(), b"text"),
        Err(ImageError::Unsupported)
    ));
    let large = vec![0u8; usize::try_from(MAX_IMAGE_BYTES).unwrap() + 1];
    assert!(matches!(
        save(dir.path(), &large),
        Err(ImageError::TooLarge)
    ));
}

#[test]
fn test_save_fails_when_the_directory_cannot_be_made() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("file");
    fs::write(&file, "x").unwrap();
    assert!(matches!(
        save(&file.join("images"), PNG),
        Err(ImageError::Io(_))
    ));
}

#[test]
fn test_import_copies_the_file() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("a.png");
    fs::write(&source, PNG).unwrap();

    let name = import(&dir.path().join("images"), &source).unwrap();

    assert_eq!(fs::read(dir.path().join("images").join(name)).unwrap(), PNG);
}

#[test]
fn test_import_rejects_missing_and_large_files() {
    let dir = tempdir().unwrap();
    assert!(matches!(
        import(dir.path(), &dir.path().join("none.png")),
        Err(ImageError::Io(_))
    ));
    let large = dir.path().join("large.png");
    fs::File::create(&large)
        .unwrap()
        .set_len(MAX_IMAGE_BYTES + 1)
        .unwrap();
    assert!(matches!(
        import(dir.path(), &large),
        Err(ImageError::TooLarge)
    ));
}

#[test]
fn test_image_error_to_command_error() {
    assert_eq!(
        CommandError::from(ImageError::Unsupported).kind,
        ErrorKind::InvalidImage
    );
    let too_large = CommandError::from(ImageError::TooLarge);
    assert_eq!(too_large.kind, ErrorKind::InvalidImage);
    assert!(too_large.message.contains("larger than"));
    let io = CommandError::from(ImageError::Io(std::io::Error::other("boom")));
    assert_eq!((io.kind, io.message.as_str()), (ErrorKind::Io, "boom"));
}
