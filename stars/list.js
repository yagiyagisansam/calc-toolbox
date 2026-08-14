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
  var Here = global.StarsHere;
  var Places = global.StarsPlaces;

  var JST = "Asia/Tokyo";

  var state = {
    spots: [], // 予報とスコアを載せたスポット
    region: null, // 絞り込み中の地方(nullで全国)
    pref: null, // 絞り込み中の都道府県(nullですべて)
    city: null, // 絞り込み中の市区町村(nullですべて)
    sort: "score",
    /*
     * 「近い順」の基準にする場所。
     * 現在地・地名検索・地図のタップ、どれで決めても同じここに入る。
     * { lat, lon, label } の形。label は画面に出す名前。
     */
    origin: null,
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

  /**
   * 「今夜」の対象日(前夜がまだ明けていなければ前日)。判定は sky.js に集約。
   *
   * 地点ごとに求める。全国を1つの日で代表させると、日付の変わり目に食い違う ──
   * 8月15日 4時(日本時間)の時点で、東経138度あたりは既に「8月15日の夜」だが、
   * 石垣島はまだ「8月14日の夜」が明けていない。以前は (36,138) の判定を
   * 全スポットに当てていたので、石垣島の一覧は15日の夜、詳細は14日の夜を
   * 見せていた。
   *
   * now は起動時に1回だけ取った時刻を渡すこと。スポットごとに new Date() を
   * 呼ぶと、処理の途中で日付が変わったときに一部だけ別の夜になる。
   */
  function tonightDateAt(lat, lon, now) {
    return Sky.currentNightDate(lat, lon, now);
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
  function bestOfNight(spot, grid) {
    var lat = Number(spot.lat);
    var lon = Number(spot.lon);
    // その夜がどの日かはスポットごとに決まっている(start で入れてある)
    var window_ = Sky.nightWindow(spot.nightDate, lat, lon);
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
      // 予報が欠けている時刻はベストの候補にしない(0点でも満点でもなく「無い」)
      if (!result) continue;
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
      if (state.region && s.region !== state.region) return false;
      if (state.pref && s.pref !== state.pref) return false;
      if (state.city && cityOf(s) !== state.city) return false;
      return true;
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
      },
      near: function (a, b) {
        if (!state.origin) return 0;
        return distanceOf(a) - distanceOf(b);
      }
    };
    return list.sort(sorters[state.sort] || sorters.score);
  }

  /** 基準点からの直線距離(km)。基準点が無ければ比較で最後に回るよう大きな値を返す */
  function distanceOf(spot) {
    if (!state.origin) return Infinity;
    return Here.distanceKm(state.origin, { lat: Number(spot.lat), lon: Number(spot.lon) });
  }

  /**
   * スポットの市区町村。
   * 申請時に入れてもらう city をそのまま使う。座標から推測はしない ──
   * 市境の近くでは隣の町に化けるし、化けても誰も気づけない。
   */
  function cityOf(spot) {
    return spot.city || null;
  }

  // ---- 基準点(どこから近い順に並べるか) -----------------------------------

  /**
   * 基準点を決める。現在地・地名検索・地図のタップ、どれもここに集める。
   * 入口が3つあっても中の扱いを1つにしておかないと、片方だけ直し忘れる。
   *
   * @param {{lat:number, lon:number}} point
   * @param {string} label 画面に出す名前(「秩父市」「地図で指定した場所」など)
   */
  function setOrigin(point, label) {
    if (!point || !isFinite(point.lat) || !isFinite(point.lon)) return;
    state.origin = { lat: point.lat, lon: point.lon, label: label || "指定した場所" };

    var option = el("sort-near");
    if (option) option.hidden = false;
    var note = el("here-note");
    if (note) note.hidden = false;

    var box = el("origin-current");
    var text = el("origin-label");
    if (box && text) {
      text.textContent = "基準: " + state.origin.label;
      box.hidden = false;
    }

    // 基準点を決めた人は近い順が見たいはずなので、そちらへ切り替える
    state.sort = "near";
    var sortSelect = el("sort-select");
    if (sortSelect) sortSelect.value = "near";

    if (marker) marker.setLngLat([state.origin.lon, state.origin.lat]);
    renderTable();
  }

  function clearOrigin() {
    state.origin = null;
    var box = el("origin-current");
    if (box) box.hidden = true;
    var note = el("here-note");
    if (note) note.hidden = true;
    var option = el("sort-near");
    if (option) option.hidden = true;
    if (state.sort === "near") {
      state.sort = "score";
      var sortSelect = el("sort-select");
      if (sortSelect) sortSelect.value = "score";
    }
    renderTable();
  }

  /**
   * 現在地を使う。
   * 位置情報は毎回尋ねるものではないので、地図ページで許可済みなら
   * 覚えてある値をそのまま使う。
   */
  function setupHere() {
    var button = el("use-here");
    if (!Here || !button) return;

    var remembered = Here.recall();
    if (remembered) setOrigin(remembered, "現在地");

    button.addEventListener("click", function () {
      button.disabled = true;
      button.textContent = "調べています…";
      Here.ask().then(function (here) {
        button.disabled = false;
        button.textContent = "現在地";
        if (here) {
          setOrigin(here, "現在地");
        } else {
          setStatus("現在地を取得できませんでした。端末の位置情報の設定をご確認ください。", true);
        }
      });
    });
  }

  // ---- 地名でさがす -------------------------------------------------------

  /**
   * 検索の候補を出す。
   *
   * 索引(places.json)と、掲載スポットの名前の両方を見る。
   * 索引は市区町村・山・湖などを網羅しているが、「四国カルスト」のような
   * 通称は入っていないことがある。掲載スポット名も引くことで、
   * 利用者が実際に見ている名前で辿れるようにする。
   */
  function suggest(query) {
    var q = Places ? Places.normalize(query) : String(query || "").trim();
    if (!q) return [];

    var out = [];

    // まず掲載スポットそのもの(その名前で探した人は、それを見たいはず)
    state.spots.forEach(function (spot) {
      var name = String(spot.name || "");
      var kana = String(spot.name_kana || "");
      if (name.indexOf(q) >= 0 || (kana && kana.indexOf(q) >= 0)) {
        out.push({
          label: name,
          sub: spot.pref + (spot.city ? " " + spot.city : "") + "・掲載スポット",
          lat: Number(spot.lat),
          lon: Number(spot.lon)
        });
      }
    });

    if (Places && Places.isReady()) {
      Places.search(q, 12).forEach(function (place) {
        out.push({
          label: place.name,
          sub: place.pref + "・" + place.kind,
          lat: place.lat,
          lon: place.lon,
          pref: place.pref,
          kind: place.kind
        });
      });
    }

    return out.slice(0, 12);
  }

  function renderSuggest(items) {
    var box = el("place-results");
    var input = el("place-search");
    if (!box) return;
    box.textContent = "";

    if (!items.length) {
      box.hidden = true;
      if (input) input.setAttribute("aria-expanded", "false");
      return;
    }

    items.forEach(function (item) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");

      var button = document.createElement("button");
      button.type = "button";
      button.className = "stars-suggest-item";

      var name = document.createElement("span");
      name.className = "stars-suggest-name";
      name.textContent = item.label;
      button.appendChild(name);

      var sub = document.createElement("span");
      sub.className = "stars-suggest-sub";
      sub.textContent = item.sub;
      button.appendChild(sub);

      button.addEventListener("click", function () {
        setOrigin({ lat: item.lat, lon: item.lon }, item.label);
        /*
         * 都道府県で探したときは、その県だけに絞り込む。
         * 「埼玉県」と打った人は埼玉のスポットが見たいのであって、
         * 埼玉から近い順に全国を見たいわけではない。
         */
        if (item.kind === "都道府県") {
          setPref(item.label);
        }
        renderSuggest([]);
        var field = el("place-search");
        if (field) field.value = item.label;
      });

      li.appendChild(button);
      box.appendChild(li);
    });

    box.hidden = false;
    if (input) input.setAttribute("aria-expanded", "true");
  }

  function setupSearch() {
    var input = el("place-search");
    if (!input) return;

    /*
     * 索引は約176KB(gzip後)ある。一覧を開いただけの人に読ませる必要はないので、
     * 検索欄に触れてから取りに行く。
     */
    var started = false;
    function ensureLoaded() {
      if (started || !Places) return Promise.resolve();
      started = true;
      return Places.load(CONFIG.lightPollution.dataDir).catch(function () {
        setStatus("地名データを読み込めませんでした。掲載スポット名では探せます。", true);
      });
    }

    input.addEventListener("focus", ensureLoaded);
    input.addEventListener("input", function () {
      var value = input.value;
      if (!value.trim()) {
        renderSuggest([]);
        return;
      }
      ensureLoaded().then(function () {
        renderSuggest(suggest(value));
      });
    });

    // 候補の外を触ったら閉じる
    document.addEventListener("click", function (e) {
      var box = el("place-results");
      if (!box || box.hidden) return;
      if (e.target === input || box.contains(e.target)) return;
      renderSuggest([]);
    });

    var clear = el("origin-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        clearOrigin();
        input.value = "";
        renderSuggest([]);
      });
    }
  }

  // ---- 地図で選ぶ ---------------------------------------------------------

  var pickMap = null;
  var marker = null;

  /**
   * 地図をタップして基準点を置く。
   * 地図は押されたときに初めて作る(開かない人には作らない)。
   */
  function setupPickMap() {
    var button = el("pick-on-map");
    var wrap = el("pick-map-wrap");
    if (!button || !wrap) return;

    button.addEventListener("click", function () {
      var open = wrap.hidden;
      wrap.hidden = !open;
      button.textContent = open ? "地図を閉じる" : "地図で選ぶ";
      if (!open || pickMap) {
        if (pickMap) pickMap.resize();
        return;
      }
      if (!global.maplibregl) {
        setStatus("地図を読み込めませんでした。地名でお探しください。", true);
        return;
      }

      global.maplibregl.setWorkerUrl("./vendor/maplibre-gl-csp-worker.js");
      pickMap = new global.maplibregl.Map({
        container: "pick-map",
        // config.js の center は MapLibre と同じ [経度, 緯度] の順で持っている
        style: CONFIG.map.styleUrl,
        center: state.origin
          ? [state.origin.lon, state.origin.lat]
          : CONFIG.map.center,
        zoom: state.origin ? 8 : 4,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        maxPitch: 0
      });
      pickMap.touchZoomRotate.disableRotation();
      pickMap.addControl(new global.maplibregl.NavigationControl({ showCompass: false }), "top-right");

      marker = new global.maplibregl.Marker({ color: "#fdd171" });
      if (state.origin) marker.setLngLat([state.origin.lon, state.origin.lat]).addTo(pickMap);

      pickMap.on("click", function (e) {
        var point = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        if (!marker._map) marker.addTo(pickMap);
        marker.setLngLat([point.lon, point.lat]);
        setOrigin(point, describePoint(point));
      });
    });
  }

  /**
   * 地図で置いた場所に名前をつける。
   * 索引の中でいちばん近い市区町村を使う。緯度経度だけ出しても伝わらないため。
   */
  function describePoint(point) {
    if (!Places || !Places.isReady()) {
      return "地図で指定した場所 (" + point.lat.toFixed(2) + ", " + point.lon.toFixed(2) + ")";
    }
    /*
     * 近さは市区町村の代表点で測る。厳密な行政界ではないので「付近」と書く。
     * 遠すぎるとき(離島や海上)は無理に地名をつけず、座標をそのまま出す。
     */
    var nearest = nearestCity(point);
    if (nearest && nearest.km < 60) return nearest.name + "付近";
    return "地図で指定した場所 (" + point.lat.toFixed(2) + ", " + point.lon.toFixed(2) + ")";
  }

  /** 索引の市区町村のうち、その地点にいちばん近いもの */
  function nearestCity(point) {
    var meta = Places && Places.meta();
    if (!meta) return null;
    var best = null;
    var bestKm = Infinity;
    for (var i = 0; i < meta.places.length; i++) {
      var row = meta.places[i];
      var kind = meta.kinds[row[3]];
      if (kind !== "市・郡" && kind !== "町・村・区") continue;
      var km = Here.distanceKm(point, { lat: row[4], lon: row[5] });
      if (km < bestKm) {
        bestKm = km;
        best = row[0];
      }
    }
    return best ? { name: best, km: bestKm } : null;
  }

  // ---- 都道府県・市区町村のしぼりこみ ---------------------------------------

  function setPref(pref) {
    state.pref = pref || null;
    state.city = null;
    var prefSelect = el("pref-select");
    if (prefSelect && prefSelect.value !== (pref || "")) prefSelect.value = pref || "";
    /*
     * 県を選んだら地方タブは全国に戻す。
     * 「関東」タブのまま「大阪府」を選ぶと何も出ず、理由も分からないため。
     */
    if (state.pref) {
      state.region = null;
      highlightTabs();
    }
    buildCityOptions();
    renderTable();
  }

  /**
   * 市区町村の選択肢を作る。
   * 出すのは「掲載スポットが実際にある市区町村」だけ。
   * 全国1900件を並べても、ほとんどが空振りになって選ぶ意味がない。
   */
  function buildCityOptions() {
    var select = el("city-select");
    if (!select) return;
    select.textContent = "";

    var head = document.createElement("option");
    head.value = "";
    head.textContent = "すべて";
    select.appendChild(head);

    var cities = [];
    state.spots.forEach(function (spot) {
      var city = cityOf(spot);
      if (!city) return;
      if (state.pref && spot.pref !== state.pref) return;
      if (cities.indexOf(city) < 0) cities.push(city);
    });
    cities.sort(function (a, b) {
      return a.localeCompare(b, "ja");
    });

    cities.forEach(function (city) {
      var option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      select.appendChild(option);
    });

    select.disabled = cities.length === 0;
    select.value = state.city || "";
  }

  /** 掲載スポットのある都道府県だけを選択肢にする */
  function buildPrefOptions() {
    var select = el("pref-select");
    if (!select) return;
    select.textContent = "";

    var head = document.createElement("option");
    head.value = "";
    head.textContent = "すべて";
    select.appendChild(head);

    var prefs = [];
    state.spots.forEach(function (spot) {
      if (spot.pref && prefs.indexOf(spot.pref) < 0) prefs.push(spot.pref);
    });
    prefs.sort(function (a, b) {
      return a.localeCompare(b, "ja");
    });

    prefs.forEach(function (pref) {
      var option = document.createElement("option");
      option.value = pref;
      option.textContent = pref;
      select.appendChild(option);
    });
    select.value = state.pref || "";
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
      // 詳細が同じ夜を見るように、一覧が使った日を渡す
      link.href =
        "./spot.html?id=" + encodeURIComponent(spot.spot_id) +
        (spot.nightDate ? "&night=" + encodeURIComponent(spot.nightDate) : "");
      link.textContent = spot.name;
      th.appendChild(link);
      var pref = document.createElement("span");
      pref.className = "stars-cell-sub";
      // 子連れではトイレと駐車の有無が最優先なので、詳細を開かなくても分かるようにする
      pref.textContent = spot.pref + facilityMarks(spot);
      th.appendChild(pref);

      // 基準点が決まっていれば直線距離を添える(道のりではない旨は表の下に明記)
      if (state.origin) {
        var dist = document.createElement("span");
        dist.className = "stars-cell-sub";
        dist.textContent = "直線 約" + Math.round(distanceOf(spot)) + "km";
        th.appendChild(dist);
      }
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

  /**
   * 設備の有無を短い印にする。
   * 申請は自由記述なので、書かれていれば有り・触れていなければ何も出さない
   * (「無い」と断定はできないため)。
   */
  function facilityMarks(spot) {
    var text = (spot.facilities || "") + " " + (spot.access || "");
    var marks = [];
    if (/トイレ|お手洗|便所/.test(text) && !/トイレ(は)?(無|な)し/.test(text)) marks.push("トイレ");
    if (/駐車|パーキング|停め/.test(text)) marks.push("駐車");
    return marks.length ? "・" + marks.join("・") : "";
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
      button.dataset.region = item.key === null ? "" : item.key;
      button.addEventListener("click", function () {
        state.region = item.key;
        /*
         * 地方を選んだら都道府県・市区町村の絞り込みは外す。
         * 「中部」と「埼玉県」を同時に効かせると何も出ず、理由も分からない。
         */
        state.pref = null;
        state.city = null;
        var prefSelect = el("pref-select");
        if (prefSelect) prefSelect.value = "";
        buildCityOptions();
        highlightTabs();
        renderTable();
      });
      box.appendChild(button);
    });
  }

  /** いま選ばれている地方タブに印をつける */
  function highlightTabs() {
    var box = el("region-tabs");
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (b) {
      var key = b.dataset.region || null;
      b.setAttribute("aria-pressed", String(key === state.region));
    });
  }

  // ---- 起動 ---------------------------------------------------------------

  function start() {
    /*
     * 「いま」は起動時に1回だけ取り、全スポットの日付判定に同じ値を使う。
     * スポットごとに new Date() を呼ぶと、たまたま処理中に日付が変わったときに
     * 一部のスポットだけ別の夜になる。
     */
    var now = new Date();
    // 見出し用の代表日。個々のスポットは自分の位置で判定する。
    var ymd = tonightDateAt(36, 138, now);

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
        // 選択肢は「実際に掲載があるもの」だけにする(空振りを選ばせない)
        buildPrefOptions();
        buildCityOptions();
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
          // その夜がどの日かはスポットの位置で決まる。ここで決めて持たせ、
          // 点数の計算にも詳細へのリンクにも同じ値を使う。
          s.nightDate = tonightDateAt(Number(s.lat), Number(s.lon), now);
          var w = Sky.nightWindow(s.nightDate, Number(s.lat), Number(s.lon));
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
            spot.best = bestOfNight(spot, grid);
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

    setupHere();
    setupSearch();
    setupPickMap();

    el("sort-select").addEventListener("change", function (e) {
      state.sort = e.target.value;
      renderTable();
    });

    el("pref-select").addEventListener("change", function (e) {
      setPref(e.target.value);
    });

    el("city-select").addEventListener("change", function (e) {
      state.city = e.target.value || null;
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
