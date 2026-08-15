# 星見スポット（stars/）の検証手順

このリポジトリは素の静的サイトで、ビルド工程も npm も持たない。
そのぶん、検証は「入れる物が少ないこと」を前提に組んである。

## 全部まとめて走らせる

```bash
node scripts/run_tests.mjs        # 全ツールの純関数テスト（stars を含む）
node scripts/stars/sky.test.mjs   # 月と夜の判定（JPL Horizons / 国立天文台の値と照合）
node scripts/stars/net.test.mjs   # 壊れた天気キャッシュの扱い
node scripts/stars/places.test.mjs # 地名の索引と検索(富士山・八ヶ岳などの代表地点)
node scripts/stars/check_candidates.mjs # 掲載候補の判定・出典・所在地のつじつま
node scripts/stars/glow.test.mjs  # 大気散乱
node scripts/stars/land_grid.mjs  # 取りに行く地点の検査
node scripts/stars/verify.mjs     # ブラウザでの動作確認（Playwright が要る）
bash  scripts/stars/pgtest.sh     # 天気キャッシュのSQL（PostgreSQL が要る）
bash  scripts/stars/setup.test.sh # setup.sql が新規・更新どちらでも通るか
bash  scripts/stars/migrate.test.sh # 本番へ渡す差分SQLが、いまの本番の版に当たるか
```

`verify.mjs` と `pgtest.sh` 以外は Node だけで動き、外部への通信もしない。

画面の幅は `--width=390` のように変えられる(既定は 430px = iPhone に近い縦長)。
狭い端末・タブレット・机上の3つで通しておくと、
選択欄が縦積みになる・並びが折り返す、といった崩れに気づける。

```bash
for w in 390 768 1280; do node scripts/stars/verify.mjs --width=$w; done
```

## Playwright（verify.mjs に必要）

どちらか一方でよい。

**リポジトリの中に入れる**（`node_modules/` が出来る。git には入れない）

```bash
npm install --no-save playwright
npx playwright install chromium
```

**端末全体に入れる**

```bash
npm install -g playwright
npx playwright install chromium
```

`verify.mjs` は、まず普通に `import("playwright")` を試し、
駄目なら `npm root -g` に聞いてグローバルの場所を探す。
絶対パスは書いていないので、Windows でも macOS でも Linux でも同じ手順で動く。
パスに空白や日本語が含まれていても構わない（内部で `file://` URL に直している）。

ブラウザの実体を別の場所に置いている場合は、Playwright の作法どおり
`PLAYWRIGHT_BROWSERS_PATH` を指定すれば従う。

Playwright を入れ直すと、対応するブラウザの版も変わる。
`Executable doesn't exist at ...` と出たら `npx playwright install chromium`
をもう一度走らせること（版が食い違っているだけで、壊れてはいない）。

Playwright 自体が見つからないときも、ブラウザが起動できないときも、
入れ方を表示して終了コード 2 で止まる。黙って失敗はしない。

### 検証環境の注意

検証用のブラウザは外部に出られないことがある。
地図タイルと天気は差し替えて確定的に検査しているので、
タイルが出なくても合格する。本番と同じ絵を撮りたいときは:

```bash
node scripts/stars/verify.mjs --relay --shot-dir 出力先/
```

`--relay` は外部への問い合わせだけ Node 経由で中継する。
`--live` を足すと天気と掲載スポットも本物になる。

## PostgreSQL（pgtest.sh に必要）

`weather-cache.sql` の取り込みの判断を、使い捨てのデータベースで検査する。
拡張（pg_cron / pg_net）は要らない。作り物で代用する。

```bash
bash scripts/stars/pgtest.sh
```

必要なのは `initdb` / `pg_ctl` / `psql`。
Debian・Ubuntu では PATH に入っていないので、
スクリプトが `/usr/lib/postgresql/*/bin` を自分で探す。

`setup.test.sh` は、`setup.sql` を「まっさらな環境」と
「すでに古い版が入っている環境」の両方に流して確かめる。
列を足したときに `create or replace` では関数を置き換えられない、
という失敗を実際に踏んだので、渡す前に必ずこれを通すこと。

`migrate.test.sh` は、本番へ渡す差分SQLを古い版の上に流し、
その結果が「正本をまっさらな環境に流した結果」と同じ形になるかを見る。
比べる項目は `schema_signature.sql` に書いてある ──
列・制約・索引・**関数の中身**・権限・RLS・方針・トリガの324項目。

以前は関数の引数名だけを比べていたため、差分SQL側にだけ
`city` の40文字制約が無い状態を見逃した。同じ HEAD なのに、
新しく作った DB と差分を当てた DB とで受け付ける値が違う ──
画面には何も出ないまま食い違う類の壊れ方で、引数名の比較では見つからない。

**本番の Supabase では絶対に走らせないこと。**
キャッシュを書き換えるうえ、pg_net / pg_cron を作り物に差し替える。

## 期待値の出どころ

天文の期待値は、実装ではなく外部から取っている。
以前は sky.js の期待値を sky.js 自身で作っていたため、
月の高度が最大2.5度ずれたままテストが通っていた。

| 何 | どこから | ファイル |
|---|---|---|
| 月の高度・方位 | NASA/JPL Horizons (DE441) | `fixtures/moon-horizons.json` |
| 月の出・月の入り | 同上（大気差込みの上端が地平線） | `fixtures/moon-riseset-horizons.json` |
| 月齢 | 国立天文台 | `sky.test.mjs` の `NAOJ_AGE` |

取り直すとき（ふだんは不要）:

```bash
node scripts/stars/fetch_fixtures.mjs
```

通常のテストはこのファイルを読むだけで、ネットワークには出ない。
