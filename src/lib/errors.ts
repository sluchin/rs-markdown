/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Rust のコマンドのエラー (`CommandError`). */
export interface CommandError {
  /** 種類. */
  kind: string;
  /** 内容 (英語). */
  message: string;
}

/** 種類ごとの, 画面に出す文. */
const MESSAGES: Record<string, string> = {
  noToken: "HackMD の API のトークンを、設定で入れてください。",
  unauthorized: "HackMD の API のトークンが正しくありません。設定で確かめてください。",
  notFound: "ノートが見つかりません。",
  rateLimited: "HackMD の API を呼べる回数を超えました。しばらく待ってから、やり直してください。",
  network: "HackMD につながりません。通信を確かめてください。",
  conflict: "このノートと HackMD の両方が変わっています。",
  notLinked: "このノートは HackMD とつないでいません。",
  io: "ノートを読み書きできませんでした。",
  invalidImage: "貼り付けられる画像は、PNG、JPEG、GIF、WebP (20 MB まで) です。",
  invalidFile: "開けるのは、UTF-8 の Markdown のファイル (.md、.markdown、.txt。10 MB まで) です。",
  fileConflict: "このノートと元のファイルの両方が変わっています。",
  fileNotLinked: "このノートはファイルとつないでいません。",
  fileNotFound: "元のファイルが見つかりません。移したか、消した場合は、つながりを外してください。",
  fileIo: "元のファイルを読み書きできませんでした。",
};

/**
 * 値が, Rust のコマンドのエラーか.
 *
 * @param value 値
 * @returns エラーなら, true
 */
export function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).kind === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

/**
 * 失敗を, 画面に出す文にする.
 *
 * @param error 失敗 (コマンドのエラーか, ほかの例外)
 * @returns 画面に出す文
 */
export function errorMessage(error: unknown): string {
  if (isCommandError(error)) {
    return MESSAGES[error.kind] ?? `失敗しました: ${error.message}`;
  }
  return `失敗しました: ${String(error)}`;
}
