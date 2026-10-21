/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt, { type StateCore } from "markdown-it";

/** 先頭の YAML (`---` で囲む. HackMD のノートの設定). 表示では, 出さない. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 作業の一覧の印 (`[ ]` と `[x]`). */
const TASK = /^\[([ xX])\] /;

/**
 * 先頭の YAML を取り除く.
 *
 * @param source Markdown
 * @returns YAML のない Markdown
 */
export function stripFrontMatter(source: string): string {
  return source.replace(FRONT_MATTER, "");
}

/**
 * コードを, 言語に合わせて色付けする. 知らない言語なら, 色を付けない (markdown-it が, そのまま書く).
 *
 * @param code コード
 * @param language 言語 (` ```ts ` の `ts`)
 * @returns 色付けした HTML. 知らない言語なら, 空.
 */
export function highlight(code: string, language: string): string {
  if (language === "" || !hljs.getLanguage(language)) {
    return "";
  }
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

/**
 * 一覧の項目の先頭の `[ ]` と `[x]` を, チェックボックスにする (GitHub と HackMD の作業の一覧).
 * チェックボックスは, 表示だけ (押しても変わらない).
 *
 * @param state markdown-it の解析の状態
 */
export function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== "inline" ||
      tokens[i - 1].type !== "paragraph_open" ||
      tokens[i - 2].type !== "list_item_open"
    ) {
      continue;
    }
    const match = TASK.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || first?.type !== "text") {
      continue;
    }
    const checked = match[1] !== " ";
    first.content = first.content.replace(TASK, "");
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" class="task" disabled${checked ? " checked" : ""}> `;
    inline.children?.unshift(box);
    tokens[i - 2].attrJoin("class", "task-item");
  }
}

/** Markdown の変換. HTML も書ける (HackMD と同じ). 安全にするのは, {@link sanitize}. */
const md = new MarkdownIt({ html: true, linkify: true, breaks: true, highlight });
md.core.ruler.push("task_lists", taskLists);

/**
 * HTML から, スクリプト, フォーム, インラインのスタイルなど, 危ないものを取り除く.
 *
 * @param html HTML
 * @returns 安全な HTML
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "button", "iframe", "object", "embed", "link", "meta"],
    FORBID_ATTR: ["style", "srcset"],
  });
}

/**
 * Markdown を, 表示する HTML にする (先頭の YAML を除いて, 変換して, 安全にする).
 *
 * @param source Markdown
 * @returns 安全な HTML
 */
export function renderMarkdown(source: string): string {
  return sanitize(md.render(stripFrontMatter(source)));
}
