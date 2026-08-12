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
      // ラスタはこのレイヤーの下に差し込む(地名・道路のラベルが隠れないように)
      insertBelowLayerId: "water_name"
    },

    // ---- 天気の取得グリッド ----
    // 与那国(123.0E)から小笠原(142.2E)まで含む範囲。1度刻み。
    // 雲は数十kmの単位でしか変わらないので、これ以上細かくしても
    // 通信量が増えるだけで地図の見え方は変わらない。
    grid: {
      south: 24,
      north: 46,
      west: 122,
      east: 147,
      stepDeg: 1
    },

    // ---- Open-Meteo ----
    weather: {
      endpoint: "https://api.open-meteo.com/v1/forecast",
      // 地図のラスタ用(通信量を抑えるため2項目だけ)
      gridVariables: ["cloud_cover", "precipitation_probability"],
      // スポットの詳細・一覧用(視程と湿度も含めた全項目)
      spotVariables: [
        "cloud_cover",
        "precipitation_probability",
        "visibility",
        "relative_humidity_2m"
      ],
      // 取得結果を sessionStorage に置いておく時間
      cacheMinutes: 60,
      // 一覧・詳細で一度に問い合わせる地点数の上限
      maxSpotsPerRequest: 100,
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
