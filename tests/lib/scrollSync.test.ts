/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { interpolate, lineForTop, normalizeAnchors, topForLine } from "@/lib/scrollSync";

const ANCHORS = [
  { line: 1, top: 0 },
  { line: 11, top: 100 },
  { line: 21, top: 300 },
];

describe("normalizeAnchors", () => {
  it("sorts by the line and drops the anchors that go back or repeat a line", () => {
    expect(
      normalizeAnchors([
        { line: 5, top: 50 },
        { line: 1, top: 0 },
        { line: 5, top: 60 },
        { line: 7, top: 40 },
        { line: 9, top: 90 },
      ]),
    ).toEqual([
      { line: 1, top: 0 },
      { line: 5, top: 50 },
      { line: 9, top: 90 },
    ]);
  });
});

describe("interpolate", () => {
  it("joins the points with lines and keeps the ends outside", () => {
    expect(interpolate([0, 10], [0, 100], 5)).toBe(50);
    expect(interpolate([0, 10], [0, 100], -1)).toBe(0);
    expect(interpolate([0, 10], [0, 100], 20)).toBe(100);
    expect(interpolate([], [], 3)).toBe(0);
  });

  it("uses the first of the points that share x", () => {
    expect(interpolate([0, 5, 5, 10], [0, 1, 2, 3], 5)).toBe(1);
    expect(interpolate([5, 5], [1, 2], 5)).toBe(1);
    expect(interpolate([0, 5, 5], [0, 1, 2], 6)).toBe(2);
  });
});

describe("topForLine and lineForTop", () => {
  it("map the lines and the positions both ways", () => {
    expect(topForLine(ANCHORS, 16)).toBe(200);
    expect(lineForTop(ANCHORS, 200)).toBe(16);
    expect(lineForTop(ANCHORS, 50)).toBe(6);
  });
});
