/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

/** エディタの引数. */
interface Props {
  /** 始めの本文 (変わっても, 読み直さない. 読み直すときは, `key` を変える). */
  initial: string;
  /** 本文が変わったときに呼ぶ. */
  onChange: (content: string) => void;
}

/**
 * Markdown のエディタ (CodeMirror 6). 行は折り返す.
 *
 * @param props 引数
 * @returns 画面
 */
export function Editor({ initial, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initial);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) {
      return;
    }
    const view = new EditorView({
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
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);

  return <div className="editor" ref={host} />;
}
