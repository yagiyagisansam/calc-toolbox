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

  /**
   * 「今夜」の対象日。
   *
   * 一覧から来たときは、一覧が使った日を URL の night= で受け取り、それに従う。
   * 一覧と詳細で別々に判定すると、日付の変わり目に食い違う ──
   * 8月15日 4時(日本時間)の時点で、東経138度あたりは既に「8月15日の夜」だが、
   * 石垣島はまだ「8月14日の夜」が明けていない。同じスポットについて
   * 一覧が15日の夜、詳細が14日の夜を見せる、ということが起きていた。
   *
   * 直接開かれたときだけ、そのスポットの位置で判定する。
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} [fromUrl] URL で指定された "YYYY-MM-DD"
   */
  function tonightDate(lat, lon, fromUrl) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromUrl || "")) return fromUrl;
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
    setText("detail-caution", spot.caution || "特にありません");
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

    // 予報が欠けている時刻はベストの候補にしない
    var scored = hours.filter(function (h) {
      return h.score !== null;
    });
    if (!scored.length) {
      el("hourly-table").hidden = false;
      renderRows(tbody, hours, null);
      return;
    }

    var best = scored.reduce(function (a, b) {
      return b.score > a.score ? b : a;
    });

    el("summary").hidden = false;
    setText("best-score", best.score + " / 100");
    setText("best-band", best.band.label);
    /*
     * ベスト時刻に、良い条件が続く長さを添える。
     * 最高点だけだと「1時間だけ晴れる夜」と「一晩中晴れる夜」が同じに見える。
     * 出かけるかどうかを決めるのに、続き具合は点数と同じくらい効く。
     *
     * 数え方は Score.goodSpan に置いてある(一覧と同じ計算)。
     * 欠測を飛ばした scored ではなく hours を渡す。飛ばすと、間の空いた
     * 良い時刻どうしが「続いていた」ことになってしまう。
     */
    var span = Score.goodSpan(hours);
    var atText = jstDate(best.at) + " " + jstTime(best.at) + " ごろ";
    if (span.longestHours > 0) {
      atText +=
        "（「良い」以上が約 " + span.totalHours + " 時間、うち続けて約 " +
        span.longestHours + " 時間）";
    }
    setText("best-at", atText);
    setText("fact-darkness", Math.round(best.darkness * 100) + "%（光害の少なさ）");

    /*
     * 月は「その夜のいつ空に出ているか」を先に出す。
     *
     * 満月でも沈んでいれば星見への影響はゼロで、逆に細い月でも高く昇っていれば効く。
     * 点数の計算もそうなっている(brightness は地平線下で 0 を返し、
     * 出ている間は sin(高度) で重みを付ける。月齢は点数に一切入らない)。
     * 先に月齢や輝面比を見せると、影響の有無を取り違えさせる ──
     * 「今夜は満月だからやめよう」と、実は月が出ない夜を捨ててしまう。
     * 満ち欠けは、いつ出入りするかを読んだあとの補足でよい。
     */
    var moon = Sky.summary(best.at, Number(spot.lat), Number(spot.lon));
    var moonText = moonWhenText(night, spot);
    if (moonText) moonText += "／";
    moonText +=
      moon.phaseLabel + "・" + moon.illuminationPct + "%光っている" +
      "（月齢" + moon.ageDays + "）";
    setText("fact-moon", moonText);
    setText(
      "fact-night",
      night ? jstTime(night.start) + "〜" + jstTime(night.end) : "この日は充分に暗くなりません"
    );

    el("hourly-table").hidden = false;
    renderRows(tbody, hours, best);
  }

  function renderRows(tbody, hours, best) {
    hours.forEach(function (h) {
      var tr = document.createElement("tr");
      if (best && h === best) tr.className = "is-best";

      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = jstTime(h.at);
      tr.appendChild(th);

      // 予報が欠けている時刻。快晴として点を付けず、はっきり「データなし」と出す。
      if (h.score === null) {
        var none = document.createElement("td");
        none.className = "stars-cell-none";
        none.colSpan = 6;
        none.textContent = "データなし";
        tr.appendChild(none);
        tbody.appendChild(tr);
        return;
      }

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

  /**
   * その夜のあいだ、月がいつ空に出ているかを一言で表す。
   * 月あかりを避けたい人が最初に知りたいのはこれ。
   */
  function moonWhenText(night, spot) {
    if (!night) return "";
    var rs = Sky.moonRiseSet(night.start, night.end, Number(spot.lat), Number(spot.lon));
    if (rs.rise && rs.set) {
      return rs.rise < rs.set
        ? jstTime(rs.rise) + "に出て " + jstTime(rs.set) + "に沈みます"
        : jstTime(rs.set) + "に沈み " + jstTime(rs.rise) + "にまた出ます";
    }
    if (rs.set) return jstTime(rs.set) + "に沈みます（それ以降は月あかりの影響なし）";
    if (rs.rise) return jstTime(rs.rise) + "に出てきます（それまでは月あかりの影響なし）";
    return rs.upAtStart ? "一晩中出ています" : "一晩中沈んでいます（月あかりの影響なし）";
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  /*
   * 場所を地図で見せる。
   *
   * 地図そのものは別のページ(pick.html)で動かし、ここでは枠に読み込むだけ。
   * MapLibre は中で DOM への文字列の書き込みを行うので、同居させると
   * この画面で Trusted Types を強制できなくなる。見せるだけの地図のために
   * 画面全体の守りを下げる理由はない。
   *
   * 渡すのは緯度・経度・拡大率だけ。向こうは数として読めなければ何もしない。
   */
  function renderMap(spot) {
    var box = el("spot-map");
    if (!box) return;
    var lat = Number(spot.lat);
    var lon = Number(spot.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    box.hidden = false;

    var frame = document.createElement("iframe");
    frame.src =
      "./pick.html?view=1&lat=" + encodeURIComponent(lat) +
      "&lon=" + encodeURIComponent(lon) + "&zoom=10";
    frame.title = spot.name + " の場所";
    frame.className = "stars-pickmap-frame";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "same-origin");
    frame.setAttribute("loading", "lazy");
    box.appendChild(frame);
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    var params = new URLSearchParams(location.search);
    var id = params.get("id");
    // 一覧が使った「今夜」の日。食い違いを避けるため、あればこちらを優先する。
    var nightParam = params.get("night");
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
        var night = Sky.nightWindow(tonightDate(lat, lon, nightParam), lat, lon);
        if (!night) {
          setStatus("この日は空が充分に暗くなる時間帯がありません。", false);
          return null;
        }
        var from = new Date(Math.floor(night.start.getTime() / 3600000) * 3600000);
        var to = new Date(Math.ceil(night.end.getTime() / 3600000) * 3600000);

        return Net.fetchGrid(from, to).then(function (grid) {
          var series = Net.gridSeries(grid, lat, lon);
          var lpIndex = LP.isReady() ? LP.index(lat, lon) : null;

          state.hours = [];
          series.times.forEach(function (t, i) {
            var when = new Date(t * 1000);
            // 予報は1時間刻みなので、上で外側の丸い時刻まで広げて取ってきている。
            // その両端は空がまだ(もう)暗くない時刻なので、表にも「今夜のベスト」にも
            // 入れない。ここを外すと、薄明が始まった後の時刻がベストに選ばれてしまう
            // (一覧ページの bestOfNight と同じ絞り込み)。
            if (when < night.start || when > night.end) return;

            var result = Score.evaluate({
              lpIndex: lpIndex === null ? undefined : lpIndex,
              cloudPct: series.cloud[i],
              precipPct: series.precip[i],
              visibilityM: series.visibility[i],
              humidityPct: series.humidity[i],
              moonBrightness: Sky.brightness(when, lat, lon)
            });
            // 予報が欠けている時刻。行は残して「データなし」と出す
            // (黙って飛ばすと、その時刻が無かったように見えてしまう)。
            if (!result) {
              state.hours.push({ at: when, score: null, band: null });
              return;
            }
            state.hours.push({
              at: when,
              score: result.score,
              band: result.band,
              darkness: result.darkness,
              cloud: series.cloud[i],
              precip: series.precip[i],
              visibility: series.visibility[i],
              humidity: series.humidity[i],
              moonAlt: Sky.position(when, lat, lon).altitudeDeg
            });
          });

          renderHours(spot, state.hours, night);
          // 暗い時間帯が1時間に満たないと、予報の刻みに乗る時刻が1つも残らない
          if (!state.hours.length) {
            setStatus("今夜は空が充分に暗い時間帯が短く、1時間ごとの予報に乗りません。", false);
            state.ready = true;
            return;
          }
          setStatus(Net.coverageNote(grid) || "", false);
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
