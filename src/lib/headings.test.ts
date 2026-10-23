/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { headingsRule, slugify, tocHtml } from "./headings";

const md = new MarkdownIt();
md.core.ruler.push("headings", headingsRule);

describe("slugify", () => {
  it("joins the words with - and drops the symbols, keeping Japanese", () => {
    expect(slugify(" Hello, World! ")).toBe("Hello-World");
    expect(slugify("見出し 1.2")).toBe("見出し-12");
    expect(slugify("a_b-c")).toBe("a_b-c");
  });

  it("uses heading when nothing is left", () => {
    expect(slugify("!!!")).toBe("heading");
  });
});

describe("tocHtml", () => {
  it("nests the list by the levels", () => {
    expect(
      tocHtml([
        { level: 1, text: "A", id: "A" },
        { level: 2, text: "B", id: "B" },
        { level: 3, text: "C", id: "C" },
        { level: 2, text: "D", id: "D" },
        { level: 1, text: "E", id: "E" },
      ]),
    ).toBe(
      '<div class="toc"><ul><li><a href="#A">A</a><ul><li><a href="#B">B</a><ul><li><a href="#C">C</a>' +
        '</li></ul></li><li><a href="#D">D</a></li></ul></li><li><a href="#E">E</a></li></ul></div>\n',
    );
  });

  it("keeps a shallower heading after a deeper first one in the same list, and escapes", () => {
    expect(
      tocHtml([
        { level: 2, text: "<b>", id: "b c" },
        { level: 1, text: "A", id: "A" },
      ]),
    ).toBe(
      '<div class="toc"><ul><li><a href="#b%20c">&lt;b&gt;</a></li><li><a href="#A">A</a></li></ul></div>\n',
    );
  });

  it("is empty without headings", () => {
    expect(tocHtml([])).toBe("");
  });
});

describe("headingsRule", () => {
  it("adds unique ids from the text, ignoring the marks", () => {
    const html = md.render("# A *b* `c`\n\n# A b c\n\n## A b c");
    expect(html).toContain('<h1 id="A-b-c">');
    expect(html).toContain('<h1 id="A-b-c-1">');
    expect(html).toContain('<h2 id="A-b-c-2">');
  });

  it("replaces only the [TOC] paragraphs", () => {
    const html = md.render("[TOC]\n\ntext [TOC]\n\n# H");
    expect(html).toContain('<div class="toc">');
    expect(html).toContain("<p>text [TOC]</p>");
  });
});
