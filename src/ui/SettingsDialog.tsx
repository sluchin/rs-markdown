/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";
import * as api from "./api";

/** 取り元の説明. */
const SOURCES: Record<api.TokenSource, string> = {
  none: "入れていません。",
  saved: "保存したトークンを使っています。",
  env: "環境変数 HACKMD_APIKEY のトークンを使っています。",
};

/** 設定の画面の引数. */
interface Props {
  /** ログの画面を開く. */
  onOpenLog: () => void;
  /** 閉じる. */
  onClose: () => void;
}

/**
 * 設定の画面. HackMD の API のトークンを入れて, 確かめる. トークンは画面に出さない (入れ直すだけ).
 *
 * @param props 引数
 * @returns 画面
 */
export function SettingsDialog({ onOpenLog, onClose }: Props) {
  const [source, setSource] = useState<api.TokenSource>();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.getSettings().then((settings) => setSource(settings.tokenSource));
  }, []);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage(await action());
      setSource((await api.getSettings()).tokenSource);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await api.setToken(token);
      setToken("");
      return token.trim() === "" ? "保存したトークンを消しました。" : "保存しました。";
    });

  const check = () => run(async () => `${await api.checkToken()} さんのトークンです。`);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog">
        <h2 id="settings-title">設定</h2>
        <fieldset>
          <legend>HackMD</legend>
          <p className="hint">{source ? SOURCES[source] : "読んでいます…"}</p>
          <label>
            API のトークン
            <input
              type="password"
              value={token}
              autoComplete="off"
              placeholder="HackMD の Settings → API で作る"
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <p className="hint">空のまま保存すると、保存したトークンを消します。</p>
          <div className="actions">
            <button onClick={() => void save()} disabled={busy}>
              保存
            </button>
            <button onClick={() => void check()} disabled={busy || source === "none"}>
              確かめる
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>ログ</legend>
          <button onClick={onOpenLog}>ログを見る</button>
        </fieldset>
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
