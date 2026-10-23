/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** ノートとして取り込めるファイルの拡張子 (Rust の `files::EXTENSIONS` と同じ). */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];

/** URL の形 (`content://` など. ファイルのパスでない). */
const URL_FORM = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * ノートとして取り込めるファイルか (拡張子で決める. 大文字も可).
 *
 * @param path ファイルのパス
 * @returns 取り込めるなら, true
 */
export function isMarkdownPath(path: string): boolean {
  const name = path.split(/[/\\]/).at(-1) as string;
  const dot = name.lastIndexOf(".");
  return dot > 0 && MARKDOWN_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/**
 * ファイルのパスか (Android のファイルを選ぶ画面が返す `content://` などの URL でないか).
 *
 * @param path パス
 * @returns ファイルのパスなら, true
 */
export function isFilePath(path: string): boolean {
  return !URL_FORM.test(path);
}

/**
 * 落としたファイルを, ノートとして取り込むものと, それ以外 (画像として貼り付けるもの) に分ける.
 *
 * @param paths 落としたファイルのパス
 * @returns 取り込むものと, それ以外
 */
export function splitDropped(paths: readonly string[]): { notes: string[]; others: string[] } {
  return {
    notes: paths.filter(isMarkdownPath),
    others: paths.filter((path) => !isMarkdownPath(path)),
  };
}
