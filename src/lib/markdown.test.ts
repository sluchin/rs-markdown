/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { highlight, renderMarkdown, sanitize, stripFrontMatter } from "./markdown";

describe("stripFrontMatter", () => {
  it("removes the YAML at the top", () => {
    expect(stripFrontMatter("---\ntitle: a\n---\n# H")).toBe("# H");
    expect(stripFrontMatter("---\r\ntags: x\r\n---")).toBe("");
  });

  it("keeps a rule that is not at the top", () => {
    expect(stripFrontMatter("# H\n---\nx\n---\n")).toBe("# H\n---\nx\n---\n");
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
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<table>");
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
    expect(renderMarkdown("```\nplain\n```")).toContain("<code>plain\n</code>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done\n- [X] Done\n- plain");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const boxes = [...doc.querySelectorAll("input.task")] as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true]);
    expect(boxes.every((box) => box.disabled)).toBe(true);
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
