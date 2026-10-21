/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 衝突したときに選べること. */
export type Resolution = "push" | "pull" | "both";

/** 衝突の画面の引数. */
interface Props {
  /** 選んだ. */
  onChoose: (resolution: Resolution) => void;
  /** やめる. */
  onClose: () => void;
}

/**
 * このノートと HackMD の両方が変わっていたときに, どうするかを選ぶ画面.
 *
 * @param props 引数
 * @returns 画面
 */
export function ConflictDialog({ onChoose, onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="dialog">
        <h2 id="conflict-title">両方が変わっています</h2>
        <p>このノートと HackMD のノートの両方が、前に同期したあとに変わっています。</p>
        <div className="choices">
          <button onClick={() => onChoose("both")}>
            両方を残す
            <span className="hint">
              HackMD の内容を新しいノートにします。このノートは、次に送ると HackMD
              に別のノートとして作ります。
            </span>
          </button>
          <button onClick={() => onChoose("push")}>
            このノートで上書き
            <span className="hint">HackMD の変更は消えます。</span>
          </button>
          <button onClick={() => onChoose("pull")}>
            HackMD の内容で上書き
            <span className="hint">このノートの変更は消えます。</span>
          </button>
        </div>
        <div className="actions">
          <button onClick={onClose}>やめる</button>
        </div>
      </div>
    </div>
  );
}
