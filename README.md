# rs-markdown

Markdown のエディタとビューア。ノートは端末の中に保存して、[HackMD](https://hackmd.io/) のノートと同期できます。PC (Linux, Windows, macOS) と Android で動きます (Tauri 2)。

## できること

- Markdown を書く (CodeMirror 6。行の折り返し、元に戻す、検索)
- 書式のツールバーとショートカット (下の表)
- 画像を貼り付ける、ファイルを落とす (端末の中に置いて、`![](images/…)` を入れる)
- 表示する (表、作業の一覧、コードの色付け、リンク。HTML は安全にしてから出す)
- HackMD の書き方も表示する
  - 数式 (`$...$`、`$$...$$`。KaTeX)、図 (` ```mermaid `)
  - 囲み (`:::info`、`:::success`、`:::warning`、`:::danger`)、折り畳み (`:::spoiler 題名`)
  - `==強調==`、`++挿入++`、`~下付き~`、`^上付き^`、絵文字 (`:smile:`)、脚注 (`[^1]`)、目次 (`[TOC]`)
- 編集だけ、並べて、表示だけを切り替える。並べたときは、編集と表示の位置を合わせて動く。狭い画面では、一覧とノートを切り替える
- 書くと、自動で保存する (端末の中。HackMD のアカウントがなくても使える)
- HackMD と同期する
  - 送る (つないでいなければ、HackMD に、自分だけが読めるノートを作る)
  - 取り込む、HackMD のノートの一覧から取り込む
  - 両方が変わっていたら、どちらで上書きするか、両方を残すかを選ぶ
- アプリのログを見る (設定の画面)

## 書式のショートカット

| キー         | すること                    |
| :----------- | :-------------------------- |
| Ctrl+B       | 太字 (`**`)                 |
| Ctrl+I       | 斜体 (`*`)                  |
| Ctrl+Shift+X | 取り消し線 (`~~`)           |
| Ctrl+E       | コード (`` ` ``)            |
| Ctrl+Shift+H | 見出し (押すたびに段を深く) |
| Ctrl+K       | リンク                      |

macOS では、Ctrl の代わりに Command です (見出しを Ctrl+H にしないのは、macOS の Command+H がアプリを隠すため)。一覧、引用、画像、コードの段落、表、横線は、ツールバーから入れます。囲んでいるところで押すと、外します。

## 画像

貼り付けた画像と、落とした画像のファイルは、アプリのデータの `images/` に置いて、ノートに `![](images/<名前>)` を書きます。置けるのは PNG、JPEG、GIF、WebP (20 MB まで) です。

HackMD に送っても、画像は送りません (HackMD の API に、画像を置く方法がないため)。HackMD では、その画像は表示されません。

## HackMD の API のトークン

HackMD の Settings → API で作って、アプリの設定の画面で入れます。トークンは端末の中の設定のファイルに保存して、画面には出しません。

PC で開発するときは、保存したトークンがなければ、環境変数 `HACKMD_APIKEY` を使います (ビルドには入れません)。

## データの場所

|                 | 場所                                                  |
| :-------------- | :---------------------------------------------------- |
| ノート          | アプリのデータの `notes/` (`<ID>.md` と `index.json`) |
| 画像            | アプリのデータの `images/`                            |
| 設定 (トークン) | アプリの設定の `settings.json`                        |
| ログ            | アプリのデータの `logs/app.log`                       |

Linux では、アプリのデータと設定は `~/.local/share/jp.sluchin.rsmarkdown/` と `~/.config/jp.sluchin.rsmarkdown/` です。

## 開発

Docker の中でビルド、テスト、整形、静的解析をします。

```sh
export UID GID=$(id -g)
docker compose build
docker compose run --rm install
docker compose run --rm test
docker compose run --rm coverage
docker compose run --rm format
docker compose run --rm analyze
docker compose run --rm build-desktop   # src-tauri/target/debug/rs-markdown
docker compose run --rm build-android   # src-tauri/gen/android/app/build/outputs/apk/universal/debug/
```

画面の確認は、ホストで `npm run tauri:dev` を実行します。

## リリース

`v` から始まるタグ (例: `v0.1.0`) を push すると、GitHub Actions (`.github/workflows/release.yml`) が PC (Linux、Windows、macOS) のインストーラをビルドして、GitHub Releases のドラフトに載せます。Actions の「Release」から手動で実行すると、タグを打たずにビルドでき、成果物は実行結果の Artifacts からダウンロードできます。

Android の APK (arm64) は、リポジトリの Secrets に署名の鍵を登録したときだけビルドします。

| Secret                      | 内容                                     |
| --------------------------- | ---------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | キーストア (`.jks`) を base64 にしたもの |
| `ANDROID_KEYSTORE_PASSWORD` | キーストアのパスワード                   |
| `ANDROID_KEY_ALIAS`         | 鍵の別名                                 |
| `ANDROID_KEY_PASSWORD`      | 鍵のパスワード                           |

## ライセンス

GPL-3.0-or-later
