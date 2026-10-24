/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver } from "@/lib/saver";

describe("createSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the last content after the delay", async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createSaver(save, 1000, vi.fn());
    saver.change("a");
    saver.change("ab");
    expect(saver.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("ab");
    expect(saver.pending()).toBe(false);
  });

  it("saves at once on flush", async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createSaver(save, 1000, vi.fn());
    saver.change("a");
    await saver.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("a");
    // 待っている内容がなければ, 保存しない
    await saver.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves one at a time", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const save = vi.fn(
      (content: string) =>
        new Promise<void>((resolve) => {
          order.push(`start ${content}`);
          release = () => {
            order.push(`end ${content}`);
            resolve();
          };
        }),
    );
    const saver = createSaver(save, 10, vi.fn());
    saver.change("a");
    const first = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.change("b");
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["start a"]);
    release();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    release();
    await second;
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("reports a failure and keeps working", async () => {
    const onError = vi.fn();
    const save = vi
      .fn<(content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const saver = createSaver(save, 10, onError);
    saver.change("a");
    await saver.flush();
    expect(onError).toHaveBeenCalledWith(new Error("disk"));
    saver.change("b");
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith("b");
  });

  it("drops the waiting content on cancel", async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createSaver(save, 10, vi.fn());
    saver.change("a");
    saver.cancel();
    expect(saver.pending()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
