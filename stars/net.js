/*
 * 外部との通信。
 *
 * 天気予報:
 *   ブラウザは Open-Meteo に**直接は問い合わせない**。
 *   全国の格子は誰が見ても同じなので、サーバー側(Supabase)が3時間に1回だけ
 *   取得してキャッシュしたものを読む(scripts/stars/weather-cache.sql)。
 *
 *   当初は訪問者ごとに552地点を問い合わせていたが、それだと地図を1回開くだけで
 *   無料枠(600回/分)をほぼ使い切り、複数人が同時に使えなかった。
 *   いまの方式なら上流への呼び出しは訪問者数に関係なく1日8回で一定になる。
 *
 *   格子の刻みや範囲はキャッシュの meta に入っている。サイト側で決め打ちせず
 *   そちらに従う(両方に同じ数値を書くとずれるため)。
 *
 * スポットの保存/取得:
 *   Supabase の REST API を fetch で直叩き(SDKは使わない。ビルド工程を持たず
 *   CSP の script-src を 'self' に保つため)。
 *   接続情報は統計ツールと同じ ../tools/poll/config.js の POLL_CONFIG。
 *   承認前のスポットは anon から読めず、公開用の関数だけが承認済みを返す。
 *
 * window.StarsNet で公開する。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;

  // ---- Supabase の共通部分 -----------------------------------------------

  function conf() {
    var c = global.POLL_CONFIG;
    return c && c.url && c.anonKey ? c : null;
  }

  /** 接続設定が入っているか(未設定ならスポット機能は「準備中」を出す) */
  function backendReady() {
    return !!conf();
  }

  function headers() {
    var c = conf();
    return {
      apikey: c.anonKey,
      Authorization: "Bearer " + c.anonKey,
      "Content-Type": "application/json"
    };
  }

  function restBase() {
    return conf().url.replace(/\/+$/, "") + "/rest/v1";
  }

  // ---- 天気予報(キャッシュを読む) ----------------------------------------

  var gridPromise = null;

  /**
   * サーバー側にキャッシュされた全国の格子を読む。
   * 何度呼んでも1回しか取りに行かない(同じページ内で使い回す)。
   * @returns {Promise<object>} 生のキャッシュ {payload, meta, updated_at}
   */
  function fetchCachedGrid() {
    if (gridPromise) return gridPromise;
    if (!backendReady()) return Promise.reject(new Error("接続設定がありません"));

    gridPromise = fetch(
      restBase() + "/stars_weather_cache?kind=eq.grid&select=payload,meta,updated_at",
      { headers: headers() }
    )
      .then(function (r) {
        if (!r.ok) throw new Error("天気予報を取得できませんでした (" + r.status + ")");
        return r.json();
      })
      .then(function (rows) {
        if (!rows.length) throw new Error("天気予報がまだ用意されていません");
        return rows[0];
      });

    return gridPromise;
  }

  /**
   * 指定した時間帯の格子を返す。
   *
   * キャッシュは30時間ぶんを持っているので、そこから必要な時刻だけを切り出す。
   * 戻り値は時刻ごとの配列(北→南、西→東の並び)。
   *
   * @param {Date} start
   * @param {Date} end
   * @returns {Promise<{times:number[], rows:number, cols:number, grid:object,
   *                    cloud:Float32Array[], precip:Float32Array[],
   *                    visibility:Float32Array[], humidity:Float32Array[],
   *                    updatedAt:Date, weatherAvailable:boolean}>}
   */
  function fetchGrid(start, end) {
    return fetchCachedGrid().then(function (row) {
      return sliceGrid(row, start, end);
    });
  }

  /*
   * 4つの指標と、それぞれの妥当な範囲。サーバー側(weather-cache.sql)と同じ。
   * 両方で見るのは、サーバーを直せない状況(古いキャッシュが残っている、
   * 別のところから配られた等)でも、画面が嘘をつかないようにするため。
   */
  var SERIES_KEYS = ["cloud", "precip", "visibility", "humidity"];
  var SERIES_RANGE = {
    cloud: [0, 100],
    precip: [0, 100],
    visibility: [0, 1000000],
    humidity: [0, 100]
  };

  // 欠測を直前の値で埋めてよい上限。1時間を超えて続く欠けは埋めない。
  var IMPUTE_MAX_STEPS = 1;

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  /*
   * キャッシュの中身が使える形かを確かめる。
   *
   * なぜここまで見るか:
   *   以前は p.cloud の長さしか見ておらず、欠測を 0 に置き換えていた。
   *   雲量の 0 は「快晴」を意味するので、データが欠けているときに
   *   画面は最高の評価を出す。「分からない」より「快晴だと言い切る」ほうが
   *   害が大きい ── 出かけた先で曇っていた、が起きる。
   *   形がおかしければ描かずにその旨を出す。
   */
  function validateCache(row) {
    var meta = row && row.meta;
    var p = row && row.payload;
    if (!meta || !p) throw new Error("天気予報の形式が正しくありません");

    ["south", "north", "west", "east", "step"].forEach(function (k) {
      if (!isNum(meta[k])) throw new Error("天気予報の格子の定義が壊れています");
    });

    var rows = Math.round((meta.north - meta.south) / meta.step) + 1;
    var cols = Math.round((meta.east - meta.west) / meta.step) + 1;
    var n = rows * cols;
    if (!(rows > 1 && cols > 1)) throw new Error("天気予報の格子の定義が壊れています");

    if (!Array.isArray(p.times) || !p.times.length) {
      throw new Error("天気予報に時刻が入っていません");
    }
    for (var t = 0; t < p.times.length; t++) {
      if (!isNum(p.times[t])) throw new Error("天気予報の時刻が数値ではありません");
      if (t > 0 && p.times[t] <= p.times[t - 1]) {
        throw new Error("天気予報の時刻が並んでいません");
      }
    }
    var nt = p.times.length;

    SERIES_KEYS.forEach(function (key) {
      var all = p[key];
      if (!Array.isArray(all) || all.length !== n) {
        throw new Error("予報の地点数が合いません (" + key + ")");
      }
      var lo = SERIES_RANGE[key][0];
      var hi = SERIES_RANGE[key][1];
      for (var i = 0; i < n; i++) {
        var s = all[i];
        if (!Array.isArray(s) || s.length !== nt) {
          throw new Error("予報の時間数が合いません (" + key + ")");
        }
        for (var k = 0; k < nt; k++) {
          var v = s[k];
          if (v === null) continue; // 欠測。後で埋めるか「不明」にする
          if (!isNum(v) || v < lo || v > hi) {
            throw new Error("予報に使えない値が入っています (" + key + ")");
          }
        }
      }
    });

    return { rows: rows, cols: cols, n: n, nt: nt };
  }

  /*
   * 欠測を埋める。埋めるのは直前の値で、最大1時間まで。
   *
   * 埋めきれないもの(先頭から欠けている・1時間を超えて続く)は NaN のままにする。
   * 0 にはしない ── 雲量の 0 は「快晴」という強い主張になってしまうため。
   * NaN の地点は、地図では色を塗らず、一覧・詳細では「データなし」と出す。
   */
  function imputeSeries(all, n, nt) {
    var out = [];
    var k;
    for (k = 0; k < nt; k++) out.push(new Float32Array(n));

    var filled = 0;
    var missing = 0;
    for (var i = 0; i < n; i++) {
      var s = all[i];
      var carried = 0;
      var last = NaN;
      for (k = 0; k < nt; k++) {
        var v = s[k];
        if (v === null || v === undefined) {
          if (isFinite(last) && carried < IMPUTE_MAX_STEPS) {
            carried++;
            filled++;
            out[k][i] = last;
          } else {
            missing++;
            out[k][i] = NaN;
          }
        } else {
          carried = 0;
          last = v;
          out[k][i] = v;
        }
      }
    }
    return { series: out, filled: filled, missing: missing };
  }

  /*
   * キャッシュを1回だけ検証・補完して持っておく。
   * ページの中で時間帯を変えるたびに全点を見直すのは無駄なので、
   * 結果を生データの隣に貼り付けておく。
   */
  function prepare(row) {
    if (row.__prepared) return row.__prepared;

    var shape = validateCache(row);
    var p = row.payload;
    var prepared = {
      rows: shape.rows,
      cols: shape.cols,
      n: shape.n,
      times: p.times,
      meta: row.meta,
      updatedAt: new Date(row.updated_at),
      filled: 0,
      missing: 0,
      series: {}
    };

    SERIES_KEYS.forEach(function (key) {
      var r = imputeSeries(p[key], shape.n, shape.nt);
      prepared.series[key] = r.series;
      prepared.filled += r.filled;
      prepared.missing += r.missing;
    });

    row.__prepared = prepared;
    return prepared;
  }

  /** キャッシュの生データから、必要な時刻ぶんだけを取り出して組み替える */
  function sliceGrid(row, start, end) {
    var pre = prepare(row);
    var from = start.getTime() / 1000;
    var to = end.getTime() / 1000;

    var idx = [];
    for (var t = 0; t < pre.times.length; t++) {
      if (pre.times[t] >= from && pre.times[t] <= to) idx.push(t);
    }
    // 求めた時間帯がキャッシュの範囲から外れている(更新が止まっている等)
    if (!idx.length) throw new Error("この時間帯の予報がまだありません");

    var out = {
      times: idx.map(function (t) {
        return pre.times[t];
      }),
      rows: pre.rows,
      cols: pre.cols,
      grid: pre.meta,
      updatedAt: pre.updatedAt,
      weatherAvailable: true,
      // 欠測をどう扱ったか。画面に出すために持ち回す。
      imputed: { filled: pre.filled, missing: pre.missing, maxHours: IMPUTE_MAX_STEPS },
      // 求めた時間帯のうち、実際に予報があった範囲(欠けの検出に使う)
      requestedFrom: from,
      requestedTo: to
    };

    SERIES_KEYS.forEach(function (key) {
      out[key] = idx.map(function (t) {
        return pre.series[key][t];
      });
    });

    return out;
  }

  /**
   * 予報が今夜を賄えているかを確かめ、足りなければ知らせる文言を返す。
   *
   * 定期取得が止まると、キャッシュは「古いが空ではない」状態になる。
   * このとき何も言わずに残っている数時間ぶんだけを描くと、
   * 利用者には「今夜ぜんぶの予報」に見えてしまい、いちばん危ない。
   * 欠けているなら必ず画面に出すこと。
   *
   * @param {object} grid sliceGrid の戻り値
   * @param {Date=} now 判定時刻。省略時は現在時刻
   * @returns {string|null} 問題が無ければ null
   */
  function coverageNote(grid, now) {
    if (!grid || grid.weatherAvailable === false) {
      return "天気予報を取得できませんでした。空の暗さ(光害)だけで表示しています。";
    }
    if (!grid.times || !grid.times.length) return null;

    var last = grid.times[grid.times.length - 1];
    var first = grid.times[0];
    var missingEnd = grid.requestedTo - last;
    var nowSeconds = now instanceof Date ? now.getTime() / 1000 : Date.now() / 1000;
    var currentHour = Math.floor(nowSeconds / 3600) * 3600;
    /*
     * 夜の開始後にキャッシュを更新すると、Open-Meteo の forecast_hours は
     * 更新時点から始まるため、すでに過ぎた夕方の時刻は新しいキャッシュに無い。
     * その過去分を「不足」と判定すると、更新直後なのに更新停止と誤表示する。
     * 必要なのは、要求開始と現在時刻のうち遅い方から先だけ。
     */
    var neededFrom = Math.min(grid.requestedTo, Math.max(grid.requestedFrom, currentHour));
    var missingStart = first - neededFrom;
    var updatedSeconds = grid.updatedAt instanceof Date ? grid.updatedAt.getTime() / 1000 : null;
    var staleSeconds = updatedSeconds === null ? 0 : nowSeconds - updatedSeconds;

    var fmt = function (unix) {
      return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date(unix * 1000));
    };

    if (missingEnd >= 3600 || missingStart >= 3600) {
      return (
        "予報データの範囲が不足しています。表示できるのは " +
        fmt(first) +
        " 〜 " +
        fmt(last) +
        " です" +
        (grid.updatedAt ? "(最終更新 " + fmt(grid.updatedAt.getTime() / 1000) + ")" : "") +
        "。"
      );
    }

    // 定例は日中でも3時間ごと。5時間以上進まなければ実際の更新停滞として知らせる。
    if (staleSeconds >= 5 * 3600) {
      return (
        "予報の最終更新から5時間以上経っています" +
        (grid.updatedAt ? "(最終更新 " + fmt(grid.updatedAt.getTime() / 1000) + ")" : "") +
        "。最新の天気が反映されていない可能性があります。"
      );
    }

    // 時間帯は足りているが、値そのものが欠けている地点がある
    if (grid.imputed && grid.imputed.missing > 0) {
      return "予報の一部が欠けています。値が無い地域は色を塗らず「データなし」と表示しています。";
    }

    return null;
  }

  /**
   * 天気を取得できなかったときに使う、雲量ゼロの格子。
   *
   * 予報が無くても「その場所がどれだけ暗いか」は変わらないので、
   * 光害だけの表示に切り替えて地図は使えるようにする。
   * 呼び出し側は「天気は反映されていない」と画面に明示すること。
   */
  function emptyGrid(start, end) {
    var g = CONFIG.grid;
    var rows = Math.round((g.north - g.south) / g.stepDeg) + 1;
    var cols = Math.round((g.east - g.west) / g.stepDeg) + 1;
    var n = rows * cols;
    var times = [];
    for (var t = start.getTime(); t <= end.getTime(); t += 3600000) times.push(t / 1000);

    var out = {
      times: times,
      rows: rows,
      cols: cols,
      grid: { south: g.south, north: g.north, west: g.west, east: g.east, step: g.stepDeg },
      updatedAt: null,
      weatherAvailable: false
    };
    ["cloud", "precip", "visibility", "humidity"].forEach(function (key) {
      out[key] = times.map(function () {
        return new Float32Array(n);
      });
    });
    return out;
  }

  /**
   * 格子から1地点の時系列を取り出す(最も近い格子点)。
   * 一覧とスポット詳細は、これを使って地点ごとのスコアを出す。
   *
   * @param {object} grid fetchGrid の戻り値
   * @param {number} lat
   * @param {number} lon
   * @returns {{times:number[], cloud:number[], precip:number[],
   *            visibility:number[], humidity:number[]}}
   */
  function gridSeries(grid, lat, lon) {
    var g = grid.grid;
    var r = Math.round((g.north - lat) / g.step);
    var c = Math.round((lon - g.west) / g.step);
    r = Math.min(Math.max(r, 0), grid.rows - 1);
    c = Math.min(Math.max(c, 0), grid.cols - 1);
    var i = r * grid.cols + c;

    var series = { times: grid.times };
    ["cloud", "precip", "visibility", "humidity"].forEach(function (key) {
      series[key] = grid[key].map(function (arr) {
        return arr[i];
      });
    });
    return series;
  }

  // ---- スポット -----------------------------------------------------------

  /**
   * 承認済みスポットの一覧。未承認のものはデータベース側で除かれるため、
   * この関数から返ることはない。
   * @param {string} [region] 地方で絞る(省略で全件)
   */
  function publicSpots(region) {
    if (!backendReady()) return Promise.resolve([]);
    return fetch(restBase() + "/rpc/stars_public_spots", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_region: region || null })
    }).then(function (r) {
      if (!r.ok) throw new Error("スポットを取得できませんでした (" + r.status + ")");
      return r.json();
    });
  }

  /**
   * スポットを申請する。保存されるのは未承認(pending)の状態で、
   * 管理者が承認するまで公開一覧には出ない。
   * @param {object} spot
   * @returns {Promise<{ok:boolean, code?:string}>}
   */
  function submitSpot(spot) {
    if (!backendReady()) return Promise.resolve({ ok: false, code: "not_configured" });
    var h = headers();
    h.Prefer = "return=minimal";
    return fetch(restBase() + "/stars_spots", {
      method: "POST",
      headers: h,
      body: JSON.stringify(spot)
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 409) return { ok: false, code: "duplicate" };
      return r.text().then(function (body) {
        // トリガで弾かれたときは、その理由をそのまま画面に出す
        var message = "";
        try {
          message = JSON.parse(body).message || "";
        } catch (e) {
          message = "";
        }
        return { ok: false, code: "rejected", message: message };
      });
    });
  }

  var api = {
    fetchGrid: fetchGrid,
    emptyGrid: emptyGrid,
    coverageNote: coverageNote,
    gridSeries: gridSeries,
    publicSpots: publicSpots,
    submitSpot: submitSpot,
    backendReady: backendReady,
    /*
     * キャッシュの生データを検証して切り出す部分。通信を伴わないので、
     * 壊れた応答をどう扱うかをここだけ取り出して試せる
     * (scripts/stars/net.test.mjs)。
     */
    sliceGrid: sliceGrid
  };

  global.StarsNet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
