/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  categoriesOf,
  categoryPushMessage,
  categoryDeleteWarnings,
  deleteWarnings,
  type NoteMeta,
  displayTitle,
  fileName,
  fileSyncLabel,
  filterNotes,
  formatDate,
  groupByCategory,
  noteLabel,
  syncLabel,
  type SyncState,
} from "@/lib/notes";

describe("displayTitle", () => {
  it("names an empty title", () => {
    expect(displayTitle("")).toBe("無題");
    expect(displayTitle("  ")).toBe("無題");
    expect(displayTitle("Note")).toBe("Note");
  });
});

describe("filterNotes", () => {
  const notes = [{ title: "Rust memo" }, { title: "旅行" }, { title: "" }];

  it("filters by the title ignoring the case", () => {
    expect(filterNotes(notes, "rust")).toEqual([{ title: "Rust memo" }]);
    expect(filterNotes(notes, "無題")).toEqual([{ title: "" }]);
  });

  it("filters by the given label", () => {
    expect(filterNotes(notes, "MEMO", (note) => `${note.title}.md`)).toEqual([
      { title: "Rust memo" },
    ]);
    expect(filterNotes(notes, ".md", (note) => `${note.title}.md`)).toEqual(notes);
  });

  it("keeps all for an empty query", () => {
    const all = filterNotes(notes, " ");
    expect(all).toEqual(notes);
    expect(all).not.toBe(notes);
  });
});

describe("formatDate", () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();

  it("shows the time for today", () => {
    expect(formatDate(new Date(2026, 9, 21, 9, 5).getTime(), now)).toBe("09:05");
  });

  it("shows the month and the day for this year", () => {
    expect(formatDate(new Date(2026, 0, 2, 3, 4).getTime(), now)).toBe("1/2 03:04");
  });

  it("shows the year for older dates", () => {
    expect(formatDate(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("2025/12/31");
  });
});

describe("syncLabel", () => {
  it("describes every state", () => {
    const states: SyncState[] = ["unlinked", "synced", "localChanged", "remoteChanged", "conflict"];
    const labels = states.map(syncLabel);
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe("fileSyncLabel", () => {
  it("describes every state", () => {
    const states: SyncState[] = ["unlinked", "synced", "localChanged", "remoteChanged", "conflict"];
    const labels = states.map(fileSyncLabel);
    expect(new Set(labels).size).toBe(states.length);
    expect(fileSyncLabel("localChanged")).toContain("ファイルに保存");
  });
});

describe("fileName", () => {
  it("takes the last part of the path", () => {
    expect(fileName("/home/a/b.md")).toBe("b.md");
    expect(fileName("C:\\Users\\a\\b.md")).toBe("b.md");
    expect(fileName("b.md")).toBe("b.md");
  });
});

describe("noteLabel", () => {
  const file = { path: "/docs/guide.md", syncedHash: "h" };

  it("shows the title or the file name", () => {
    expect(noteLabel({ title: "Guide", file }, "title")).toBe("Guide");
    expect(noteLabel({ title: "Guide", file }, "file")).toBe("guide.md");
  });

  it("falls back to the title without a file", () => {
    expect(noteLabel({ title: "", file: null }, "file")).toBe("無題");
    expect(noteLabel({ title: "Memo" }, "file")).toBe("Memo");
  });
});

describe("groupByCategory", () => {
  it("groups by the category and puts the rest last", () => {
    const notes = [
      { id: 1, category: "仕事" },
      { id: 2, category: null },
      { id: 3, category: "趣味" },
      { id: 4, category: "仕事" },
      { id: 5 },
      { id: 6, category: "" },
    ];
    expect(groupByCategory(notes)).toEqual([
      { category: "仕事", notes: [notes[0], notes[3]] },
      { category: "趣味", notes: [notes[2]] },
      { category: null, notes: [notes[1], notes[4], notes[5]] },
    ]);
  });

  it("omits the rest when every note has a category", () => {
    expect(groupByCategory([{ category: "b" }, { category: "a" }])).toEqual([
      { category: "a", notes: [{ category: "a" }] },
      { category: "b", notes: [{ category: "b" }] },
    ]);
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("categoriesOf", () => {
  it("lists the names once in order", () => {
    expect(
      categoriesOf([{ category: "b" }, { category: null }, { category: "a" }, { category: "b" }]),
    ).toEqual(["a", "b"]);
  });
});

describe("categoryPushMessage", () => {
  const note = (title: string) => ({ title }) as NoteMeta;

  it("reports the counts", () => {
    expect(categoryPushMessage("仕事", { pushed: [note("a")], unchanged: 0, conflicts: [] })).toBe(
      "「仕事」の 1 件のノートを HackMD に送りました。",
    );
    expect(
      categoryPushMessage("仕事", {
        pushed: [],
        unchanged: 2,
        conflicts: [note("b"), note("")],
      }),
    ).toBe(
      "「仕事」の 0 件のノートを HackMD に送りました。2 件は変わっていないので、送りませんでした。「b」、「無題」は HackMD の側が変わっていたので、送りませんでした (ノートを開いて、1 件ずつ送ります)。",
    );
  });

  it("reports an empty category", () => {
    expect(categoryPushMessage("空", { pushed: [], unchanged: 0, conflicts: [] })).toBe(
      "「空」にはノートがありません。",
    );
  });
});

describe("deleteWarnings", () => {
  const none = {
    pending: false,
    linkedHackmd: false,
    linkedFile: false,
    hackmd: false,
    file: false,
  };

  it("つないでいないノートは、元に戻せないことを伝える", () => {
    expect(deleteWarnings(none)).toEqual([
      "HackMD にも、ファイルにも、つないでいないので、消すと元に戻せません。",
    ]);
  });

  it("保存していない内容と、送っていない変更を、1 つずつ伝える", () => {
    const lines = deleteWarnings({
      pending: true,
      linkedHackmd: true,
      linkedFile: true,
      hackmd: true,
      file: true,
    });
    expect(lines).toEqual([
      "書いたあと、まだ保存していない内容があります。消すと、その内容も失われます。",
      "HackMD に送っていない変更があります。消すと、この変更は失われます。",
      "元のファイルに保存していない変更があります。消すと、この変更は失われます。",
      "HackMD のノートは消えません。",
      "元のファイルは消えません。",
    ]);
  });

  it("HackMD だけにつないで、変更がなければ、HackMD のノートが消えないことだけを伝える", () => {
    expect(deleteWarnings({ ...none, linkedHackmd: true })).toEqual([
      "HackMD のノートは消えません。",
    ]);
    expect(deleteWarnings({ ...none, linkedFile: true })).toEqual(["元のファイルは消えません。"]);
  });
});

describe("categoryDeleteWarnings", () => {
  const base = {
    total: 3,
    pending: false,
    linkedHackmd: 0,
    linkedFile: 0,
    hackmd: 0,
    file: 0,
    unlinked: 0,
  };

  it("注意することがなければ、空になる", () => {
    expect(categoryDeleteWarnings(base)).toEqual([]);
  });

  it("保存していない内容と、送っていない変更と、元に戻せないノートを、件数で伝える", () => {
    expect(
      categoryDeleteWarnings({
        total: 5,
        pending: true,
        linkedHackmd: 2,
        linkedFile: 1,
        hackmd: 2,
        file: 1,
        unlinked: 2,
      }),
    ).toEqual([
      "書いたあと、まだ保存していない内容があります。消すと、その内容も失われます。",
      "HackMD に送っていない変更があるノートが、2 件あります。消すと、この変更は失われます。",
      "元のファイルに保存していない変更があるノートが、1 件あります。消すと、この変更は失われます。",
      "HackMD のノートは消えません。",
      "元のファイルは消えません。",
      "HackMD にも、ファイルにも、つないでいないノートが、2 件あります。消すと元に戻せません。",
    ]);
  });
});
