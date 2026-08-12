/*
 * 外部との通信。
 *   - 天気予報: Open-Meteo(APIキー不要・CC BY 4.0)
 *   - スポットの保存/取得: Supabase の REST API を fetch で直叩き
 *     (SDKは使わない。ビルド工程を持たず CSP の script-src を 'self' に保つため)
 *
 * Supabase の接続情報は統計ツールと同じものを使う(../tools/poll/config.js の
 * POLL_CONFIG)。anonキーは公開前提で、権限はデータベース側の RLS で絞ってある。
 * 承認前のスポットは anon から読めず、公開用の関数だけが承認済みを返す。
 *
 * window.StarsNet で公開する。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;

  // ---- 共通 -------------------------------------------------------------

  function cacheGet(key) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (Date.now() - box.at > CONFIG.weather.cacheMinutes * 60000) return null;
      return box.value;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value: value }));
    } catch (e) {
      // 容量超過などは無視する(キャッシュは無くても動く)
    }
  }

  // Open-Meteo は「時刻の文字列」を分単位まで受け取る
  function hourParam(date) {
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      date.getUTCFullYear() +
      "-" +
      p(date.getUTCMonth() + 1) +
      "-" +
      p(date.getUTCDate()) +
      "T" +
      p(date.getUTCHours()) +
      ":00"
    );
  }

  /**
   * Open-Meteo に問い合わせる。地点はカンマ区切りでまとめて渡せる。
   * @param {Array<{lat:number, lon:number}>} points
   * @param {string[]} variables 取得する時間別の項目
   * @param {Date} start 開始時刻
   * @param {Date} end 終了時刻
   * @returns {Promise<Array>} 地点ごとの結果(points と同じ並び)
   */
  function fetchForecast(points, variables, start, end) {
    var url = new URL(CONFIG.weather.endpoint);
    url.searchParams.set("latitude", points.map(function (p) { return p.lat; }).join(","));
    url.searchParams.set("longitude", points.map(function (p) { return p.lon; }).join(","));
    url.searchParams.set("hourly", variables.join(","));
    url.searchParams.set("start_hour", hourParam(start));
    url.searchParams.set("end_hour", hourParam(end));
    // 時刻は UTC で受け取り、表示するときに変換する(閲覧者の地域に依存させない)
    url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("timezone", "GMT");

    return fetch(url.toString()).then(function (r) {
      if (!r.ok) throw new Error("天気予報を取得できませんでした (" + r.status + ")");
      return r.json();
    }).then(function (json) {
      // 地点が1つのときはオブジェクト、複数のときは配列で返る
      return Array.isArray(json) ? json : [json];
    });
  }

  // ---- 地図用のグリッド ---------------------------------------------------

  /** 設定にしたがって格子状の地点一覧を作る */
  function gridPoints() {
    var g = CONFIG.grid;
    var pts = [];
    var rows = 0;
    var cols = 0;
    for (var lat = g.north; lat >= g.south - 1e-9; lat -= g.stepDeg) {
      cols = 0;
      for (var lon = g.west; lon <= g.east + 1e-9; lon += g.stepDeg) {
        pts.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
        cols++;
      }
      rows++;
    }
    return { points: pts, rows: rows, cols: cols };
  }

  /**
   * 地図のラスタ用に、格子の各点の雲量・降水確率を取得する。
   * 戻り値は時刻ごとの2次元配列(北→南、西→東の並び)。
   * @param {Date} start
   * @param {Date} end
   * @returns {Promise<{times:number[], rows:number, cols:number, grid:object,
   *                    cloud:Float32Array[], precip:Float32Array[]}>}
   */
  function fetchGrid(start, end) {
    var key = "stars:grid:" + hourParam(start) + ":" + hourParam(end);
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(inflateGrid(cached));

    var g = gridPoints();
    return fetchForecast(g.points, CONFIG.weather.gridVariables, start, end).then(function (list) {
      if (list.length !== g.points.length) {
        throw new Error("天気予報の地点数が合いません (" + list.length + "/" + g.points.length + ")");
      }
      var times = list[0].hourly.time;
      // 通信量を抑えるため、キャッシュには整数の配列だけを入れる
      var packed = {
        times: times,
        rows: g.rows,
        cols: g.cols,
        grid: CONFIG.grid,
        cloud: list.map(function (e) { return e.hourly.cloud_cover; }),
        precip: list.map(function (e) { return e.hourly.precipitation_probability; })
      };
      cacheSet(key, packed);
      return inflateGrid(packed);
    });
  }

  /**
   * 天気を取得できなかったときに使う、雲量ゼロの格子。
   *
   * 予報が無くても「その場所がどれだけ暗いか」は変わらないので、
   * 光害だけの表示に切り替えて地図は使えるようにする。
   * 呼び出し側は「天気は反映されていない」と画面に明示すること。
   */
  function emptyGrid(start, end) {
    var g = gridPoints();
    var times = [];
    for (var t = start.getTime(); t <= end.getTime(); t += 3600000) times.push(t / 1000);
    var n = g.rows * g.cols;
    var cloud = [];
    var precip = [];
    for (var i = 0; i < times.length; i++) {
      cloud.push(new Float32Array(n));
      precip.push(new Float32Array(n));
    }
    return {
      times: times,
      rows: g.rows,
      cols: g.cols,
      grid: CONFIG.grid,
      cloud: cloud,
      precip: precip,
      weatherAvailable: false
    };
  }

  /* 地点ごとの配列を「時刻ごとの格子」に組み替える(ラスタ描画で引きやすい形) */
  function inflateGrid(packed) {
    var nt = packed.times.length;
    var n = packed.rows * packed.cols;
    var cloud = [];
    var precip = [];
    for (var t = 0; t < nt; t++) {
      var c = new Float32Array(n);
      var p = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var cv = packed.cloud[i] && packed.cloud[i][t];
        var pv = packed.precip[i] && packed.precip[i][t];
        // 欠測は「曇っている」側に倒さず、雲ゼロ扱いにもしない。
        // 直前の値を引き継ぎ、最初から無い場合だけ 0 とする。
        c[i] = cv === null || cv === undefined ? (t > 0 ? cloud[t - 1][i] : 0) : cv;
        p[i] = pv === null || pv === undefined ? (t > 0 ? precip[t - 1][i] : 0) : pv;
      }
      cloud.push(c);
      precip.push(p);
    }
    return {
      times: packed.times,
      rows: packed.rows,
      cols: packed.cols,
      grid: packed.grid,
      cloud: cloud,
      precip: precip,
      weatherAvailable: true
    };
  }

  // ---- スポット単位の予報 -------------------------------------------------

  /**
   * スポットごとの詳しい予報(視程・湿度を含む)をまとめて取得する。
   * @param {Array<{lat:number, lon:number}>} spots
   * @param {Date} start
   * @param {Date} end
   */
  function fetchSpotForecasts(spots, start, end) {
    if (!spots.length) return Promise.resolve([]);
    var max = CONFIG.weather.maxSpotsPerRequest;
    var chunks = [];
    for (var i = 0; i < spots.length; i += max) chunks.push(spots.slice(i, i + max));

    return Promise.all(
      chunks.map(function (chunk) {
        return fetchForecast(chunk, CONFIG.weather.spotVariables, start, end);
      })
    ).then(function (results) {
      return results.reduce(function (acc, r) {
        return acc.concat(r);
      }, []);
    });
  }

  // ---- Supabase ----------------------------------------------------------

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
    fetchSpotForecasts: fetchSpotForecasts,
    gridPoints: gridPoints,
    publicSpots: publicSpots,
    submitSpot: submitSpot,
    backendReady: backendReady
  };
})(typeof window !== "undefined" ? window : globalThis);
