// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画像の保存 (アプリのデータの `images/`). ノートに貼り付けた画像と, 落とした画像のファイルを置く.
//!
//! 形式は, 名前ではなく中身 (始めのバイト) で決める. 置けるのは PNG, JPEG, GIF, WebP だけ.
//! 名前は `<UUID>.<拡張子>` にする (ノートには `images/<名前>` と書く).

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// 画像の大きさの上限 (バイト).
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// 画像を置くディレクトリの名前 (アプリのデータの中).
pub const IMAGES_DIR: &str = "images";

/// 置ける画像の, 拡張子.
pub const EXTENSIONS: [&str; 4] = ["png", "jpg", "gif", "webp"];

/// 画像を置けなかった理由.
#[derive(Debug)]
pub enum ImageError {
    /// 置けない形式 (PNG, JPEG, GIF, WebP でない).
    Unsupported,
    /// 大きすぎる ([`MAX_IMAGE_BYTES`] を超える).
    TooLarge,
    /// 読み書きの失敗.
    Io(io::Error),
}

impl fmt::Display for ImageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "unsupported image format"),
            Self::TooLarge => write!(f, "image larger than {} bytes", MAX_IMAGE_BYTES),
            Self::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<io::Error> for ImageError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// 画像を置くディレクトリを返す.
///
/// # Arguments
///
/// * `data_dir` - アプリのデータのディレクトリ.
///
/// # Returns
///
/// `<データ>/images`.
pub fn images_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(IMAGES_DIR)
}

/// 中身の始めのバイトから, 画像の形式 (拡張子) を決める.
///
/// # Arguments
///
/// * `bytes` - 中身.
///
/// # Returns
///
/// 拡張子 (`png`, `jpg`, `gif`, `webp`). 置けない形式なら `None`.
pub fn detect_format(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// 画像のファイルの名前 (`<UUID>.<拡張子>`) として, 正しいか.
///
/// # Arguments
///
/// * `name` - 名前.
///
/// # Returns
///
/// 正しければ `true`.
pub fn is_valid_name(name: &str) -> bool {
    name.split_once('.').is_some_and(|(id, extension)| {
        crate::store::is_valid_id(id) && EXTENSIONS.contains(&extension)
    })
}

/// 画像を置く.
///
/// # Arguments
///
/// * `dir` - 置くディレクトリ (なければ作る).
/// * `bytes` - 中身.
///
/// # Returns
///
/// 置いたファイルの名前. 置けない形式, 大きすぎる, 書けないときは [`ImageError`].
pub fn save(dir: &Path, bytes: &[u8]) -> Result<String, ImageError> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(ImageError::TooLarge);
    }
    let extension = detect_format(bytes).ok_or(ImageError::Unsupported)?;
    fs::create_dir_all(dir)?;
    let name = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    fs::write(dir.join(&name), bytes)?;
    Ok(name)
}

/// 画像のファイルを, 写して置く (落としたファイル).
///
/// # Arguments
///
/// * `dir` - 置くディレクトリ (なければ作る).
/// * `source` - 写すファイル.
///
/// # Returns
///
/// 置いたファイルの名前. 読めない, 置けない形式, 大きすぎるときは [`ImageError`].
pub fn import(dir: &Path, source: &Path) -> Result<String, ImageError> {
    // 大きなファイルを読み込まないよう, 先に大きさを確かめる
    if fs::metadata(source)?.len() > MAX_IMAGE_BYTES {
        return Err(ImageError::TooLarge);
    }
    save(dir, &fs::read(source)?)
}
