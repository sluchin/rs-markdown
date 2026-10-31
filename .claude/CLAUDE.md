# プロジェクト設定

Markdown のエディタとビューア (rs-markdown。前の名前は rs-mdnote)。ノートはローカル (アプリのデータの `notes/`) に保存して、HackMD のノートと同期する。PC (Linux, Windows, macOS) と Android。Tauri 2 (Rust) + React (TypeScript)。

```
編集 (ui/Editor.tsx: CodeMirror 6) ─> 自動保存 (lib/saver.ts) ─> Rust (store.rs: notes/<ID>.md と index.json)
表示 (ui/Preview.tsx) <─ lib/markdown.ts (markdown-it + highlight.js ─> DOMPurify)
同期 (送る, 取り込む) ─> Rust (sync.rs) ─> HackMD の API (hackmd.rs. https://api.hackmd.io/v1)
```

- アプリの識別子は `jp.rsmdnote.app` (`tauri.conf.json` の `identifier`、Android の `applicationId`)。変えると、ノートと設定の保存先が変わる。
- `src/lib/`: DOM と Tauri に依存しない処理。行と分岐のカバレッジ 100% (Vitest + jsdom)。テストは `tests/lib/` に置く (`src/lib/markdown.ts` のテストは `tests/lib/markdown.test.ts`。`src/` は `@/` で参照する)。`markdown.ts` (変換と安全化)、`math.ts` (数式の解析)、`headings.ts` (見出しの `id` と目次)、`format.ts` (書式のツールバーとショートカットの書き換え)、`scrollSync.ts` (編集と表示の位置の対応)、`images.ts` (ノートの中の画像の場所)、`tasks.ts` (表示のチェックボックスで, 作業の一覧の印を切り替える)、`files.ts` (取り込めるファイルと, 落としたファイルの振り分け)、`notes.ts` (ノートの一覧と, 同期の状態の説明)。
- `src/ui/`: React の画面。薄く保つ。テストは置かない。Rust の呼び出しは `ui/api.ts` にまとめる。
- `src-tauri/src/`: `store.rs` (ノートの保存)、`hackmd.rs` (API)、`sync.rs` (同期)、`settings.rs` (トークン)、`errors.rs` (画面に返すエラー)、`logging.rs` (ログ。doc-translator-core と同じ)、`images.rs` (貼り付けた画像の保存)、`files.rs` (外の Markdown のファイルの読み書き)、`filesync.rs` (取り込んだファイルとの同期。`sync.rs` と同じ考え方)、`commands.rs` (画面から呼ぶコマンドの本体。`AppState` を受け取る普通の関数)、`lib.rs` (`State` を `commands` に渡すだけの Tauri のコマンドと起動)。行のカバレッジ 100% (cargo tarpaulin)。Tauri に依存して単体テストできない薄い部分 (`lib.rs` のコマンドと起動、`main`) だけを `#[cfg(not(tarpaulin_include))]` で外す。

## 同期

- どちらが変わったかは、最後に同期したときの本文のハッシュ (`HackmdLink.syncedHash`) と、ローカルと HackMD の本文のハッシュを比べて決める (`sync::state_of`)。日時は使わない。
- 送る: HackMD の側が変わっていたら、衝突として止める。取り込む: ローカルの側が変わっていたら、止める。衝突したら、画面で選ぶ (このノートで上書き、HackMD の内容で上書き、両方を残す)。
- HackMD に作るノートは、読むのも書くのも自分だけ (`readPermission: owner`)。公開は HackMD の画面で選ぶ。
- **HackMD のノートは消さない** (アプリで消すのは、ローカルのノートだけ)。
- HackMD の API は、呼べる回数に上限がある。自動の同期や、開くたびの問い合わせはしない (利用者がボタンを押したときだけ)。

## セキュリティの決まり (守ること)

- **HackMD の API のトークンを、ログ、エラー、画面に出さない。** 画面に返すのは、あるかどうかと取り元だけ (`SettingsView`)。保存は設定のディレクトリの `settings.json` (Unix は 600)。保存したトークンがなければ、実行するときの環境変数 `HACKMD_APIKEY` を使う (PC の開発用。ビルドに入れない。`option_env!` を使わない)。
- 表示する HTML は、必ず `sanitize()` (DOMPurify) を通す (`renderMarkdown`)。`dangerouslySetInnerHTML` に渡すのはその結果だけ。
- 数式と図は、安全にした後に描く (`Preview.tsx`)。変換では、TeX と Mermaid の文を、文字として要素に入れるだけにする (スタイル属性を許さないため)。KaTeX は `trust: false`、Mermaid は `securityLevel: "strict"` で描く。
- 表示の中のリンクは、アプリの中で開かない (`lib/links.ts`。`http`、`https`、`mailto` だけをブラウザで開く)。
- CSP (`tauri.conf.json`) は、画像だけを `https:` と `data:` と asset プロトコル (`asset:`、`http://asset.localhost`) に広げる (ノートの画像のため)。asset プロトコルで読めるのは、アプリのデータの `images/` だけ (`assetProtocol.scope`)。スクリプトと通信は広げない。HackMD との通信は Rust から行う。
- 画像は、名前ではなく中身 (始めのバイト) で形式を決め、PNG、JPEG、GIF、WebP だけを置く (`images::detect_format`。SVG は置かない)。名前は `<UUID>.<拡張子>` にする。
- 外の Markdown のファイルは、拡張子が `.md`、`.markdown`、`.txt` で、10 MB までの、UTF-8 のものだけを読み書きする (`files::read_markdown`、`files::write_markdown`)。**元のファイルに書くのは、利用者が「ファイルに保存」を押したときだけ** (`filesync::push`)。自動の保存では書かない。書く先は、取り込んだときに一覧 (`NoteMeta.file`) に残したパスだけ。ファイルの側が変わっていたら衝突として止める (ほかのエディタの変更を消さない)。元のファイルがなければ、作らない。パスと本文はログに書かない。
- ノートの ID は UUID の形だけを通す (`store::is_valid_id`。ファイルの名前に使う)。HackMD のノートの ID も、URL のパスに入れる前に確かめる (`hackmd::is_valid_note_id`)。
- ノートの本文をログに書かない。

## コマンド

- `docker compose run` には必ず `--rm` を付ける。`UID` と `GID` をシェルでエクスポートしておく。
- 依存関係: `install` / テスト: `test` (Vitest と cargo test) / カバレッジ: `coverage` (`src/lib` と Rust が 100%) / 整形の確認: `format` / 整形: `format-fix` / 静的解析: `analyze` (tsc, ESLint, Clippy) / PC のビルド: `build-desktop` / Android の APK: `build-android` / 生成物の削除: `clean`。
- Windows と macOS のビルドはそれぞれの OS で行う。画面の確認はホストの `npm run tauri:dev` か、実機。
- Rust の HackMD の API のテストは、テスト用の HTTP サーバー (mockito) を使う。本物の HackMD は呼ばない。

## コーディング規約

- Prettier (TypeScript, CSS, JSON, Markdown) と rustfmt に従う。手で整形しない。ESLint と Clippy の警告をゼロにする (`-D warnings`)。
- **ファイルの先頭に著作権とライセンスを書く** (`Copyright (c) 2026 Tetsuya Higashi` と `SPDX-License-Identifier: GPL-3.0-or-later`)。
- **コメントは日本語。** 句読点は「, 」(カンマと空白) と「.」(ピリオド) にする。ログとエラーのメッセージ、識別子は英語。画面に出す文字は日本語 (句読点は「、」「。」でよい)。
- 関数には TSDoc / rustdoc の説明を付ける (`@param` `@returns`、`# Arguments` `# Returns`)。
- `!` (非 null の表明) は使わず、`as` は直前に型が保証されているときだけ使う。`unwrap()` はテスト以外で使わない。
- **Rust のテストは `src-tauri/tests/` にファイルを分けて置く** (本番のソースの中に `#[cfg(test)] mod tests` を書かない)。テストが呼ぶ関数と型は `pub` にする。
- ログ: Rust は `log::info!` など、TypeScript は `lib/log.ts` の `log` (`console.*` を直接使わない)。設定の画面の「ログを見る」で見られる。

## 開発フロー

1. Push 時に GitHub Actions (`.github/workflows/build.yml`) が `test` `coverage` `format` `analyze` `build-desktop` `build-android` を実行する。
2. コードを修正したら、`format-fix` → `format` → `analyze` → `test` → `coverage` を全て成功させる。`tauri.conf.json`、`Cargo.toml`、Android の設定を変えたら、`build-desktop` と `build-android` も実行する。
3. ビルドやテストを実行できなかったときはそのことを報告する。ユーザーに依頼されない限り、`git commit` / `git push` は行わない。

## アイコン

`assets/icon.svg`。作り直すときは `npx tauri icon assets/icon.svg` (`src-tauri/icons/` と、Android の `mipmap-*` が更新される)。`tauri android init` のあとにも、必ず実行する。

## コミットガイドライン

- コミットメッセージは英語。件名は Conventional Commits の `type(scope): description` (type: `feat` `fix` `docs` `style` `refactor` `test` `build` `ci` `chore`。scope: `app` `rust` `android` `docker`)。description は英語で、命令形。
- 件名のあとに空行を 1 行入れて、本文を書く。本文はハイフンで始まる箇条書き。
- コミットメッセージに `Co-Authored-By` または Claude 帰属行を含めない。
- rebase のあとの push は `git push --force-with-lease --force-if-includes origin <ブランチ名>`。

## 開発ルール

- Markdown (`*.md`) の日本語の文章は、句読点に「、」「。」を使う (「,」「.」は使わない)。インラインコード・コードブロック・URL・ファイル名・数値 (`1.2.0`、`1,000`) は対象外。見出しや番号付きリストの「1.」の形は変えない。`docs/` の生成物と、この `CLAUDE.md` は対象外。
