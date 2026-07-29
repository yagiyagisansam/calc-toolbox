# lab — 検討中の新ツール置き場

**このフォルダのツールは公開サイトに反映されていません。**

- `scripts/build/data.js`(トップページのタイル)に登録していないため、`quick-calc.site` の一覧・検索には出ません
- `sitemap.xml` にも載せていません(`scripts/build/build_sitemap.mjs` は `lab/` を除外します)
- `robots.txt` で `/lab/` をクロール対象外にしています

GitHub上でファイルとして確認するため、また各ページをローカルで開いて動きを見るための場所です。
本サイトへ載せると決めたツールだけを `tools/` へ移し、`data.js` と `icons.js` に登録します。

## 構成

各ツールは `tools/` と同じ構成です。

```
lab/<slug>/
  index.html   ページ本体(計算ツールボックスと同じ見た目・「検討中」の帯つき)
  calc.js      計算ロジック(画面から切り離してテストできる形)
  tests.json   期待値つきテストケース
  test.html    ブラウザでテストを実行する内部ページ
```

## テストの実行

```
node scripts/run_tests.mjs --lab          # lab の全ツール
node scripts/run_tests.mjs --lab <slug>   # 特定のツールだけ
```

実ブラウザでの一括検証:

```
python3 -m http.server 8901 &
node scripts/verify_lab.mjs 8901
```

## 一覧

ツールの一覧表は `lab/INDEX.md` と `lab/新ツール一覧.pdf` にあります。
