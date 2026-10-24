/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { applyChange, toggleTask } from "@/lib/tasks";

/**
 * 行の印を切り替えた本文を返す.
 *
 * @param source 本文
 * @param line 行 (1 から)
 * @returns 切り替えた本文. 作業の一覧でなければ, `undefined`.
 */
function toggled(source: string, line: number): string | undefined {
  const change = toggleTask(source, line);
  return change && applyChange(source, change);
}

describe("toggleTask", () => {
  it("checks and unchecks the task on the line", () => {
    expect(toggled("# t\n- [ ] a\n- [x] b", 2)).toBe("# t\n- [x] a\n- [x] b");
    expect(toggled("# t\n- [ ] a\n- [x] b", 3)).toBe("# t\n- [ ] a\n- [ ] b");
    expect(toggled("- [X] c", 1)).toBe("- [ ] c");
  });

  it("finds the tasks with other list marks, numbers, indentation and quotes", () => {
    expect(toggled("* [ ] a", 1)).toBe("* [x] a");
    expect(toggled("+ [ ] a", 1)).toBe("+ [x] a");
    expect(toggled("12. [ ] a", 1)).toBe("12. [x] a");
    expect(toggled("1) [ ] a", 1)).toBe("1) [x] a");
    expect(toggled("- a\n    - [ ] b", 2)).toBe("- a\n    - [x] b");
    expect(toggled("> - [ ] a", 1)).toBe("> - [x] a");
  });

  it("keeps the CR of a CRLF line", () => {
    expect(toggled("- [ ] a\r\n- [ ] b", 2)).toBe("- [ ] a\r\n- [x] b");
  });

  it("returns nothing for the lines that are not tasks or out of range", () => {
    expect(toggleTask("- a\n[ ] b\n-[ ] c", 1)).toBeUndefined();
    expect(toggleTask("- a\n[ ] b\n-[ ] c", 2)).toBeUndefined();
    expect(toggleTask("- a\n[ ] b\n-[ ] c", 3)).toBeUndefined();
    expect(toggleTask("- [ ] a", 0)).toBeUndefined();
    expect(toggleTask("- [ ] a", 2)).toBeUndefined();
  });
});
