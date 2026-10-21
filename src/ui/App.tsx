/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isCommandError } from "../lib/errors";
import { log } from "../lib/log";
import {
  displayTitle,
  filterNotes,
  formatDate,
  type NoteMeta,
  type SyncState,
  syncLabel,
} from "../lib/notes";
import { createSaver, type Saver } from "../lib/saver";
import * as api from "./api";
import { ConflictDialog, type Resolution } from "./ConflictDialog";
import { Editor } from "./Editor";
import { LogDialog } from "./LogDialog";
import { Preview } from "./Preview";
import { RemoteDialog } from "./RemoteDialog";
import { SettingsDialog } from "./SettingsDialog";

/** 表示のしかた. */
type Mode = "edit" | "split" | "view";

/** 開いている画面. */
type Dialog = "settings" | "log" | "remote" | "conflict" | undefined;

/** 開いているノート. */
interface Current {
  /** ノートの ID. */
  id: string;
  /** エディタに渡す本文 (取り込んだときに, 変える). */
  initial: string;
  /** エディタを作り直すための番号 (本文を読み直すたびに, 増やす). */
  revision: number;
}

/** 書き終えてから保存するまでの時間 (ミリ秒). */
const SAVE_DELAY = 800;

/** 狭い画面 (一覧とノートを, 切り替えて出す). CSS の切り替えと, 同じ幅にする. */
const NARROW = "(max-width: 899px)";

/**
 * 一覧を, 変えたノートで置き換えて, 新しく変えた順に並べる.
 *
 * @param notes 一覧
 * @param meta 変えたノート
 * @returns 新しい一覧
 */
function replaceMeta(notes: readonly NoteMeta[], meta: NoteMeta): NoteMeta[] {
  return [meta, ...notes.filter((note) => note.id !== meta.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

/**
 * アプリの画面. 左にノートの一覧, 右にエディタと表示. 狭い画面では, 一覧とノートを切り替える.
 *
 * @returns 画面
 */
export default function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<Current>();
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>(() =>
    window.matchMedia(NARROW).matches ? "edit" : "split",
  );
  const [showList, setShowList] = useState(true);
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 一覧の日時の「今日」を決める (開いたときの日時)
  const [now] = useState(() => Date.now());
  const saver = useRef<Saver>(undefined);

  const meta = notes.find((note) => note.id === current?.id);

  const fail = useCallback((e: unknown) => {
    log.warn("Action failed:", e);
    setMessage(errorMessage(e));
  }, []);

  useEffect(() => {
    api.listNotes().then(setNotes).catch(fail);
  }, [fail]);

  // 閉じるときと, 裏に回るとき (Android) に, 待っている内容を保存する
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void saver.current?.flush();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    const closing = getCurrentWindow()
      .onCloseRequested(async () => {
        await saver.current?.flush();
      })
      .catch(() => undefined);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      void closing.then((unlisten) => unlisten?.());
    };
  }, []);

  // Android の戻るボタンで, ノートから一覧に戻る
  useEffect(() => {
    const onPop = () => setShowList(true);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const updateMeta = useCallback((changed: NoteMeta) => {
    setNotes((list) => replaceMeta(list, changed));
  }, []);

  /**
   * 本文を読み直して, エディタを作り直す.
   *
   * @param id ノートの ID
   */
  const load = async (id: string) => {
    const text = await api.readNote(id);
    setCurrent((before) => ({ id, initial: text, revision: (before?.revision ?? 0) + 1 }));
    setContent(text);
  };

  const open = async (id: string) => {
    setConfirmDelete(false);
    setSyncState(undefined);
    setMessage(undefined);
    try {
      await saver.current?.flush();
      saver.current = createSaver(
        (text) => api.saveNote(id, text).then(updateMeta),
        SAVE_DELAY,
        fail,
      );
      await load(id);
      if (showList && window.matchMedia(NARROW).matches) {
        window.history.pushState({ note: id }, "");
      }
      setShowList(false);
    } catch (e) {
      fail(e);
    }
  };

  const create = async () => {
    try {
      const created = await api.createNote("");
      updateMeta(created);
      await open(created.id);
      setMode((before) => (before === "view" ? "edit" : before));
    } catch (e) {
      fail(e);
    }
  };

  const remove = async () => {
    if (!current) {
      return;
    }
    setConfirmDelete(false);
    saver.current?.cancel();
    saver.current = undefined;
    try {
      await api.deleteNote(current.id);
      setNotes((list) => list.filter((note) => note.id !== current.id));
      setCurrent(undefined);
      setContent("");
      back();
    } catch (e) {
      fail(e);
    }
  };

  const onChange = useCallback((text: string) => {
    setContent(text);
    saver.current?.change(text);
  }, []);

  /**
   * 同期の操作をする. 待っている内容を保存してから行う. 衝突したら, 選ぶ画面を出す.
   *
   * @param action 操作
   * @param done 終わったときの説明
   */
  const sync = async (action: (id: string) => Promise<void>, done: string) => {
    if (!current) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await saver.current?.flush();
      await action(current.id);
      setMessage(done);
    } catch (e) {
      if (isCommandError(e) && e.kind === "conflict") {
        setSyncState("conflict");
        setDialog("conflict");
      } else {
        fail(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const push = (force: boolean) =>
    sync(async (id) => {
      updateMeta(await api.pushNote(id, force));
      setSyncState("synced");
    }, "HackMD に送りました。");

  const pull = (force: boolean) =>
    sync(async (id) => {
      updateMeta(await api.pullNote(id, force));
      await load(id);
      setSyncState("synced");
    }, "HackMD から取り込みました。");

  const status = () =>
    sync(async (id) => setSyncState(await api.noteStatus(id)), "HackMD に問い合わせました。");

  const unlink = () =>
    sync(async (id) => {
      updateMeta(await api.unlinkNote(id));
      setSyncState("unlinked");
    }, "HackMD とのつながりを外しました。");

  const resolve = (resolution: Resolution) => {
    setDialog(undefined);
    if (resolution === "push") {
      void push(true);
    } else if (resolution === "pull") {
      void pull(true);
    } else {
      void sync(async (id) => {
        const created = await api.keepBoth(id);
        setNotes(await api.listNotes());
        await open(created.id);
      }, "両方を残しました。開いているのは、HackMD の内容のノートです。");
    }
  };

  const back = () => {
    if (window.history.state?.note) {
      window.history.back();
    } else {
      setShowList(true);
    }
  };

  const openRemote = async (id: string) => {
    setDialog(undefined);
    setNotes(await api.listNotes().catch(() => notes));
    await open(id);
  };

  const shown = filterNotes(notes, query);
  const link = meta?.hackmd;

  return (
    <div className={`app ${showList ? "show-list" : "show-note"}`}>
      <aside className="sidebar">
        <div className="toolbar">
          <button onClick={() => void create()}>新規</button>
          <button onClick={() => setDialog("remote")}>HackMD</button>
          <button onClick={() => setDialog("settings")} aria-label="設定">
            設定
          </button>
        </div>
        <input
          type="search"
          className="search"
          value={query}
          placeholder="題名で探す"
          aria-label="題名で探す"
          onChange={(event) => setQuery(event.target.value)}
        />
        {shown.length === 0 ? (
          <p className="empty">
            {notes.length === 0
              ? "「新規」でノートを作るか、HackMD から取り込みます。"
              : "見つかりません。"}
          </p>
        ) : (
          <ul className="note-list">
            {shown.map((note) => (
              <li key={note.id}>
                <button
                  className={note.id === current?.id ? "selected" : undefined}
                  onClick={() => void open(note.id)}
                >
                  <span className="title">{displayTitle(note.title)}</span>
                  <span className="meta">
                    {formatDate(note.updatedAt, now)}
                    {note.hackmd ? " ・HackMD" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!current && message && (
          <p className="empty" role="status">
            {message}
          </p>
        )}
      </aside>

      <main className="main">
        {current && meta ? (
          <>
            <div className="toolbar">
              <button className="back" onClick={back} aria-label="一覧に戻る">
                ←
              </button>
              <span className="note-title">{displayTitle(meta.title)}</span>
              <div className="modes" role="group" aria-label="表示のしかた">
                {(
                  [
                    ["edit", "編集"],
                    ["split", "分割"],
                    ["view", "表示"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={mode === value ? "selected" : undefined}
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar sync">
              <button onClick={() => void push(false)} disabled={busy}>
                {link ? "送る" : "HackMD に作る"}
              </button>
              {link && (
                <>
                  <button onClick={() => void pull(false)} disabled={busy}>
                    取り込む
                  </button>
                  <button onClick={() => void status()} disabled={busy}>
                    状態
                  </button>
                  {link.publishLink && (
                    <button
                      onClick={() =>
                        void openUrl(link.publishLink ?? "").catch((e: unknown) => fail(e))
                      }
                    >
                      HackMD で開く
                    </button>
                  )}
                  <button onClick={() => void unlink()} disabled={busy}>
                    つながりを外す
                  </button>
                </>
              )}
              {confirmDelete ? (
                <>
                  <button className="danger" onClick={() => void remove()}>
                    本当に消す
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>やめる</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)}>消す</button>
              )}
            </div>
            {(syncState || message) && (
              <p className="status" role="status">
                {syncState && <span>{syncLabel(syncState)}</span>}
                {message && <span>{message}</span>}
              </p>
            )}
            <div className={`panes mode-${mode}`}>
              {mode !== "view" && (
                <Editor
                  key={`${current.id}:${current.revision}`}
                  initial={current.initial}
                  onChange={onChange}
                />
              )}
              {mode !== "edit" && <Preview content={content} />}
            </div>
          </>
        ) : (
          <div className="placeholder">
            <p>ノートを選ぶか、「新規」で作ります。</p>
          </div>
        )}
      </main>

      {dialog === "settings" && (
        <SettingsDialog onOpenLog={() => setDialog("log")} onClose={() => setDialog(undefined)} />
      )}
      {dialog === "log" && <LogDialog onClose={() => setDialog(undefined)} />}
      {dialog === "remote" && (
        <RemoteDialog onOpen={(id) => void openRemote(id)} onClose={() => setDialog(undefined)} />
      )}
      {dialog === "conflict" && (
        <ConflictDialog onChoose={resolve} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}
