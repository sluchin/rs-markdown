// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! ノートの保存 (アプリのデータの `notes/`).
//!
//! 本文は `<ID>.md`, 一覧 (題名, 更新した日時, HackMD とのつながり) は `index.json` に置く.
//! 書き込みは, 一時的なファイルに書いてから名前を変える (途中で落ちても, 前の内容が残る).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 題名の最大の文字数. 長い行は, ここで切る.
pub const MAX_TITLE_CHARS: usize = 80;

/// ノートと, HackMD のノートとのつながり.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HackmdLink {
    /// HackMD のノートの ID.
    pub note_id: String,
    /// 最後に同期したときの, 本文のハッシュ ([`content_hash`]). ローカルと HackMD の, どちらが変わったかを調べるのに使う.
    pub synced_hash: String,
    /// HackMD の, ノートを開く URL (分かれば).
    pub publish_link: Option<String>,
}

/// ノートの一覧の, 1 つの項目.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    /// ノートの ID (UUID).
    pub id: String,
    /// 題名 (本文から作る. [`title_of`]).
    pub title: String,
    /// 最後に変えた日時 (UNIX 時間のミリ秒).
    pub updated_at: u64,
    /// HackMD のノートとのつながり (つないでいなければ `None`).
    pub hackmd: Option<HackmdLink>,
}

/// 本文のハッシュ (SHA-256 の 16 進数) を返す.
///
/// # Arguments
///
/// * `content` - 本文.
///
/// # Returns
///
/// ハッシュの文字列.
pub fn content_hash(content: &str) -> String {
    Sha256::digest(content.as_bytes())
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 本文から題名を作る. HackMD と同じく, 先頭の YAML (`---` で囲む) の `title:` があればそれを,
/// なければ最初の見出し (`# `) を, なければ最初の空でない行を使う.
///
/// # Arguments
///
/// * `content` - 本文.
///
/// # Returns
///
/// 題名 ([`MAX_TITLE_CHARS`] 文字まで). 本文が空なら, 空の文字列.
pub fn title_of(content: &str) -> String {
    let mut lines = content.lines().peekable();
    let mut front_title = None;
    if lines.peek().map(|l| l.trim_end()) == Some("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim_end() == "---" {
                break;
            }
            if let Some(value) = line.strip_prefix("title:") {
                front_title = Some(value.trim().trim_matches(['"', '\'']).to_string());
            }
        }
    }
    let rest: Vec<&str> = lines.collect();
    let heading = rest
        .iter()
        .find_map(|l| l.trim_start().strip_prefix("# ").map(str::trim));
    let first = rest.iter().map(|l| l.trim()).find(|l| !l.is_empty());
    let title = front_title
        .filter(|t| !t.is_empty())
        .or(heading.map(str::to_string))
        .or(first.map(str::to_string))
        .unwrap_or_default();
    title.chars().take(MAX_TITLE_CHARS).collect()
}

/// ノートの ID として正しいか (UUID の形. ファイルの名前に使うので, ほかの文字を通さない).
///
/// # Arguments
///
/// * `id` - ID.
///
/// # Returns
///
/// 正しければ `true`.
pub fn is_valid_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// ファイルに, 一時的なファイルを経由して書く.
///
/// # Arguments
///
/// * `path` - 書くファイル.
/// * `bytes` - 内容.
///
/// # Returns
///
/// 失敗したら [`Err`].
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// ID が正しくなければ, エラーにする.
///
/// # Arguments
///
/// * `id` - ノートの ID.
///
/// # Returns
///
/// 正しくなければ [`io::ErrorKind::InvalidInput`] の [`Err`].
fn check_id(id: &str) -> io::Result<()> {
    if is_valid_id(id) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid note id: {}", id),
        ))
    }
}

/// ノートが見つからないエラーを作る.
///
/// # Arguments
///
/// * `id` - ノートの ID.
///
/// # Returns
///
/// [`io::ErrorKind::NotFound`] のエラー.
fn not_found(id: &str) -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, format!("note not found: {}", id))
}

/// ノートの保存先.
pub struct Store {
    /// ノートのディレクトリ.
    dir: PathBuf,
}

impl Store {
    /// ノートのディレクトリを開く (なければ作る).
    ///
    /// # Arguments
    ///
    /// * `dir` - ノートのディレクトリ.
    ///
    /// # Returns
    ///
    /// 作れなければ [`Err`].
    pub fn open(dir: &Path) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        Ok(Self {
            dir: dir.to_path_buf(),
        })
    }

    /// 一覧のファイルのパス.
    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    /// 本文のファイルのパス.
    fn note_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.md", id))
    }

    /// 一覧を, 保存した順のまま読む. ファイルがなければ空.
    fn load_index(&self) -> io::Result<Vec<NoteMeta>> {
        match fs::read(self.index_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    /// 一覧を保存する.
    fn save_index(&self, notes: &[NoteMeta]) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(notes).map_err(io::Error::other)?;
        write_atomic(&self.index_path(), &json)
    }

    /// 一覧の 1 つの項目を変えて, 保存する.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    /// * `change` - 項目を変える処理.
    ///
    /// # Returns
    ///
    /// 変えたあとの項目. ノートがなければ [`io::ErrorKind::NotFound`].
    fn update_meta(&self, id: &str, change: impl FnOnce(&mut NoteMeta)) -> io::Result<NoteMeta> {
        let mut notes = self.load_index()?;
        let meta = notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| not_found(id))?;
        change(meta);
        let changed = meta.clone();
        self.save_index(&notes)?;
        Ok(changed)
    }

    /// ノートの一覧を, 新しく変えた順に返す.
    ///
    /// # Returns
    ///
    /// 一覧. 読めなければ [`Err`].
    pub fn list(&self) -> io::Result<Vec<NoteMeta>> {
        let mut notes = self.load_index()?;
        notes.sort_by_key(|n| std::cmp::Reverse(n.updated_at));
        Ok(notes)
    }

    /// ノートの一覧の項目を返す.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    ///
    /// # Returns
    ///
    /// 項目. なければ [`io::ErrorKind::NotFound`].
    pub fn meta(&self, id: &str) -> io::Result<NoteMeta> {
        self.load_index()?
            .into_iter()
            .find(|n| n.id == id)
            .ok_or_else(|| not_found(id))
    }

    /// HackMD のノートにつないだ, ローカルのノートを探す.
    ///
    /// # Arguments
    ///
    /// * `note_id` - HackMD のノートの ID.
    ///
    /// # Returns
    ///
    /// 見つかれば, その項目.
    pub fn find_by_remote(&self, note_id: &str) -> io::Result<Option<NoteMeta>> {
        Ok(self.load_index()?.into_iter().find(|n| {
            n.hackmd
                .as_ref()
                .is_some_and(|link| link.note_id == note_id)
        }))
    }

    /// ノートの本文を読む.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    ///
    /// # Returns
    ///
    /// 本文. ID が正しくないか, 読めなければ [`Err`].
    pub fn read(&self, id: &str) -> io::Result<String> {
        check_id(id)?;
        fs::read_to_string(self.note_path(id))
    }

    /// ノートを作る.
    ///
    /// # Arguments
    ///
    /// * `content` - 本文.
    /// * `hackmd` - HackMD のノートとのつながり (HackMD から取り込むとき).
    /// * `now` - 今の日時 (UNIX 時間のミリ秒).
    ///
    /// # Returns
    ///
    /// 作ったノートの項目. 書けなければ [`Err`].
    pub fn create(
        &self,
        content: &str,
        hackmd: Option<HackmdLink>,
        now: u64,
    ) -> io::Result<NoteMeta> {
        let meta = NoteMeta {
            id: uuid::Uuid::new_v4().to_string(),
            title: title_of(content),
            updated_at: now,
            hackmd,
        };
        write_atomic(&self.note_path(&meta.id), content.as_bytes())?;
        let mut notes = self.load_index()?;
        notes.push(meta.clone());
        self.save_index(&notes)?;
        Ok(meta)
    }

    /// ノートの本文を保存する. 題名と, 変えた日時も更新する.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    /// * `content` - 本文.
    /// * `now` - 今の日時 (UNIX 時間のミリ秒).
    ///
    /// # Returns
    ///
    /// 変えたあとの項目. ノートがないか, 書けなければ [`Err`].
    pub fn save(&self, id: &str, content: &str, now: u64) -> io::Result<NoteMeta> {
        check_id(id)?;
        self.meta(id)?;
        write_atomic(&self.note_path(id), content.as_bytes())?;
        self.update_meta(id, |meta| {
            meta.title = title_of(content);
            meta.updated_at = now;
        })
    }

    /// HackMD のノートとのつながりを変える.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    /// * `hackmd` - 新しいつながり (`None` は, つながりを外す).
    ///
    /// # Returns
    ///
    /// 変えたあとの項目. ノートがなければ [`Err`].
    pub fn set_link(&self, id: &str, hackmd: Option<HackmdLink>) -> io::Result<NoteMeta> {
        self.update_meta(id, |meta| meta.hackmd = hackmd)
    }

    /// ノートを消す (ローカルだけ. HackMD のノートは消さない).
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    ///
    /// # Returns
    ///
    /// ID が正しくないか, 消せなければ [`Err`]. ノートがなくても成功.
    pub fn delete(&self, id: &str) -> io::Result<()> {
        check_id(id)?;
        let mut notes = self.load_index()?;
        notes.retain(|n| n.id != id);
        self.save_index(&notes)?;
        match fs::remove_file(self.note_path(id)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}
