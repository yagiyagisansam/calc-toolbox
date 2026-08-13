/*
 * 地図ページの組み立て。
 * 画面の状態(今夜の時間帯・選択中の時刻・スポットの選択)を持ち、
 * map.js / net.js / lp.js を呼び分ける。
 *
 * window.StarsApp で公開する(検証用に内部の状態も少しだけ覗けるようにしてある)。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;
  var Sky = global.StarsSky;
  var Score = global.StarsScore;
  var Palette = global.StarsPalette;
  var LP = global.StarsLP;
  var Net = global.StarsNet;
  var MapView = global.StarsMap;

  var state = {
    times: [],
    timeIndex: 0,
    spots: [],
    lastRenderMs: null,
    ready: false,
    weatherAvailable: true,
    error: null
  };

  // ---- 時刻の扱い ---------------------------------------------------------

  var JST = "Asia/Tokyo";

  /** 日本時間での時刻表示(例 21:00) */
  function jstTime(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  /** 日本時間での日付表示(例 8月12日(水)) */
  function jstDate(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST,
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  /**
   * 「今夜」の対象日。前夜がまだ明けていなければ前日を返す。
   * 判定は sky.js に置いてある(一覧・詳細でも同じものを使うため)。
   * 日本の中心付近を代表点にする。
   */
  function tonightDate() {
    return Sky.currentNightDate(36, 138, new Date());
  }

  /**
   * 日本全体をまとめて扱うための夜の時間帯。
   * 南北・東西で暗くなる時刻がずれるため、代表地点の中で最も早く暗くなる時刻から
   * 最も遅くまで暗い時刻までを採り、どの地域を見ても抜けがないようにする。
   */
  function nationalNightWindow(ymd) {
    var refs = [
      { lat: 45.4, lon: 141.7 }, // 稚内
      { lat: 35.7, lon: 139.8 }, // 東京
      { lat: 33.6, lon: 130.4 }, // 福岡
      { lat: 24.3, lon: 124.2 }, // 石垣島
      { lat: 27.1, lon: 142.2 } // 小笠原
    ];
    var start = null;
    var end = null;
    refs.forEach(function (r) {
      var w = Sky.nightWindow(ymd, r.lat, r.lon);
      if (!w) return;
      if (start === null || w.start < start) start = w.start;
      if (end === null || w.end > end) end = w.end;
    });
    if (!start) return null;
    // 予報は1時間刻みなので、外側の丸い時刻へ広げる
    start = new Date(Math.floor(start.getTime() / 3600000) * 3600000);
    end = new Date(Math.ceil(end.getTime() / 3600000) * 3600000);
    return { start: start, end: end };
  }

  // ---- 画面部品 -----------------------------------------------------------

  function el(id) {
    return document.getElementById(id);
  }

  function buildLegend() {
    var box = el("legend-items");
    if (!box) return;
    Score.BANDS.forEach(function (band, i) {
      var row = document.createElement("div");
      row.className = "legend-row";

      var chip = document.createElement("span");
      chip.className = "legend-chip";
      // 地図上で実際に見える色(半透明で重ねた後の色)をそのまま置く
      chip.style.backgroundColor = Palette.BAND_COLORS_ON_MAP[i];
      row.appendChild(chip);

      var label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = band.label;
      row.appendChild(label);

      var note = document.createElement("span");
      note.className = "legend-note";
      note.textContent = band.note;
      row.appendChild(note);

      box.appendChild(row);
    });
  }

  /*
   * 表示する項目(総合・空の暗さ・天気)の切り替え。
   *
   * 総合の点だけでは「低いのは曇っているからか、街明かりのせいか」が読めない。
   * 要素ごとに見られるようにして、たとえば「天気は最高だが場所が明るい」
   * ＝ もう少し足を伸ばせば見える、という判断ができるようにする。
   */
  function buildLayerTabs() {
    var box = el("layer-tabs");
    if (!box) return;

    function select(key) {
      var chosen = MapView.setLayer(key);
      Array.prototype.forEach.call(box.children, function (b) {
        var on = b.dataset.layer === chosen;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var note = el("layer-note");
      if (note) note.textContent = Score.layerOf(chosen).note;
      var title = el("legend-title");
      if (title) {
        title.textContent =
          chosen === "total" ? "星見レベル" : Score.layerOf(chosen).label + "（星見のしやすさ）";
      }
      if (state.ready) requestRender();
    }

    Score.LAYERS.forEach(function (layer) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "stars-layer-tab";
      b.dataset.layer = layer.key;
      b.textContent = layer.label;
      b.addEventListener("click", function () {
        select(layer.key);
      });
      box.appendChild(b);
    });
    select("total");
  }

  function setStatus(message, isError) {
    var box = el("status");
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
    box.classList.toggle("is-error", !!isError);
  }

  function updateTimeLabel() {
    var when = new Date(state.times[state.timeIndex] * 1000);
    var label = el("time-label");
    if (label) label.textContent = jstDate(when) + " " + jstTime(when);

    var moon = el("moon-label");
    if (moon) {
      var c = MapView.map() ? MapView.map().getCenter() : { lat: 36, lng: 138 };
      var s = Sky.summary(when, c.lat, c.lng);
      moon.textContent =
        "月: " +
        s.phaseLabel +
        "(月齢" +
        s.ageDays +
        "・輝面比" +
        s.illuminationPct +
        "%)" +
        (s.altitudeDeg > 0 ? " 高度" + Math.round(s.altitudeDeg) + "度" : " 地平線下");
    }
  }

  // 連続してスライダーを動かしても描き直しが詰まらないようにする
  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      state.lastRenderMs = MapView.render(state.timeIndex);
      updateTimeLabel();
    });
  }

  function buildSlider() {
    var slider = el("time-slider");
    if (!slider) return;
    slider.min = "0";
    slider.max = String(state.times.length - 1);
    slider.value = String(state.timeIndex);
    slider.disabled = false;
    slider.addEventListener("input", function () {
      state.timeIndex = Number(slider.value);
      requestRender();
    });
  }

  /** 今夜のうち、全国で最もよく晴れる時刻を初期値にする */
  function bestTimeIndex(grid) {
    var best = 0;
    var bestValue = Infinity;
    for (var t = 0; t < grid.times.length; t++) {
      var sum = 0;
      var cloud = grid.cloud[t];
      for (var i = 0; i < cloud.length; i++) sum += cloud[i];
      if (sum < bestValue) {
        bestValue = sum;
        best = t;
      }
    }
    return best;
  }

  // ---- スポット -----------------------------------------------------------

  function showSpotCard(list) {
    var card = el("spot-card");
    if (!card) return;
    var spot = list[0];
    card.hidden = false;
    el("spot-name").textContent = spot.name;
    el("spot-place").textContent = spot.pref + (spot.elevation_m ? " ・標高" + spot.elevation_m + "m" : "");

    var when = new Date(state.times[state.timeIndex] * 1000);
    var lat = Number(spot.lat);
    var lon = Number(spot.lon);
    var lpIndex = LP.index(lat, lon);
    var series = state.grid ? Net.gridSeries(state.grid, lat, lon) : null;
    var i = state.timeIndex;
    var result = Score.evaluate({
      lpIndex: lpIndex === null ? undefined : lpIndex,
      cloudPct: series ? series.cloud[i] : 0,
      precipPct: series ? series.precip[i] : 0,
      visibilityM: series && state.weatherAvailable ? series.visibility[i] : undefined,
      humidityPct: series && state.weatherAvailable ? series.humidity[i] : undefined,
      moonBrightness: Sky.brightness(when, lat, lon)
    });
    el("spot-score").textContent = result.score + " / 100";
    el("spot-band").textContent = result.band.label;
    el("spot-note").textContent = spot.note || "";
    el("spot-detail-link").href = "./spot.html?id=" + encodeURIComponent(spot.spot_id);

    var others = el("spot-others");
    others.textContent = list.length > 1 ? "この付近に他 " + (list.length - 1) + " 件" : "";

    MapView.flyTo(Number(spot.lat), Number(spot.lon));
  }

  function loadSpots() {
    if (!Net.backendReady()) return Promise.resolve([]);
    return Net.publicSpots()
      .then(function (spots) {
        state.spots = spots || [];
        MapView.setSpots(state.spots, showSpotCard);
        var count = el("spot-count");
        if (count) {
          count.textContent = state.spots.length
            ? "掲載スポット " + state.spots.length + " 件"
            : "掲載スポットはまだありません";
        }
        return state.spots;
      })
      .catch(function () {
        // スポットが取れなくても地図は使えるので、黙って続ける
        return [];
      });
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    buildLegend();
    buildLayerTabs();
    setStatus("光害データを読み込んでいます…");

    var ymd = tonightDate();
    var window_ = nationalNightWindow(ymd);
    if (!window_) {
      setStatus("この日は夜のデータを作れませんでした", true);
      return;
    }

    LP.load(CONFIG.lightPollution.dataDir)
      .then(function () {
        setStatus("地図を準備しています…");
        return MapView.init("map");
      })
      .then(function (map) {
        // 下地(地形や地名)は後追いで読み込まれる。届かなくても色分けは使えるので、
        // 画面を止めずに一言だけ添える。
        MapView.onBasemapFail(function () {
          var note = el("basemap-note");
          if (note) {
            note.hidden = false;
            note.textContent = "地図の下地を読み込めませんでした(色分けと時刻の操作は使えます)";
          }
        });
        return map;
      })
      .then(function () {
        setStatus("天気予報を取得しています…");
        // 予報が取れなくても、光害だけの表示に切り替えて地図は使えるようにする
        return Net.fetchGrid(window_.start, window_.end).catch(function () {
          return Net.emptyGrid(window_.start, window_.end);
        });
      })
      .then(function (grid) {
        state.grid = grid;
        state.times = grid.times;
        state.timeIndex = bestTimeIndex(grid);
        MapView.setGrid(grid);
        buildSlider();
        requestRender();
        setStatus("");
        state.ready = true;
        state.weatherAvailable = grid.weatherAvailable !== false;

        // 予報が無い/今夜を賄えていないときは、必ずその旨を出す。
        // 黙って残っている数時間ぶんだけを描くと「今夜ぜんぶの予報」に見えてしまう。
        var coverage = Net.coverageNote(grid);
        if (coverage) {
          var wn = el("weather-note");
          if (wn) {
            wn.hidden = false;
            wn.textContent = coverage;
          }
        } else if (grid.updatedAt) {
          // いつ時点の予報かを出す(夜間は1時間ごとに更新される)
          var upd = el("night-range");
          if (upd) {
            upd.textContent += "／予報は " + jstTime(grid.updatedAt) + " 時点";
          }
        }

        var head = el("night-range");
        if (head) {
          head.textContent =
            jstDate(window_.start) +
            "の夜 " +
            jstTime(window_.start) +
            "〜" +
            jstTime(window_.end) +
            "(空が充分に暗い時間帯)";
        }
        return loadSpots();
      })
      .catch(function (err) {
        state.error = String(err && err.message ? err.message : err);
        setStatus(state.error, true);
      });

    // 地図の背景をタップしたら詳細カードを閉じる
    document.addEventListener("click", function (e) {
      var card = el("spot-card");
      if (card && !card.hidden && !card.contains(e.target)) card.hidden = true;
    });

    var opacity = el("opacity-slider");
    if (opacity) {
      opacity.addEventListener("input", function () {
        MapView.setOpacity(Number(opacity.value) / 100);
      });
    }
  }

  global.StarsApp = {
    start: start,
    state: state,
    tonightDate: tonightDate,
    nationalNightWindow: nationalNightWindow
  };
})(typeof window !== "undefined" ? window : globalThis);
