// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! 設定 (HackMD の API のトークン). アプリの設定のディレクトリの `settings.json` に置く.
//!
//! トークンは画面に返さない (あるかどうかだけを返す). ファイルは, 自分だけが読めるようにする (Unix).
//! 保存したトークンがなければ, 実行するときの環境変数 `HACKMD_APIKEY` を使う (PC で開発するとき.
//! ビルドには入れない).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// トークンを読む, 環境変数の名前.
pub const TOKEN_ENV: &str = "HACKMD_APIKEY";

/// 保存する設定.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// HackMD の API のトークン.
    #[serde(default)]
    pub token: Option<String>,
}

/// トークンをどこから取ったか.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TokenSource {
    /// ない.
    None,
    /// 設定の画面で入れた.
    Saved,
    /// 環境変数 [`TOKEN_ENV`].
    Env,
}

/// 設定のディレクトリから, 設定のファイルのパスを求める.
///
/// # Arguments
///
/// * `config_dir` - アプリの設定のディレクトリ.
///
/// # Returns
///
/// `<設定のディレクトリ>/settings.json`.
pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

/// 設定を読む. ファイルがないか, 読めない内容なら, 初期値.
///
/// # Arguments
///
/// * `path` - 設定のファイル.
///
/// # Returns
///
/// 設定.
pub fn load(path: &Path) -> Settings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// 設定を保存する. Unix では, 自分だけが読み書きできるようにする.
///
/// # Arguments
///
/// * `path` - 設定のファイル.
/// * `settings` - 設定.
///
/// # Returns
///
/// 書けなければ [`Err`].
pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    fs::write(path, json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// 空白を除いて, 空ならなしにする.
fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// 使うトークンを決める. 保存したトークンを先に, なければ環境変数を使う.
///
/// # Arguments
///
/// * `settings` - 設定.
/// * `env` - 環境変数 [`TOKEN_ENV`] の値.
///
/// # Returns
///
/// トークンと, その取り元. どちらもなければ `None` と [`TokenSource::None`].
pub fn effective_token(settings: &Settings, env: Option<&str>) -> (Option<String>, TokenSource) {
    if let Some(token) = non_empty(settings.token.as_deref()) {
        (Some(token), TokenSource::Saved)
    } else if let Some(token) = non_empty(env) {
        (Some(token), TokenSource::Env)
    } else {
        (None, TokenSource::None)
    }
}

/// 入れたトークンで, 設定を変える. 空なら, 保存したトークンを消す.
///
/// # Arguments
///
/// * `settings` - 設定.
/// * `token` - 入れたトークン.
///
/// # Returns
///
/// 変えたあとの設定.
pub fn with_token(settings: &Settings, token: Option<&str>) -> Settings {
    let mut changed = settings.clone();
    changed.token = non_empty(token);
    changed
}
