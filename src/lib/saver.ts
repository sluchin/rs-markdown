/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 書いているあいだ待ってから保存する仕組み. */
export interface Saver {
  /**
   * 保存する内容を渡す. 最後に渡してから `delay` ミリ秒たったら, 保存する.
   *
   * @param content 内容
   */
  change: (content: string) => void;
  /**
   * 待っている内容があれば, すぐに保存する (ノートを切り替えるとき, 閉じるとき).
   *
   * @returns 保存が終わったら, 解決する
   */
  flush: () => Promise<void>;
  /** 待っている内容があるか. */
  pending: () => boolean;
  /** 待っている内容を捨てる (ノートを消したとき). */
  cancel: () => void;
}

/**
 * 書いているあいだ待ってから保存する仕組みを作る. 保存は 1 つずつ行う (前の保存が終わってから, 次を始める).
 *
 * @param save 保存する関数
 * @param delay 待つ時間 (ミリ秒)
 * @param onError 保存に失敗したときに呼ぶ
 * @returns 仕組み
 */
export function createSaver(
  save: (content: string) => Promise<void>,
  delay: number,
  onError: (error: unknown) => void,
): Saver {
  let waiting: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const content = waiting;
    waiting = undefined;
    if (content !== undefined) {
      running = running.then(() => save(content)).catch(onError);
    }
    return running;
  };

  return {
    change: (content) => {
      waiting = content;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    pending: () => waiting !== undefined,
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
      waiting = undefined;
    },
  };
}
