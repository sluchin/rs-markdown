/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  displayTitle,
  fileName,
  fileSyncLabel,
  filterNotes,
  formatDate,
  syncLabel,
  type SyncState,
} from "./notes";

describe("displayTitle", () => {
  it("names an empty title", () => {
    expect(displayTitle("")).toBe("無題");
    expect(displayTitle("  ")).toBe("無題");
    expect(displayTitle("Note")).toBe("Note");
  });
});

describe("filterNotes", () => {
  const notes = [{ title: "Rust memo" }, { title: "旅行" }, { title: "" }];

  it("filters by the title ignoring the case", () => {
    expect(filterNotes(notes, "rust")).toEqual([{ title: "Rust memo" }]);
    expect(filterNotes(notes, "無題")).toEqual([{ title: "" }]);
  });

  it("keeps all for an empty query", () => {
    const all = filterNotes(notes, " ");
    expect(all).toEqual(notes);
    expect(all).not.toBe(notes);
  });
});

describe("formatDate", () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();

  it("shows the time for today", () => {
    expect(formatDate(new Date(2026, 9, 21, 9, 5).getTime(), now)).toBe("09:05");
  });

  it("shows the month and the day for this year", () => {
    expect(formatDate(new Date(2026, 0, 2, 3, 4).getTime(), now)).toBe("1/2 03:04");
  });

  it("shows the year for older dates", () => {
    expect(formatDate(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("2025/12/31");
  });
});

describe("syncLabel", () => {
  it("describes every state", () => {
    const states: SyncState[] = ["unlinked", "synced", "localChanged", "remoteChanged", "conflict"];
    const labels = states.map(syncLabel);
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe("fileSyncLabel", () => {
  it("describes every state", () => {
    const states: SyncState[] = ["unlinked", "synced", "localChanged", "remoteChanged", "conflict"];
    const labels = states.map(fileSyncLabel);
    expect(new Set(labels).size).toBe(states.length);
    expect(fileSyncLabel("localChanged")).toContain("ファイルに保存");
  });
});

describe("fileName", () => {
  it("takes the last part of the path", () => {
    expect(fileName("/home/a/b.md")).toBe("b.md");
    expect(fileName("C:\\Users\\a\\b.md")).toBe("b.md");
    expect(fileName("b.md")).toBe("b.md");
  });
});
