/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 選んでいる範囲 (文字の位置. `from` と `to` が同じなら, カーソル). */
export interface Selection {
  /** 始め. */
  from: number;
  /** 終わり. */
  to: number;
}

/** 本文の書き換え. `from` から `to` を `insert` に置き換えて, 選ぶ範囲を `selection` にする. */
export interface Edit {
  /** 置き換える範囲の始め. */
  from: number;
  /** 置き換える範囲の終わり. */
  to: number;
  /** 置き換える文字. */
  insert: string;
  /** 書き換えた後に選ぶ範囲. */
  selection: Selection;
}

/** 書式の操作. */
export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "heading"
  | "quote"
  | "bullet"
  | "ordered"
  | "task"
  | "link"
  | "image"
  | "codeBlock"
  | "table"
  | "rule";

/** ツールバーのボタン. */
export interface FormatButton {
  /** 操作. */
  command: FormatCommand;
  /** ボタンの文字. */
  label: string;
  /** 説明 (ボタンにかざしたときと, 読み上げ). */
  title: string;
  /** ショートカット (CodeMirror の書き方. `Mod` は Ctrl か Command). ないものもある. */
  key?: string;
}

/** ツールバーのボタン (並べる順). */
export const FORMAT_BUTTONS: readonly FormatButton[] = [
  { command: "bold", label: "B", title: "太字", key: "Mod-b" },
  { command: "italic", label: "I", title: "斜体", key: "Mod-i" },
  { command: "strike", label: "S", title: "取り消し線", key: "Mod-Shift-x" },
  { command: "heading", label: "H", title: "見出し (段を変える)", key: "Mod-Shift-h" },
  { command: "code", label: "`", title: "コード", key: "Mod-e" },
  { command: "quote", label: "❝", title: "引用" },
  { command: "bullet", label: "•", title: "箇条書き" },
  { command: "ordered", label: "1.", title: "番号付きの一覧" },
  { command: "task", label: "☑", title: "作業の一覧" },
  { command: "link", label: "🔗", title: "リンク", key: "Mod-k" },
  { command: "image", label: "🖼", title: "画像" },
  { command: "codeBlock", label: "{ }", title: "コードの段落" },
  { command: "table", label: "▦", title: "表" },
  { command: "rule", label: "―", title: "横線" },
];

/** 囲む印. */
const WRAPS: Partial<Record<FormatCommand, string>> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

/** 一覧と引用の, 行の始めの印 (付けるとき, 外すとき). */
const PREFIXES: Partial<
  Record<FormatCommand, { pattern: RegExp; make: (index: number) => string }>
> = {
  quote: { pattern: /^> ?/, make: () => "> " },
  bullet: { pattern: /^[-*+] (?!\[[ xX]\] )/, make: () => "- " },
  ordered: { pattern: /^\d+\. /, make: (index) => `${index + 1}. ` },
  task: { pattern: /^[-*+] \[[ xX]\] /, make: () => "- [ ] " },
};

/** 一覧の印 (別の一覧に変えるときに, 外す). */
const LIST_MARK = /^(?:[-*+] (?:\[[ xX]\] )?|\d+\. )/;

/** 表のひな形. */
const TABLE = "| 列 1 | 列 2 |\n| ---- | ---- |\n| 文字 | 文字 |";

/** 表のひな形で, 選んでおく文字. */
const TABLE_FIRST = "列 1";

/** リンクと画像の URL のひな形. */
const URL_PLACEHOLDER = "https://";

/**
 * 選んだ文字を印で囲む. 既に囲んでいれば (印が外側か, 選んだ文字の両端), 外す.
 *
 * @param doc 本文
 * @param sel 選んでいる範囲
 * @param mark 印 (`**` など)
 * @returns 書き換え
 */
export function toggleWrap(doc: string, sel: Selection, mark: string): Edit {
  const n = mark.length;
  const text = doc.slice(sel.from, sel.to);
  // 印の外側が同じ文字なら, 別の印 (`*` に対する `**`) なので, 囲みとみなさない
  const outside =
    doc.slice(sel.from - n, sel.from) === mark &&
    doc.slice(sel.to, sel.to + n) === mark &&
    doc[sel.from - n - 1] !== mark[0] &&
    doc[sel.to + n] !== mark[0];
  if (sel.from >= n && outside) {
    return {
      from: sel.from - n,
      to: sel.to + n,
      insert: text,
      selection: { from: sel.from - n, to: sel.to - n },
    };
  }
  if (text.length >= 2 * n && text.startsWith(mark) && text.endsWith(mark)) {
    const inner = text.slice(n, -n);
    return { ...sel, insert: inner, selection: { from: sel.from, to: sel.from + inner.length } };
  }
  return {
    ...sel,
    insert: `${mark}${text}${mark}`,
    selection: { from: sel.from + n, to: sel.to + n },
  };
}

/**
 * 選んでいる範囲の行の, 始めと終わりを返す.
 *
 * @param doc 本文
 * @param sel 選んでいる範囲
 * @returns 行の範囲
 */
function lineRange(doc: string, sel: Selection): Selection {
  const end = doc.indexOf("\n", sel.to);
  return { from: doc.lastIndexOf("\n", sel.from - 1) + 1, to: end === -1 ? doc.length : end };
}

/**
 * 選んでいる行に, 一覧か引用の印を付ける. どの行にも付いていれば, 外す.
 * 別の一覧の印は, 付け替える.
 *
 * @param doc 本文
 * @param sel 選んでいる範囲
 * @param command 一覧か引用の操作
 * @returns 書き換え
 */
export function toggleLinePrefix(
  doc: string,
  sel: Selection,
  command: "quote" | "bullet" | "ordered" | "task",
): Edit {
  const { pattern, make } = PREFIXES[command] as NonNullable<(typeof PREFIXES)[typeof command]>;
  const range = lineRange(doc, sel);
  const lines = doc.slice(range.from, range.to).split("\n");
  const remove = lines.every((line) => pattern.test(line));
  const insert = lines
    .map((line, index) => {
      if (remove) {
        return line.replace(pattern, "");
      }
      const bare = command === "quote" ? line : line.replace(LIST_MARK, "");
      return make(index) + bare;
    })
    .join("\n");
  return { ...range, insert, selection: { from: range.from, to: range.from + insert.length } };
}

/**
 * カーソルのある行の見出しの段を, 一つ深くする (なし → `#` → … → `######` → なし).
 *
 * @param doc 本文
 * @param sel 選んでいる範囲
 * @returns 書き換え
 */
export function cycleHeading(doc: string, sel: Selection): Edit {
  const from = doc.lastIndexOf("\n", sel.from - 1) + 1;
  const level = /^(#{1,6}) /.exec(doc.slice(from))?.[1].length ?? 0;
  const old = level === 0 ? "" : `${"#".repeat(level)} `;
  const next = level === 6 ? "" : `${"#".repeat(level + 1)} `;
  const delta = next.length - old.length;
  return {
    from,
    to: from + old.length,
    insert: next,
    selection: {
      from: Math.max(from, sel.from + delta),
      to: Math.max(from, sel.to + delta),
    },
  };
}

/**
 * リンクか画像を入れる. 選んだ文字を, リンクの文字 (画像なら説明) にして, URL を選ぶ.
 *
 * @param sel 選んでいる範囲
 * @param text 選んでいる文字
 * @param image 画像なら, true
 * @returns 書き換え
 */
function insertLink(sel: Selection, text: string, image: boolean): Edit {
  const head = `${image ? "!" : ""}[${text}](`;
  const url = sel.from + head.length;
  return {
    ...sel,
    insert: `${head}${URL_PLACEHOLDER})`,
    selection: { from: url, to: url + URL_PLACEHOLDER.length },
  };
}

/**
 * 足りない改行を返す (前後の段落と, 空の行で分けるため).
 *
 * @param newlines 既にある改行の数
 * @returns 改行
 */
function missingNewlines(newlines: number): string {
  return "\n".repeat(Math.max(0, 2 - newlines));
}

/**
 * 段落 (コード, 表, 横線) を入れる. 前後の段落とつながらないように (横線の上の行が見出しになるなど),
 * 空の行で分ける. 本文の始めと終わりには, 足さない.
 *
 * @param doc 本文
 * @param sel 置き換える範囲
 * @param block 入れる段落 (終わりに改行を付けない)
 * @param select 入れた段落の中で選ぶ範囲 (段落の始めから)
 * @returns 書き換え
 */
function insertBlock(doc: string, sel: Selection, block: string, select: Selection): Edit {
  const head = doc.slice(0, sel.from);
  const tail = doc.slice(sel.to);
  const before = head === "" ? "" : missingNewlines(head.length - head.replace(/\n+$/, "").length);
  const after = tail === "" ? "" : missingNewlines(tail.length - tail.replace(/^\n+/, "").length);
  const start = sel.from + before.length;
  return {
    ...sel,
    insert: `${before}${block}${after}`,
    selection: { from: start + select.from, to: start + select.to },
  };
}

/**
 * 書式の操作を, 本文の書き換えにする.
 *
 * @param doc 本文
 * @param sel 選んでいる範囲
 * @param command 操作
 * @returns 書き換え
 */
export function formatEdit(doc: string, sel: Selection, command: FormatCommand): Edit {
  const text = doc.slice(sel.from, sel.to);
  switch (command) {
    case "bold":
    case "italic":
    case "strike":
    case "code":
      return toggleWrap(doc, sel, WRAPS[command] as string);
    case "heading":
      return cycleHeading(doc, sel);
    case "quote":
    case "bullet":
    case "ordered":
    case "task":
      return toggleLinePrefix(doc, sel, command);
    case "link":
    case "image":
      return insertLink(sel, text, command === "image");
    case "codeBlock": {
      const body = 4; // "```\n" の後
      return insertBlock(doc, sel, `\`\`\`\n${text}\n\`\`\``, {
        from: body,
        to: body + text.length,
      });
    }
    case "table":
      return insertBlock(doc, sel, TABLE, { from: 2, to: 2 + TABLE_FIRST.length });
    case "rule":
      return insertBlock(doc, sel, "---", { from: 3, to: 3 });
  }
}
