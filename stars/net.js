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

  /** キャッシュの生データから、必要な時刻ぶんだけを取り出して組み替える */
  function sliceGrid(row, start, end) {
    var meta = row.meta;
    var p = row.payload;
    var from = start.getTime() / 1000;
    var to = end.getTime() / 1000;

    var idx = [];
    for (var t = 0; t < p.times.length; t++) {
      if (p.times[t] >= from && p.times[t] <= to) idx.push(t);
    }
    // 求めた時間帯がキャッシュの範囲から外れている(更新が止まっている等)
    if (!idx.length) throw new Error("この時間帯の予報がまだありません");

    var rows = Math.round((meta.north - meta.south) / meta.step) + 1;
    var cols = Math.round((meta.east - meta.west) / meta.step) + 1;
    var n = rows * cols;
    if (p.cloud.length !== n) {
      throw new Error("予報の地点数が合いません (" + p.cloud.length + "/" + n + ")");
    }

    var out = {
      times: idx.map(function (t) {
        return p.times[t];
      }),
      rows: rows,
      cols: cols,
      grid: meta,
      updatedAt: new Date(row.updated_at),
      weatherAvailable: true
    };

    ["cloud", "precip", "visibility", "humidity"].forEach(function (key) {
      var series = [];
      for (var k = 0; k < idx.length; k++) {
        var arr = new Float32Array(n);
        for (var i = 0; i < n; i++) {
          var v = p[key] && p[key][i] ? p[key][i][idx[k]] : null;
          // 欠測は直前の時刻の値を引き継ぐ(最初から無い場合だけ0)
          arr[i] = v === null || v === undefined ? (k > 0 ? series[k - 1][i] : 0) : v;
        }
        series.push(arr);
      }
      out[key] = series;
    });

    return out;
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

  global.StarsNet = {
    fetchGrid: fetchGrid,
    emptyGrid: emptyGrid,
    gridSeries: gridSeries,
    publicSpots: publicSpots,
    submitSpot: submitSpot,
    backendReady: backendReady
  };
})(typeof window !== "undefined" ? window : globalThis);
