/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { errorMessage, isCommandError } from "./errors";

describe("isCommandError", () => {
  it("accepts the command error", () => {
    expect(isCommandError({ kind: "io", message: "x" })).toBe(true);
  });

  it("rejects other values", () => {
    expect(isCommandError(null)).toBe(false);
    expect(isCommandError("text")).toBe(false);
    expect(isCommandError({ kind: 1, message: "x" })).toBe(false);
    expect(isCommandError({ kind: "io" })).toBe(false);
  });
});

describe("errorMessage", () => {
  it("uses the message for the kind", () => {
    expect(errorMessage({ kind: "noToken", message: "x" })).toContain("トークン");
    expect(errorMessage({ kind: "conflict", message: "x" })).toContain("両方");
    expect(errorMessage({ kind: "invalidImage", message: "x" })).toContain("PNG");
    expect(errorMessage({ kind: "invalidFile", message: "x" })).toContain("Markdown");
    expect(errorMessage({ kind: "fileConflict", message: "x" })).toContain("元のファイル");
    expect(errorMessage({ kind: "fileNotFound", message: "x" })).toContain("見つかりません");
  });

  it("falls back to the English message", () => {
    expect(errorMessage({ kind: "other", message: "HTTP 500" })).toBe("失敗しました: HTTP 500");
    expect(errorMessage(new Error("boom"))).toBe("失敗しました: Error: boom");
  });
});
