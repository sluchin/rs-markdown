# rs-mdnote

Markdown のエディタとビューア。ノートは端末の中に保存して、[HackMD](https://hackmd.io/) のノートと同期できます。PC (Linux, Windows, macOS) と Android で動きます (Tauri 2)。

## できること

- Markdown を書く (CodeMirror 6。行の折り返し、元に戻す、検索)
- 書式のツールバーとショートカット (下の表)
- 画像を貼り付ける、ファイルを落とす (端末の中に置いて、`![](images/…)` を入れる)
- Markdown のファイル (`.md`、`.markdown`、`.txt`) を、ノートとして取り込む (「開く」で選ぶか、ウィンドウに落とす。PC だけ)。編集した内容は「ファイルに保存」を押したときに、元のファイルに書き戻す (下の「元のファイルとの同期」)
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

## 元のファイルとの同期

「開く」で取り込んだノートは、元のファイルとつながります。HackMD の「送る」「取り込む」と同じ考え方です。

- 自動の保存は、ノート (アプリのデータ) だけに書きます。**元のファイルに書くのは、「ファイルに保存」を押したときだけ**です。
- 「読み直す」は、元のファイルの内容をノートに読み込みます。「状態」は、ノートとファイルのどちらが変わったかを出します。
- ほかのエディタでファイルを変えていて、ノートも変わっているときは、止めて選んでもらいます (このノートでファイルを上書き、ファイルの内容で上書き、両方を残す)。
- 書き戻すときは、元のファイルの BOM と改行 (`\r\n`) に合わせます。権限はそのまま残し、シンボリックリンクなら指す先に書きます。元のファイルが消えていたら、作り直しません。
- 同じファイルをもう一度「開く」と、つながっているノートを開きます。
- 「つながりを外す」と、元のファイルはそのままで、ノートだけになります。

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

Linux では、アプリのデータと設定は `~/.local/share/jp.sluchin.rsmdnote/` と `~/.config/jp.sluchin.rsmdnote/` です。

## 開発

Docker の中でビルド、テスト、整形、静的解析をします。

```sh
export UID GID=$(id -g)
docker compose build
docker compose run --rm install
docker compose run --rm test
docker compose run --rm coverage        # src/lib と Rust が 100% (Rust の結果は src-tauri/tarpaulin-report.html)
docker compose run --rm format
docker compose run --rm analyze
docker compose run --rm build-desktop   # src-tauri/target/debug/rs-mdnote
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
