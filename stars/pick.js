/*
 * 「地図で場所を選ぶ」の中身(stars/pick.html 専用)。
 *
 * 一覧・申請・詳細から枠内に読み込まれ、地図をタップされたら
 * その緯度経度を親へ渡す。それ以外のことはしない。
 * 場所が妥当かどうかの判断は、すべて親の側にある。
 *
 * なぜ別のページなのか:
 *   MapLibre は中で DOM への文字列の書き込みを行うため、
 *   Trusted Types を強制している文書とは同居できない。
 *   地図をこの1枚に寄せることで、呼ぶ側の文書は
 *   require-trusted-types-for 'script' を保てる。
 *
 * これはセキュリティ境界ではない:
 *   枠には allow-same-origin が要る(地図の worker が同一生成元でないと動かない)。
 *   同一生成元である以上、この文書は window.parent.document へ直に触れるし、
 *   親にある枠の sandbox 属性を外して読み直すこともできる。
 *   つまり、この文書が乗っ取られた場合に親を守る壁にはならない。
 *   得られているのは「MapLibre の通常の DOM 書き込みを親の文書から外す」ことだけで、
 *   侵害時の隔離ではない。下の postMessage の検査も、通常のメッセージの
 *   取り違えを防ぐためのもので、乗っ取られた同一生成元の子には効かない。
 *
 * 親とのやりとり:
 *   親 → ここ  init   { origin: {lat,lon}|null, zoom, minZoom, maxZoom, draggable }
 *                     地図を作る。すでにあれば寄せ直す
 *   親 → ここ  mark   { lat, lon }   印だけ動かす(視界は動かさない)
 *   親 → ここ  unmark {}             印を外す(親が場所を却下したとき)
 *   ここ → 親  ready  {}             受け入れ準備ができた
 *   ここ → 親  picked { lat, lon, from: "click"|"drag" }
 *   相手は必ず親の枠(window.parent)で、生成元は自分と同じであることを見る。
 *
 * init と mark を分けているのは、地図をタップされるたびに親から知らせが返ってきて
 * 地図が中心へ寄り直すのを避けるため(自分でタップした場所から視界が動いてしまう)。
 */
(function (global) {
  "use strict";

  var CONFIG = global.STARS_CONFIG;
  var map = null;
  var marker = null;
  var draggable = false;

  function send(message) {
    // 相手は自分と同じ生成元(同じサイト)にしか送らない
    global.parent.postMessage(message, global.location.origin);
  }

  /*
   * 受け取った緯度経度が数として成り立っているか。
   *
   * NaN はどの大小比較も false を返すので、範囲の検査をすり抜けて
   * そのまま地図へ渡り、MapLibre の中で落ちる。
   * これは乗っ取られた同一生成元の子への壁ではなく、
   * 壊れた知らせを受け取ったときの取り決めとして置いている。
   */
  function isPoint(lat, lon) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180
    );
  }

  /*
   * 下地が無くても成立する最小のスタイル。
   *
   * これで地図を作ってから、本物の下地を後追いで読み込む。
   * タイル配信が落ちていても場所を選ぶことはできる ──
   * 申請フォームでは「地図が出ないので投稿できない」が起きてはいけない。
   */
  function bareStyle() {
    return {
      version: 8,
      sources: {},
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#0c0c0c" } }
      ]
    };
  }

  function place(lat, lon) {
    if (!marker) {
      marker = new global.maplibregl.Marker({ color: "#fdd171", draggable: draggable });
      if (draggable) {
        marker.on("dragend", function () {
          var p = marker.getLngLat();
          send({ type: "stars-pick:picked", lat: p.lat, lon: p.lng, from: "drag" });
        });
      }
    }
    // 位置を決めてから地図に載せる。逆にすると最初の1回で MapLibre が落ちる
    marker.setLngLat([lon, lat]);
    if (!marker._map) marker.addTo(map);
  }

  function unplace() {
    if (marker && marker._map) marker.remove();
  }

  function start(options) {
    var opts = options || {};
    var origin =
      opts.origin && isPoint(Number(opts.origin.lat), Number(opts.origin.lon))
        ? opts.origin
        : null;

    if (map) {
      if (origin) {
        place(origin.lat, origin.lon);
        map.jumpTo({ center: [origin.lon, origin.lat], zoom: opts.zoom || 8 });
      }
      map.resize();
      return;
    }

    draggable = !!opts.draggable;
    global.maplibregl.setWorkerUrl("./vendor/maplibre-gl-csp-worker.js");
    map = new global.maplibregl.Map({
      container: "pick-map",
      style: bareStyle(),
      // config.js の center は MapLibre と同じ [経度, 緯度] の順で持っている
      center: origin ? [origin.lon, origin.lat] : CONFIG.map.center,
      zoom: origin ? opts.zoom || 8 : opts.zoom || 4,
      minZoom: opts.minZoom || undefined,
      maxZoom: opts.maxZoom || undefined,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new global.maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // 下地は後追い。届かなくても場所は選べる
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
          /* 下地なしのまま使う */
        });
    });

    if (origin) place(origin.lat, origin.lon);

    map.on("click", function (e) {
      place(e.lngLat.lat, e.lngLat.lng);
      send({ type: "stars-pick:picked", lat: e.lngLat.lat, lon: e.lngLat.lng, from: "click" });
    });
  }

  /*
   * 見せるだけの使い方(スポット詳細)。
   * ?view=1&lat=..&lon=..&zoom=.. で開かれたら、親とのやりとりを待たずに
   * その場所を出す。数として読める値でなければ何もしない。
   */
  function fromQuery() {
    var q = new URLSearchParams(global.location.search);
    if (q.get("view") !== "1") return false;
    var lat = Number(q.get("lat"));
    var lon = Number(q.get("lon"));
    if (!isPoint(lat, lon)) return false;
    var zoom = Number(q.get("zoom"));
    start({ origin: { lat: lat, lon: lon }, zoom: isFinite(zoom) && zoom > 0 ? zoom : 10 });
    // 見せるだけなので、タップしても親へは何も送らない
    map.off("click");
    return true;
  }

  global.addEventListener("message", function (e) {
    // 親以外からの指示は受けない
    if (e.source !== global.parent) return;
    if (e.origin !== global.location.origin) return;
    var data = e.data;
    if (!data) return;
    if (data.type === "stars-pick:init") {
      start(data);
    } else if (data.type === "stars-pick:mark" && map && isPoint(Number(data.lat), Number(data.lon))) {
      place(Number(data.lat), Number(data.lon));
    } else if (data.type === "stars-pick:unmark") {
      unplace();
    }
  });

  // 準備ができたことを親へ知らせる(親はこれを待ってから init を送る)
  if (!fromQuery()) send({ type: "stars-pick:ready" });

  // 検証用
  global.StarsPick = {
    map: function () {
      return map;
    },
    marker: function () {
      return marker;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
