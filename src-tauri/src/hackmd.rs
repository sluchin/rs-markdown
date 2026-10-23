// Copyright (c) 2026 Tetsuya Higashi
//
// SPDX-License-Identifier: GPL-3.0-or-later

//! HackMD の API (v1) の呼び出し. 使うのは, 自分のノートの一覧, 取得, 作成, 本文の更新だけ
//! (HackMD のノートは消さない).
//!
//! API のトークンはログに書かない. エラーにも, 応答の本文を入れない.

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

/// HackMD の API の URL.
pub const API_BASE: &str = "https://api.hackmd.io/v1";
/// 名乗る User-Agent.
pub const USER_AGENT: &str = "rs-mdnote/0.1 (+https://github.com/sluchin/rs-mdnote)";
/// 1 回の呼び出しの時間の上限.
const TIMEOUT: Duration = Duration::from_secs(30);

/// HackMD のノート (一覧では, 本文 `content` がない).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteNote {
    /// ノートの ID.
    pub id: String,
    /// 題名.
    #[serde(default)]
    pub title: String,
    /// 最後に変えた日時 (UNIX 時間のミリ秒).
    #[serde(default)]
    pub last_changed_at: Option<u64>,
    /// ノートを開く URL.
    #[serde(default)]
    pub publish_link: Option<String>,
    /// 本文 (1 つのノートを取得したときだけ).
    #[serde(default)]
    pub content: Option<String>,
}

/// トークンの持ち主.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    /// 名前.
    #[serde(default)]
    pub name: String,
    /// ユーザーのパス (`@` のあとの名前).
    #[serde(default)]
    pub user_path: String,
}

/// API の呼び出しの失敗.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// トークンがないか, 正しくない (401, 403).
    Unauthorized,
    /// ノートがない (404).
    NotFound,
    /// 呼び出しの回数の上限を超えた (429).
    RateLimited,
    /// ほかの HTTP のエラー.
    Status(u16),
    /// 通信の失敗 (つながらない, 時間切れ).
    Network(String),
    /// 応答を読めない.
    Decode(String),
    /// ノートの ID が正しくない.
    InvalidId,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Unauthorized => write!(f, "the HackMD API token was rejected"),
            ApiError::NotFound => write!(f, "the HackMD note was not found"),
            ApiError::RateLimited => write!(f, "the HackMD API rate limit was exceeded"),
            ApiError::Status(code) => write!(f, "the HackMD API returned HTTP {}", code),
            ApiError::Network(e) => write!(f, "could not reach HackMD: {}", e),
            ApiError::Decode(e) => write!(f, "could not read the HackMD response: {}", e),
            ApiError::InvalidId => write!(f, "invalid HackMD note id"),
        }
    }
}

/// HTTP の状態の番号を, エラーにする.
///
/// # Arguments
///
/// * `status` - 状態の番号.
///
/// # Returns
///
/// 成功 (2xx) なら [`Ok`]. それ以外は, 対応する [`ApiError`].
pub fn check_status(status: u16) -> Result<(), ApiError> {
    match status {
        200..=299 => Ok(()),
        401 | 403 => Err(ApiError::Unauthorized),
        404 => Err(ApiError::NotFound),
        429 => Err(ApiError::RateLimited),
        code => Err(ApiError::Status(code)),
    }
}

/// HackMD のノートの ID として正しいか (URL のパスに入れるので, 英数字と `-` `_` だけを通す).
///
/// # Arguments
///
/// * `id` - ID.
///
/// # Returns
///
/// 正しければ `true`.
pub fn is_valid_note_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// HackMD の API の呼び出し.
pub struct Client {
    /// HTTP のクライアント.
    http: reqwest::Client,
    /// API の URL (テストでは, テスト用のサーバー).
    base: String,
    /// API のトークン.
    token: String,
}

impl Client {
    /// 呼び出しを作る.
    ///
    /// # Arguments
    ///
    /// * `base` - API の URL ([`API_BASE`]).
    /// * `token` - API のトークン.
    ///
    /// # Returns
    ///
    /// 作れなければ (TLS の初期化の失敗) [`ApiError::Network`].
    pub fn new(base: &str, token: &str) -> Result<Self, ApiError> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok(Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    /// リクエストを作る (トークンを付ける).
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
    }

    /// リクエストを送って, 状態を確かめる.
    async fn send(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, ApiError> {
        let response = request
            .send()
            .await
            .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
        check_status(response.status().as_u16())?;
        Ok(response)
    }

    /// リクエストを送って, 応答の JSON を読む.
    async fn send_json<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, ApiError> {
        self.send(request)
            .await?
            .json()
            .await
            .map_err(|e| ApiError::Decode(e.without_url().to_string()))
    }

    /// トークンの持ち主を返す (トークンの確認).
    ///
    /// # Returns
    ///
    /// 持ち主. 失敗したら [`ApiError`].
    pub async fn me(&self) -> Result<Me, ApiError> {
        self.send_json(self.request(reqwest::Method::GET, "/me"))
            .await
    }

    /// 自分のノートの一覧を返す (本文はない).
    ///
    /// # Returns
    ///
    /// 一覧. 失敗したら [`ApiError`].
    pub async fn list(&self) -> Result<Vec<RemoteNote>, ApiError> {
        self.send_json(self.request(reqwest::Method::GET, "/notes"))
            .await
    }

    /// ノートを, 本文と一緒に返す.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    ///
    /// # Returns
    ///
    /// ノート. 失敗したら [`ApiError`].
    pub async fn get(&self, id: &str) -> Result<RemoteNote, ApiError> {
        if !is_valid_note_id(id) {
            return Err(ApiError::InvalidId);
        }
        self.send_json(self.request(reqwest::Method::GET, &format!("/notes/{}", id)))
            .await
    }

    /// ノートを作る. 読めるのも書けるのも自分だけにする (公開は, HackMD の画面で選ぶ).
    ///
    /// # Arguments
    ///
    /// * `content` - 本文.
    ///
    /// # Returns
    ///
    /// 作ったノート. 失敗したら [`ApiError`].
    pub async fn create(&self, content: &str) -> Result<RemoteNote, ApiError> {
        let body = json!({
            "content": content,
            "readPermission": "owner",
            "writePermission": "owner",
            "commentPermission": "disabled",
        });
        self.send_json(self.request(reqwest::Method::POST, "/notes").json(&body))
            .await
    }

    /// ノートの本文を置き換える.
    ///
    /// # Arguments
    ///
    /// * `id` - ノートの ID.
    /// * `content` - 本文.
    ///
    /// # Returns
    ///
    /// 失敗したら [`ApiError`].
    pub async fn update(&self, id: &str, content: &str) -> Result<(), ApiError> {
        if !is_valid_note_id(id) {
            return Err(ApiError::InvalidId);
        }
        let body = json!({ "content": content });
        self.send(
            self.request(reqwest::Method::PATCH, &format!("/notes/{}", id))
                .json(&body),
        )
        .await?;
        Ok(())
    }
}
