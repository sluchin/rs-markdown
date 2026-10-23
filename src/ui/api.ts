/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { invoke } from "@tauri-apps/api/core";
import type { LogLevel } from "../lib/log";
import type { NoteMeta, RemoteEntry, SyncState } from "../lib/notes";

/** トークンの取り元 (Rust の `TokenSource`). */
export type TokenSource = "none" | "saved" | "env";

/** 設定 (Rust の `SettingsView`). */
export interface SettingsView {
  /** トークンの取り元. */
  tokenSource: TokenSource;
}

/**
 * ノートの一覧を返す.
 *
 * @returns 一覧 (新しく変えた順)
 */
export const listNotes = () => invoke<NoteMeta[]>("list_notes");

/**
 * ノートの本文を返す.
 *
 * @param id ノートの ID
 * @returns 本文
 */
export const readNote = (id: string) => invoke<string>("read_note", { id });

/**
 * ノートを作る.
 *
 * @param content 本文
 * @returns 作ったノート
 */
export const createNote = (content: string) => invoke<NoteMeta>("create_note", { content });

/**
 * ノートの本文を保存する.
 *
 * @param id ノートの ID
 * @param content 本文
 * @returns 変えたあとのノート
 */
export const saveNote = (id: string, content: string) =>
  invoke<NoteMeta>("save_note", { id, content });

/**
 * ノートを消す (ローカルだけ).
 *
 * @param id ノートの ID
 * @returns 終わったら, 解決する
 */
export const deleteNote = (id: string) => invoke<void>("delete_note", { id });

/**
 * HackMD のノートとのつながりを外す.
 *
 * @param id ノートの ID
 * @returns 変えたあとのノート
 */
export const unlinkNote = (id: string) => invoke<NoteMeta>("unlink_note", { id });

/**
 * 同期の状態を, HackMD に問い合わせる.
 *
 * @param id ノートの ID
 * @returns 状態
 */
export const noteStatus = (id: string) => invoke<SyncState>("note_status", { id });

/**
 * ノートを HackMD に送る.
 *
 * @param id ノートの ID
 * @param force HackMD の側が変わっていても, 上書きするか
 * @returns 送ったあとのノート
 */
export const pushNote = (id: string, force: boolean) =>
  invoke<NoteMeta>("push_note", { id, force });

/**
 * HackMD の本文を取り込む.
 *
 * @param id ノートの ID
 * @param force このノートが変わっていても, 上書きするか
 * @returns 取り込んだあとのノート
 */
export const pullNote = (id: string, force: boolean) =>
  invoke<NoteMeta>("pull_note", { id, force });

/**
 * 衝突したときに, 両方を残す.
 *
 * @param id ノートの ID
 * @returns HackMD の本文の, 新しいノート
 */
export const keepBoth = (id: string) => invoke<NoteMeta>("keep_both", { id });

/**
 * HackMD のノートの一覧を返す.
 *
 * @returns 一覧
 */
export const listRemote = () => invoke<RemoteEntry[]>("list_remote");

/**
 * HackMD のノートを取り込む.
 *
 * @param noteId HackMD のノートの ID
 * @returns ローカルのノート
 */
export const importNote = (noteId: string) => invoke<NoteMeta>("import_note", { noteId });

/**
 * 設定を返す.
 *
 * @returns 設定
 */
export const getSettings = () => invoke<SettingsView>("get_settings");

/**
 * HackMD の API のトークンを保存する.
 *
 * @param token トークン (null は, 消す)
 * @returns 終わったら, 解決する
 */
export const setToken = (token: string | null) => invoke<void>("set_token", { token });

/**
 * トークンを確かめる.
 *
 * @returns 持ち主の名前
 */
export const checkToken = () => invoke<string>("check_token");

/**
 * アプリのログの末尾を返す.
 *
 * @returns ログ
 */
export const readLog = () => invoke<string>("read_log");

/**
 * アプリのログを消す.
 *
 * @returns 終わったら, 解決する
 */
export const clearLog = () => invoke<void>("clear_log");

/**
 * 画面のログを, Rust のログに送る.
 *
 * @param level 重大度
 * @param message 内容
 * @returns 終わったら, 解決する
 */
export const sendLog = (level: LogLevel, message: string) =>
  invoke<void>("log_frontend_message", { level, message });

/**
 * 貼り付けた画像を, アプリのデータに置く.
 *
 * @param bytes 画像の中身
 * @returns 置いたファイルの名前 (ノートには `images/<名前>` と書く)
 */
export const saveImage = (bytes: Uint8Array) => invoke<string>("save_image", bytes);

/**
 * 落とした画像のファイルを, アプリのデータに写して置く.
 *
 * @param path ファイルのパス
 * @returns 置いたファイルの名前
 */
export const importImage = (path: string) => invoke<string>("import_image", { path });

/**
 * 画像を置くディレクトリを返す.
 *
 * @returns ディレクトリのパス
 */
export const imagesDir = () => invoke<string>("images_dir");

/**
 * 外の Markdown のファイルを, ファイルとつないだノートとして取り込む (もう取り込んであれば, そのノート).
 *
 * @param path ファイルのパス
 * @returns 取り込んだノート
 */
export const importFile = (path: string) => invoke<NoteMeta>("import_file", { path });

/**
 * ノートと元のファイルの同期の状態を返す.
 *
 * @param id ノートの ID
 * @returns 状態
 */
export const fileStatus = (id: string) => invoke<SyncState>("file_status", { id });

/**
 * ノートの本文を, 元のファイルに書く.
 *
 * @param id ノートの ID
 * @param force ファイルの側が変わっていても, 上書きするか
 * @returns 書いたあとのノート
 */
export const pushFile = (id: string, force: boolean) =>
  invoke<NoteMeta>("push_file", { id, force });

/**
 * 元のファイルの本文を, ノートに取り込み直す.
 *
 * @param id ノートの ID
 * @param force このノートが変わっていても, 上書きするか
 * @returns 取り込んだあとのノート
 */
export const pullFile = (id: string, force: boolean) =>
  invoke<NoteMeta>("pull_file", { id, force });

/**
 * ファイルとの衝突で, 両方を残す.
 *
 * @param id ノートの ID
 * @returns ファイルの本文の, 新しいノート
 */
export const keepBothFile = (id: string) => invoke<NoteMeta>("keep_both_file", { id });

/**
 * 元のファイルとのつながりを外す.
 *
 * @param id ノートの ID
 * @returns 変えたあとのノート
 */
export const unlinkFile = (id: string) => invoke<NoteMeta>("unlink_file", { id });
