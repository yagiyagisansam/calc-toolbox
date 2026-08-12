/*
 * 光害ラスタ(stars/data/lp-japan.png)の読み込みと参照。
 *
 * PNG は「その地点の上空の明るさ」を 0(最も暗い)〜255(都心) で表したグレースケール。
 * 作り方と出典は stars/data/lp-japan.json と scripts/stars/build_lp.mjs を参照。
 *
 * 画像をいったん canvas に描いて画素値を取り出し、以降はメモリ上の配列を引く。
 * 地図のラスタ描画では1フレームで数十万回参照するため、RGBA のまま持たず
 * 輝度1chに詰め直しておく(メモリは1/4、参照も速い)。
 *
 * ブラウザ専用(Node では使わない)。window.StarsLP で公開する。
 */
(function (global) {
  "use strict";

  var state = {
    ready: false,
    meta: null,
    data: null, // Uint8Array(width*height)
    width: 0,
    height: 0
  };

  /**
   * 光害ラスタを読み込む。二重に呼んでも1回しか読み込まない。
   * @param {string} baseUrl data ディレクトリの場所(既定 "./data")
   * @returns {Promise<object>} 読み込んだメタ情報
   */
  var loading = null;
  function load(baseUrl) {
    if (loading) return loading;
    var base = baseUrl || "./data";

    loading = fetch(base + "/lp-japan.json")
      .then(function (r) {
        if (!r.ok) throw new Error("光害データの情報を取得できません (" + r.status + ")");
        return r.json();
      })
      .then(function (meta) {
        state.meta = meta;
        return loadImage(base + "/lp-japan.png");
      })
      .then(function (img) {
        var meta = state.meta;
        var canvas = document.createElement("canvas");
        canvas.width = meta.width;
        canvas.height = meta.height;
        var ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var rgba = ctx.getImageData(0, 0, meta.width, meta.height).data;

        var n = meta.width * meta.height;
        var gray = new Uint8Array(n);
        for (var i = 0; i < n; i++) gray[i] = rgba[i * 4];

        state.data = gray;
        state.width = meta.width;
        state.height = meta.height;
        state.ready = true;
        return meta;
      });

    return loading;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("光害データの画像を読み込めません: " + url));
      };
      img.src = url;
    });
  }

  /** 経度 → 画素の列(小数)。範囲外でも外挿せず、そのまま返す */
  function xOf(lon) {
    var b = state.meta.bbox;
    return ((lon - b.west) / (b.east - b.west)) * state.width;
  }

  /** 緯度 → 画素の行(小数) */
  function yOf(lat) {
    var b = state.meta.bbox;
    return ((b.north - lat) / (b.north - b.south)) * state.height;
  }

  /**
   * 指定地点の光害指標(0-255)。データ範囲の外なら null。
   * 2.7km 四方の格子なので最近傍で引く(補間しても情報は増えない)。
   */
  function index(lat, lon) {
    if (!state.ready) return null;
    var x = Math.floor(xOf(lon));
    var y = Math.floor(yOf(lat));
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return state.data[y * state.width + x];
  }

  /** データが覆う範囲に入っているか */
  function covers(lat, lon) {
    if (!state.meta) return false;
    var b = state.meta.bbox;
    return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  }

  var api = {
    load: load,
    index: index,
    covers: covers,
    xOf: xOf,
    yOf: yOf,
    isReady: function () {
      return state.ready;
    },
    // 地図のラスタ描画が直接触るための生データ
    raw: function () {
      return state;
    }
  };

  global.StarsLP = api;
})(typeof window !== "undefined" ? window : globalThis);
