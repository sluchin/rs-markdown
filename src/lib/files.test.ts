/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { isFilePath, isMarkdownPath, splitDropped } from "./files";

describe("isMarkdownPath", () => {
  it("accepts the Markdown and text files by the extension", () => {
    expect(isMarkdownPath("/home/u/note.md")).toBe(true);
    expect(isMarkdownPath("C:\\Users\\u\\Note.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("memo.txt")).toBe(true);
  });

  it("rejects the other files", () => {
    expect(isMarkdownPath("/home/u/a.png")).toBe(false);
    expect(isMarkdownPath("/home/u/README")).toBe(false);
    expect(isMarkdownPath("/home/u/.md")).toBe(false);
    expect(isMarkdownPath("/home/u/dir.md/")).toBe(false);
  });
});

describe("isFilePath", () => {
  it("accepts the paths and rejects the URLs", () => {
    expect(isFilePath("/home/u/a.md")).toBe(true);
    expect(isFilePath("C:\\Users\\u\\a.md")).toBe(true);
    expect(isFilePath("content://com.android.providers/document/1")).toBe(false);
  });
});

describe("splitDropped", () => {
  it("splits the dropped files into the notes and the others", () => {
    expect(splitDropped(["/a.md", "/b.png", "/c.txt", "/d"])).toEqual({
      notes: ["/a.md", "/c.txt"],
      others: ["/b.png", "/d"],
    });
  });
});
