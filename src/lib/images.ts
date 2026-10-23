/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** ノートに書く, 画像の場所の始め (アプリのデータの `images/`). */
export const IMAGE_PREFIX = "images/";

/** 画像の名前 (`<UUID>.<拡張子>`. Rust の `images::is_valid_name` と同じ). */
const IMAGE_NAME = /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/i;

/**
 * 表示の画像の `src` が, アプリのデータの画像 (`images/<名前>`) なら, 名前を返す.
 *
 * @param src 画像の `src` (属性のまま)
 * @returns 名前. アプリのデータの画像でなければ, `undefined`.
 */
export function localImageName(src: string | null): string | undefined {
  if (!src?.startsWith(IMAGE_PREFIX)) {
    return undefined;
  }
  const name = src.slice(IMAGE_PREFIX.length);
  return IMAGE_NAME.test(name) ? name : undefined;
}

/**
 * 置いた画像を, ノートに書く Markdown にする.
 *
 * @param name 画像の名前
 * @param alt 説明 (元のファイルの名前など). `[` と `]` は除く.
 * @returns Markdown
 */
export function imageMarkdown(name: string, alt = ""): string {
  return `![${alt.replace(/[[\]]/g, "")}](${IMAGE_PREFIX}${name})`;
}

/**
 * 貼り付けたものが, 画像か (クリップボードの種類).
 *
 * @param type 種類 (`image/png` など)
 * @returns 画像なら, true
 */
export function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

/**
 * ファイルのパスから, 名前 (拡張子を除く) を返す. 画像の説明に使う.
 *
 * @param path パス (`/` か `\` で区切る)
 * @returns 名前
 */
export function baseName(path: string): string {
  const file = path.split(/[/\\]/).at(-1) as string;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}
