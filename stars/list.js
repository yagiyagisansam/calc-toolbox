/*
 * 地域別の一覧。
 *
 * 天気はサーバー側にキャッシュされた全国の格子(1度刻み)から読む。
 * 訪問者ごとに Open-Meteo へ問い合わせると、人数ぶんだけ上流の呼び出しが
 * 増えて同時に使えなくなるため(→ scripts/stars/weather-cache.sql)。
 *
 * 1スポットにつき「今夜のうち最も条件がよい時刻とその点数」を出す。
 * 星見は一晩じゅう外にいるわけではないので、最高値のほうが判断に使える。
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

  var state = {
    spots: [], // 予報とスコアを載せたスポット
    region: null, // 絞り込み中の地方(nullで全国)
    sort: "score",
    ready: false,
    error: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function jstTime(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function jstDate(date) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: JST,
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  /** 「今夜」の対象日(前夜がまだ明けていなければ前日)。判定は sky.js に集約 */
  function tonightDate() {
    return Sky.currentNightDate(36, 138, new Date());
  }

  function setStatus(message, isError) {
    var box = el("status");
    box.hidden = !message;
    box.textContent = message || "";
    box.classList.toggle("is-error", !!isError);
  }

  // ---- スコアの計算 -------------------------------------------------------

  /**
   * 1スポットぶんの予報から、今夜のうち最も条件がよい時刻を選ぶ。
   * その地点で空が充分に暗い時間帯だけを対象にする(全国の時間帯ではなく)。
   */
  function bestOfNight(spot, grid, ymd) {
    var lat = Number(spot.lat);
    var lon = Number(spot.lon);
    var window_ = Sky.nightWindow(ymd, lat, lon);
    var lpIndex = LP.isReady() ? LP.index(lat, lon) : null;
    var series = Net.gridSeries(grid, lat, lon);

    var best = null;
    for (var i = 0; i < series.times.length; i++) {
      var when = new Date(series.times[i] * 1000);
      // その地点で暗くない時刻は候補から外す
      if (window_ && (when < window_.start || when > window_.end)) continue;

      var result = Score.evaluate({
        lpIndex: lpIndex === null ? undefined : lpIndex,
        cloudPct: series.cloud[i],
        precipPct: series.precip[i],
        visibilityM: series.visibility[i],
        humidityPct: series.humidity[i],
        moonBrightness: Sky.brightness(when, lat, lon)
      });
      if (!best || result.score > best.score) {
        best = {
          score: result.score,
          band: result.band,
          at: when,
          cloud: series.cloud[i],
          darkness: result.darkness
        };
      }
    }
    return best;
  }

  // ---- 表 -----------------------------------------------------------------

  function visibleSpots() {
    var list = state.spots.filter(function (s) {
      return !state.region || s.region === state.region;
    });
    var sorters = {
      score: function (a, b) {
        return (b.best ? b.best.score : -1) - (a.best ? a.best.score : -1);
      },
      darkness: function (a, b) {
        return (b.best ? b.best.darkness : -1) - (a.best ? a.best.darkness : -1);
      },
      name: function (a, b) {
        return String(a.name_kana || a.name).localeCompare(String(b.name_kana || b.name), "ja");
      },
      pref: function (a, b) {
        return String(a.pref).localeCompare(String(b.pref), "ja") ||
          String(a.name).localeCompare(String(b.name), "ja");
      }
    };
    return list.sort(sorters[state.sort] || sorters.score);
  }

  function renderTable() {
    var tbody = el("spot-rows");
    var table = el("spot-table");
    tbody.textContent = "";

    var list = visibleSpots();
    if (!list.length) {
      table.hidden = true;
      setStatus(
        state.region
          ? state.region + "に掲載中のスポットはまだありません。"
          : "掲載中のスポットはまだありません。よい場所をご存じでしたら申請してください。",
        false
      );
      return;
    }
    setStatus("", false);
    table.hidden = false;

    list.forEach(function (spot) {
      var tr = document.createElement("tr");

      // スポット名(詳細へのリンク)と都道府県
      var th = document.createElement("th");
      th.scope = "row";
      var link = document.createElement("a");
      link.href = "./spot.html?id=" + encodeURIComponent(spot.spot_id);
      link.textContent = spot.name;
      th.appendChild(link);
      var pref = document.createElement("span");
      pref.className = "stars-cell-sub";
      pref.textContent = spot.pref;
      th.appendChild(pref);
      tr.appendChild(th);

      // 星見レベル
      var tdScore = document.createElement("td");
      if (spot.best) {
        var chip = document.createElement("span");
        chip.className = "stars-band-chip";
        chip.style.backgroundColor = Palette.BAND_COLORS_ON_MAP[Score.bandIndex(spot.best.score)];
        tdScore.appendChild(chip);
        var label = document.createElement("span");
        label.textContent = spot.best.band.label;
        tdScore.appendChild(label);
        var num = document.createElement("span");
        num.className = "stars-cell-sub";
        num.textContent = spot.best.score + "点";
        tdScore.appendChild(num);
      } else {
        tdScore.textContent = "—";
      }
      tr.appendChild(tdScore);

      tr.appendChild(cell(spot.best ? jstTime(spot.best.at) : "—"));
      tr.appendChild(cell(spot.best ? Math.round(spot.best.cloud) + "%" : "—"));
      tr.appendChild(cell(spot.best ? Math.round(spot.best.darkness * 100) + "%" : "—"));
      tr.appendChild(cell(spot.elevation_m ? spot.elevation_m + "m" : "—"));

      tbody.appendChild(tr);
    });
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function buildTabs(regions) {
    var box = el("region-tabs");
    var all = [{ key: null, label: "全国" }].concat(
      regions.map(function (r) {
        return { key: r, label: r };
      })
    );
    all.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "stars-tab";
      button.textContent = item.label;
      button.setAttribute("aria-pressed", String(state.region === item.key));
      button.addEventListener("click", function () {
        state.region = item.key;
        Array.prototype.forEach.call(box.children, function (b) {
          b.setAttribute("aria-pressed", String(b === button));
        });
        renderTable();
      });
      box.appendChild(button);
    });
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    var ymd = tonightDate();

    fetch("./data/prefs.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        buildTabs(data.regions);
      })
      .catch(function () {
        /* タブが出なくても表は使える */
      });

    // 全国の夜の時間帯(見出し用)。個々の判定は地点ごとに計算する。
    var tokyoNight = Sky.nightWindow(ymd, 35.68, 139.76);
    if (tokyoNight) {
      el("night-range").textContent =
        jstDate(tokyoNight.start) +
        "の夜の予報です(東京で " +
        jstTime(tokyoNight.start) +
        "〜" +
        jstTime(tokyoNight.end) +
        "。時間帯は地点ごとに計算しています)";
    }

    if (!Net.backendReady()) {
      setStatus("いまはスポットの一覧を表示できません。", true);
      return;
    }

    // 光害データは無くても予報だけで表は出せるので、失敗しても止めない
    var lpReady = LP.load(CONFIG.lightPollution.dataDir).catch(function () {});

    Promise.all([lpReady, Net.publicSpots()])
      .then(function (results) {
        var spots = results[1] || [];
        state.spots = spots;
        if (!spots.length) {
          renderTable();
          state.ready = true;
          return null;
        }

        setStatus("今夜の予報を読み込んでいます…", false);
        // 掲載スポット全部を覆う時間帯を求め、格子から一度に切り出す。
        // 地点ごとの絞り込みは受け取ってから行う。
        var starts = [];
        var ends = [];
        spots.forEach(function (s) {
          var w = Sky.nightWindow(ymd, Number(s.lat), Number(s.lon));
          if (w) {
            starts.push(w.start.getTime());
            ends.push(w.end.getTime());
          }
        });
        if (!starts.length) {
          renderTable();
          state.ready = true;
          return null;
        }
        var from = new Date(Math.floor(Math.min.apply(null, starts) / 3600000) * 3600000);
        var to = new Date(Math.ceil(Math.max.apply(null, ends) / 3600000) * 3600000);

        return Net.fetchGrid(from, to).then(function (grid) {
          spots.forEach(function (spot) {
            spot.best = bestOfNight(spot, grid, ymd);
          });
          renderTable();
          // 予報が今夜を賄えていないときは黙らない(地図ページと同じ扱い)
          var coverage = Net.coverageNote(grid);
          setStatus(coverage || "", !!coverage);
          state.ready = true;
        });
      })
      .catch(function (err) {
        state.error = String(err && err.message ? err.message : err);
        // 予報が取れなくても、掲載スポットの一覧そのものは出す
        if (state.spots.length) {
          renderTable();
          setStatus("今夜の予報を取得できませんでした。スポットの一覧のみ表示しています。", true);
        } else {
          setStatus("スポットを取得できませんでした。時間をおいてお試しください。", true);
        }
        state.ready = true;
      });

    el("sort-select").addEventListener("change", function (e) {
      state.sort = e.target.value;
      renderTable();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  global.StarsList = { state: state, bestOfNight: bestOfNight };
})(typeof window !== "undefined" ? window : globalThis);
