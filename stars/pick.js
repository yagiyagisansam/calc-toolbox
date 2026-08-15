/*
 * 「地図で場所を選ぶ」の中身(stars/pick.html 専用)。
 *
 * 一覧(list.html)から枠内に読み込まれ、地図をタップされたら
 * その緯度経度を親へ渡す。それ以外のことはしない。
 *
 * なぜ別のページなのか:
 *   MapLibre は中で DOM への文字列の書き込みを行うため、
 *   Trusted Types を強制している文書とは同居できない。
 *   地図をここへ閉じ込めることで、一覧のほうは
 *   require-trusted-types-for 'script' を保てる。
 *
 * 親とのやりとり:
 *   親 → ここ  { type: "stars-pick:init", origin: {lat, lon} | null }  地図を作る/寄せる
 *   親 → ここ  { type: "stars-pick:mark", lat, lon }                   印だけ動かす
 *   ここ → 親  { type: "stars-pick:picked", lat, lon }                 選ばれた
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

  function send(message) {
    // 相手は自分と同じ生成元(同じサイト)にしか送らない
    global.parent.postMessage(message, global.location.origin);
  }

  function place(lat, lon) {
    if (!marker) marker = new global.maplibregl.Marker({ color: "#fdd171" });
    // 位置を決めてから地図に載せる。逆にすると最初の1回で MapLibre が落ちる
    marker.setLngLat([lon, lat]);
    if (!marker._map) marker.addTo(map);
  }

  function start(origin) {
    if (map) {
      if (origin) {
        place(origin.lat, origin.lon);
        map.jumpTo({ center: [origin.lon, origin.lat], zoom: 8 });
      }
      map.resize();
      return;
    }

    global.maplibregl.setWorkerUrl("./vendor/maplibre-gl-csp-worker.js");
    map = new global.maplibregl.Map({
      container: "pick-map",
      // config.js の center は MapLibre と同じ [経度, 緯度] の順で持っている
      style: CONFIG.map.styleUrl,
      center: origin ? [origin.lon, origin.lat] : CONFIG.map.center,
      zoom: origin ? 8 : 4,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      maxPitch: 0
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new global.maplibregl.NavigationControl({ showCompass: false }), "top-right");

    if (origin) place(origin.lat, origin.lon);

    map.on("click", function (e) {
      place(e.lngLat.lat, e.lngLat.lng);
      send({ type: "stars-pick:picked", lat: e.lngLat.lat, lon: e.lngLat.lng });
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
    if (!isFinite(lat) || !isFinite(lon)) return false;
    var zoom = Number(q.get("zoom"));
    start({ lat: lat, lon: lon });
    if (isFinite(zoom) && zoom > 0) map.setZoom(zoom);
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
      start(data.origin && isFinite(data.origin.lat) ? data.origin : null);
    } else if (data.type === "stars-pick:mark" && map && isFinite(data.lat)) {
      place(data.lat, data.lon);
    }
  });

  // 準備ができたことを親へ知らせる(親はこれを待ってから init を送る)
  if (!fromQuery()) send({ type: "stars-pick:ready" });

  // 検証用
  global.StarsPick = {
    map: function () {
      return map;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
