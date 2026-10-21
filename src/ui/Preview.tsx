/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { type MouseEvent, useDeferredValue, useMemo } from "react";
import { linkAction } from "../lib/links";
import { log } from "../lib/log";
import { renderMarkdown } from "../lib/markdown";

/** 表示の引数. */
interface Props {
  /** Markdown. */
  content: string;
}

/**
 * リンクを押したときに, ブラウザで開くか, 見出しへ移る (アプリの中では, ほかのページを開かない).
 *
 * @param event クリック
 */
function onClick(event: MouseEvent<HTMLDivElement>) {
  const anchor = (event.target as Element).closest("a");
  if (!anchor) {
    return;
  }
  event.preventDefault();
  const action = linkAction(anchor.getAttribute("href"));
  if (action.kind === "external") {
    openUrl(action.url).catch((e: unknown) => log.warn("Could not open the link:", e));
  } else if (action.kind === "anchor") {
    document.getElementById(action.id)?.scrollIntoView();
  }
}

/**
 * Markdown の表示. HTML は {@link renderMarkdown} で安全にしたもの.
 *
 * @param props 引数
 * @returns 画面
 */
export function Preview({ content }: Props) {
  // 書いているあいだは, 表示を後回しにする (入力を遅くしない)
  const deferred = useDeferredValue(content);
  const html = useMemo(() => renderMarkdown(deferred), [deferred]);
  return (
    <div
      className="preview markdown-body"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
