/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { baseName, imageMarkdown, isImageType, localImageName } from "@/lib/images";

const NAME = "0f8fad5b-d9cb-469f-a165-70867728950e.png";

describe("localImageName", () => {
  it("returns the name of an image in the app data", () => {
    expect(localImageName(`images/${NAME}`)).toBe(NAME);
  });

  it("ignores other sources", () => {
    expect(localImageName(null)).toBeUndefined();
    expect(localImageName("https://example.com/a.png")).toBeUndefined();
    expect(localImageName("images/../secret.png")).toBeUndefined();
    expect(localImageName("images/0f8fad5b-d9cb-469f-a165-70867728950e.svg")).toBeUndefined();
  });
});

describe("imageMarkdown", () => {
  it("writes the image with the description, without brackets", () => {
    expect(imageMarkdown(NAME, "a [b]")).toBe(`![a b](images/${NAME})`);
    expect(imageMarkdown(NAME)).toBe(`![](images/${NAME})`);
  });
});

describe("isImageType", () => {
  it("accepts the image types", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("text/plain")).toBe(false);
  });
});

describe("baseName", () => {
  it("returns the file name without the extension", () => {
    expect(baseName("/home/u/photo.jpg")).toBe("photo");
    expect(baseName("C:\\Users\\u\\a.b.png")).toBe("a.b");
    expect(baseName(".hidden")).toBe(".hidden");
    expect(baseName("noext")).toBe("noext");
  });
});
