/*
 * スポットの詳細。?id=<spot_id> で1件を表示する。
 *
 * 天気はサーバー側にキャッシュされた全国の格子から、最も近い格子点を読む
 * (→ scripts/stars/weather-cache.sql)。1時間ごとの推移を出す。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;
  var Sky = global.StarsSky;
  var Score = global.StarsScore;
  var Palette = global.StarsPalette;
  var LP = global.StarsLP;
  var Net = global.StarsNet;

  var JST = "Asia/Tokyo";
  var state = { spot: null, hours: [], ready: false, error: null };

  function el(id) {
    return document.getElementById(id);
  }

  function jstTime(d) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d);
  }

  function jstDate(d) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST, month: "long", day: "numeric", weekday: "short"
    }).format(d);
  }

  /** 「今夜」の対象日。そのスポットの位置で判定する(sky.js に集約) */
  function tonightDate(lat, lon) {
    return Sky.currentNightDate(lat, lon, new Date());
  }

  function setStatus(message, isError) {
    var box = el("status");
    box.hidden = !message;
    box.textContent = message || "";
    box.classList.toggle("is-error", !!isError);
  }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  // ---- 表示 ---------------------------------------------------------------

  function renderHeader(spot) {
    document.title = spot.name + "の星見予報 | 今夜のオススメ星見スポット";
    setText("spot-name", spot.name);
    setText(
      "spot-place",
      spot.pref + (spot.name_kana ? "（" + spot.name_kana + "）" : "")
    );
    setText("fact-elev", spot.elevation_m ? spot.elevation_m + " m" : "登録なし");

    el("spot-details").hidden = false;
    setText("detail-access", spot.access || "登録なし");
    setText("detail-facilities", spot.facilities || "登録なし");
    setText("detail-note", spot.note || "登録なし");

    var source = el("detail-source");
    source.textContent = "";
    if (isSafeUrl(spot.source_url)) {
      var a = document.createElement("a");
      a.href = spot.source_url;
      a.textContent = spot.source_url;
      a.target = "_blank";
      a.rel = "noopener nofollow";
      source.appendChild(a);
    } else if (spot.source_url) {
      // https 以外は、リンクにせず文字として出す
      source.textContent = spot.source_url;
    } else {
      source.textContent = "登録なし";
    }
  }

  /**
   * リンクとして開いてよいURLか。
   *
   * 申請時にデータベース側のトリガが https:// だけを通しているが、
   * ここは外から来た文字列がそのまま href に入る唯一の場所なので、
   * 表示側でも確かめる。javascript: や data: を踏ませないため。
   */
  function isSafeUrl(url) {
    if (typeof url !== "string") return false;
    try {
      return new URL(url).protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function renderHours(spot, hours, night) {
    var tbody = el("hourly-rows");
    tbody.textContent = "";
    if (!hours.length) return;

    var best = hours.reduce(function (a, b) {
      return b.score > a.score ? b : a;
    });

    el("summary").hidden = false;
    setText("best-score", best.score + " / 100");
    setText("best-band", best.band.label);
    setText("best-at", jstDate(best.at) + " " + jstTime(best.at) + " ごろ");
    setText("fact-darkness", Math.round(best.darkness * 100) + "%（光害の少なさ）");

    var moon = Sky.summary(best.at, Number(spot.lat), Number(spot.lon));
    setText(
      "fact-moon",
      moon.phaseLabel + "・月齢" + moon.ageDays + "・輝面比" + moon.illuminationPct + "%" +
        (moon.altitudeDeg > 0 ? "（高度" + Math.round(moon.altitudeDeg) + "度）" : "（地平線下）")
    );
    setText(
      "fact-night",
      night ? jstTime(night.start) + "〜" + jstTime(night.end) : "この日は充分に暗くなりません"
    );

    el("hourly-table").hidden = false;
    hours.forEach(function (h) {
      var tr = document.createElement("tr");
      if (h === best) tr.className = "is-best";

      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = jstTime(h.at);
      tr.appendChild(th);

      var td = document.createElement("td");
      var chip = document.createElement("span");
      chip.className = "stars-band-chip";
      chip.style.backgroundColor = Palette.BAND_COLORS_ON_MAP[Score.bandIndex(h.score)];
      td.appendChild(chip);
      td.appendChild(document.createTextNode(h.band.label));
      var num = document.createElement("span");
      num.className = "stars-cell-sub";
      num.textContent = h.score + "点";
      td.appendChild(num);
      tr.appendChild(td);

      tr.appendChild(cell(Math.round(h.cloud) + "%"));
      tr.appendChild(cell(Math.round(h.precip) + "%"));
      tr.appendChild(cell(h.visibility === null ? "—" : Math.round(h.visibility / 1000) + "km"));
      tr.appendChild(cell(h.humidity === null ? "—" : Math.round(h.humidity) + "%"));
      tr.appendChild(cell(h.moonAlt > 0 ? Math.round(h.moonAlt) + "度" : "地平線下"));

      tbody.appendChild(tr);
    });
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function renderMap(spot) {
    if (!global.maplibregl) return;
    global.maplibregl.setWorkerUrl("./vendor/maplibre-gl-csp-worker.js");
    var box = el("spot-map");
    box.hidden = false;

    var map = new maplibregl.Map({
      container: "spot-map",
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#0c0c0c" } }]
      },
      center: [Number(spot.lon), Number(spot.lat)],
      zoom: 10,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    var pin = document.createElement("div");
    pin.className = "stars-pin";
    new maplibregl.Marker({ element: pin })
      .setLngLat([Number(spot.lon), Number(spot.lat)])
      .addTo(map);

    map.on("load", function () {
      fetch(CONFIG.map.styleUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("style");
          return r.json();
        })
        .then(function (style) {
          map.setStyle(style);
        })
        .catch(function () {
          /* 下地なしでも位置は分かる */
        });
    });
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    var id = new URLSearchParams(location.search).get("id");
    if (!id) {
      setStatus("スポットが指定されていません。一覧から選び直してください。", true);
      return;
    }
    if (!Net.backendReady()) {
      setStatus("いまはスポットを表示できません。", true);
      return;
    }

    setStatus("読み込んでいます…", false);

    Promise.all([
      LP.load(CONFIG.lightPollution.dataDir).catch(function () {}),
      Net.publicSpots()
    ])
      .then(function (results) {
        var spot = (results[1] || []).filter(function (s) {
          return s.spot_id === id;
        })[0];
        if (!spot) {
          setStatus("このスポットは見つかりませんでした。掲載が取り下げられた可能性があります。", true);
          return null;
        }
        state.spot = spot;
        renderHeader(spot);
        renderMap(spot);

        var lat = Number(spot.lat);
        var lon = Number(spot.lon);
        var night = Sky.nightWindow(tonightDate(lat, lon), lat, lon);
        if (!night) {
          setStatus("この日は空が充分に暗くなる時間帯がありません。", false);
          return null;
        }
        var from = new Date(Math.floor(night.start.getTime() / 3600000) * 3600000);
        var to = new Date(Math.ceil(night.end.getTime() / 3600000) * 3600000);

        return Net.fetchGrid(from, to).then(function (grid) {
          var series = Net.gridSeries(grid, lat, lon);
          var lpIndex = LP.isReady() ? LP.index(lat, lon) : null;

          state.hours = series.times.map(function (t, i) {
            var when = new Date(t * 1000);
            var result = Score.evaluate({
              lpIndex: lpIndex === null ? undefined : lpIndex,
              cloudPct: series.cloud[i],
              precipPct: series.precip[i],
              visibilityM: series.visibility[i],
              humidityPct: series.humidity[i],
              moonBrightness: Sky.brightness(when, lat, lon)
            });
            return {
              at: when,
              score: result.score,
              band: result.band,
              darkness: result.darkness,
              cloud: series.cloud[i],
              precip: series.precip[i],
              visibility: series.visibility[i],
              humidity: series.humidity[i],
              moonAlt: Sky.position(when, lat, lon).altitudeDeg
            };
          });

          renderHours(spot, state.hours, night);
          setStatus("", false);
          state.ready = true;
        });
      })
      .catch(function (err) {
        state.error = String(err && err.message ? err.message : err);
        setStatus("今夜の予報を取得できませんでした。時間をおいてお試しください。", true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  global.StarsSpot = { state: state };
})(typeof window !== "undefined" ? window : globalThis);
