/*
 * 地図と、星見レベルの色分けラスタの描画。
 *
 * 描き方:
 *   光害ラスタ(緯度経度が等間隔)と、天気の粗い格子(1度刻み)と、月の影響を
 *   画素ごとに合成して1枚の画像を作り、MapLibre の canvas ソースとして
 *   日本の範囲に貼り付ける。地図を動かしても貼り直す必要はなく、
 *   時刻を変えたときだけ描き直す。
 *
 * 投影に注意:
 *   MapLibre は canvas を「Webメルカトル上で線形」とみなして貼る。
 *   一方こちらの光害ラスタは緯度が等間隔(正距円筒)なので、そのまま貼ると
 *   北海道と沖縄で位置がずれる。そこで canvas の行はメルカトルの等間隔で刻み、
 *   行ごとに対応する緯度へ変換してから光害ラスタを引く。
 *
 * 速度:
 *   1回の描き直しで百万画素近くを塗るので、画素ごとの計算は
 *   「表を3回引いて掛ける」だけにしてある(score.js の buildTables)。
 *   行ごと・列ごとに決まる値(緯度・格子の位置と重み)は先に配列へ出しておく。
 *
 * window.StarsMap で公開する。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;
  var Score = global.StarsScore;
  var Palette = global.StarsPalette;
  var Sky = global.StarsSky;
  var LP = global.StarsLP;

  var RAD = Math.PI / 180;

  // ---- メルカトル変換 -----------------------------------------------------

  function mercY(latDeg) {
    return Math.log(Math.tan(Math.PI / 4 + (latDeg * RAD) / 2));
  }

  function invMercY(y) {
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
  }

  // ---- 状態 ---------------------------------------------------------------

  var state = {
    map: null,
    canvas: null,
    ctx: null,
    imageData: null,
    tables: null,
    grid: null, // StarsNet.fetchGrid の結果
    timeIndex: 0,
    opacity: null, // ラスタの不透明度(初期値は palette.js)
    basemap: "loading", // loading | loaded | failed
    onBasemapFail: null,
    // 行ごと・列ごとにあらかじめ計算しておく値
    rowLat: null,
    rowLpOffset: null, // 光害ラスタの行頭の添字
    rowGrid0: null,
    rowGridW: null,
    colLon: null,
    colLp: null,
    colGrid0: null,
    colGridW: null,
    markers: []
  };

  // ---- 初期化 -------------------------------------------------------------

  /*
   * 地図の下地(基図)が無くても成立する最小のスタイル。
   *
   * 最初はこれで地図を作り、色分けを即座に出す。下地はそのあと非同期に読み込む。
   * こうしておくと、タイル配信が落ちていたり通信が細いときでも、
   * このサイトの主役である色分けと時刻の操作は必ず使える。
   * 下地を先に待つ作りだと、タイルが来ないだけで画面全体が無反応になってしまう。
   */
  function fallbackStyle() {
    return {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": Palette.MAP_SURFACE }
        }
      ]
    };
  }

  /**
   * 地図を作る。呼ぶ前に StarsLP.load() が終わっていること。
   * @param {string} containerId 地図を入れる要素のid
   * @returns {Promise<object>} MapLibre の Map
   */
  function init(containerId) {
    var meta = LP.raw().meta;
    buildCanvas(meta);

    var map = new maplibregl.Map({
      container: containerId,
      style: fallbackStyle(),
      center: CONFIG.map.center,
      zoom: CONFIG.map.zoom,
      minZoom: CONFIG.map.minZoom,
      maxZoom: CONFIG.map.maxZoom,
      attributionControl: false,
      // 2Dに固定する(傾き・回転は星見の判断に使わず、操作を難しくするだけ)
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '<a href="' +
          CONFIG.weather.attribution.url +
          '" target="_blank" rel="noopener">' +
          CONFIG.weather.attribution.text +
          "</a> | 光害: NASA GIBS/VIIRS"
      }),
      "bottom-left"
    );

    state.map = map;

    return new Promise(function (resolve) {
      map.on("load", function () {
        addScoreLayer();
        resolve(map);
        // 下地は後追いで読み込む(失敗しても色分けは動いたまま)
        loadBasemap();
      });
    });
  }

  /** 色分けラスタのソースとレイヤーを地図に足す(既にあれば何もしない) */
  function addScoreLayer() {
    var map = state.map;
    if (!map || map.getSource("stars-score")) return;
    var b = LP.raw().meta.bbox;

    map.addSource("stars-score", {
      type: "canvas",
      canvas: state.canvas,
      // 左上→右上→右下→左下 の順
      coordinates: [
        [b.west, b.north],
        [b.east, b.north],
        [b.east, b.south],
        [b.west, b.south]
      ],
      animate: false
    });
    map.addLayer(
      {
        id: "stars-score",
        type: "raster",
        source: "stars-score",
        paint: {
          "raster-opacity": state.opacity,
          "raster-resampling": "linear",
          "raster-fade-duration": 0
        }
      },
      // 地名・道路のラベルより下に入れて、ラベルが読めるようにする
      map.getLayer(CONFIG.map.insertBelowLayerId) ? CONFIG.map.insertBelowLayerId : undefined
    );
  }

  /**
   * 下地(OpenFreeMap のスタイル)を読み込んで差し替える。
   * setStyle は既存のソース・レイヤーを消すので、差し替え後に色分けを入れ直す。
   */
  function loadBasemap() {
    fetch(CONFIG.map.styleUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("style " + r.status);
        return r.json();
      })
      .then(function (style) {
        state.map.once("styledata", function () {
          addScoreLayer();
          if (state.grid) render(state.timeIndex);
        });
        state.map.setStyle(style);
        state.basemap = "loaded";
      })
      .catch(function () {
        // 下地なしでも色分けは読める。呼び出し側が案内を出せるよう印だけ残す。
        state.basemap = "failed";
        if (state.onBasemapFail) state.onBasemapFail();
      });
  }

  /** 描画用の canvas を作り、行・列ごとの変換表を用意する */
  function buildCanvas(meta) {
    var b = meta.bbox;

    // 幅は光害ラスタと同じにし、高さはメルカトルでの縦横比に合わせる。
    // これ以上大きくしても、天気の格子が粗いので見え方は変わらない。
    var width = meta.width;
    var lonSpan = (b.east - b.west) * RAD;
    var latSpan = mercY(b.north) - mercY(b.south);
    var height = Math.round((width * latSpan) / lonSpan);

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");
    state.imageData = state.ctx.createImageData(width, height);
    state.tables = Score.buildTables();
    if (state.opacity === null) state.opacity = Palette.OVERLAY_ALPHA;

    var lp = LP.raw();
    var g = CONFIG.grid;
    var gCols = Math.round((g.east - g.west) / g.stepDeg) + 1;

    // --- 行(緯度)ごと ---
    var yTop = mercY(b.north);
    var yBottom = mercY(b.south);
    state.rowLat = new Float64Array(height);
    state.rowLpOffset = new Int32Array(height);
    state.rowGrid0 = new Int32Array(height);
    state.rowGridW = new Float32Array(height);
    for (var y = 0; y < height; y++) {
      // 画素の中心をとる
      var my = yTop + ((yBottom - yTop) * (y + 0.5)) / height;
      var lat = invMercY(my);
      state.rowLat[y] = lat;

      var lpRow = Math.floor(((b.north - lat) / (b.north - b.south)) * lp.height);
      state.rowLpOffset[y] = Math.min(Math.max(lpRow, 0), lp.height - 1) * lp.width;

      // 天気の格子は北から南へ並んでいる
      var gr = (g.north - lat) / g.stepDeg;
      var gr0 = Math.floor(gr);
      state.rowGrid0[y] = gr0;
      state.rowGridW[y] = gr - gr0;
    }

    // --- 列(経度)ごと ---
    state.colLon = new Float64Array(width);
    state.colLp = new Int32Array(width);
    state.colGrid0 = new Int32Array(width);
    state.colGridW = new Float32Array(width);
    for (var x = 0; x < width; x++) {
      var lon = b.west + ((b.east - b.west) * (x + 0.5)) / width;
      state.colLon[x] = lon;
      var lpCol = Math.floor(((lon - b.west) / (b.east - b.west)) * lp.width);
      state.colLp[x] = Math.min(Math.max(lpCol, 0), lp.width - 1);

      var gc = (lon - g.west) / g.stepDeg;
      var gc0 = Math.floor(gc);
      state.colGrid0[x] = gc0;
      state.colGridW[x] = gc - gc0;
    }
    state.gridCols = gCols;
  }

  // ---- 描画 ---------------------------------------------------------------

  /**
   * 指定した時刻の色分けを描き直す。
   * @param {number} timeIndex fetchGrid が返した times の添字
   */
  function render(timeIndex) {
    if (!state.grid || !state.canvas) return;

    var t0 = performance.now();
    var lp = LP.raw();
    var lpData = lp.data;
    var w = state.canvas.width;
    var h = state.canvas.height;
    var out = state.imageData.data;

    var cloud = state.grid.cloud[timeIndex];
    var precip = state.grid.precip[timeIndex];
    var rows = state.grid.rows;
    var cols = state.grid.cols;

    var skyT = state.tables.sky;
    var cloudT = state.tables.cloud;
    var precipT = state.tables.precip;

    // 月の影響は全国でほとんど変わらないので、地図の中心で一度だけ求める
    var when = new Date(state.grid.times[timeIndex] * 1000);
    var center = state.map ? state.map.getCenter() : { lat: 36, lng: 138 };
    var moonF = Score.moonFactor(Sky.brightness(when, center.lat, center.lng));

    var bands = Score.BANDS;
    var nBands = bands.length;
    var rgb = Palette.BAND_RGB;

    for (var y = 0; y < h; y++) {
      var lpOff = state.rowLpOffset[y];
      var gr0 = state.rowGrid0[y];
      var wy = state.rowGridW[y];
      // 格子の外に出る行は端に寄せる(外洋の端など)
      var gr1 = gr0 + 1;
      if (gr0 < 0) { gr0 = 0; gr1 = 0; wy = 0; }
      else if (gr1 > rows - 1) { gr0 = rows - 1; gr1 = rows - 1; wy = 0; }
      var rowA = gr0 * cols;
      var rowB = gr1 * cols;

      var p = y * w * 4;
      for (var x = 0; x < w; x++) {
        var gc0 = state.colGrid0[x];
        var wx = state.colGridW[x];
        var gc1 = gc0 + 1;
        if (gc0 < 0) { gc0 = 0; gc1 = 0; wx = 0; }
        else if (gc1 > cols - 1) { gc0 = cols - 1; gc1 = cols - 1; wx = 0; }

        // 粗い格子から双一次補間で雲量と降水確率を求める
        var iA0 = rowA + gc0, iA1 = rowA + gc1, iB0 = rowB + gc0, iB1 = rowB + gc1;
        var c =
          (cloud[iA0] * (1 - wx) + cloud[iA1] * wx) * (1 - wy) +
          (cloud[iB0] * (1 - wx) + cloud[iB1] * wx) * wy;
        var pr =
          (precip[iA0] * (1 - wx) + precip[iA1] * wx) * (1 - wy) +
          (precip[iB0] * (1 - wx) + precip[iB1] * wx) * wy;

        var lpv = lpData[lpOff + state.colLp[x]];
        var score = 100 * skyT[lpv] * cloudT[c | 0] * precipT[pr | 0] * moonF;

        // 段階を引く(上から順に見る。段数は6なので分岐で十分速い)
        var bi = nBands - 1;
        for (var k = 0; k < nBands; k++) {
          if (score >= bands[k].min) { bi = k; break; }
        }
        var col = rgb[bi];
        out[p] = col[0];
        out[p + 1] = col[1];
        out[p + 2] = col[2];
        out[p + 3] = 255;
        p += 4;
      }
    }

    state.ctx.putImageData(state.imageData, 0, 0);
    if (state.map && state.map.getSource("stars-score")) {
      // canvas ソースは中身が変わったことを地図に知らせる必要がある
      state.map.getSource("stars-score").play();
      state.map.getSource("stars-score").pause();
    }
    state.timeIndex = timeIndex;
    return performance.now() - t0;
  }

  /** 天気データを差し替える(取得しなおしたとき) */
  function setGrid(grid) {
    state.grid = grid;
  }

  /** ラスタの濃さを変える(0で非表示) */
  function setOpacity(alpha) {
    state.opacity = alpha;
    if (state.map && state.map.getLayer("stars-score")) {
      state.map.setPaintProperty("stars-score", "raster-opacity", alpha);
    }
  }

  // ---- スポットのピン -----------------------------------------------------

  /**
   * 承認済みスポットのピンを置き直す。
   * 近すぎる点はまとめて1本にし、件数を出す(最後の晩餐アプリと同じ考え方)。
   * @param {Array} spots
   * @param {function} onSelect ピンが選ばれたとき呼ばれる
   */
  function setSpots(spots, onSelect) {
    state.markers.forEach(function (m) {
      m.remove();
    });
    state.markers = [];
    if (!state.map) return;

    var groups = {};
    spots.forEach(function (s) {
      var key = Number(s.lat).toFixed(3) + "," + Number(s.lon).toFixed(3);
      (groups[key] = groups[key] || []).push(s);
    });

    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var el = document.createElement("button");
      el.type = "button";
      el.className = "stars-pin";
      el.setAttribute("aria-label", list[0].name + (list.length > 1 ? " ほか" + (list.length - 1) + "件" : ""));
      if (list.length > 1) {
        var badge = document.createElement("span");
        badge.className = "stars-pin-count";
        badge.textContent = String(list.length);
        el.appendChild(badge);
      }
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        onSelect(list);
      });

      var marker = new maplibregl.Marker({ element: el })
        .setLngLat([Number(list[0].lon), Number(list[0].lat)])
        .addTo(state.map);
      state.markers.push(marker);
    });
  }

  /** 指定地点へ寄る。詳細カードに隠れないよう少し上にずらす。 */
  function flyTo(lat, lon) {
    if (!state.map) return;
    var h = state.map.getContainer().clientHeight;
    state.map.flyTo({
      center: [lon, lat],
      zoom: Math.max(state.map.getZoom(), 9),
      offset: [0, -h * 0.18],
      duration: 900
    });
  }

  global.StarsMap = {
    init: init,
    /** 下地の読み込み結果 loading|loaded|failed */
    basemapState: function () {
      return state.basemap;
    },
    /** 下地の読み込みに失敗したときに呼ばれる関数を登録する */
    onBasemapFail: function (fn) {
      state.onBasemapFail = fn;
      if (state.basemap === "failed") fn();
    },
    render: render,
    setGrid: setGrid,
    setOpacity: setOpacity,
    setSpots: setSpots,
    flyTo: flyTo,
    map: function () {
      return state.map;
    },
    canvas: function () {
      return state.canvas;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
