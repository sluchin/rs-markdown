/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MarkdownIt, StateBlock, StateInline } from "markdown-it";

/** `$` の文字コード. */
const DOLLAR = 0x24;

/** 数式の区切り (`$$`). */
const DISPLAY = "$$";

/**
 * HTML の特別な文字を, 文字参照にする.
 *
 * @param text 文字列
 * @returns 文字参照にした文字列
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 文中の数式 (`$...$`) を読む. HackMD と同じく, `$` のすぐ内側に空白があるもの, 閉じる `$` のすぐ後に
 * 数字があるもの (金額など) は, 数式にしない.
 *
 * @param state markdown-it の解析の状態
 * @param silent 確かめるだけなら, true (字句を作らない)
 * @returns 数式なら, true
 */
export function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  // `$$` (二つ続く) は, 文中では数式にしない (二つ目の `$` から読み直したときも)
  if (
    src.charCodeAt(pos) !== DOLLAR ||
    src.charCodeAt(pos + 1) === DOLLAR ||
    src.charCodeAt(pos - 1) === DOLLAR
  ) {
    return false;
  }
  const start = pos + 1;
  if (start >= state.posMax || /\s/.test(src[start])) {
    return false;
  }
  let end = src.indexOf("$", start);
  // 閉じる `$` の前の `\$` は, 文字の `$`
  while (end !== -1 && src[end - 1] === "\\") {
    end = src.indexOf("$", end + 1);
  }
  if (
    end === -1 ||
    end >= state.posMax ||
    /\s/.test(src[end - 1]) ||
    /\d/.test(src[end + 1] ?? "")
  ) {
    return false;
  }
  if (!silent) {
    const token = state.push("math_inline", "", 0);
    token.content = src.slice(start, end);
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

/**
 * 段落の数式 (`$$` で囲む. 1 行でも, 複数の行でも) を読む.
 *
 * @param state markdown-it の解析の状態
 * @param startLine 始めの行
 * @param endLine 終わりの行 (含まない)
 * @param silent 確かめるだけなら, true (字句を作らない)
 * @returns 数式なら, true
 */
export function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const lineText = (line: number) =>
    state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
  // 4 文字以上の字下げ (コード) は, markdown-it がこの規則の前に読むので, ここには来ない
  const first = lineText(startLine);
  if (!first.startsWith(DISPLAY)) {
    return false;
  }
  let content: string;
  let last = startLine;
  const rest = first.slice(DISPLAY.length);
  if (rest.trim().endsWith(DISPLAY)) {
    // 1 行 (`$$ x $$`)
    content = rest.trim().slice(0, -DISPLAY.length);
  } else {
    const lines = [rest];
    for (;;) {
      last += 1;
      if (last >= endLine) {
        // 閉じていない
        return false;
      }
      const text = lineText(last);
      if (text.endsWith(DISPLAY)) {
        lines.push(text.slice(0, -DISPLAY.length));
        break;
      }
      lines.push(text);
    }
    content = lines.join("\n");
  }
  if (silent) {
    return true;
  }
  const token = state.push("math_block", "div", 0);
  token.content = content.trim();
  token.markup = DISPLAY;
  token.block = true;
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

/**
 * 数式 (`$...$` と `$$...$$`) を読む plugin. 数式は, ここでは描かない. TeX のまま `class="math"` の要素に入れて,
 * 表示のときに KaTeX で描く (安全にした後に描くので, KaTeX の出すスタイルを消さない).
 *
 * @param md markdown-it
 */
export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math">${escapeHtml(tokens[idx].content)}</span>`;
  md.renderer.rules.math_block = (tokens, idx, _options, _env, self) =>
    `<div class="math math-display"${self.renderAttrs(tokens[idx])}>${escapeHtml(tokens[idx].content)}</div>\n`;
}
