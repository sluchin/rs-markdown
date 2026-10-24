/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { type Edit, FORMAT_BUTTONS, type FormatCommand, formatEdit } from "@/lib/format";

/**
 * 書き換えを本文に当てて, 選ぶ範囲を `«` と `»` で示した本文を返す.
 *
 * @param doc 本文. 選ぶ範囲を `«` と `»` で示す (`«` だけならカーソル).
 * @param command 操作
 * @returns 書き換えた本文 (選ぶ範囲を `«` と `»` で示す)
 */
function apply(doc: string, command: FormatCommand): string {
  const from = doc.indexOf("«");
  const close = doc.indexOf("»", from);
  const to = close === -1 ? from : close - 1;
  const plain = doc.replace("«", "").replace("»", "");
  const edit: Edit = formatEdit(plain, { from, to }, command);
  const result = plain.slice(0, edit.from) + edit.insert + plain.slice(edit.to);
  const { from: a, to: b } = edit.selection;
  return a === b
    ? `${result.slice(0, a)}«${result.slice(a)}`
    : `${result.slice(0, a)}«${result.slice(a, b)}»${result.slice(b)}`;
}

describe("FORMAT_BUTTONS", () => {
  it("has one button for each command, with unique keys", () => {
    const commands = FORMAT_BUTTONS.map((button) => button.command);
    expect(new Set(commands).size).toBe(commands.length);
    const keys = FORMAT_BUTTONS.flatMap((button) => (button.key ? [button.key] : []));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("formatEdit (wrap)", () => {
  it("wraps the selection, or puts the cursor between the marks", () => {
    expect(apply("a «b» c", "bold")).toBe("a **«b»** c");
    expect(apply("a «b» c", "italic")).toBe("a *«b»* c");
    expect(apply("a «b» c", "strike")).toBe("a ~~«b»~~ c");
    expect(apply("a «b» c", "code")).toBe("a `«b»` c");
    expect(apply("a « c", "bold")).toBe("a **«** c");
  });

  it("unwraps the marks outside or at both ends of the selection", () => {
    expect(apply("a **«b»** c", "bold")).toBe("a «b» c");
    expect(apply("a «**b**» c", "bold")).toBe("a «b» c");
    expect(apply("«*b*»", "italic")).toBe("«b»");
  });

  it("does not take another mark (** for *) as the same mark", () => {
    expect(apply("**«b»**", "italic")).toBe("***«b»***");
    expect(apply("«**»", "bold")).toBe("**«**»**");
  });
});

describe("formatEdit (lines)", () => {
  it("adds the marks to every selected line, and removes them when all have them", () => {
    expect(apply("«a\nb»", "bullet")).toBe("«- a\n- b»");
    expect(apply("«- a\n- b»", "bullet")).toBe("«a\nb»");
    expect(apply("x\n«a\nb»\ny", "ordered")).toBe("x\n«1. a\n2. b»\ny");
    expect(apply("«a»", "task")).toBe("«- [ ] a»");
    expect(apply("«- [x] a»", "task")).toBe("«a»");
    expect(apply("«a\n> b»", "quote")).toBe("«> a\n> > b»");
    expect(apply("«> a\n>b»", "quote")).toBe("«a\nb»");
  });

  it("changes the kind of the list", () => {
    expect(apply("«- a\n1. b»", "ordered")).toBe("«1. a\n2. b»");
    expect(apply("«- [ ] a»", "bullet")).toBe("«- a»");
  });
});

describe("formatEdit (heading)", () => {
  it("makes the heading one level deeper, and removes it after six", () => {
    expect(apply("a\nb«c", "heading")).toBe("a\n# b«c");
    expect(apply("# t«", "heading")).toBe("## t«");
    expect(apply("###### «t»", "heading")).toBe("«t»");
  });

  it("keeps the cursor in the line when the marks before it are removed", () => {
    expect(apply("##«#### t", "heading")).toBe("«t");
  });
});

describe("formatEdit (links and blocks)", () => {
  it("uses the selection as the text of a link or an image, and selects the URL", () => {
    expect(apply("see «here»", "link")).toBe("see [here](«https://»)");
    expect(apply("«", "image")).toBe("![](«https://»)");
  });

  it("puts the selection into a code block", () => {
    expect(apply("«x»", "codeBlock")).toBe("```\n«x»\n```");
    expect(apply("a «x» b", "codeBlock")).toBe("a \n\n```\n«x»\n```\n\n b");
  });

  it("separates a table and a rule from the paragraphs with blank lines", () => {
    expect(apply("text\n«", "table")).toBe(
      "text\n\n| «列 1» | 列 2 |\n| ---- | ---- |\n| 文字 | 文字 |",
    );
    expect(apply("text«\n\nnext", "rule")).toBe("text\n\n---«\n\nnext");
  });
});
