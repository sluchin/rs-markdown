/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LintError } from "markdownlint";
import { describe, expect, it } from "vitest";
import { type LintResult, lintMarkdown, lintMessage, textChange } from "@/lib/lint";
import type { TextChange } from "@/lib/tasks";

/**
 * 書き換えを本文に当てる.
 *
 * @param source 本文
 * @param change 書き換え (なければ, そのまま)
 * @returns 書き換えた本文
 */
function apply(source: string, change: TextChange | undefined): string {
  return change === undefined
    ? source
    : source.slice(0, change.from) + change.insert + source.slice(change.to);
}

/**
 * 指摘を作る (lintMessage が使うところだけ).
 *
 * @param lineNumber 行
 * @param rule 規則の名前
 * @returns 指摘
 */
function error(lineNumber: number, rule: string): LintError {
  return {
    lineNumber,
    ruleNames: [rule],
    ruleDescription: "説明",
    ruleInformation: "",
    errorDetail: "",
    errorContext: "",
    errorRange: [],
  };
}

describe("lintMarkdown", () => {
  it("直せるところを markdownlint の --fix と同じに直す", () => {
    const source = "#見出し\n本文   \n\n\n* a\n+ b\n";
    const result = lintMarkdown(source);
    expect(apply(source, result.change)).toBe("# 見出し\n\n本文\n\n* a\n* b\n");
    expect(result.fixed).toBeGreaterThan(0);
    expect(result.remaining).toEqual([]);
  });

  it("整った本文は変えない", () => {
    const result = lintMarkdown("# 見出し\n\n本文\n");
    expect(result).toEqual({ change: undefined, fixed: 0, remaining: [] });
  });

  it("直せない指摘は残す", () => {
    const result = lintMarkdown("# 一\n\n# 二\n");
    expect(result.change).toBeUndefined();
    expect(result.remaining.map((e) => e.ruleNames[0])).toEqual(["MD025"]);
  });

  it("直したあとの残りを数え直す", () => {
    const source = "# 一\n# 二\n";
    const result = lintMarkdown(source);
    expect(apply(source, result.change)).toBe("# 一\n\n# 二\n");
    expect(result.remaining.map((e) => e.ruleNames[0])).toEqual(["MD025"]);
  });

  it("ノートに合わない規則は使わない (長い行, HTML, URL, 最初の行)", () => {
    const source = `本文 ${"あ".repeat(200)}\n\n<b>太字</b> https://example.com\n`;
    expect(lintMarkdown(source).remaining).toEqual([]);
  });
});

describe("lintMessage", () => {
  const changed: LintResult = { change: { from: 0, to: 0, insert: "" }, fixed: 2, remaining: [] };

  it("直した数を出す", () => {
    expect(lintMessage(changed)).toBe("整形しました (2 か所)。");
  });

  it("変えるところがないと出す", () => {
    expect(lintMessage({ fixed: 0, remaining: [] })).toBe("整形するところはありません。");
  });

  it("残った指摘を 3 つまで出す", () => {
    const remaining = [error(1, "MD025"), error(4, "MD001")];
    expect(lintMessage({ ...changed, remaining })).toBe(
      "整形しました (2 か所)。直せない指摘が 2 件あります (1 行目 MD025 説明、4 行目 MD001 説明)。",
    );
    const many = [1, 2, 3, 4].map((line) => error(line, "MD025"));
    expect(lintMessage({ fixed: 0, remaining: many })).toBe(
      "整形するところはありません。直せない指摘が 4 件あります (1 行目 MD025 説明、2 行目 MD025 説明、3 行目 MD025 説明 ほか)。",
    );
  });
});

describe("textChange", () => {
  it("同じなら書き換えない", () => {
    expect(textChange("abc", "abc")).toBeUndefined();
  });

  it("違うところだけを書き換える", () => {
    expect(textChange("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(textChange("abc", "abcd")).toEqual({ from: 3, to: 3, insert: "d" });
    expect(textChange("abcd", "abc")).toEqual({ from: 3, to: 4, insert: "" });
    expect(textChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(textChange("", "x")).toEqual({ from: 0, to: 0, insert: "x" });
  });
});
