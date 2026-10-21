/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";
import { displayTitle, filterNotes, formatDate, type RemoteEntry } from "../lib/notes";
import * as api from "./api";

/** HackMD の一覧の画面の引数. */
interface Props {
  /** ローカルのノートを開く (取り込んだあとも, 呼ぶ). */
  onOpen: (id: string) => void;
  /** 閉じる. */
  onClose: () => void;
}

/**
 * HackMD の, 自分のノートの一覧. 選んだノートを, ローカルに取り込んで開く.
 *
 * @param props 引数
 * @returns 画面
 */
export function RemoteDialog({ onOpen, onClose }: Props) {
  const [entries, setEntries] = useState<RemoteEntry[]>();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    api
      .listRemote()
      .then(setEntries)
      .catch((e: unknown) => {
        setEntries([]);
        setMessage(errorMessage(e));
      });
  }, []);

  const open = async (entry: RemoteEntry) => {
    if (entry.localId) {
      onOpen(entry.localId);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      onOpen((await api.importNote(entry.id)).id);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = entries ? filterNotes(entries, query) : [];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="remote-title">
      <div className="dialog remote-dialog">
        <h2 id="remote-title">HackMD のノート</h2>
        <input
          type="search"
          value={query}
          placeholder="題名で探す"
          aria-label="題名で探す"
          onChange={(event) => setQuery(event.target.value)}
        />
        {entries === undefined ? (
          <p className="hint">読んでいます…</p>
        ) : shown.length === 0 ? (
          <p className="hint">ノートはありません。</p>
        ) : (
          <ul className="remote-list">
            {shown.map((entry) => (
              <li key={entry.id}>
                <button disabled={busy} onClick={() => void open(entry)}>
                  <span className="title">{displayTitle(entry.title)}</span>
                  <span className="meta">
                    {entry.lastChangedAt ? formatDate(entry.lastChangedAt, now) : ""}
                    {entry.localId ? " ・取り込み済み" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p className="hint" role="status">
            {message}
          </p>
        )}
        <div className="actions">
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
