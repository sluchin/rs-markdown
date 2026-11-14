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

/** ノートと, 取り込んだ元のファイルとのつながり (Rust の `FileLink`). */
export interface FileLink {
  /** 元のファイルのパス. */
  path: string;
  /** 最後にファイルと合わせたときの, 本文のハッシュ. */
  syncedHash: string;
}

/** ノートの一覧の項目 (Rust の `NoteMeta`). */
export interface NoteMeta {
  /** ノートの ID. */
  id: string;
  /** 題名 (空なら無題). */
  title: string;
  /** 最後に変えた日時 (UNIX 時間のミリ秒). */
  updatedAt: number;
  /** HackMD のノートとのつながり. */
  hackmd: HackmdLink | null;
  /** 取り込んだ元のファイルとのつながり (前の版の一覧には, ない). */
  file?: FileLink | null;
  /** カテゴリ (分けていなければ null. 前の版の一覧には, ない). */
  category?: string | null;
}

/** ディレクトリから取り込んだ結果 (Rust の `DirImport`). */
export interface DirImport {
  /** 取り込んだノート. */
  notes: NoteMeta[];
  /** 取り込めなかったファイルの数. */
  skipped: number;
}

/** カテゴリのノートを, まとめて HackMD に送った結果 (Rust の `CategoryPush`). */
export interface CategoryPush {
  /** 送ったノート. */
  pushed: NoteMeta[];
  /** 変わっていないので, 送らなかったノートの数. */
  unchanged: number;
  /** HackMD の側が変わっていたので, 送らなかったノート. */
  conflicts: NoteMeta[];
}

/** カテゴリの名前の最大の文字数 (Rust の `store::MAX_CATEGORY_CHARS` と同じ). */
export const MAX_CATEGORY_CHARS = 40;

/** 一覧に出す名前 (題名か, 元のファイルの名前). */
export type ListLabel = "title" | "file";

/** カテゴリごとの, ノートのまとまり. */
export interface NoteGroup<T> {
  /** カテゴリ (null は, 分けていないノート). */
  category: string | null;
  /** ノート (順は変えない). */
  notes: T[];
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
 * 一覧に出す名前. ファイル名を選んでいても, ファイルとつないでいないノートは題名にする.
 *
 * @param note ノート
 * @param by 出す名前
 * @returns 名前
 */
export function noteLabel(note: Pick<NoteMeta, "title" | "file">, by: ListLabel): string {
  return by === "file" && note.file ? fileName(note.file.path) : displayTitle(note.title);
}

/**
 * 名前で, ノートを絞り込む (大文字と小文字を区別しない).
 *
 * @param notes ノート
 * @param query 探す文字 (空なら全部)
 * @param label ノートの名前 (省くと, 題名)
 * @returns 絞り込んだノート (順は変えない)
 */
export function filterNotes<T extends { title: string }>(
  notes: readonly T[],
  query: string,
  label: (note: T) => string = (note) => displayTitle(note.title),
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...notes];
  }
  return notes.filter((note) => label(note).toLowerCase().includes(needle));
}

/**
 * ノートを, カテゴリごとにまとめる. カテゴリは名前の順で, 分けていないノートは最後.
 *
 * @param notes ノート
 * @returns まとまり (ノートがなければ空)
 */
export function groupByCategory<T extends { category?: string | null }>(
  notes: readonly T[],
): NoteGroup<T>[] {
  const groups = new Map<string, T[]>();
  const rest: T[] = [];
  for (const note of notes) {
    if (!note.category) {
      rest.push(note);
      continue;
    }
    const group = groups.get(note.category);
    if (group) {
      group.push(note);
    } else {
      groups.set(note.category, [note]);
    }
  }
  const named = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ja"))
    .map(([category, list]) => ({ category, notes: list }));
  return rest.length > 0 ? [...named, { category: null, notes: rest }] : named;
}

/**
 * ノートのカテゴリの名前を, 重ねずに, 名前の順で返す (入力の候補).
 *
 * @param notes ノート
 * @returns カテゴリの名前
 */
export function categoriesOf(notes: readonly { category?: string | null }[]): string[] {
  return groupByCategory(notes)
    .map((group) => group.category)
    .filter((category) => category !== null);
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

/**
 * 元のファイルとの同期の状態の説明.
 *
 * @param state 状態
 * @returns 説明
 */
export function fileSyncLabel(state: SyncState): string {
  switch (state) {
    case "unlinked":
      return "ファイルとつないでいません";
    case "synced":
      return "ファイルと同じです";
    case "localChanged":
      return "このノートだけが変わっています (ファイルに保存できます)";
    case "remoteChanged":
      return "ファイルだけが変わっています (読み直せます)";
    case "conflict":
      return "ノートとファイルの両方が変わっています";
  }
}

/**
 * パスから, ファイルの名前を取り出す (`/` と `\\` のどちらの区切りも).
 *
 * @param path パス
 * @returns ファイルの名前 (区切りがなければパスのまま)
 */
export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * カテゴリのノートを, まとめて HackMD に送った結果の説明.
 *
 * @param category カテゴリ
 * @param result 送った結果
 * @returns 画面に出す説明
 */
export function categoryPushMessage(category: string, result: CategoryPush): string {
  const { pushed, unchanged, conflicts } = result;
  if (pushed.length + unchanged + conflicts.length === 0) {
    return `「${category}」にはノートがありません。`;
  }
  const parts = [`「${category}」の ${pushed.length} 件のノートを HackMD に送りました。`];
  if (unchanged > 0) {
    parts.push(`${unchanged} 件は変わっていないので、送りませんでした。`);
  }
  if (conflicts.length > 0) {
    const titles = conflicts.map((note) => `「${displayTitle(note.title)}」`).join("、");
    parts.push(
      `${titles}は HackMD の側が変わっていたので、送りませんでした (ノートを開いて、1 件ずつ送ります)。`,
    );
  }
  return parts.join("");
}
