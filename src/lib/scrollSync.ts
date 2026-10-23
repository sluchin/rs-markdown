/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 本文の行と, 表示の中の位置の組 (表示の段落の, 元の行と, 上からの位置). */
export interface Anchor {
  /** 本文の行 (1 から). */
  line: number;
  /** 表示の中の位置 (ピクセル. 表示の始めから). */
  top: number;
}

/**
 * 組を行の順に並べて, 位置が逆に戻るもの (入れ子の段落など) と, 同じ行の 2 つ目からを除く.
 *
 * @param anchors 組
 * @returns 行も位置も, 増えていく組
 */
export function normalizeAnchors(anchors: readonly Anchor[]): Anchor[] {
  const sorted = [...anchors].sort((a, b) => a.line - b.line || a.top - b.top);
  const result: Anchor[] = [];
  for (const anchor of sorted) {
    const last = result.at(-1);
    if (!last || (anchor.line > last.line && anchor.top >= last.top)) {
      result.push(anchor);
    }
  }
  return result;
}

/**
 * 点を結んだ折れ線で, `x` の値を求める. 範囲の外は, 端の値.
 *
 * @param xs 点の x (増えていく)
 * @param ys 点の y
 * @param x 求める x
 * @returns y. 点がなければ, 0.
 */
export function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  if (xs.length === 0) {
    return 0;
  }
  if (x <= xs[0]) {
    return ys[0];
  }
  for (let i = 1; i < xs.length; i++) {
    // ここに来るのは x > xs[i - 1] のときなので, x <= xs[i] なら, 幅 (xs[i] - xs[i - 1]) は 0 にならない
    if (x <= xs[i]) {
      return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

/**
 * 本文の行 (小数. 行の途中も) から, 表示の位置を求める.
 *
 * @param anchors 組 ({@link normalizeAnchors} したもの)
 * @param line 行
 * @returns 表示の位置
 */
export function topForLine(anchors: readonly Anchor[], line: number): number {
  return interpolate(
    anchors.map((a) => a.line),
    anchors.map((a) => a.top),
    line,
  );
}

/**
 * 表示の位置から, 本文の行 (小数) を求める.
 *
 * @param anchors 組 ({@link normalizeAnchors} したもの)
 * @param top 表示の位置
 * @returns 行
 */
export function lineForTop(anchors: readonly Anchor[], top: number): number {
  return interpolate(
    anchors.map((a) => a.top),
    anchors.map((a) => a.line),
    top,
  );
}
