/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** 衝突したときに選べること. */
export type Resolution = "push" | "pull" | "both";

/** 衝突した相手 (HackMD のノートか, 取り込んだ元のファイル). */
export type ConflictTarget = "hackmd" | "file";

/** 相手ごとの, 画面の文. */
const TEXTS: Record<
  ConflictTarget,
  { lead: string; both: string; push: string; pushHint: string; pull: string }
> = {
  hackmd: {
    lead: "このノートと HackMD のノートの両方が、前に同期したあとに変わっています。",
    both: "HackMD の内容を新しいノートにします。このノートは、次に送ると HackMD に別のノートとして作ります。",
    push: "このノートで上書き",
    pushHint: "HackMD の変更は消えます。",
    pull: "HackMD の内容で上書き",
  },
  file: {
    lead: "このノートと元のファイルの両方が、前にファイルと合わせたあとに変わっています。",
    both: "ファイルの内容を、ファイルとつないだ新しいノートにします。このノートは、ファイルとのつながりを外します。",
    push: "このノートでファイルを上書き",
    pushHint: "ファイルの変更は消えます。",
    pull: "ファイルの内容で上書き",
  },
};

/** 衝突の画面の引数. */
interface Props {
  /** 衝突した相手. */
  target: ConflictTarget;
  /** 選んだ. */
  onChoose: (resolution: Resolution) => void;
  /** やめる. */
  onClose: () => void;
}

/**
 * このノートと相手 (HackMD か, 元のファイル) の両方が変わっていたときに, どうするかを選ぶ画面.
 *
 * @param props 引数
 * @returns 画面
 */
export function ConflictDialog({ target, onChoose, onClose }: Props) {
  const text = TEXTS[target];
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="dialog">
        <h2 id="conflict-title">両方が変わっています</h2>
        <p>{text.lead}</p>
        <div className="choices">
          <button onClick={() => onChoose("both")}>
            両方を残す
            <span className="hint">{text.both}</span>
          </button>
          <button onClick={() => onChoose("push")}>
            {text.push}
            <span className="hint">{text.pushHint}</span>
          </button>
          <button onClick={() => onChoose("pull")}>
            {text.pull}
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
