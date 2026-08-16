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
bash  scripts/stars/seed.test.sh  # 登録SQLと確認SQLが、実際に通って30件入るか
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

`seed.test.sh` は、掲載30件の登録SQL(`generated/seed-spots.sql`)と
確認SQL(`generated/verify-spots.sql`)を、使い捨てのデータベースに実際に流す。
Hiroさんが iPhone から Supabase の SQL エディタへ貼るものなので、
そこで初めて失敗すると手元で調べようがない。
最初に流したとき、`submitter_hint` の 8文字以上という決まりに引っかかって
1件目で止まった ── 貼る前にこれを通していなければ、そのまま渡していた。
2回流しても増えないこと、先に来ていた申請を巻き込まないことも一緒に見る。
確認SQLのほうは、わざと1件消して **NG が出ること**まで見る。
判定の列が常に ok を返すだけなら、確認になっていない。

**登録と確認は必ず別ファイルにする。** 一度まとめて渡したところ、
SQL エディタが最後の文の結果しか出さないため、
貼った Hiroさんからは「案内されていないSQLが出てきて、
最後の1行だけが表示された」ように見えた。
渡す相手の画面に何が出るかまでが、こちらの作るものの範囲。

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

## 地図の置き場所（`stars/pick.html`）

地図（MapLibre）は `pick.html` という別の文書に置き、
一覧・詳細・申請はそれを枠で読み込んでいる。
MapLibre は中で DOM への文字列の書き込みを行うので、
`require-trusted-types-for 'script'` を強制している文書には同居できない。
分けたことで、その4画面は強制したまま保てる。

**これはセキュリティ境界ではない。**
枠には `allow-same-origin` が要る（地図の worker が同一生成元でないと動かない）。
同一生成元である以上、枠の中は `window.parent.document` へ直に触れるし、
親にある `sandbox` 属性を外して読み直すこともできる。
`sandbox` が止めているのは通常動作での top への移動・別窓・フォーム送信だけで、
**枠の中が乗っ取られた場合に親を守る壁にはならない**。
`postMessage` の source/origin の検査も、通常のメッセージの取り違えを防ぐためのもの。

得られているのは「MapLibre の DOM 書き込みを親の文書から外した」ことだけで、
侵害時の隔離ではない。本当に分けるなら地図を別の生成元（サブドメイン等）から
配ることになるが、GitHub Pages の1生成元では取れない。

`index.html` は画面そのものが地図なので分けられず、Trusted Types が無いままである。
サイト全体で守られているとは言えない。守れているのは一覧・詳細・申請・データについての4画面。

## 地名の索引は2段構え

| ファイル | 件数 | gzip | いつ読むか |
|---|---|---|---|
| `stars/data/places.json` | 9,882 | 181 KB | 検索欄に触れる／地図を開くとき |
| `stars/data/places-local.json` | 46,573 | 446 KB | 主の索引が**0件**のときだけ |

集落・字の索引を取りに行く条件は3つとも満たしたときだけ。

1. 打ち終わってから 400ms（途中の0件のたびに始めない）
2. 寄せたあとで2文字以上（打ち間違いの1文字で446KBを引かない）
3. 主の索引が1件も返さない

**混ぜる条件も同じ。** 読み込み済みでも、主の索引が1件でも返すなら集落は足さない。
以前は「上限に足りなければ足す」だったので、いったん読み込むと
主の索引が1〜11件返す検索にも集落が混ざり、
読み込み済みかどうかで結果が変わっていた。

開発機（Node）で測った値。**iPhone 実機では測っていない**。

```
JSON.parse       25.8 ms（46,573件）
寄せた形を作る   17.1 ms
検索1回          1.62 ms
heap             20.1 MB（主の索引ぶんを含む）
```

## 掲載候補の所在地

候補の座標が、書かれた市区町村の中にあるかは国土地理院に聞く。

```bash
node scripts/stars/verify_candidate_cities.mjs   # 47件・約1分。結果を JSON へ書き戻す
```

最初は同梱の地名索引（市区町村の**役場の代表点**）からの距離で見ていたが、
役場は自治体の中心ではないので、広い自治体では隣町の役場のほうが近い。
正しい7件を疑って、本当の誤り1件を見逃していた。
国土地理院の逆ジオコーダは行政界そのもので答えるので、そちらへ替えた。
**47件中21件が別の市区町村に落ちた。1件は県すら違った。**

結果は `spot-candidates.json` の `cityCheck` に入る。
`check_candidates.mjs` はそれを読むだけなので、通常のテストは通信しない。
`cityCheck.ok` が false のものは承認対象にできない（機械の検査で落ちる）。
