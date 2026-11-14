/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isCommandError } from "../lib/errors";
import { isFilePath, MARKDOWN_EXTENSIONS, splitDropped } from "../lib/files";
import { FORMAT_BUTTONS } from "../lib/format";
import { baseName, imageMarkdown } from "../lib/images";
import { lintMarkdown, lintMessage } from "../lib/lint";
import { log } from "../lib/log";
import {
  categoriesOf,
  categoryPushMessage,
  displayTitle,
  fileName,
  fileSyncLabel,
  filterNotes,
  formatDate,
  groupByCategory,
  type ListLabel,
  noteLabel,
  type NoteMeta,
  type SyncState,
  syncLabel,
} from "../lib/notes";
import { createSaver, type Saver } from "../lib/saver";
import { type Anchor, lineForTop, normalizeAnchors, topForLine } from "../lib/scrollSync";
import { applyChange, toggleTask } from "../lib/tasks";
import * as api from "./api";
import { CategoryDialog } from "./CategoryDialog";
import { ConflictDialog, type ConflictTarget, type Resolution } from "./ConflictDialog";
import { Editor, type EditorHandle } from "./Editor";
import { LogDialog } from "./LogDialog";
import { Preview } from "./Preview";
import { RemoteDialog } from "./RemoteDialog";
import { SettingsDialog } from "./SettingsDialog";

/** 表示のしかた. */
type Mode = "edit" | "split" | "view";

/** 開いている画面. */
type Dialog =
  | "settings"
  | "log"
  | "remote"
  | "conflict"
  | "category"
  | "importDir"
  | "pushCategory"
  | undefined;

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

/** 広い画面で, 一覧を隠しているかを覚えておく名前 (localStorage). */
const SIDEBAR_HIDDEN_KEY = "rs-markdown.sidebarHidden";

/**
 * 一覧を隠しているかを読む (読めなければ隠さない).
 *
 * @returns 隠しているか
 */
function loadSidebarHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 一覧を隠しているかを覚える (覚えられなくても画面はそのまま動く).
 *
 * @param hidden 隠しているか
 */
function saveSidebarHidden(hidden: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // 覚えられなくても, 今の画面では隠したままにする
  }
}

/** 一覧に出す名前 (題名か, ファイルの名前) を覚えておく名前 (localStorage). */
const LIST_LABEL_KEY = "rs-markdown.listLabel";

/**
 * 一覧に出す名前を読む (読めなければ題名).
 *
 * @returns 一覧に出す名前
 */
function loadListLabel(): ListLabel {
  try {
    return localStorage.getItem(LIST_LABEL_KEY) === "file" ? "file" : "title";
  } catch {
    return "title";
  }
}

/**
 * 一覧に出す名前を覚える (覚えられなくても画面はそのまま動く).
 *
 * @param label 一覧に出す名前
 */
function saveListLabel(label: ListLabel): void {
  try {
    localStorage.setItem(LIST_LABEL_KEY, label);
  } catch {
    // 覚えられなくても, 今の画面では切り替えたままにする
  }
}

/** 片方を動かしてから, もう片方の動きを無視する時間 (ミリ秒. 合わせた動きで戻さないため). */
const SCROLL_LOCK = 100;

/**
 * 表示の段落の, 元の行と位置の組を集める. 始めと終わりも加える.
 *
 * @param preview 表示 (動かす範囲の要素)
 * @param lines 本文の行の数
 * @returns 組 (行も位置も増えていく)
 */
function previewAnchors(preview: HTMLElement, lines: number): Anchor[] {
  const base = preview.getBoundingClientRect().top - preview.scrollTop;
  const anchors = [...preview.querySelectorAll<HTMLElement>("[data-source-line]")].map(
    (element) => ({
      line: Number(element.dataset.sourceLine),
      top: element.getBoundingClientRect().top - base,
    }),
  );
  return normalizeAnchors([
    { line: 1, top: 0 },
    ...anchors,
    { line: lines + 1, top: preview.scrollHeight - preview.clientHeight },
  ]);
}

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
  // 広い画面で, 一覧を隠して, ノートを広く使う (狭い画面は, 一覧とノートを切り替えるので, 使わない)
  const [sidebarHidden, setSidebarHidden] = useState(loadSidebarHidden);
  const [listLabel, setListLabel] = useState<ListLabel>(loadListLabel);
  // 畳んでいるカテゴリ (空の文字列は, 分けていないノート)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // 取り込むフォルダ (カテゴリを入れる画面を出している間)
  const [pendingDir, setPendingDir] = useState<string>();
  // HackMD に送るカテゴリ (始めに入れておく名前)
  const [pushTarget, setPushTarget] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>();
  const [fileState, setFileState] = useState<SyncState>();
  const [conflictTarget, setConflictTarget] = useState<ConflictTarget>("hackmd");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 一覧の日時の「今日」を決める (開いたときの日時)
  const [now] = useState(() => Date.now());
  const [imagesDir, setImagesDir] = useState<string>();
  const saver = useRef<Saver>(undefined);
  const editor = useRef<EditorHandle>(null);
  const preview = useRef<HTMLDivElement>(null);
  // 本文の行の数と, 最後に動かした側 (合わせた動きで戻さないため)
  const lineCount = useRef(1);
  const scrollLock = useRef<{ side: "editor" | "preview"; until: number }>(undefined);

  const meta = notes.find((note) => note.id === current?.id);

  const fail = useCallback((e: unknown) => {
    log.warn("Action failed:", e);
    setMessage(errorMessage(e));
  }, []);

  useEffect(() => {
    api.listNotes().then(setNotes).catch(fail);
    api.imagesDir().then(setImagesDir).catch(fail);
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
   * 本文を読み直してエディタを作り直す.
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
    setFileState(undefined);
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

  /**
   * 外の Markdown のファイルを, ノートとして取り込んで, 最後に取り込んだノートを開く.
   *
   * @param paths ファイルのパス
   */
  const importFiles = async (paths: readonly string[]) => {
    let last: NoteMeta | undefined;
    for (const path of paths) {
      if (!isFilePath(path)) {
        // Android のファイルを選ぶ画面は, パスでなく URL を返す (読めない)
        fail({ kind: "invalidFile", message: "not a file path" });
        continue;
      }
      try {
        last = await api.importFile(path);
      } catch (e) {
        fail(e);
      }
    }
    if (last) {
      setNotes(await api.listNotes().catch(() => notes));
      await open(last.id);
      setMessage(
        "ファイルを取り込みました。「ファイルに保存」を押すと、元のファイルに書き戻します。",
      );
    }
  };

  const openFiles = async () => {
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
      });
      if (picked) {
        await importFiles(picked);
      }
    } catch (e) {
      fail(e);
    }
  };

  /** フォルダを選んで, カテゴリを入れる画面を出す. */
  const openDir = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") {
        return;
      }
      if (!isFilePath(picked)) {
        fail({ kind: "invalidFile", message: "not a directory path" });
        return;
      }
      setPendingDir(picked);
      setDialog("importDir");
    } catch (e) {
      fail(e);
    }
  };

  /**
   * 選んだフォルダの Markdown のファイルを, 全てカテゴリに取り込む.
   *
   * @param category カテゴリ
   */
  const importDir = async (category: string) => {
    setDialog(undefined);
    const dir = pendingDir;
    setPendingDir(undefined);
    if (!dir) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.importDir(dir, category);
      setNotes(await api.listNotes());
      setCollapsed((before) => new Set([...before].filter((name) => name !== category)));
      const skipped =
        result.skipped > 0 ? `取り込めないファイルが ${result.skipped} 件ありました。` : "";
      setMessage(
        result.notes.length > 0
          ? `${result.notes.length} 件のファイルを「${category}」に取り込みました。${skipped}`
          : `取り込める Markdown のファイルがありませんでした。${skipped}`,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 開いているノートのカテゴリを変える.
   *
   * @param category カテゴリ (空なら分けない)
   */
  const changeCategory = async (category: string) => {
    setDialog(undefined);
    if (!current) {
      return;
    }
    try {
      updateMeta(await api.setCategory(current.id, category));
    } catch (e) {
      fail(e);
    }
  };

  /**
   * カテゴリを HackMD に送る画面を出す.
   *
   * @param category 始めに入れておくカテゴリ
   */
  const askPushCategory = (category: string) => {
    setPushTarget(category);
    setDialog("pushCategory");
  };

  /**
   * カテゴリのノートを, まとめて HackMD に送る.
   *
   * @param category カテゴリ
   */
  const pushCategory = async (category: string) => {
    setDialog(undefined);
    setBusy(true);
    setMessage(undefined);
    try {
      await saver.current?.flush();
      const result = await api.pushCategory(category);
      setNotes(await api.listNotes());
      if (current && result.pushed.some((note) => note.id === current.id)) {
        setSyncState("synced");
      } else if (current && result.conflicts.some((note) => note.id === current.id)) {
        setSyncState("conflict");
      }
      setMessage(categoryPushMessage(category, result));
    } catch (e) {
      // 途中で止まっても, それまでに送ったノートは, つながりが残る
      setNotes(await api.listNotes().catch(() => notes));
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * カテゴリを畳むか, 開く.
   *
   * @param key カテゴリ (空の文字列は, 分けていないノート)
   */
  const toggleCategory = (key: string) => {
    setCollapsed((before) => {
      const next = new Set(before);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
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
   * 表示で作業の一覧のチェックボックスを押したときに, 元の行の印を切り替える.
   * エディタがあれば, エディタで書き換える (元に戻せて自動で保存する). 表示だけのときは, 本文を書き換えて保存する.
   *
   * @param line 項目の元の行 (1 から)
   */
  const onToggleTask = (line: number) => {
    const change = toggleTask(content, line);
    if (!change) {
      return;
    }
    if (editor.current) {
      editor.current.change(change);
    } else {
      onChange(applyChange(content, change));
    }
  };

  /** 本文を markdownlint の規則で整形する (直せるところを直す. 元に戻せる). */
  const tidy = () => {
    const result = lintMarkdown(content);
    if (result.change) {
      editor.current?.change(result.change);
    }
    log.info(`Linted a note: ${result.fixed} fixed, ${result.remaining.length} remaining`);
    setMessage(lintMessage(result));
  };

  const onPasteImage = useCallback(
    async (file: File) => {
      try {
        const name = await api.saveImage(new Uint8Array(await file.arrayBuffer()));
        return imageMarkdown(name, baseName(file.name));
      } catch (e) {
        fail(e);
        return undefined;
      }
    },
    [fail],
  );

  /**
   * 片方を動かしたときに, もう片方を合わせる (分割のときだけ).
   *
   * @param side 動かした側
   * @param follow もう片方を動かす関数
   */
  const syncScroll = useCallback((side: "editor" | "preview", follow: () => void) => {
    const lock = scrollLock.current;
    if (lock && lock.side !== side && Date.now() < lock.until) {
      // 合わせた動き
      return;
    }
    scrollLock.current = { side, until: Date.now() + SCROLL_LOCK };
    follow();
  }, []);

  const onEditorScroll = useCallback(
    (line: number, lines: number) => {
      lineCount.current = lines;
      const target = preview.current;
      if (target) {
        syncScroll("editor", () => {
          target.scrollTop = topForLine(previewAnchors(target, lines), line);
        });
      }
    },
    [syncScroll],
  );

  const onPreviewScroll = useCallback(() => {
    const target = preview.current;
    if (target) {
      syncScroll("preview", () => {
        const anchors = previewAnchors(target, lineCount.current);
        editor.current?.scrollToLine(lineForTop(anchors, target.scrollTop));
      });
    }
  }, [syncScroll]);

  // 落としたファイル: Markdown はノートとして取り込む. 画像は, 編集しているときに, 落とした場所に入れる
  const canDrop = Boolean(current) && mode !== "view";
  const dropTargets = useRef({ canDrop, importFiles });
  useEffect(() => {
    dropTargets.current = { canDrop, importFiles };
  });
  useEffect(() => {
    const unlisten = getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") {
          return;
        }
        const { paths, position } = event.payload;
        const { notes: markdown, others } = splitDropped(paths);
        if (markdown.length > 0) {
          void dropTargets.current.importFiles(markdown);
        }
        if (others.length === 0) {
          return;
        }
        if (!dropTargets.current.canDrop) {
          fail({ kind: "invalidFile", message: "not a Markdown file" });
          return;
        }
        const at = {
          x: position.x / window.devicePixelRatio,
          y: position.y / window.devicePixelRatio,
        };
        void Promise.all(
          others.map((path) =>
            api.importImage(path).then(
              (name) => imageMarkdown(name, baseName(path)),
              (e: unknown) => {
                fail(e);
                return undefined;
              },
            ),
          ),
        ).then((texts) => {
          const text = texts.filter((t) => t !== undefined).join("\n");
          if (text) {
            editor.current?.insert(text, at);
          }
        });
      })
      .catch(() => undefined);
    return () => {
      void unlisten.then((stop) => stop?.());
    };
  }, [fail]);

  /**
   * 同期の操作をする. 待っている内容を保存してから行う. 衝突したら選ぶ画面を出す.
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
        setConflictTarget("hackmd");
        setDialog("conflict");
      } else if (isCommandError(e) && e.kind === "fileConflict") {
        setFileState("conflict");
        setConflictTarget("file");
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

  const pushFile = (force: boolean) =>
    sync(async (id) => {
      updateMeta(await api.pushFile(id, force));
      setFileState("synced");
    }, "元のファイルに保存しました。");

  const pullFile = (force: boolean) =>
    sync(async (id) => {
      updateMeta(await api.pullFile(id, force));
      await load(id);
      setFileState("synced");
    }, "元のファイルから読み直しました。");

  const fileStatus = () =>
    sync(async (id) => setFileState(await api.fileStatus(id)), "元のファイルと比べました。");

  const unlinkFile = () =>
    sync(async (id) => {
      updateMeta(await api.unlinkFile(id));
      setFileState(undefined);
    }, "ファイルとのつながりを外しました (元のファイルは、そのまま残ります)。");

  /**
   * 元のファイルとの衝突を解く.
   *
   * @param resolution 選んだこと
   */
  const resolveFile = (resolution: Resolution) => {
    if (resolution === "push") {
      void pushFile(true);
    } else if (resolution === "pull") {
      void pullFile(true);
    } else {
      void sync(async (id) => {
        const created = await api.keepBothFile(id);
        setNotes(await api.listNotes());
        await open(created.id);
      }, "両方を残しました。開いているのは、ファイルの内容のノートです。");
    }
  };

  const resolve = (resolution: Resolution) => {
    setDialog(undefined);
    if (conflictTarget === "file") {
      resolveFile(resolution);
    } else if (resolution === "push") {
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

  const shown = filterNotes(notes, query, (note) => noteLabel(note, listLabel));
  const groups = groupByCategory(shown);
  // カテゴリがなければ, 見出しを出さない
  const grouped = groups.some((group) => group.category !== null);
  const searching = query.trim() !== "";

  /**
   * ノートの一覧を出す.
   *
   * @param list ノート
   * @returns 一覧
   */
  const noteList = (list: readonly NoteMeta[]) => (
    <ul className="note-list">
      {list.map((note) => (
        <li key={note.id}>
          <button
            className={note.id === current?.id ? "selected" : undefined}
            onClick={() => void open(note.id)}
            title={note.file ? note.file.path : undefined}
          >
            <span className="title">{noteLabel(note, listLabel)}</span>
            <span className="meta">
              {formatDate(note.updatedAt, now)}
              {note.hackmd ? " ・HackMD" : ""}
              {note.file ? " ・ファイル" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  const link = meta?.hackmd;
  const file = meta?.file;

  return (
    <div
      className={`app ${showList ? "show-list" : "show-note"}${
        sidebarHidden && current ? " hide-sidebar" : ""
      }`}
    >
      <aside className="sidebar">
        <div className="toolbar">
          <button onClick={() => void create()}>新規</button>
          <button
            onClick={() => void openFiles()}
            title="Markdown のファイルを、ノートとして取り込む"
          >
            開く
          </button>
          <button
            onClick={() => void openDir()}
            disabled={busy}
            title="フォルダの中の Markdown のファイルを、カテゴリに取り込む"
          >
            フォルダ
          </button>
          <button onClick={() => setDialog("remote")}>HackMD</button>
          <button onClick={() => setDialog("settings")} aria-label="設定">
            設定
          </button>
        </div>
        <input
          type="search"
          className="search"
          value={query}
          placeholder={listLabel === "file" ? "ファイル名で探す" : "題名で探す"}
          aria-label={listLabel === "file" ? "ファイル名で探す" : "題名で探す"}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="list-label" role="group" aria-label="一覧に出す名前">
          {(
            [
              ["title", "題名"],
              ["file", "ファイル名"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={listLabel === value ? "selected" : undefined}
              aria-pressed={listLabel === value}
              onClick={() => {
                saveListLabel(value);
                setListLabel(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="empty">
            {notes.length === 0
              ? "「新規」でノートを作るか、「開く」でファイルを、「HackMD」で HackMD のノートを取り込みます。"
              : "見つかりません。"}
          </p>
        ) : grouped ? (
          <div className="note-groups">
            {groups.map(({ category, notes: list }) => {
              const key = category ?? "";
              // 探している間は, 畳んだカテゴリも開いて見せる
              const expanded = searching || !collapsed.has(key);
              return (
                <section key={key} className="note-group">
                  <div className="category-row">
                    <button
                      className="category"
                      aria-expanded={expanded}
                      onClick={() => toggleCategory(key)}
                    >
                      <span className="arrow">{expanded ? "▾" : "▸"}</span>
                      <span className="name">{category ?? "未分類"}</span>
                      <span className="count">{list.length}</span>
                    </button>
                    {category !== null && (
                      <button
                        className="push-category"
                        onClick={() => askPushCategory(category)}
                        disabled={busy}
                        title={`「${category}」のノートを、まとめて HackMD に送る`}
                        aria-label={`「${category}」を HackMD に送る`}
                      >
                        送る
                      </button>
                    )}
                  </div>
                  {expanded && noteList(list)}
                </section>
              );
            })}
          </div>
        ) : (
          noteList(shown)
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
              <button
                className="sidebar-toggle"
                onClick={() => {
                  saveSidebarHidden(!sidebarHidden);
                  setSidebarHidden(!sidebarHidden);
                }}
                aria-pressed={sidebarHidden}
                aria-label={sidebarHidden ? "一覧を表示する" : "一覧を隠す"}
                title={sidebarHidden ? "一覧を表示する" : "一覧を隠す"}
              >
                ☰
              </button>
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
              <button onClick={() => setDialog("category")} title="このノートのカテゴリを変える">
                分類{meta.category ? `: ${meta.category}` : ""}
              </button>
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
            {file && (
              <div className="toolbar sync">
                <span className="file-name" title={file.path}>
                  {fileName(file.path)}
                </span>
                <button
                  onClick={() => void pushFile(false)}
                  disabled={busy}
                  title="このノートの内容を、元のファイルに書く"
                >
                  ファイルに保存
                </button>
                <button
                  onClick={() => void pullFile(false)}
                  disabled={busy}
                  title="元のファイルの内容を、このノートに読み直す"
                >
                  読み直す
                </button>
                <button onClick={() => void fileStatus()} disabled={busy}>
                  状態
                </button>
                <button onClick={() => void unlinkFile()} disabled={busy}>
                  つながりを外す
                </button>
              </div>
            )}
            {mode !== "view" && (
              <div className="toolbar format" role="toolbar" aria-label="書式">
                {FORMAT_BUTTONS.map(({ command, label, title, key }) => (
                  <button
                    key={command}
                    title={key ? `${title} (${key.replace("Mod", "Ctrl")})` : title}
                    aria-label={title}
                    // エディタの選んでいる範囲を, 押したときに外さない
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => editor.current?.format(command)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  title="markdownlint の規則で整形する"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={tidy}
                >
                  整形
                </button>
              </div>
            )}
            {(syncState || fileState || message) && (
              <p className="status" role="status">
                {syncState && <span>{syncLabel(syncState)}</span>}
                {fileState && <span>{fileSyncLabel(fileState)}</span>}
                {message && <span>{message}</span>}
              </p>
            )}
            <div className={`panes mode-${mode}`}>
              {mode !== "view" && (
                <Editor
                  key={`${current.id}:${current.revision}`}
                  initial={current.initial}
                  onChange={onChange}
                  onPasteImage={onPasteImage}
                  onScrollLine={mode === "split" ? onEditorScroll : () => undefined}
                  handle={editor}
                />
              )}
              {mode !== "edit" && (
                <Preview
                  content={content}
                  imagesDir={imagesDir}
                  onScroll={mode === "split" ? onPreviewScroll : () => undefined}
                  scroller={preview}
                  onToggleTask={onToggleTask}
                />
              )}
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
      {dialog === "importDir" && pendingDir && (
        <CategoryDialog
          title="フォルダを取り込む"
          description={`「${fileName(pendingDir)}」の中の Markdown のファイル (下のフォルダも含む) を、入れたカテゴリに取り込みます。`}
          initial={fileName(pendingDir)}
          required
          submitLabel="取り込む"
          categories={categoriesOf(notes)}
          onSubmit={(category) => void importDir(category)}
          onClose={() => {
            setPendingDir(undefined);
            setDialog(undefined);
          }}
        />
      )}
      {dialog === "category" && meta && (
        <CategoryDialog
          title="カテゴリを変える"
          initial={meta.category ?? ""}
          required={false}
          submitLabel="変える"
          categories={categoriesOf(notes)}
          onSubmit={(category) => void changeCategory(category)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "pushCategory" && (
        <CategoryDialog
          title="カテゴリを HackMD に送る"
          description="カテゴリのノートを、まとめて HackMD に送ります。HackMD にないノートは作り (読むのも書くのも自分だけ)、前に送ったときから変わっていないノートは送りません。HackMD の側が変わっていたノートは上書きしません。"
          initial={pushTarget}
          required
          submitLabel="送る"
          categories={categoriesOf(notes)}
          onSubmit={(category) => void pushCategory(category)}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "conflict" && (
        <ConflictDialog
          target={conflictTarget}
          onChoose={resolve}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}
