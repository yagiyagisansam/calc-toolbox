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
    dayOffset: 0, // 0=今夜 1=明日 2=明後日
    nightDate: null, // 表示中の夜 "YYYY-MM-DD"(スポット詳細へ渡す)
    window: null, // 表示中の夜の時間帯
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
  function buildLayerTabs(initialLayer) {
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
    select(initialLayer || "total");
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
      /*
       * 「月齢」「輝面比」は天文の言葉なので、意味が伝わる形に言い換える。
       * 月あかりの強さを判断するのに要るのは「どれだけ光っているか」と
       * 「空に出ているか」の2つだけ(レビューで3名が用語の難しさを指摘)。
       */
      moon.textContent =
        "月: " +
        s.phaseLabel +
        "・" +
        s.illuminationPct +
        "%光っている" +
        (s.altitudeDeg > 0
          ? "（空に出ています・高さ" + Math.round(s.altitudeDeg) + "度）"
          : "（沈んでいて影響なし）");
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
      writeUrlState();
    });
  }

  // 日付を切り替えるたびに呼ばれるので、聞き手を足すのは最初の1回だけにする
  var sliderBound = false;
  function buildSlider() {
    var slider = el("time-slider");
    if (!slider) return;
    slider.min = "0";
    slider.max = String(state.times.length - 1);
    slider.value = String(state.timeIndex);
    slider.disabled = false;
    if (sliderBound) return;
    sliderBound = true;
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
      cloudPct: series ? series.cloud[i] : undefined,
      precipPct: series ? series.precip[i] : undefined,
      visibilityM: series && state.weatherAvailable ? series.visibility[i] : undefined,
      humidityPct: series && state.weatherAvailable ? series.humidity[i] : undefined,
      moonBrightness: Sky.brightness(when, lat, lon)
    });
    // 予報が無い・欠けている。快晴として点を付けず、そのまま伝える。
    el("spot-score").textContent = result ? result.score + " / 100" : "データなし";
    el("spot-band").textContent = result ? result.band.label : "";
    el("spot-note").textContent = spot.note || "";
    // 地図が出している夜をそのまま詳細へ渡す(別々に判定すると日付の変わり目でずれる)
    el("spot-detail-link").href =
      "./spot.html?id=" + encodeURIComponent(spot.spot_id) +
      (state.nightDate ? "&night=" + encodeURIComponent(state.nightDate) : "");

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

  // ---- 画面の状態をURLに残す ----------------------------------------------

  /*
   * 「この夜のこの時刻の、この場所」をそのまま人に送れるようにする。
   * 状態がURLに無いと、リンクを渡しても相手には初期表示しか見えず、
   * 再読み込みでも自分の見ていた画面に戻れない(レビューで3名が指摘)。
   *
   * 履歴に積むと戻るボタンが操作のたびに1つずつ戻ることになって煩いので、
   * replaceState で現在の1件を書き換える。
   */
  function writeUrlState() {
    if (!state.ready || !MapView.map()) return;
    var map = MapView.map();
    var c = map.getCenter();
    var parts = [
      "d=" + state.dayOffset,
      "t=" + state.timeIndex,
      "layer=" + MapView.layer(),
      "z=" + Math.round(map.getZoom() * 10) / 10,
      "c=" + Math.round(c.lng * 1000) / 1000 + "," + Math.round(c.lat * 1000) / 1000
    ];
    try {
      history.replaceState(null, "", "#" + parts.join("&"));
    } catch (e) {
      /* 書けない環境では諦める(表示には影響しない) */
    }
  }

  /** URL のハッシュから状態を読む。壊れていれば無視して既定値を使う */
  function readUrlState() {
    var out = {};
    var hash = (location.hash || "").replace(/^#/, "");
    if (!hash) return out;
    hash.split("&").forEach(function (pair) {
      var i = pair.indexOf("=");
      if (i < 0) return;
      var key = pair.slice(0, i);
      var value = pair.slice(i + 1);
      if (key === "d") {
        var d = Number(value);
        if (d === 0 || d === 1 || d === 2) out.dayOffset = d;
      } else if (key === "t") {
        var t = Number(value);
        if (isFinite(t) && t >= 0) out.timeIndex = t;
      } else if (key === "layer") {
        out.layer = Score.layerOf(value).key;
      } else if (key === "z") {
        var z = Number(value);
        if (isFinite(z)) out.zoom = z;
      } else if (key === "c") {
        var xy = value.split(",").map(Number);
        if (xy.length === 2 && isFinite(xy[0]) && isFinite(xy[1])) out.center = xy;
      }
    });
    return out;
  }

  // ---- 日付の切り替え -----------------------------------------------------

  /**
   * ymd に日数を足す(日付の文字列演算)。
   * Date に足すと時差の扱いで1日ずれることがあるので、文字列のまま扱う。
   */
  function addDays(ymd, days) {
    var t = Date.UTC(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(5, 7)) - 1,
      Number(ymd.slice(8, 10))
    );
    return new Date(t + days * 86400000).toISOString().slice(0, 10);
  }

  /*
   * 選べる夜。キャッシュは78時間先まで持っているので、今夜・明日・明後日が入る。
   * 星見は前もって日を決める行為なので、今夜しか見られないと計画に使えない。
   */
  var DAY_CHOICES = [
    { offset: 0, label: "今夜" },
    { offset: 1, label: "明日" },
    { offset: 2, label: "明後日" }
  ];

  function buildDayTabs() {
    var box = el("day-tabs");
    if (!box) return;
    DAY_CHOICES.forEach(function (choice) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "stars-day-tab";
      b.textContent = choice.label;
      b.dataset.offset = String(choice.offset);
      b.addEventListener("click", function () {
        if (state.dayOffset === choice.offset) return;
        selectDay(choice.offset);
      });
      box.appendChild(b);
    });
    markDayTabs();
  }

  function markDayTabs() {
    var box = el("day-tabs");
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (b) {
      var on = Number(b.dataset.offset) === state.dayOffset;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function selectDay(offset) {
    state.dayOffset = offset;
    markDayTabs();
    loadNight().catch(function (err) {
      setStatus(String(err && err.message ? err.message : err), true);
    });
  }

  // ---- 夜ごとの読み込み ---------------------------------------------------

  /**
   * 選ばれている夜の予報を読み込んで、地図とスライダーを組み直す。
   *
   * キャッシュ本体は一度しか取りに行かない(net.js が覚えている)ので、
   * 日付を切り替えても通信は発生せず、切り出す時刻の範囲が変わるだけ。
   */
  function loadNight(wantTimeIndex) {
    var ymd = addDays(tonightDate(), state.dayOffset);
    // 地図が今どの夜を出しているか。スポットの詳細へ渡して食い違いを防ぐ。
    state.nightDate = ymd;
    var window_ = nationalNightWindow(ymd);
    if (!window_) {
      setStatus("この日は夜のデータを作れませんでした", true);
      return Promise.resolve();
    }
    state.window = window_;
    setStatus("天気予報を取得しています…");

    // 予報が取れなくても、光害だけの表示に切り替えて地図は使えるようにする
    return Net.fetchGrid(window_.start, window_.end)
      .catch(function () {
        return Net.emptyGrid(window_.start, window_.end);
      })
      .then(function (grid) {
        state.grid = grid;
        state.times = grid.times;
        // URL で時刻を指定されていればそれを、無ければ最も晴れる時刻を初期値にする
        state.timeIndex =
          typeof wantTimeIndex === "number" && wantTimeIndex < grid.times.length
            ? wantTimeIndex
            : bestTimeIndex(grid);
        state.weatherAvailable = grid.weatherAvailable !== false;
        MapView.setGrid(grid);
        buildSlider();
        requestRender();
        setStatus("");
        state.ready = true;
        writeUrlState();

        var head = el("night-range");
        if (head) {
          head.textContent =
            jstDate(window_.start) +
            "の夜 " +
            jstTime(window_.start) +
            "〜" +
            jstTime(window_.end) +
            "（この時間帯は空が暗く、星がよく見えます）";
        }

        /*
         * 予報が無い/その夜を賄えていないときは、必ずその旨を出す。
         * 黙って残っている数時間ぶんだけを描くと「その夜ぜんぶの予報」に見えてしまう。
         * 見出しを書き換えたあとに追記すること(先に足すと上書きで消える)。
         */
        var note = el("weather-note");
        var coverage = Net.coverageNote(grid);
        if (note) {
          note.hidden = !coverage;
          note.textContent = coverage || "";
        }
        if (!coverage && grid.updatedAt && head) {
          head.textContent += "／予報は " + jstTime(grid.updatedAt) + " 時点";
        }
      });
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    var initial = readUrlState();
    if (typeof initial.dayOffset === "number") state.dayOffset = initial.dayOffset;

    buildLegend();
    buildLayerTabs(initial.layer);
    buildDayTabs();
    setStatus("光害データを読み込んでいます…");

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
        if (initial.center) {
          map.jumpTo({
            center: initial.center,
            zoom: typeof initial.zoom === "number" ? initial.zoom : map.getZoom()
          });
        }
        map.on("moveend", writeUrlState);
        return map;
      })
      .then(function () {
        return loadNight(initial.timeIndex);
      })
      .then(loadSpots)
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
    nationalNightWindow: nationalNightWindow,
    selectDay: selectDay,
    addDays: addDays
  };
})(typeof window !== "undefined" ? window : globalThis);
