# Claude（くろーど）向け作業指示書 — 星見スポットサイト公開前修正

対象リポジトリ: `yagiyagisansam/calc-toolbox`

対象ブランチ: `claude/stargazing-spot-site-uijopc`

前提資料: 同じフォルダの `INDEPENDENT-REVIEW.md` と `REVIEW-BRIEF.md`

## 厳守事項

1. `main` / `gh-pages` へmerge・pushしない。公開しない。
2. 本番Supabaseの書き込み関数を検証目的で呼ばない。
3. Open-Meteoを大量に呼ばない。外部期待値は固定fixtureへ保存し、通常テストはネットワークなしで動かす。
4. 修正は小さなコミットに分ける。天文、SQL、日付、検証基盤、文言を混ぜない。
5. 既存テストの期待値を新実装から再生成しない。外部の固定値を手でfixture化する。

## 作業順序

### 1. 月高度・月の出入りを修正する [最優先]

対象: `stars/sky.js`、`stars/tests.json`、必要なら新しい天文fixture

実施内容:

- 月の測心位置を計算する。最低限、地心視差を補正する。
- 月の黄経・黄緯は0.3°以内を満たす十分な周期項へ拡張する。
- `moonRiseSet()` は10分走査だけで時刻を返さず、符号反転区間を二分法等で1分未満へ絞る。
- 月の出入りの定義を決める。推奨は国立天文台との比較が明確な「月中心が地平線に一致」。上辺・大気差を使うなら別名とし、テストもその定義に合わせる。
- `brightness()` が月の出入り境界の直前直後で連続かつ正しい符号になることを確認する。

必須回帰テスト:

- 東京 2026-08-14 10:20 UTC: 月中心高度はJPL Horizonsの `-0.274325°` に対し0.3°以内。
- 東京 2026-08-14 10:30 UTC: JPL `-2.254439°` に対し0.3°以内。
- 東京 2026年8月の代表的な月出入を国立天文台値と比較し、各イベント5分以内を目標、少なくとも10分以内。
- 月が沈んだ後の `brightness()` は0。

受入条件:

- 月高度の外部fixtureが全件0.3°以内。
- 月出入の誤差が全件10分以内で、量子化が10分単位ではない。
- 既存の星見判定テストが、新しい外部fixtureと矛盾しない。

### 2. 「月齢」の算出または表示名を修正する

選択肢A（推奨）:

- 直前の朔時刻を求め、経過日数を `ageDays` とする。
- 朔時刻計算はMeeus等の独立したアルゴリズムを実装し、国立天文台値で固定テストする。

選択肢B（短期）:

- 現在の `ageDays` を廃止し、UIから「月齢」を削除する。
- 輝面比と位相ラベルだけを「目安」として表示する。

必須fixture:

- 2026-08-01 12:00 JST: 月齢17.7
- 2026-08-24 12:00 JST: 月齢11.4
- 2026-08-28 12:00 JST: 月齢15.4
- 2026-08-31 12:00 JST: 月齢18.4

受入条件:

- 「月齢」を残す場合、上記が0.2日以内。
- 輝面比のテストを月齢テストと分離する。

### 3. 天気キャッシュへ共通cycleを導入する [最優先]

対象: `scripts/stars/weather-cache.sql`

推奨する最小設計:

- `stars_weather_pending` に `cycle_at timestamptz not null` を追加する。
- 通常のpart要求は同じ定例時間帯で共通の `date_trunc('hour', now())` をcycleとして保存する。
- retryは新しいcycleを作らず、最新未完cycleの同じpartを差し替える。
- collectは次を全て満たす場合だけ公開する。
  - part 1〜`parts` がちょうど1件ずつ存在
  - 全partの `cycle_at` が一致
  - 全partの応答がHTTP 200
  - 全partのtime配列が一致
  - 各partの地点数が `stars_grid_points(part)` の件数と一致
  - 4指標の配列長がtime配列長と一致
- cacheの `meta.cycle` は共通cycleを保存する。
- publish済みcycleは再公開しない。

より堅牢にするなら、pendingを上書きせず `(cycle_id, part)` 主キーのbatch方式にする。

必須SQLテスト（本番ではなくローカル/隔離DB）:

1. 旧cycleが全6part成功済み、新cycleがpart 1〜4だけ到着 → collectは0、cache不変。
2. 新cycleが6part到着 → 1回だけ公開。
3. part 3だけ失敗後にretry成功 → 同じcycleとして公開。
4. part 2の応答がpart 1より先に到着 → 順序に関係なく正しく公開。
5. 応答行がTTLで消えた → 前回cache維持、statusに失敗理由。
6. `parts` を6→5、5→6へ変更 → 古いpart混入なし、揃うまで公開しない。

受入条件:

- 新旧cycleを混ぜるテストが必ず失敗側（非公開）になる。
- collectの並行2実行でも公開は1回。
- retry上限60はトランザクション競合下でも超えない。

### 4. サーバー・クライアント双方で天気payloadを検証する

サーバー側:

- `content::jsonb` の例外を捕捉する。
- bodyの型、地点数、4指標、time、各配列長、数値範囲を検証する。
- time配列がpart間で一致しない場合は公開しない。
- 失敗理由を `stars_weather_status.detail` に、機密情報を含めない短い形式で保存する。

クライアント側 `stars/net.js`:

- `p.cloud.length` だけでなく全指標を検証する。
- `NaN`、Infinity、null、短い配列を拒否する。
- 欠損先頭値を0へ変換しない。
- 補完する場合は最大1時間等の明示ルールを設け、`meta.imputed` を表示へ伝える。

必須テスト:

- cloud欠落、visibility欠落、time不一致、地点不足、配列短縮、null先頭、壊れたJSON、HTTP 200のエラーJSON。
- 全ケースで「前回cache維持」または画面の明示エラーとなり、快晴0%へ化けない。

### 5. 一覧と詳細の「今夜」を統一する

対象: `stars/list.js`、`stars/spot.js`、必要ならURL仕様

推奨実装:

- 初期化時に `const now = new Date()` 相当を一度だけ取得し、全スポットの日付判定へ同じnowを渡す。
- 一覧では各スポットについて `Sky.currentNightDate(lat, lon, now)` を使う。
- 予報取得範囲は、各スポットの日付別night windowの最小start〜最大endとする。
- 一覧から詳細へ `night=YYYY-MM-DD` を付け、詳細はその値を優先する。直接アクセス時だけ地点別 `currentNightDate` を使う。

必須回帰テスト:

- `now=2026-08-14T19:00:00Z` で石垣島の一覧リンクと詳細がともに `2026-08-14` を使う。
- 同時刻の代表地点 `(36,138)` は `2026-08-15` でも、石垣のスコアへ混入しない。
- 稚内、東京、石垣について、一覧のベスト時刻・スコアが詳細と完全一致。
- 端末TZをUTC、JST、America/Los_Angelesへ変えても一致。

### 6. Open-Meteoのモデルと文言を一致させる

どちらかを選ぶ。

- JMA固定: SQLのURLに適切な `models=` を明示し、必要変数と78時間の可用性を確認する。
- Best Match継続: 全ページの「日本国内は気象庁モデル」を「Open-Meteo Best Match」等へ変更する。

推奨はBest Match継続＋正確な文言。モデル固定は予報期間・変数可用性・障害時フォールバックを狭める可能性がある。

### 7. ブラウザ検証を環境非依存にする

対象: `scripts/stars/verify.mjs` と開発用依存設定

- `/opt/.../playwright/index.mjs` の絶対importを廃止する。
- `playwright` を通常の開発依存として解決する。
- ブラウザ未導入時の手順を文書化する。
- WindowsとLinuxで `node scripts/stars/verify.mjs` が同じ結果になるようにする。

受入条件:

- 新規checkoutで手順どおり導入後、単一コマンドで59件が動く。
- パスに日本語や空白を含むWindowsディレクトリでも動く。

### 8. 補助改善

- `land_grid.mjs` の検査を頂点だけでなく全海岸線分の格子セル横断へ拡張する。
- 下地失敗時にも海を塗らないことが要件なら、静的な水域マスクを同梱する。そうでなければabout文言を条件付きにする。
- スコアを「独自指数」と明記し、降水確率100%の下限40点を再検討する。

## 最終確認コマンド

以下は外部期待値fixtureをローカルへ保存した後、ネットワークなしで通る状態にすること。

```bash
node scripts/run_tests.mjs
node scripts/stars/glow.test.mjs
node scripts/stars/verify.mjs
node scripts/stars/land_grid.mjs
```

追加で、隔離PostgreSQL上のSQL競合テストを実行すること。本番Supabaseをテスト対象にしない。

## 完了報告に含めるもの

- 修正した問題番号
- 各ファイルと変更の要約
- 外部fixtureの出典URL・観測地点・時刻・定義
- 全テスト結果
- 未解決事項と判断理由
- 本番へ書き込んでいないこと、公開していないことの明記

公開・merge・pushは別の明示指示があるまで行わないこと。
