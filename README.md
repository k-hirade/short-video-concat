# short_connect

ffmpeg.wasm で動画を順番に結合するだけの、Netlify 向け簡易アプリです。

## 仕様

- 入力枠の初期値は `3`
- `+/-` ボタンで入力枠数を変更（最小 `1`、最大 `50`）
- 表示中の入力枠はすべて必須（順番どおりに連結）
- 先頭画像は任意で指定可能（`0.1`〜`30` 秒の表示時間）
- 出力は `merged.mp4`
- 簡易実装のため、出力は **無音（音声なし）**
- 処理はブラウザ内で実行（サーバーに動画を送信しない）

## ローカル実行

```bash
npm install
npm run dev
```

`http://localhost:5173` で確認できます。

## Netlify デプロイ

1. このリポジトリを Netlify に接続
2. Build command は `npm run build`
3. Publish directory は `dist`

`netlify.toml` に設定済みです。

## 注意点

- ブラウザのメモリを使うため、長時間動画や巨大ファイルでは失敗する場合があります。
- 動画・先頭画像は内部で `1280x720 / 30fps / SAR=1` にそろえてから連結します。
# short-video-concat
