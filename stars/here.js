/*
 * 訪問者のおおよその現在地を、ページをまたいで覚えておく。
 *
 * なぜ要るか:
 *   星見は「ここから行ける範囲でどこが暗いか」を決める行為なので、
 *   自分の位置が分からないと色分けを見ても距離感がつかめない。
 *   ただし位置情報は毎ページで許可を求めるものではないので、
 *   地図で一度許可してもらったら、その値を一覧・詳細でも使い回す。
 *
 * 扱い方:
 *   ・保存先は sessionStorage(タブを閉じれば消える)。
 *     長く持ち続ける必要はなく、端末に残す理由もない。
 *   ・小数第2位(約1km)に丸めて保存する。距離の目安を出すには充分で、
 *     必要以上に細かい位置を持たない。
 *   ・保存も読み出しも失敗しうる(プライベートブラウズ等)ので、
 *     例外は握りつぶして「現在地なし」として扱う。
 *
 * window.StarsHere で公開する。
 */
(function (global) {
  "use strict";

  var KEY = "stars.here";

  function remember(here) {
    if (!here || typeof here.lat !== "number" || typeof here.lon !== "number") return;
    try {
      global.sessionStorage.setItem(
        KEY,
        JSON.stringify({ lat: Math.round(here.lat * 100) / 100, lon: Math.round(here.lon * 100) / 100 })
      );
    } catch (e) {
      /* 使えない環境では覚えないだけ */
    }
  }

  function recall() {
    try {
      var raw = global.sessionStorage.getItem(KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (typeof v.lat !== "number" || typeof v.lon !== "number") return null;
      return v;
    } catch (e) {
      return null;
    }
  }

  function forget() {
    try {
      global.sessionStorage.removeItem(KEY);
    } catch (e) {
      /* 何もしない */
    }
  }

  /**
   * 2地点間の距離(km)。地球を半径6371kmの球とみなす(ハヴァサイン)。
   * 道のりではなく直線距離なので、表示は必ず「直線」と断ること。
   */
  function distanceKm(a, b) {
    var R = 6371;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLon = (b.lon - a.lon) * rad;
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * 位置情報を尋ねる。許可されなければ null で解決する(エラーにしない)。
   * @returns {Promise<{lat:number, lon:number}|null>}
   */
  function ask() {
    return new Promise(function (resolve) {
      if (!global.navigator || !global.navigator.geolocation) {
        resolve(null);
        return;
      }
      global.navigator.geolocation.getCurrentPosition(
        function (pos) {
          var here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          remember(here);
          resolve(here);
        },
        function () {
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });
  }

  var api = {
    remember: remember,
    recall: recall,
    forget: forget,
    ask: ask,
    distanceKm: distanceKm
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.StarsHere = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
