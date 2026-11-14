/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { applyFixes, type Configuration, type LintError } from "markdownlint";
import { lint } from "markdownlint/sync";
import type { TextChange } from "./tasks";

/**
 * 整形の規則 (markdownlint の設定). リポジトリの `.markdownlint-cli2.jsonc` と同じ.
 * markdownlint-cli2 は Node のコマンドで, アプリ (Android を含む) には入れられないので,
 * その中で動いている markdownlint を, 同じ規則で直接使う.
 */
export const LINT_CONFIG: Configuration = {
  default: true,
  // 1 行の長さ (日本語の文は, 折り返さずに書く)
  MD013: false,
  // 同じ見出し (兄弟の間だけ見る)
  MD024: { siblings_only: true },
  // HTML
  MD033: false,
  // 囲んでいない URL
  MD034: false,
  // 強調を見出しの代わりに使う
  MD036: false,
  // 最初の行が見出しでない
  MD041: false,
};

/** 整形の結果. */
export interface LintResult {
  /** 本文の書き換え. 変えるところがなければ, `undefined`. */
  change?: TextChange;
  /** 直した指摘の数. */
  fixed: number;
  /** 直せずに残った指摘. */
  remaining: LintError[];
}

/** 一度に示す, 残った指摘の数. */
const SHOWN_ERRORS = 3;

/**
 * 直す回数の上限. 1 回直すと, 次の指摘が出ることがある (`#見出し` に空白を入れると見出しになり,
 * 前後の空行の指摘が出る) ので, 指摘がなくなるまで繰り返す. 直しが収まらないときのために, 上限を置く.
 */
const MAX_PASSES = 5;

/**
 * 本文を markdownlint の規則で検査して, 自動で直せるところを直す (markdownlint-cli2 の `--fix` と同じ).
 *
 * @param source 本文
 * @returns 書き換えと, 直した数と, 残った指摘
 */
export function lintMarkdown(source: string): LintResult {
  let text = source;
  let errors = lintText(text);
  let fixed = 0;
  for (let pass = 0; pass < MAX_PASSES && fixableCount(errors) > 0; pass += 1) {
    fixed += fixableCount(errors);
    text = applyFixes(text, errors);
    errors = lintText(text);
  }
  return { change: textChange(source, text), fixed, remaining: errors };
}

/**
 * 整形の結果を, 画面に出す文にする.
 *
 * @param result 整形の結果
 * @returns 文
 */
export function lintMessage(result: LintResult): string {
  const done =
    result.change === undefined
      ? "整形するところはありません。"
      : `整形しました (${result.fixed} か所)。`;
  if (result.remaining.length === 0) {
    return done;
  }
  const shown = result.remaining
    .slice(0, SHOWN_ERRORS)
    .map((error) => `${error.lineNumber} 行目 ${error.ruleNames[0]} ${error.ruleDescription}`)
    .join("、");
  const more = result.remaining.length > SHOWN_ERRORS ? " ほか" : "";
  return `${done}直せない指摘が ${result.remaining.length} 件あります (${shown}${more})。`;
}

/**
 * 2 つの本文の違いを, 1 つの書き換えにする (同じ始めと終わりは, 書き換えない. カーソルを動かさないため).
 *
 * @param before 前の本文
 * @param after 後の本文
 * @returns 書き換え. 同じなら, `undefined`
 */
export function textChange(before: string, after: string): TextChange | undefined {
  if (before === after) {
    return undefined;
  }
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) {
    start += 1;
  }
  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end += 1;
  }
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

/**
 * 自動で直せる指摘を数える.
 *
 * @param errors 指摘
 * @returns 直せる指摘の数
 */
function fixableCount(errors: LintError[]): number {
  // 直せない指摘の fixInfo は, 型では undefined だが, 実際には null
  return errors.filter((error) => Boolean(error.fixInfo)).length;
}

/**
 * 本文を検査する.
 *
 * @param text 本文
 * @returns 指摘 (行の順)
 */
function lintText(text: string): LintError[] {
  return lint({ strings: { note: text }, config: LINT_CONFIG }).note;
}
