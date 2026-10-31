// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 外の Markdown のファイルを読み書きする (ノートとして取り込むためと, 利用者がボタンを押したときに, 書き戻すため).
//!
//! 読み書きできるのは, 拡張子が `.md`, `.markdown`, `.txt` で, [`MAX_FILE_BYTES`] までの, UTF-8 のファイルだけ.
//! 読むときは, 先頭の BOM を除き, 改行を `\n` にそろえる (エディタは `\n` で書く). 書くときは,
//! 今のファイルの BOM と改行 (`\r\n`) に合わせる.

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

/// 取り込めるファイルの大きさの上限 (バイト).
pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// 取り込めるファイルの拡張子 (小文字).
pub const EXTENSIONS: [&str; 3] = ["md", "markdown", "txt"];

/// ファイルを取り込めなかった理由.
#[derive(Debug)]
pub enum FileError {
    /// 取り込めない拡張子.
    Unsupported,
    /// 大きすぎる ([`MAX_FILE_BYTES`] を超える).
    TooLarge,
    /// UTF-8 でない.
    NotText,
    /// 読めない.
    Io(io::Error),
}

impl fmt::Display for FileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "unsupported file type"),
            Self::TooLarge => write!(f, "file larger than {} bytes", MAX_FILE_BYTES),
            Self::NotText => write!(f, "file is not UTF-8 text"),
            Self::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<io::Error> for FileError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// 取り込めるファイルか (拡張子で決める. 大文字も可).
///
/// # Arguments
///
/// * `path` - ファイルのパス.
///
/// # Returns
///
/// 取り込める拡張子なら `true`.
pub fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// UTF-8 の BOM.
const BOM: char = '\u{feff}';

/// Markdown のファイルを, そのまま読む (拡張子と大きさを確かめる).
///
/// # Arguments
///
/// * `path` - ファイルのパス.
///
/// # Returns
///
/// 中身. 取り込めない拡張子, 大きすぎる, UTF-8 でない, 読めないときは [`FileError`].
fn read_raw(path: &Path) -> Result<String, FileError> {
    if !is_markdown_file(path) {
        return Err(FileError::Unsupported);
    }
    // 大きなファイルを読み込まないよう, 先に大きさを確かめる
    if fs::metadata(path)?.len() > MAX_FILE_BYTES {
        return Err(FileError::TooLarge);
    }
    String::from_utf8(fs::read(path)?).map_err(|_| FileError::NotText)
}

/// Markdown のファイルを読む. 先頭の BOM を除き, 改行を `\n` にそろえる.
///
/// # Arguments
///
/// * `path` - ファイルのパス.
///
/// # Returns
///
/// 本文. 取り込めない拡張子, 大きすぎる, UTF-8 でない, 読めないときは [`FileError`].
pub fn read_markdown(path: &Path) -> Result<String, FileError> {
    let text = read_raw(path)?;
    let text = text.strip_prefix(BOM).unwrap_or(&text);
    Ok(text.replace("\r\n", "\n"))
}

/// 本文を, 今の Markdown のファイルに書く. 今のファイルの BOM と改行 (`\r\n`) に合わせる.
///
/// 同じディレクトリの一時的なファイルに書いてから, 名前を変える (途中で落ちても, 前の内容が残る).
/// 権限は, 今のファイルのものを引き継ぐ. シンボリックリンクなら, 指す先のファイルに書く.
/// ファイルがなければ, 作らない ([`io::ErrorKind::NotFound`]).
///
/// # Arguments
///
/// * `path` - ファイルのパス.
/// * `content` - 本文 (改行は `\n`).
///
/// # Returns
///
/// 書けない拡張子, 大きすぎる, UTF-8 でない, ない, 書けないときは [`FileError`].
pub fn write_markdown(path: &Path, content: &str) -> Result<(), FileError> {
    let target = fs::canonicalize(path)?;
    let current = read_raw(&target)?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(FileError::TooLarge);
    }
    let mut text = if current.contains("\r\n") {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    };
    if current.starts_with(BOM) {
        text.insert(0, BOM);
    }
    let mut tmp = target.as_os_str().to_os_string();
    tmp.push(".rs-markdown.tmp");
    fs::write(&tmp, text.as_bytes())?;
    let renamed = fs::set_permissions(&tmp, fs::metadata(&target)?.permissions())
        .and_then(|()| fs::rename(&tmp, &target));
    remove_on_error(Path::new(&tmp), renamed).map_err(FileError::from)
}

/// 失敗していたら, 一時的なファイルを消す (残さない). 消せなくても, 元の失敗を返す.
///
/// # Arguments
///
/// * `tmp` - 一時的なファイル.
/// * `result` - 一時的なファイルを使った処理の結果.
///
/// # Returns
///
/// `result` のまま.
pub fn remove_on_error(tmp: &Path, result: io::Result<()>) -> io::Result<()> {
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
