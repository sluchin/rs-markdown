/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 消す確認の画面の引数. */
interface Props {
  /** 画面の見出し. */
  title: string;
  /** 消すものの名前. */
  label: string;
  /** 注意の文 (保存していない変更など). */
  warnings: readonly string[];
  /** 消す. */
  onConfirm: () => void;
  /** やめる. */
  onClose: () => void;
}

/**
 * ノートやカテゴリを消す前に確かめる画面. 保存していない変更があれば, 注意として出す.
 *
 * @param props 引数
 * @returns 画面
 */
export function DeleteDialog({ title, label, warnings, onConfirm, onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="dialog">
        <h2 id="delete-title">{title}</h2>
        <p className="delete-target">{label}</p>
        <ul className="delete-warnings">
          {warnings.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="actions">
          <button onClick={onClose}>やめる</button>
          <button className="danger" onClick={onConfirm} autoFocus={false}>
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
