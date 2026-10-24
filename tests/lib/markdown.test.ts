/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
  frontMatterLines,
  highlight,
  renderMarkdown,
  sanitize,
  sourceLines,
  stripFrontMatter,
} from "@/lib/markdown";

/**
 * HTML を, 文書にする.
 *
 * @param html HTML
 * @returns 文書
 */
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("stripFrontMatter", () => {
  it("removes the YAML at the top", () => {
    expect(stripFrontMatter("---\ntitle: a\n---\n# H")).toBe("# H");
    expect(stripFrontMatter("---\r\ntags: x\r\n---")).toBe("");
  });

  it("keeps a rule that is not at the top", () => {
    expect(stripFrontMatter("# H\n---\nx\n---\n")).toBe("# H\n---\nx\n---\n");
  });
});

describe("frontMatterLines", () => {
  it("counts the lines of the YAML at the top", () => {
    expect(frontMatterLines("---\ntitle: x\n---\nbody")).toBe(3);
    expect(frontMatterLines("---\ntitle: x\n---")).toBe(3);
    expect(frontMatterLines("body")).toBe(0);
  });
});

describe("highlight", () => {
  it("colors a known language", () => {
    expect(highlight("let a = 1;", "js")).toContain("hljs-keyword");
  });

  it("leaves an unknown or missing language", () => {
    expect(highlight("x", "no-such-language")).toBe("");
    expect(highlight("x", "")).toBe("");
  });
});

describe("sanitize", () => {
  it("removes scripts, styles and event handlers", () => {
    const html = sanitize(
      '<p style="color:red" onclick="x()">a</p><script>x()</script><style>p{}</style><iframe></iframe>',
    );
    expect(html).toBe("<p>a</p>");
  });
});

describe("renderMarkdown", () => {
  it("renders headings, tables and line breaks", () => {
    const html = renderMarkdown("# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nline1\nline2");
    expect(parse(html).querySelector("h1")?.textContent).toBe("Title");
    expect(html).toContain('<table data-source-line="3">');
    expect(html).toContain("line1<br>");
  });

  it("links bare URLs", () => {
    expect(renderMarkdown("see https://example.com")).toContain('href="https://example.com"');
  });

  it("removes the front matter and unsafe HTML", () => {
    const html = renderMarkdown('---\ntitle: x\n---\n<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("title: x");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript');
    expect(renderMarkdown("[a](javascript:alert(1))")).not.toContain("href=");
  });

  it("colors fenced code", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toContain("hljs-keyword");
    expect(renderMarkdown("```\nplain\n```")).toContain(
      '<code data-source-line="1">plain\n</code>',
    );
  });

  it("renders task lists as checkboxes in the items with the source lines", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done\n- [X] Done\n- plain");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const boxes = [...doc.querySelectorAll("input.task")] as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true]);
    expect(boxes.some((box) => box.disabled)).toBe(false);
    // 押したときに, 項目の元の行を探せる
    expect(
      boxes.map((box) => box.closest("[data-source-line]")?.getAttribute("data-source-line")),
    ).toEqual(["1", "2", "3"]);
    expect(doc.querySelectorAll("li.task-item")).toHaveLength(3);
    expect(doc.body.textContent).toContain("todo");
    expect(doc.body.textContent).not.toContain("[ ]");
  });

  it("leaves brackets that are not tasks", () => {
    // 項目の先頭でない, 段落の中の印は, そのまま
    expect(renderMarkdown("[ ] not a list")).toContain("[ ] not a list");
    // 先頭が文字でない (強調) ときは, そのまま
    expect(renderMarkdown("- **[ ] bold**")).not.toContain("checkbox");
    // 印のない項目
    expect(renderMarkdown("- [y] other")).not.toContain("checkbox");
  });
});

describe("renderMarkdown (HackMD)", () => {
  it("renders marks, inserts, subscripts, superscripts, emoji and footnotes", () => {
    const html = renderMarkdown("==mark== ++ins++ H~2~O x^2^ :smile: note[^1]\n\n[^1]: foot");
    expect(html).toContain("<mark>mark</mark>");
    expect(html).toContain("<ins>ins</ins>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("😄");
    expect(parse(html).querySelector(".footnotes")?.textContent).toContain("foot");
  });

  it("renders the alert blocks and the spoiler", () => {
    const doc = parse(
      renderMarkdown(
        ":::info\nhi\n:::\n\n:::danger\nno\n:::\n\n:::spoiler Answer\nsecret\n:::\n\n:::spoiler\nx\n:::",
      ),
    );
    expect(doc.querySelector(".alert.alert-info")?.textContent).toContain("hi");
    expect(doc.querySelector(".alert.alert-danger")?.textContent).toContain("no");
    const summaries = [...doc.querySelectorAll("details.spoiler > summary")];
    expect(summaries.map((s) => s.textContent)).toEqual(["Answer", "Spoiler"]);
    expect(doc.querySelector("details")?.textContent).toContain("secret");
  });

  it("leaves the math and the Mermaid source for the view to draw", () => {
    const doc = parse(renderMarkdown("$a<b$\n\n$$\nx^2\n$$\n\n```mermaid\ngraph TD; A-->B\n```"));
    expect(doc.querySelector("span.math")?.textContent).toBe("a<b");
    expect(doc.querySelector("div.math-display")?.textContent).toBe("x^2");
    expect(doc.querySelector("div.mermaid")?.textContent).toBe("graph TD; A-->B\n");
  });

  it("adds ids to the headings and replaces [TOC] with the table of contents", () => {
    const doc = parse(renderMarkdown("[TOC]\n\n# One\n\n## Two"));
    expect(doc.querySelector("h1")?.id).toBe("One");
    expect([...doc.querySelectorAll(".toc a")].map((a) => a.getAttribute("href"))).toEqual([
      "#One",
      "#Two",
    ]);
  });

  it("marks the blocks with their source lines, counting the front matter", () => {
    const doc = parse(renderMarkdown("---\ntitle: x\n---\n# A\n\ntext\n\n```\ncode\n```\n\n---"));
    const lines = [...doc.querySelectorAll("[data-source-line]")].map((element) => [
      element.tagName,
      element.getAttribute("data-source-line"),
    ]);
    expect(lines).toEqual([
      ["H1", "4"],
      ["P", "6"],
      ["CODE", "8"],
      ["HR", "12"],
    ]);
  });
});

describe("sourceLines", () => {
  it("counts from the first line without the offset", () => {
    const md = new MarkdownIt();
    md.core.ruler.push("source_lines", sourceLines);
    expect(md.render("a\n\nb")).toBe(
      '<p data-source-line="1">a</p>\n<p data-source-line="3">b</p>\n',
    );
  });
});
