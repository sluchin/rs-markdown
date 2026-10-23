// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ノートと, 取り込んだ元のファイルの同期 (HackMD の同期 ([`crate::sync`]) と同じ考え方).
//!
//! 元のファイルに書くのは, 利用者が「ファイルに保存」を押したときだけ ([`push`]). 自動の保存は, ノートだけに書く.
//! どちらが変わったかは, 最後にファイルと合わせたときの本文のハッシュ ([`FileLink::synced_hash`]) と,
//! 今の本文のハッシュを比べて決める. 両方が変わっていたら, 衝突として止める (ほかのエディタで変えた内容を, 消さないため).

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;

use crate::files::{self, FileError};
use crate::store::{FileLink, NoteMeta, Store, content_hash};
use crate::sync::{SyncState, state_of};

/// ファイルとの同期の失敗.
#[derive(Debug)]
pub enum FileSyncError {
    /// ノートの読み書きの失敗.
    Note(io::Error),
    /// 元のファイルの読み書きの失敗.
    File(FileError),
    /// 両方が変わっていて, 上書きを選んでいない.
    Conflict,
    /// ファイルとつないでいない.
    NotLinked,
}

impl fmt::Display for FileSyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Note(e) => write!(f, "could not access the local note: {}", e),
            Self::File(e) => write!(f, "could not access the file: {}", e),
            Self::Conflict => write!(f, "both the note and the file changed"),
            Self::NotLinked => write!(f, "the note is not linked to a file"),
        }
    }
}

impl From<io::Error> for FileSyncError {
    fn from(e: io::Error) -> Self {
        Self::Note(e)
    }
}

impl From<FileError> for FileSyncError {
    fn from(e: FileError) -> Self {
        Self::File(e)
    }
}

/// ファイルと合わせたあとの, つながりを作る.
///
/// # Arguments
///
/// * `path` - 元のファイルのパス.
/// * `content` - 合わせた本文.
///
/// # Returns
///
/// つながり.
fn link_of(path: &str, content: &str) -> FileLink {
    FileLink {
        path: path.to_string(),
        synced_hash: content_hash(content),
    }
}

/// ノートのつながりを返す (つないでいなければ, エラー).
fn link_or_err(meta: &NoteMeta) -> Result<&FileLink, FileSyncError> {
    meta.file.as_ref().ok_or(FileSyncError::NotLinked)
}

/// ノートとファイルの本文と, 状態を返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `id` - ノートの ID.
/// * `link` - ファイルとのつながり.
///
/// # Returns
///
/// (ノートの本文, ファイルの本文, 状態).
fn compare(
    store: &Store,
    id: &str,
    link: &FileLink,
) -> Result<(String, String, SyncState), FileSyncError> {
    let local = store.read(id)?;
    let file = files::read_markdown(Path::new(&link.path))?;
    let state = state_of(
        &link.synced_hash,
        &content_hash(&local),
        &content_hash(&file),
    );
    Ok((local, file, state))
}

/// 外の Markdown のファイルを, ファイルとつないだノートとして取り込む.
/// 同じファイルを, もう取り込んであれば, そのノートを返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `path` - ファイルのパス (シンボリックリンクは, 指す先にする).
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// ノートの項目. 読めなければ [`FileSyncError`].
pub fn import(store: &Store, path: &Path, now: u64) -> Result<NoteMeta, FileSyncError> {
    let content = files::read_markdown(path)?;
    let canonical = fs::canonicalize(path)
        .map_err(FileError::from)?
        .to_string_lossy()
        .into_owned();
    if let Some(existing) = store.find_by_file(&canonical)? {
        return Ok(existing);
    }
    let created = store.create(&content, None, now)?;
    Ok(store.set_file(&created.id, Some(link_of(&canonical, &content)))?)
}

/// ノートとファイルの同期の状態を返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 状態 (つないでいなければ [`SyncState::Unlinked`]). 読めなければ [`FileSyncError`].
pub fn status(store: &Store, id: &str) -> Result<SyncState, FileSyncError> {
    let meta = store.meta(id)?;
    let Some(link) = meta.file.as_ref() else {
        return Ok(SyncState::Unlinked);
    };
    Ok(compare(store, id, link)?.2)
}

/// ノートの本文を, 元のファイルに書く.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `id` - ノートの ID.
/// * `force` - ファイルの側も変わっていたら, 上書きするか.
///
/// # Returns
///
/// 書いたあとの項目. ファイルの側が変わっていて `force` でなければ [`FileSyncError::Conflict`].
pub fn push(store: &Store, id: &str, force: bool) -> Result<NoteMeta, FileSyncError> {
    let meta = store.meta(id)?;
    let link = link_or_err(&meta)?;
    let (local, _, state) = compare(store, id, link)?;
    if matches!(state, SyncState::RemoteChanged | SyncState::Conflict) && !force {
        return Err(FileSyncError::Conflict);
    }
    if state != SyncState::Synced {
        files::write_markdown(Path::new(&link.path), &local)?;
        log::info!("Wrote the note {} to its file", id);
    }
    Ok(store.set_file(id, Some(link_of(&link.path, &local)))?)
}

/// 元のファイルの本文を, ノートに取り込み直す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `id` - ノートの ID.
/// * `force` - ノートの側も変わっていたら, 上書きするか.
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// 取り込んだあとの項目. ノートの側が変わっていて `force` でなければ [`FileSyncError::Conflict`].
pub fn pull(store: &Store, id: &str, force: bool, now: u64) -> Result<NoteMeta, FileSyncError> {
    let meta = store.meta(id)?;
    let link = link_or_err(&meta)?;
    let (_, file, state) = compare(store, id, link)?;
    if matches!(state, SyncState::LocalChanged | SyncState::Conflict) && !force {
        return Err(FileSyncError::Conflict);
    }
    if state != SyncState::Synced {
        store.save(id, &file, now)?;
        log::info!("Read the note {} from its file", id);
    }
    Ok(store.set_file(id, Some(link_of(&link.path, &file)))?)
}

/// 衝突したときに, 両方を残す. ファイルの本文を, ファイルとつないだ新しいノートにして,
/// 今のノートのつながりを外す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `id` - ノートの ID.
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// 新しいノートの項目. 失敗したら [`FileSyncError`].
pub fn keep_both(store: &Store, id: &str, now: u64) -> Result<NoteMeta, FileSyncError> {
    let meta = store.meta(id)?;
    let link = link_or_err(&meta)?;
    let file = files::read_markdown(Path::new(&link.path))?;
    store.set_file(id, None)?;
    let created = store.create(&file, None, now)?;
    log::info!("Kept both {} and {} for the file", id, created.id);
    Ok(store.set_file(&created.id, Some(link_of(&link.path, &file)))?)
}
