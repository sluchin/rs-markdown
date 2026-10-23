/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { FORMAT_BUTTONS, type FormatCommand, formatEdit } from "../lib/format";
import { isImageType } from "../lib/images";
import type { TextChange } from "../lib/tasks";

/** 親から, エディタを動かす窓口. */
export interface EditorHandle {
  /** 書式の操作をする (ツールバー). */
  format: (command: FormatCommand) => void;
  /** 文字を入れる. 画面の位置 (落とした場所) があれば, そこに. なければ, カーソルに. */
  insert: (text: string, at?: { x: number; y: number }) => void;
  /** 本文の行 (小数) が, 上の端に来るように動かす. */
  scrollToLine: (line: number) => void;
  /** 本文を書き換える (カーソルは動かさない. 元に戻せる). */
  change: (change: TextChange) => void;
}

/** エディタの引数. */
interface Props {
  /** 始めの本文 (変わっても, 読み直さない. 読み直すときは, `key` を変える). */
  initial: string;
  /** 本文が変わったときに呼ぶ. */
  onChange: (content: string) => void;
  /** 貼り付けた画像を置いて, 入れる Markdown を返す. 置けなければ, `undefined`. */
  onPasteImage: (file: File) => Promise<string | undefined>;
  /** 動かしたときに, 上の端の本文の行 (小数) と, 行の数を知らせる. */
  onScrollLine: (line: number, lines: number) => void;
  /** 親から, エディタを動かす窓口. */
  handle: Ref<EditorHandle>;
}

/**
 * Markdown のエディタ (CodeMirror 6). 行は折り返す.
 *
 * @param props 引数
 * @returns 画面
 */
export function Editor({ initial, onChange, onPasteImage, onScrollLine, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const initialRef = useRef(initial);
  const callbacks = useRef({ onChange, onPasteImage, onScrollLine });

  useEffect(() => {
    callbacks.current = { onChange, onPasteImage, onScrollLine };
  }, [onChange, onPasteImage, onScrollLine]);

  useImperativeHandle(handle, () => ({
    format: (command) => {
      const current = view.current;
      if (current) {
        runFormat(current, command);
      }
    },
    insert: (text, at) => {
      const current = view.current;
      if (!current) {
        return;
      }
      const pos = at ? current.posAtCoords(at) : null;
      const { from, to } = pos === null ? current.state.selection.main : { from: pos, to: pos };
      current.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      current.focus();
    },
    change: (change) => {
      view.current?.dispatch({ changes: change });
    },
    scrollToLine: (line) => {
      const current = view.current;
      if (!current) {
        return;
      }
      const doc = current.state.doc;
      const number = Math.min(Math.max(Math.floor(line), 1), doc.lines);
      const block = current.lineBlockAt(doc.line(number).from);
      current.scrollDOM.scrollTop =
        documentOffset(current) + block.top + (line - number) * block.height;
    },
  }));

  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          placeholder("Markdown を書く…"),
          // 書式のショートカット (Ctrl+I など) は, 既定の割り当てより先に使う
          Prec.high(
            keymap.of(
              FORMAT_BUTTONS.flatMap(({ key, command }) =>
                key ? [{ key, run: (target: EditorView) => runFormat(target, command) }] : [],
              ),
            ),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.domEventHandlers({
            paste: (event, target) => {
              const images = [...(event.clipboardData?.files ?? [])].filter((file) =>
                isImageType(file.type),
              );
              if (images.length === 0) {
                return false;
              }
              event.preventDefault();
              void pasteImages(target, images, callbacks.current.onPasteImage);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = created;
    const scroller = created.scrollDOM;
    const onScroll = () => {
      // 上の端の, 本文の始めからの高さ
      const top = scroller.scrollTop - documentOffset(created);
      const block = created.lineBlockAtHeight(top);
      const line = created.state.doc.lineAt(block.from).number;
      const inside = block.height > 0 ? (top - block.top) / block.height : 0;
      callbacks.current.onScrollLine(
        line + Math.min(Math.max(inside, 0), 1),
        created.state.doc.lines,
      );
    };
    scroller.addEventListener("scroll", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      created.destroy();
      view.current = undefined;
    };
  }, []);

  return <div className="editor" ref={host} />;
}

/**
 * 動かす範囲の始めから, 本文の始めまでの高さ (上の余白) を返す.
 *
 * @param view エディタ
 * @returns 高さ (ピクセル)
 */
function documentOffset(view: EditorView): number {
  return view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
}

/**
 * 書式の操作を, 選んでいる範囲に当てる.
 *
 * @param view エディタ
 * @param command 操作
 * @returns 当てたら, true (ショートカットの既定の動きをさせない)
 */
function runFormat(view: EditorView, command: FormatCommand): boolean {
  const { from, to } = view.state.selection.main;
  const edit = formatEdit(view.state.doc.toString(), { from, to }, command);
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selection.from, head: edit.selection.to },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/**
 * 貼り付けた画像を置いて, カーソルの位置に Markdown を入れる (複数なら, 行を分ける).
 *
 * @param view エディタ
 * @param files 画像
 * @param save 画像を置いて, 入れる Markdown を返す関数
 */
async function pasteImages(
  view: EditorView,
  files: File[],
  save: (file: File) => Promise<string | undefined>,
): Promise<void> {
  const texts = (await Promise.all(files.map(save))).filter((text) => text !== undefined);
  if (texts.length === 0) {
    return;
  }
  const insert = texts.join("\n");
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
}
