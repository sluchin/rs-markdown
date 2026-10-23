/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { Mermaid } from "mermaid";
import {
  type MouseEvent,
  type Ref,
  useDeferredValue,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { localImageName } from "../lib/images";
import { linkAction } from "../lib/links";
import { log } from "../lib/log";
import { renderMarkdown } from "../lib/markdown";

/** 表示の引数. */
interface Props {
  /** Markdown. */
  content: string;
  /** 画像を置くディレクトリ (`images/<名前>` の画像を読む). 分かるまでは `undefined`. */
  imagesDir: string | undefined;
  /** 動かしたときに呼ぶ. */
  onScroll: () => void;
  /** 動かす範囲の要素 (エディタと位置を合わせるのに使う). */
  scroller: Ref<HTMLDivElement>;
  /** 作業の一覧のチェックボックスを押したときに, 項目の元の行 (1 から) を渡して呼ぶ. */
  onToggleTask: (line: number) => void;
}

/** 描いた図を覚えておく数 (同じ図を描き直さない). */
const MAX_CACHED_DIAGRAMS = 50;

/** 描いた図 (Mermaid の文 → SVG). */
const diagrams = new Map<string, string>();

/** Mermaid (大きいので, 図があるときに読む). */
let mermaidLoader: Promise<Mermaid> | undefined;

/** 図の要素の番号 (Mermaid に渡す `id`). */
let diagramCount = 0;

/**
 * リンクを押したときに, ブラウザで開くか, 見出しへ移る (アプリの中では, ほかのページを開かない).
 * 作業の一覧のチェックボックスを押したときは, 項目の元の行を知らせる.
 *
 * @param event クリック
 * @param onToggleTask チェックボックスを押したときに呼ぶ関数
 */
function onClick(event: MouseEvent<HTMLDivElement>, onToggleTask: (line: number) => void) {
  const target = event.target as Element;
  if (target.matches("input.task")) {
    // 表示は, 本文を書き換えた後に描き直す (ここでは, 印を変えない)
    event.preventDefault();
    const line = target.closest<HTMLElement>("[data-source-line]")?.dataset.sourceLine;
    if (line) {
      onToggleTask(Number(line));
    }
    return;
  }
  const anchor = target.closest("a");
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
 * アプリのデータの画像 (`images/<名前>`) を, 読める URL にする.
 *
 * @param root 表示
 * @param dir 画像を置くディレクトリ
 */
function drawImages(root: HTMLElement, dir: string | undefined) {
  if (!dir) {
    return;
  }
  const separator = dir.includes("\\") ? "\\" : "/";
  for (const image of root.querySelectorAll("img")) {
    const name = localImageName(image.getAttribute("src"));
    if (name) {
      image.src = convertFileSrc(`${dir}${separator}${name}`);
    }
  }
}

/**
 * 数式 (`class="math"`. 中身は TeX) を, KaTeX で描く. TeX の誤りは, 赤い文字で出す.
 *
 * @param root 表示
 */
function drawMath(root: HTMLElement) {
  for (const element of root.querySelectorAll<HTMLElement>(".math")) {
    katex.render(element.textContent ?? "", element, {
      displayMode: element.classList.contains("math-display"),
      throwOnError: false,
      // \href などで, リンクやスタイルを作らせない
      trust: false,
    });
  }
}

/**
 * Mermaid を読む (1 回だけ). 文から作る要素は, Mermaid が安全にする (`securityLevel: "strict"`).
 *
 * @returns Mermaid
 */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
    });
    return mermaid;
  });
  return mermaidLoader;
}

/**
 * Mermaid の図 (`class="mermaid"`. 中身は図の文) を描く. 描けなければ, 理由と文を出す.
 *
 * @param root 表示
 * @param cancelled 表示が変わって, 描くのをやめるなら, true を返す関数
 */
async function drawDiagrams(root: HTMLElement, cancelled: () => boolean) {
  const nodes = [...root.querySelectorAll<HTMLElement>("div.mermaid")];
  if (nodes.length === 0) {
    return;
  }
  const mermaid = await loadMermaid();
  for (const node of nodes) {
    const source = node.textContent ?? "";
    let svg = diagrams.get(source);
    if (svg === undefined) {
      try {
        diagramCount += 1;
        svg = (await mermaid.render(`mermaid-${diagramCount}`, source)).svg;
      } catch (e) {
        if (!cancelled()) {
          node.classList.add("mermaid-error");
          node.textContent = `図を描けません: ${String(e)}\n\n${source}`;
        }
        continue;
      }
      if (diagrams.size >= MAX_CACHED_DIAGRAMS) {
        diagrams.delete(diagrams.keys().next().value as string);
      }
      diagrams.set(source, svg);
    }
    if (cancelled()) {
      return;
    }
    node.innerHTML = svg;
  }
}

/**
 * Markdown の表示. HTML は {@link renderMarkdown} で安全にしたもの. 数式と図は, その後に描く.
 *
 * @param props 引数
 * @returns 画面
 */
export function Preview({ content, imagesDir, onScroll, scroller, onToggleTask }: Props) {
  // 書いているあいだは, 表示を後回しにする (入力を遅くしない)
  const deferred = useDeferredValue(content);
  const html = useMemo(() => renderMarkdown(deferred), [deferred]);
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(scroller, () => root.current as HTMLDivElement, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    drawImages(element, imagesDir);
    drawMath(element);
    let stop = false;
    drawDiagrams(element, () => stop).catch((e: unknown) =>
      log.warn("Could not draw the diagrams:", e),
    );
    return () => {
      stop = true;
    };
  }, [html, imagesDir]);

  return (
    <div
      ref={root}
      className="preview markdown-body"
      onClick={(event) => onClick(event, onToggleTask)}
      onScroll={onScroll}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
