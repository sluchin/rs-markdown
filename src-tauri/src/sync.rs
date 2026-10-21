// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ローカルのノートと, HackMD のノートの同期.
//!
//! どちらが変わったかは, 最後に同期したときの本文のハッシュ ([`HackmdLink::synced_hash`]) と,
//! 今の本文のハッシュを比べて決める (日時は使わない. HackMD の更新は, 応答のあとに反映されることがあるため).
//! 両方が変わっていたら, 衝突として止める (利用者が, 上書きか, 両方を残すかを選ぶ).

use std::fmt;
use std::io;

use serde::Serialize;

use crate::hackmd::{ApiError, Client, RemoteNote};
use crate::store::{HackmdLink, NoteMeta, Store, content_hash};

/// ノートの同期の状態.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncState {
    /// HackMD のノートとつないでいない.
    Unlinked,
    /// 同じ.
    Synced,
    /// ローカルだけが変わった (送れる).
    LocalChanged,
    /// HackMD だけが変わった (取れる).
    RemoteChanged,
    /// 両方が変わった.
    Conflict,
}

/// ハッシュを比べて, 同期の状態を決める.
///
/// # Arguments
///
/// * `synced` - 最後に同期したときのハッシュ.
/// * `local` - ローカルの本文のハッシュ.
/// * `remote` - HackMD の本文のハッシュ.
///
/// # Returns
///
/// 状態. ローカルと HackMD が同じなら, 同期したときと違っても [`SyncState::Synced`].
pub fn state_of(synced: &str, local: &str, remote: &str) -> SyncState {
    match (local == synced, remote == synced) {
        _ if local == remote => SyncState::Synced,
        (false, true) => SyncState::LocalChanged,
        (true, false) => SyncState::RemoteChanged,
        _ => SyncState::Conflict,
    }
}

/// 同期の失敗.
#[derive(Debug)]
pub enum SyncError {
    /// HackMD の API の失敗.
    Api(ApiError),
    /// ローカルのノートの読み書きの失敗.
    Io(io::Error),
    /// 両方が変わっていて, 上書きを選んでいない.
    Conflict,
    /// HackMD のノートとつないでいない.
    NotLinked,
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::Api(e) => write!(f, "{}", e),
            SyncError::Io(e) => write!(f, "could not access the local note: {}", e),
            SyncError::Conflict => write!(f, "both the local note and the HackMD note changed"),
            SyncError::NotLinked => write!(f, "the note is not linked to HackMD"),
        }
    }
}

impl From<ApiError> for SyncError {
    fn from(e: ApiError) -> Self {
        SyncError::Api(e)
    }
}

impl From<io::Error> for SyncError {
    fn from(e: io::Error) -> Self {
        SyncError::Io(e)
    }
}

/// 同期したあとの, つながりを作る.
///
/// # Arguments
///
/// * `remote` - HackMD のノート.
/// * `content` - 同期した本文.
///
/// # Returns
///
/// つながり.
fn link_of(remote: &RemoteNote, content: &str) -> HackmdLink {
    HackmdLink {
        note_id: remote.id.clone(),
        synced_hash: content_hash(content),
        publish_link: remote.publish_link.clone(),
    }
}

/// ノートのつながりを返す (つないでいなければ, エラー).
fn link_or_err(meta: &NoteMeta) -> Result<&HackmdLink, SyncError> {
    meta.hackmd.as_ref().ok_or(SyncError::NotLinked)
}

/// HackMD のノートを取得する. 本文がなければ, 空とする.
async fn fetch(client: &Client, note_id: &str) -> Result<(RemoteNote, String), SyncError> {
    let remote = client.get(note_id).await?;
    let content = remote.content.clone().unwrap_or_default();
    Ok((remote, content))
}

/// ノートの同期の状態を, HackMD に問い合わせて返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 状態. 失敗したら [`SyncError`].
pub async fn status(store: &Store, client: &Client, id: &str) -> Result<SyncState, SyncError> {
    let meta = store.meta(id)?;
    let Some(link) = meta.hackmd.as_ref() else {
        return Ok(SyncState::Unlinked);
    };
    let local = store.read(id)?;
    let (_, remote) = fetch(client, &link.note_id).await?;
    Ok(state_of(
        &link.synced_hash,
        &content_hash(&local),
        &content_hash(&remote),
    ))
}

/// ノートを HackMD に送る. つないでいなければ, HackMD にノートを作って, つなぐ.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
/// * `id` - ノートの ID.
/// * `force` - HackMD の側も変わっていたら, 上書きするか.
///
/// # Returns
///
/// 送ったあとの項目. HackMD の側が変わっていて `force` でなければ [`SyncError::Conflict`].
pub async fn push(
    store: &Store,
    client: &Client,
    id: &str,
    force: bool,
) -> Result<NoteMeta, SyncError> {
    let meta = store.meta(id)?;
    let local = store.read(id)?;
    let Some(link) = meta.hackmd.as_ref() else {
        let created = client.create(&local).await?;
        log::info!("Created the HackMD note for {}", id);
        return Ok(store.set_link(id, Some(link_of(&created, &local)))?);
    };
    let (remote, remote_content) = fetch(client, &link.note_id).await?;
    let state = state_of(
        &link.synced_hash,
        &content_hash(&local),
        &content_hash(&remote_content),
    );
    if matches!(state, SyncState::RemoteChanged | SyncState::Conflict) && !force {
        return Err(SyncError::Conflict);
    }
    if state != SyncState::Synced {
        client.update(&remote.id, &local).await?;
        log::info!("Pushed {} to HackMD", id);
    }
    Ok(store.set_link(id, Some(link_of(&remote, &local)))?)
}

/// HackMD のノートの本文を, ローカルのノートに取り込む.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
/// * `id` - ノートの ID.
/// * `force` - ローカルの側も変わっていたら, 上書きするか.
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// 取り込んだあとの項目. ローカルの側が変わっていて `force` でなければ [`SyncError::Conflict`].
pub async fn pull(
    store: &Store,
    client: &Client,
    id: &str,
    force: bool,
    now: u64,
) -> Result<NoteMeta, SyncError> {
    let meta = store.meta(id)?;
    let link = link_or_err(&meta)?;
    let local = store.read(id)?;
    let (remote, remote_content) = fetch(client, &link.note_id).await?;
    let state = state_of(
        &link.synced_hash,
        &content_hash(&local),
        &content_hash(&remote_content),
    );
    if matches!(state, SyncState::LocalChanged | SyncState::Conflict) && !force {
        return Err(SyncError::Conflict);
    }
    if state != SyncState::Synced {
        store.save(id, &remote_content, now)?;
        log::info!("Pulled {} from HackMD", id);
    }
    Ok(store.set_link(id, Some(link_of(&remote, &remote_content)))?)
}

/// 衝突したときに, 両方を残す. HackMD の本文を, つないだ新しいノートにして, 今のノートのつながりを外す.
///
/// 今のノートは, あとで送ると, HackMD に別のノートとして作られる.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
/// * `id` - ノートの ID.
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// 新しいノートの項目. 失敗したら [`SyncError`].
pub async fn keep_both(
    store: &Store,
    client: &Client,
    id: &str,
    now: u64,
) -> Result<NoteMeta, SyncError> {
    let meta = store.meta(id)?;
    let link = link_or_err(&meta)?;
    let (remote, content) = fetch(client, &link.note_id).await?;
    store.set_link(id, None)?;
    let created = store.create(&content, Some(link_of(&remote, &content)), now)?;
    log::info!("Kept both {} and {}", id, created.id);
    Ok(created)
}

/// HackMD のノートを, ローカルに取り込む. もう取り込んであれば, そのノートを返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
/// * `note_id` - HackMD のノートの ID.
/// * `now` - 今の日時 (UNIX 時間のミリ秒).
///
/// # Returns
///
/// ローカルのノートの項目. 失敗したら [`SyncError`].
pub async fn import(
    store: &Store,
    client: &Client,
    note_id: &str,
    now: u64,
) -> Result<NoteMeta, SyncError> {
    if let Some(existing) = store.find_by_remote(note_id)? {
        return Ok(existing);
    }
    let (remote, content) = fetch(client, note_id).await?;
    let created = store.create(&content, Some(link_of(&remote, &content)), now)?;
    log::info!("Imported a HackMD note as {}", created.id);
    Ok(created)
}

/// HackMD のノートの一覧の項目 (取り込んだローカルのノートの ID を添える).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    /// HackMD のノートの ID.
    pub id: String,
    /// 題名.
    pub title: String,
    /// 最後に変えた日時 (UNIX 時間のミリ秒).
    pub last_changed_at: Option<u64>,
    /// 取り込んだローカルのノートの ID (取り込んでいなければ `None`).
    pub local_id: Option<String>,
}

/// HackMD のノートの一覧を, 新しく変えた順に返す.
///
/// # Arguments
///
/// * `store` - ノートの保存先.
/// * `client` - HackMD の API.
///
/// # Returns
///
/// 一覧. 失敗したら [`SyncError`].
pub async fn remote_list(store: &Store, client: &Client) -> Result<Vec<RemoteEntry>, SyncError> {
    let locals = store.list()?;
    let mut entries: Vec<RemoteEntry> = client
        .list()
        .await?
        .into_iter()
        .map(|note| RemoteEntry {
            local_id: locals
                .iter()
                .find(|l| l.hackmd.as_ref().is_some_and(|h| h.note_id == note.id))
                .map(|l| l.id.clone()),
            id: note.id,
            title: note.title,
            last_changed_at: note.last_changed_at,
        })
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.last_changed_at));
    Ok(entries)
}
