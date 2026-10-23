/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 本文の書き換え. `from` から `to` を `insert` に置き換える. */
export interface TextChange {
  /** 置き換える範囲の始め. */
  from: number;
  /** 置き換える範囲の終わり. */
  to: number;
  /** 置き換える文字. */
  insert: string;
}

/** 作業の一覧の行 (引用の中も). 1 つ目の組は `[` の前まで, 2 つ目は印 (` ` か `x`). */
const TASK_LINE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/**
 * 作業の一覧の行の, 印 (`[ ]` と `[x]`) を切り替える書き換えを返す.
 *
 * @param source 本文
 * @param line 行 (1 から)
 * @returns 書き換え. その行が作業の一覧でなければ, `undefined`.
 */
export function toggleTask(source: string, line: number): TextChange | undefined {
  const lines = source.split("\n");
  const text = lines[line - 1];
  const match = text === undefined ? null : TASK_LINE.exec(text);
  if (!match) {
    return undefined;
  }
  const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
  // `[` の次の文字
  const at = start + match[1].length + 1;
  return { from: at, to: at + 1, insert: match[2] === " " ? "x" : " " };
}

/**
 * 書き換えを, 本文に当てる.
 *
 * @param source 本文
 * @param change 書き換え
 * @returns 書き換えた本文
 */
export function applyChange(source: string, change: TextChange): string {
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}
