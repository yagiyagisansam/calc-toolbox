/*
 * 星見スポットの設定値。
 * 対象地域を日本から広げるときは、ここと stars/data/lp-japan.png を差し替える。
 */
(function (global) {
  "use strict";

  var CONFIG = {
    // ---- 地図 ----
    map: {
      // OpenFreeMap の暗色スタイル。APIキー不要・無料。
      // 暗色にしているのは、星見のサイトとして自然であることに加えて、
      // 明るい地図の上では6段階の色を半透明で重ねると見分けられなくなるため。
      styleUrl: "https://tiles.openfreemap.org/styles/dark",
      // 日本全体が画面に収まる初期表示
      center: [137.5, 37.2], // MapLibre は [経度, 緯度] の順
      zoom: 4.2,
      minZoom: 3,
      maxZoom: 12,
      // 対象は日本だけ。国外へ延々と移動して不要なタイルを読むのを防ぐ。
      maxBounds: [[122, 20], [154, 46]],
      // ラスタはこのレイヤーの下に差し込む(地名・道路のラベルが隠れないように)
      insertBelowLayerId: "water_name"
    },

    // ---- 天気の格子(予備の値) ----
    // 実際に使う格子の定義はサーバー側のキャッシュ(meta)から来る。
    // ここに書いてあるのは、天気をまったく取得できなかったときに
    // 「光害だけの表示」を組み立てるための入れ物にすぎない。
    // 格子を変えるときは scripts/stars/weather-cache.sql の stars_grid_def() を直す。
    grid: {
      south: 24,
      north: 46,
      west: 123,
      east: 146,
      stepDeg: 1
    },

    // ---- 天気予報 ----
    weather: {
      // 出典表示(CC BY 4.0 のため必須)
      attribution: {
        text: "Weather data by Open-Meteo.com",
        url: "https://open-meteo.com/"
      }
    },

    // ---- 光害データ ----
    lightPollution: {
      dataDir: "./data"
    },

    // ---- 申請の受け付け範囲 ----
    // 日本の範囲。海外へ広げるときはここを緩める(データベース側のトリガにも
    // 同じ範囲を入れてあるので、両方を直すこと)。
    submitBounds: { south: 20, north: 46, west: 122, east: 154 }
  };

  global.STARS_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
