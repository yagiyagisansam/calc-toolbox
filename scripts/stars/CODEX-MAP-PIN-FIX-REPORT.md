# 地図ピンずれ修正レポート（Claude引継ぎ用）

作成日: 2026-08-16
対象: `yagiyagisansam/calc-toolbox` / `claude/stargazing-spot-site-uijopc`

## 結論

地図上の白いスポットピンが東側へずれる原因は、スポットの緯度・経度ではなくCSSでした。
MapLibreがピン要素へ付ける `position: absolute` を、後から読み込まれる
`stars/stars.css` の `.stars-pin { position: relative; }` が上書きしていました。

`position: relative` を削除し、MapLibreの絶対配置を保つよう修正しました。
掲載スポット、座標、Supabaseデータには変更を加えていません。

## 再現時の確認結果

公開ページ `https://quick-calc.site/stars/` を実ブラウザで確認しました。

- 読み込まれたピン: 30個
- ピン要素のクラス: `stars-pin maplibregl-marker maplibregl-marker-anchor-center`
- 修正前の算出済み `position`: `relative`
- MapLibreの座標変換値に対する余分な横ずれ:
  - 1個目: 0px
  - 2個目: 22px
  - 3個目: 44px

ピンは幅22pxのボタンです。通常配置に残った各ボタンの位置がMapLibreの
`transform` に順次加算されるため、後のピンほど東側へずれ、折り返し後は縦方向にも
ずれていました。ズームしてもCSSの配置方式は変わらないため、ずれが解消しませんでした。

## 変更ファイル

### `stars/stars.css`

- `.stars-pin` の `position: relative` を削除。
- バッジ `.stars-pin-count` の基準要素は、MapLibre側の
  `.maplibregl-marker { position: absolute; }` が引き続き担います。

### `scripts/stars/verify.mjs`

- 通常の画面検証へ、全 `.stars-pin` の算出済み `position` が
  `absolute` であることを確認する回帰検査を追加。

### `scripts/stars/verify_live.mjs`

- 本番データを使う画面検証にも同じ回帰検査を追加。
- 今後CSSの読み込み順や追加規則で再び上書きされた場合、公開前検証で失敗します。

## 修正後の検証結果

- `node scripts/run_tests.mjs`: **1301 / 1301件通過**
- `node scripts/stars/check_candidates.mjs`: **973 / 973件通過**
  - 候補47件: 条件付き可30 / 保留7 / 除外10（従来どおり）
- `git diff --check`: 問題なし
- ローカル配信した修正版を実ブラウザで検証:
  - 30個すべて `position: absolute`
  - 30個すべて、MapLibreの変換座標とピン中心の差が縦横0px
  - 2段階拡大後も30個すべて `position: absolute`
  - 拡大後の最大位置差は約0.00008px（描画の小数丸め範囲）

## 実行できなかった検証

`node scripts/stars/verify.mjs --width=1280` は、ローカル環境にPlaywrightパッケージが
入っていないため起動できませんでした。依存関係を追加してリポジトリを汚さず、
同じ算出済みCSSと実座標の検査をブラウザ操作で実施しました。

## Claudeへの申し送り

1. この修正を戻さないでください。`.stars-pin` 自身へ `position: relative` を付けると再発します。
2. 個別座標の取り直しやSupabaseの再登録は不要です。
3. ピン内の件数バッジを調整する場合も、基準要素はMapLibreの
   `position: absolute` のままにしてください。
4. 公開後は `scripts/stars/verify_live.mjs` の追加検査が通ること、またはブラウザで
   全ピンの算出済み `position` が `absolute` であることを確認してください。
