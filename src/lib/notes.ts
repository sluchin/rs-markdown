/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** ノートと, HackMD のノートとのつながり (Rust の `HackmdLink`). */
export interface HackmdLink {
  /** HackMD のノートの ID. */
  noteId: string;
  /** 最後に同期したときの, 本文のハッシュ. */
  syncedHash: string;
  /** HackMD の, ノートを開く URL. */
  publishLink: string | null;
}

/** ノートの一覧の項目 (Rust の `NoteMeta`). */
export interface NoteMeta {
  /** ノートの ID. */
  id: string;
  /** 題名 (空なら, 無題). */
  title: string;
  /** 最後に変えた日時 (UNIX 時間のミリ秒). */
  updatedAt: number;
  /** HackMD のノートとのつながり. */
  hackmd: HackmdLink | null;
}

/** 同期の状態 (Rust の `SyncState`). */
export type SyncState = "unlinked" | "synced" | "localChanged" | "remoteChanged" | "conflict";

/** HackMD のノートの一覧の項目 (Rust の `RemoteEntry`). */
export interface RemoteEntry {
  /** HackMD のノートの ID. */
  id: string;
  /** 題名. */
  title: string;
  /** 最後に変えた日時 (UNIX 時間のミリ秒). */
  lastChangedAt: number | null;
  /** 取り込んだローカルのノートの ID. */
  localId: string | null;
}

/**
 * 画面に出す題名 (空なら「無題」).
 *
 * @param title 題名
 * @returns 画面に出す題名
 */
export function displayTitle(title: string): string {
  return title.trim() === "" ? "無題" : title;
}

/**
 * 題名で, ノートを絞り込む (大文字と小文字を区別しない).
 *
 * @param notes ノート
 * @param query 探す文字 (空なら, 全部)
 * @returns 絞り込んだノート (順は変えない)
 */
export function filterNotes<T extends { title: string }>(notes: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...notes];
  }
  return notes.filter((note) => displayTitle(note.title).toLowerCase().includes(needle));
}

/**
 * 日時を, 端末の時刻で短く書く (今日なら時刻だけ, 今年なら月日と時刻, それより前は年月日).
 *
 * @param millis 日時 (UNIX 時間のミリ秒)
 * @param now 今の日時 (UNIX 時間のミリ秒)
 * @returns 日時の文字列
 */
export function formatDate(millis: number, now: number): string {
  const date = new Date(millis);
  const today = new Date(now);
  const two = (value: number) => String(value).padStart(2, "0");
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === today.toDateString()) {
    return time;
  }
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 同期の状態の説明.
 *
 * @param state 状態
 * @returns 説明
 */
export function syncLabel(state: SyncState): string {
  switch (state) {
    case "unlinked":
      return "HackMD とつないでいません";
    case "synced":
      return "HackMD と同じです";
    case "localChanged":
      return "このノートだけが変わっています (送れます)";
    case "remoteChanged":
      return "HackMD だけが変わっています (取り込めます)";
    case "conflict":
      return "両方が変わっています";
  }
}
