/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 表示の中のリンクを押したときに, すること. */
export type LinkAction =
  /** ブラウザで開く (`url`). */
  | { kind: "external"; url: string }
  /** 表示の中の見出しへ移る (`id`). */
  | { kind: "anchor"; id: string }
  /** 何もしない (ほかの形の URL. アプリの中では開かない). */
  | { kind: "ignore" };

/**
 * リンクの `href` から, することを決める. ブラウザで開くのは, `http`, `https`, `mailto` だけ.
 *
 * @param href リンクの `href` (属性のまま)
 * @returns すること
 */
export function linkAction(href: string | null): LinkAction {
  if (!href) {
    return { kind: "ignore" };
  }
  if (href.startsWith("#")) {
    return href.length > 1
      ? { kind: "anchor", id: decodeURIComponent(href.slice(1)) }
      : { kind: "ignore" };
  }
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? { kind: "external", url: url.href }
      : { kind: "ignore" };
  } catch {
    return { kind: "ignore" };
  }
}
