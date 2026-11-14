/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from "react";
import { MAX_CATEGORY_CHARS } from "../lib/notes";

/** カテゴリを入れる画面の引数. */
interface Props {
  /** 画面の題名. */
  title: string;
  /** 説明 (フォルダの名前など). */
  description?: string;
  /** 始めに入れておく名前. */
  initial: string;
  /** 空にできないか (フォルダから取り込むときは, 必須). */
  required: boolean;
  /** 決めるボタンの文字. */
  submitLabel: string;
  /** 入力の候補 (今あるカテゴリ). */
  categories: readonly string[];
  /** 決めたときに呼ぶ (前後の空白は除く). */
  onSubmit: (category: string) => void;
  /** 閉じる. */
  onClose: () => void;
}

/**
 * カテゴリの名前を入れる画面. 今あるカテゴリを候補に出す.
 *
 * @param props 引数
 * @returns 画面
 */
export function CategoryDialog({
  title,
  description,
  initial,
  required,
  submitLabel,
  categories,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial);
  const category = value.trim();
  const canSubmit = !required || category !== "";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="category-title">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit(category);
          }
        }}
      >
        <h2 id="category-title">{title}</h2>
        {description && <p className="hint">{description}</p>}
        <label>
          カテゴリ
          <input
            value={value}
            list="category-choices"
            maxLength={MAX_CATEGORY_CHARS}
            required={required}
            autoFocus
            placeholder={required ? "カテゴリの名前 (必須)" : "空にすると、分けない"}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <datalist id="category-choices">
          {categories.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="actions">
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button type="submit" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
