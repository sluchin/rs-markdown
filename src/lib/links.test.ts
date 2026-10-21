/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { linkAction } from "./links";

describe("linkAction", () => {
  it("opens web and mail links in the browser", () => {
    expect(linkAction("https://example.com/a")).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
    expect(linkAction("http://example.com")).toEqual({
      kind: "external",
      url: "http://example.com/",
    });
    expect(linkAction("mailto:a@example.com").kind).toBe("external");
  });

  it("moves to anchors", () => {
    expect(linkAction("#%E8%A6%8B%E5%87%BA%E3%81%97")).toEqual({ kind: "anchor", id: "見出し" });
    expect(linkAction("#")).toEqual({ kind: "ignore" });
  });

  it("ignores other links", () => {
    expect(linkAction(null)).toEqual({ kind: "ignore" });
    expect(linkAction("")).toEqual({ kind: "ignore" });
    expect(linkAction("javascript:alert(1)")).toEqual({ kind: "ignore" });
    expect(linkAction("file:///etc/passwd")).toEqual({ kind: "ignore" });
    expect(linkAction("relative/page")).toEqual({ kind: "ignore" });
  });
});
