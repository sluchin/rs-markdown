/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt, { type StateCore, type Token } from "markdown-it";
import container from "markdown-it-container";
import { full as emoji } from "markdown-it-emoji";
import footnote from "markdown-it-footnote";
import ins from "markdown-it-ins";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import { headingsRule } from "./headings";
import { escapeHtml, mathPlugin } from "./math";

/** 先頭の YAML (`---` で囲む. HackMD のノートの設定). 表示では, 出さない. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 作業の一覧の印 (`[ ]` と `[x]`). */
const TASK = /^\[([ xX])\] /;

/** HackMD の囲み (`:::info` など) の種類. */
const ALERTS = ["info", "success", "warning", "danger"] as const;

/** 折り畳み (`:::spoiler 題名`). */
const SPOILER = /^spoiler(?:\s+(.*))?$/;

/** 元の行の番号を付ける, 段落の字句 (開く字句のほかに). 表示とエディタの位置を合わせるのに使う. */
const LINE_TOKENS = new Set(["fence", "code_block", "hr", "math_block"]);

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
 * 先頭の YAML の行の数を返す.
 *
 * @param source Markdown
 * @returns 行の数. YAML がなければ, 0.
 */
export function frontMatterLines(source: string): number {
  const match = FRONT_MATTER.exec(source);
  return match ? match[0].split("\n").length - (match[0].endsWith("\n") ? 1 : 0) : 0;
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
 * チェックボックスを押すと, 元の行の印を切り替える (`lib/tasks.ts`).
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
    // 押すと, 元の行の印を切り替える (表示 `Preview.tsx` が, 項目の `data-source-line` で行を探す)
    box.content = `<input type="checkbox" class="task"${checked ? " checked" : ""}> `;
    inline.children?.unshift(box);
    tokens[i - 2].attrJoin("class", "task-item");
  }
}

/**
 * 段落の字句に, 元の行の番号 (`data-source-line`. 1 から) を付ける (markdown-it の core の規則).
 * 先頭の YAML を除いた分は, `env.lineOffset` で足す.
 *
 * @param state markdown-it の解析の状態
 */
export function sourceLines(state: StateCore): void {
  const offset = (state.env as { lineOffset?: number }).lineOffset ?? 0;
  for (const token of state.tokens) {
    if (token.map && (token.nesting === 1 || LINE_TOKENS.has(token.type))) {
      token.attrSet("data-source-line", String(token.map[0] + offset + 1));
    }
  }
}

/**
 * HackMD の囲み (`:::info` / `:::success` / `:::warning` / `:::danger`) を描く.
 *
 * @param name 種類
 * @returns 描く関数
 */
function renderAlert(name: string) {
  return (tokens: Token[], idx: number) =>
    tokens[idx].nesting === 1 ? `<div class="alert alert-${name}">\n` : "</div>\n";
}

/**
 * 折り畳み (`:::spoiler 題名`) を描く. 題名がなければ, 「Spoiler」.
 *
 * @param tokens 字句
 * @param idx 描く字句の位置
 * @returns HTML
 */
function renderSpoiler(tokens: Token[], idx: number): string {
  if (tokens[idx].nesting !== 1) {
    return "</details>\n";
  }
  const title = SPOILER.exec(tokens[idx].info.trim())?.[1] ?? "Spoiler";
  return `<details class="spoiler"><summary>${escapeHtml(title)}</summary>\n`;
}

/** Markdown の変換. HTML も書ける (HackMD と同じ). 安全にするのは, {@link sanitize}. */
const md = new MarkdownIt({ html: true, linkify: true, breaks: true, highlight })
  .use(mark)
  .use(ins)
  .use(sub)
  .use(sup)
  .use(footnote)
  .use(emoji)
  .use(mathPlugin);
for (const name of ALERTS) {
  md.use(container, name, { render: renderAlert(name) });
}
md.use(container, "spoiler", {
  validate: (params: string) => SPOILER.test(params.trim()),
  render: renderSpoiler,
});
md.core.ruler.push("task_lists", taskLists);
md.core.ruler.push("headings", headingsRule);
md.core.ruler.push("source_lines", sourceLines);

// Mermaid の図 (` ```mermaid `) は, ここでは描かない. 表示のときに, `class="mermaid"` の要素を描く.
// 既定の描き方 (コード) は, markdown-it が必ず持っている.
const defaultFence = md.renderer.rules.fence as NonNullable<typeof md.renderer.rules.fence>;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === "mermaid") {
    return `<div class="mermaid"${self.renderAttrs(token)}>${escapeHtml(token.content)}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

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
  return sanitize(md.render(stripFrontMatter(source), { lineOffset: frontMatterLines(source) }));
}
