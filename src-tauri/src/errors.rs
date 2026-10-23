// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 画面に返すエラー. 画面は `kind` で, 出す文 (日本語) を選ぶ. `message` は英語で, ログ用.

use std::io;

use serde::Serialize;

use crate::files::FileError;
use crate::filesync::FileSyncError;
use crate::hackmd::ApiError;
use crate::images::ImageError;
use crate::sync::SyncError;

/// エラーの種類.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    /// HackMD の API のトークンがない.
    NoToken,
    /// トークンが正しくない.
    Unauthorized,
    /// HackMD のノートがない.
    NotFound,
    /// HackMD の API の呼び出しの回数の上限.
    RateLimited,
    /// 通信の失敗.
    Network,
    /// ローカルと HackMD の両方が変わった.
    Conflict,
    /// HackMD のノートとつないでいない.
    NotLinked,
    /// ローカルのノートの読み書きの失敗.
    Io,
    /// 置けない画像 (形式か大きさ).
    InvalidImage,
    /// 取り込めないファイル (拡張子, 大きさ, 文字コード).
    InvalidFile,
    /// ノートと, 元のファイルの両方が変わった.
    FileConflict,
    /// 元のファイルとつないでいない.
    FileNotLinked,
    /// 元のファイルがない.
    FileNotFound,
    /// 元のファイルの読み書きの失敗.
    FileIo,
    /// そのほか.
    Other,
}

/// 画面に返すエラー.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// 種類.
    pub kind: ErrorKind,
    /// 内容 (英語).
    pub message: String,
}

impl CommandError {
    /// エラーを作る.
    ///
    /// # Arguments
    ///
    /// * `kind` - 種類.
    /// * `message` - 内容.
    ///
    /// # Returns
    ///
    /// エラー.
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// トークンがないエラー.
    ///
    /// # Returns
    ///
    /// エラー.
    pub fn no_token() -> Self {
        Self::new(ErrorKind::NoToken, "no HackMD API token")
    }
}

impl From<ApiError> for CommandError {
    fn from(e: ApiError) -> Self {
        let kind = match e {
            ApiError::Unauthorized => ErrorKind::Unauthorized,
            ApiError::NotFound => ErrorKind::NotFound,
            ApiError::RateLimited => ErrorKind::RateLimited,
            ApiError::Network(_) => ErrorKind::Network,
            ApiError::Status(_) | ApiError::Decode(_) | ApiError::InvalidId => ErrorKind::Other,
        };
        Self::new(kind, e.to_string())
    }
}

impl From<io::Error> for CommandError {
    fn from(e: io::Error) -> Self {
        let kind = if e.kind() == io::ErrorKind::NotFound {
            ErrorKind::NotFound
        } else {
            ErrorKind::Io
        };
        Self::new(kind, e.to_string())
    }
}

impl From<SyncError> for CommandError {
    fn from(e: SyncError) -> Self {
        match e {
            SyncError::Api(api) => api.into(),
            SyncError::Io(io) => io.into(),
            SyncError::Conflict => Self::new(ErrorKind::Conflict, e.to_string()),
            SyncError::NotLinked => Self::new(ErrorKind::NotLinked, e.to_string()),
        }
    }
}

impl From<ImageError> for CommandError {
    fn from(e: ImageError) -> Self {
        match e {
            ImageError::Io(io) => io.into(),
            ImageError::Unsupported | ImageError::TooLarge => {
                Self::new(ErrorKind::InvalidImage, e.to_string())
            }
        }
    }
}

impl From<FileError> for CommandError {
    fn from(e: FileError) -> Self {
        match e {
            FileError::Io(io) => io.into(),
            FileError::Unsupported | FileError::TooLarge | FileError::NotText => {
                Self::new(ErrorKind::InvalidFile, e.to_string())
            }
        }
    }
}

impl From<FileSyncError> for CommandError {
    fn from(e: FileSyncError) -> Self {
        let message = e.to_string();
        match e {
            FileSyncError::Note(io) => io.into(),
            FileSyncError::File(FileError::Io(io)) if io.kind() == io::ErrorKind::NotFound => {
                Self::new(ErrorKind::FileNotFound, message)
            }
            FileSyncError::File(FileError::Io(_)) => Self::new(ErrorKind::FileIo, message),
            FileSyncError::File(file) => file.into(),
            FileSyncError::Conflict => Self::new(ErrorKind::FileConflict, message),
            FileSyncError::NotLinked => Self::new(ErrorKind::FileNotLinked, message),
        }
    }
}
