# rs-markdown

Markdown のエディタとビューア。ノートは端末の中に保存して、[HackMD](https://hackmd.io/) のノートと同期できます。PC (Linux, Windows, macOS) と Android で動きます (Tauri 2)。

## できること

- Markdown を書く (CodeMirror 6。行の折り返し、元に戻す、検索)
- 表示する (表、作業の一覧、コードの色付け、リンク。HTML は安全にしてから出す)
- 編集だけ、並べて、表示だけを切り替える。狭い画面では、一覧とノートを切り替える
- 書くと、自動で保存する (端末の中。HackMD のアカウントがなくても使える)
- HackMD と同期する
  - 送る (つないでいなければ、HackMD に、自分だけが読めるノートを作る)
  - 取り込む、HackMD のノートの一覧から取り込む
  - 両方が変わっていたら、どちらで上書きするか、両方を残すかを選ぶ
- アプリのログを見る (設定の画面)

## HackMD の API のトークン

HackMD の Settings → API で作って、アプリの設定の画面で入れます。トークンは端末の中の設定のファイルに保存して、画面には出しません。

PC で開発するときは、保存したトークンがなければ、環境変数 `HACKMD_APIKEY` を使います (ビルドには入れません)。

## データの場所

|                 | 場所                                                  |
| :-------------- | :---------------------------------------------------- |
| ノート          | アプリのデータの `notes/` (`<ID>.md` と `index.json`) |
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
