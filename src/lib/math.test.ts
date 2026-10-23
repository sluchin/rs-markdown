/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { escapeHtml, mathPlugin } from "./math";

const md = new MarkdownIt().use(mathPlugin);

describe("escapeHtml", () => {
  it("escapes the special characters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("mathPlugin (inline)", () => {
  it("reads $...$ as math", () => {
    expect(md.renderInline("a $x+1$ b")).toBe('a <span class="math">x+1</span> b');
    expect(md.renderInline(String.raw`$\$5$`)).toBe(String.raw`<span class="math">\$5</span>`);
  });

  it("leaves dollars that are not math", () => {
    for (const text of [
      "$ x$", // 開いた直後が空白
      "$x $", // 閉じる直前が空白
      "$5 and $6", // 閉じる直後が数字
      "$x", // 閉じていない
      "$", // 何もない
      "$$x$$", // 二つ続く (文中では, 数式にしない)
      String.raw`$x\$`, // 閉じる `$` が文字
    ]) {
      expect(md.renderInline(text)).not.toContain("math");
    }
  });

  it("keeps the text when it only checks (in a link text)", () => {
    expect(md.render("[$x$](https://example.com)")).toContain('<span class="math">x</span>');
  });
});

describe("mathPlugin (block)", () => {
  it("reads $$ blocks on one line or many lines", () => {
    expect(md.render("$$ x^2 $$")).toBe('<div class="math math-display">x^2</div>\n');
    expect(md.render("$$\na\nb\n$$\nafter")).toBe(
      '<div class="math math-display">a\nb</div>\n<p>after</p>\n',
    );
    expect(md.render("$$a\nb$$")).toBe('<div class="math math-display">a\nb</div>\n');
  });

  it("leaves blocks that are not closed, indented as code, or not $$", () => {
    expect(md.render("$$\nx")).not.toContain("math");
    expect(md.render("    $$x$$")).toContain("<pre><code>");
    expect(md.render("$x$")).toBe('<p><span class="math">x</span></p>\n');
  });

  it("ends a paragraph with a $$ block", () => {
    expect(md.render("text\n$$x$$")).toBe('<p>text</p>\n<div class="math math-display">x</div>\n');
  });
});
