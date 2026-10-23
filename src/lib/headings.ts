/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { StateCore, Token } from "markdown-it";
import { escapeHtml } from "./math";

/** 目次に載せる見出し. */
export interface Heading {
  /** 段 (`#` の数). */
  level: number;
  /** 見出しの文字. */
  text: string;
  /** 見出しの `id`. */
  id: string;
}

/** 目次を置く印 (HackMD と同じ). */
const TOC_MARK = "[TOC]";

/** `id` に使わない記号 (ASCII の記号のうち, `-` と `_` 以外). */
const PUNCTUATION = /[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;

/**
 * 見出しの文字から, `id` を作る (HackMD と同じく, 空白を `-` にして, 記号を除く. 日本語は残す).
 *
 * @param text 見出しの文字
 * @returns `id`. 何も残らなければ, `heading`.
 */
export function slugify(text: string): string {
  const slug = text.trim().replace(PUNCTUATION, "").replace(/\s+/g, "-");
  return slug === "" ? "heading" : slug;
}

/**
 * 字句の並びから, 見える文字を取り出す (文字とコード. 強調などの印は除く).
 *
 * @param children 文中の字句
 * @returns 文字
 */
function plainText(children: Token[]): string {
  return children
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("");
}

/**
 * 目次の HTML を作る. 見出しの段に合わせて, 入れ子の一覧にする.
 *
 * @param headings 見出し (出てくる順)
 * @returns HTML. 見出しがなければ, 空.
 */
export function tocHtml(headings: readonly Heading[]): string {
  if (headings.length === 0) {
    return "";
  }
  let html = '<div class="toc">';
  // 開いている一覧の段 (一番内側が末尾)
  const open: number[] = [];
  for (const heading of headings) {
    if (open.length === 0 || heading.level > open[open.length - 1]) {
      // 前の項目の中に, 一覧を開く
      html += "<ul>";
      open.push(heading.level);
    } else {
      html += "</li>";
      while (open.length > 1 && heading.level < open[open.length - 1]) {
        html += "</ul></li>";
        open.pop();
      }
    }
    html += `<li><a href="#${escapeHtml(encodeURIComponent(heading.id))}">${escapeHtml(heading.text)}</a>`;
  }
  html += "</li>" + "</ul></li>".repeat(open.length - 1) + "</ul></div>\n";
  return html;
}

/**
 * 見出しに `id` を付けて, `[TOC]` だけの段落を目次にする (markdown-it の core の規則).
 * 同じ `id` が 2 回目からは, `-1`, `-2` を付ける.
 *
 * @param state markdown-it の解析の状態
 */
export function headingsRule(state: StateCore): void {
  const tokens = state.tokens;
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") {
      continue;
    }
    // 見出しの次は, 必ず文中の字句 (解析した子を持つ)
    const text = plainText(tokens[i + 1].children as Token[]);
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    tokens[i].attrSet("id", id);
    headings.push({ level: Number(tokens[i].tag.slice(1)), text, id });
  }
  for (let i = 0; i < tokens.length; i++) {
    // 段落の次は, 必ず文中の字句
    if (tokens[i].type === "paragraph_open" && tokens[i + 1].content.trim() === TOC_MARK) {
      const toc = new state.Token("html_block", "", 0);
      toc.content = tocHtml(headings);
      toc.map = tokens[i].map;
      // 段落 (開く, 中身, 閉じる) を, 目次に置き換える
      tokens.splice(i, 3, toc);
    }
  }
}
