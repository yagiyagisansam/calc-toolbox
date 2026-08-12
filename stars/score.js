/*
 * 星見レベル(0〜100)の計算ロジック
 *
 * 考え方:
 *   星が見えるかどうかは「空が暗いか」と「空が晴れているか」の掛け算で決まる。
 *   どれだけ暗い場所でも曇っていれば何も見えないし、どれだけ晴れていても
 *   都心なら暗い星は見えない。したがって各要因は足し算ではなく掛け算で合成する。
 *
 * 要因:
 *   1. 光害      その場所の空の明るさ(lp-japan.png の 0-255 指標)
 *   2. 雲量      Open-Meteo の cloud_cover(%)
 *   3. 降水確率  Open-Meteo の precipitation_probability(%)
 *   4. 視程・湿度 Open-Meteo の visibility(m) と relative_humidity_2m(%)。
 *                もやや靄の効果。地点単位の予報にのみ含まれる。
 *   5. 月        sky.js が返す「月による空の明るさへの寄与」(0〜1)
 *
 * 前提と限界(サイト側に明記すること):
 *   - 光害指標は VIIRS 夜間光にもとづく相対値で、絶対的な空の明るさ(SQM値)ではない。
 *   - 地形による遮蔽(山が街明かりを隠す・山に視界を遮られる)は考慮していない。
 *   - しきい値はすべて下の CONFIG に集約してある。値を変えるときはここだけを触ること。
 *
 * ブラウザでは window.StarsScore、Node(テストランナー)では module.exports で公開する。
 */
(function (global) {
  "use strict";

  var CONFIG = {
    /*
     * 光害指標(0-255) → 暗さ(0〜1)の対応表。
     * 実在地点の値を基準に段階を割り当てている(stars/data/lp-japan.json の references)。
     * 間は直線で補間する。
     */
    darknessAnchors: [
      { index: 10, darkness: 1.0 }, // 外洋・指標の下限
      { index: 40, darkness: 0.95 }, // 西表島クラス
      { index: 70, darkness: 0.88 }, // 小笠原・父島クラス
      { index: 110, darkness: 0.8 }, // 乗鞍畳平・上高地(国内で最も暗い部類)
      { index: 125, darkness: 0.68 }, // 野辺山・富士山頂
      { index: 150, darkness: 0.45 }, // 奥多摩(都市の外れ)
      { index: 180, darkness: 0.3 },
      { index: 205, darkness: 0.18 }, // 甲府クラスの地方都市
      { index: 230, darkness: 0.08 },
      { index: 255, darkness: 0.0 } // 東京都心
    ],

    // 光害の効き方。真っ暗でなくても明るい星は見えるので、下駄を残す。
    darknessFloor: 0.25,

    // 雲量の効き方。1より大きくすると「少しの雲でも大きく減点」になる。
    cloudExponent: 1.2,

    // 降水確率の最大減点。雲量とかなり重複するため控えめにする。
    precipWeight: 0.6,

    // 視程がこれ以上あれば減点しない(m)
    visibilityFull: 20000,
    // 視程が0でも残す割合(視程は地上の見通しで、天頂方向とは必ずしも一致しないため)
    visibilityFloor: 0.5,

    // 湿度がこの値を超えた分だけ減点しはじめる(%)
    humidityThreshold: 70,
    // 湿度100%のときの最大減点
    humidityWeight: 0.25,

    // 月が最も影響するとき(満月が天頂)の最大減点
    moonWeight: 0.6
  };

  // 表示の段階。色は palette.js が持つ(ここでは意味だけを定義する)。
  var BANDS = [
    { key: "excellent", min: 80, label: "最高", note: "天の川がはっきり見える条件" },
    { key: "good", min: 65, label: "良い", note: "暗い星まで見える" },
    { key: "fair", min: 50, label: "まずまず", note: "主な星座はよく見える" },
    { key: "poor", min: 35, label: "いまひとつ", note: "明るい星なら見える" },
    { key: "bad", min: 20, label: "悪い", note: "ごく明るい星だけ" },
    { key: "none", min: 0, label: "不可", note: "星見には向かない" }
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /**
   * 光害指標(0-255) → 暗さ(0〜1)。1 が最も暗い。
   * @param {number} index lp-japan.png の画素値
   */
  function darknessFromIndex(index) {
    var a = CONFIG.darknessAnchors;
    var x = clamp(index, a[0].index, a[a.length - 1].index);
    for (var i = 1; i < a.length; i++) {
      if (x <= a[i].index) {
        var t = (x - a[i - 1].index) / (a[i].index - a[i - 1].index);
        return a[i - 1].darkness + t * (a[i].darkness - a[i - 1].darkness);
      }
    }
    return a[a.length - 1].darkness;
  }

  /** 各要因の係数(すべて0〜1)を掛け合わせて 0〜100 にする */
  function combine(f) {
    return 100 * f.sky * f.cloud * f.precip * f.air * f.moon;
  }

  /**
   * 星見レベルを計算する。
   * @param {object} input
   * @param {number} input.lpIndex 光害指標(0-255)。省略時は最も暗いものとして扱う
   * @param {number} input.cloudPct 雲量(%)
   * @param {number} input.precipPct 降水確率(%)。省略可
   * @param {number} input.visibilityM 視程(m)。省略可
   * @param {number} input.humidityPct 相対湿度(%)。省略可
   * @param {number} input.moonBrightness 月の寄与(0〜1)。sky.js の brightness()。省略可
   * @returns {{score:number, band:object, darkness:number, factors:object, hasAirQuality:boolean}}
   */
  function evaluate(input) {
    var darkness = darknessFromIndex(
      typeof input.lpIndex === "number" ? input.lpIndex : CONFIG.darknessAnchors[0].index
    );

    var cloud = clamp(Number(input.cloudPct) || 0, 0, 100);
    var precip = clamp(Number(input.precipPct) || 0, 0, 100);
    var moon = clamp(Number(input.moonBrightness) || 0, 0, 1);

    // 視程・湿度は地点単位の予報にしか含まれない。無いときは減点しない。
    var hasAir = typeof input.visibilityM === "number" || typeof input.humidityPct === "number";
    var visFactor = 1;
    if (typeof input.visibilityM === "number") {
      var v = clamp(input.visibilityM / CONFIG.visibilityFull, 0, 1);
      visFactor = CONFIG.visibilityFloor + (1 - CONFIG.visibilityFloor) * v;
    }
    var humFactor = 1;
    if (typeof input.humidityPct === "number") {
      var over = clamp(input.humidityPct - CONFIG.humidityThreshold, 0, 100 - CONFIG.humidityThreshold);
      humFactor = 1 - (over / (100 - CONFIG.humidityThreshold)) * CONFIG.humidityWeight;
    }

    var factors = {
      sky: CONFIG.darknessFloor + (1 - CONFIG.darknessFloor) * darkness,
      cloud: Math.pow(1 - cloud / 100, CONFIG.cloudExponent),
      precip: 1 - (precip / 100) * CONFIG.precipWeight,
      air: visFactor * humFactor,
      moon: 1 - moon * CONFIG.moonWeight
    };

    var score = combine(factors);
    return {
      score: Math.round(score * 10) / 10,
      band: bandOf(score),
      darkness: Math.round(darkness * 1000) / 1000,
      factors: factors,
      hasAirQuality: hasAir
    };
  }

  /**
   * 地図のラスタ描画用の軽量版。1画素ごとに呼ぶのでオブジェクトを作らない。
   * 視程・湿度は持たないため減点しない(evaluate で省略した場合と同じ)。
   * @returns {number} 0〜100
   */
  function quick(lpIndex, cloudPct, precipPct, moonBrightness) {
    var darkness = darknessFromIndex(lpIndex);
    var sky = CONFIG.darknessFloor + (1 - CONFIG.darknessFloor) * darkness;
    var cloud = Math.pow(1 - clamp(cloudPct, 0, 100) / 100, CONFIG.cloudExponent);
    var precip = 1 - (clamp(precipPct, 0, 100) / 100) * CONFIG.precipWeight;
    var moon = 1 - clamp(moonBrightness, 0, 1) * CONFIG.moonWeight;
    return 100 * sky * cloud * precip * moon;
  }

  /**
   * 地図のラスタ描画用の早見表を作る。
   *
   * ラスタは1回の描画で百万画素近くを塗るため、画素ごとに Math.pow を呼ぶと
   * 端末によっては目に見えて遅くなる。光害指標は 0〜255 の整数、雲量と降水確率は
   * 0〜100 の整数に丸めて差し支えないので、あらかじめ表にしておいて掛けるだけにする。
   * 表の中身は evaluate/quick と同じ CONFIG から作るので、値がずれることはない。
   *
   * @returns {{sky:Float32Array, cloud:Float32Array, precip:Float32Array}}
   */
  function buildTables() {
    var sky = new Float32Array(256);
    for (var i = 0; i < 256; i++) {
      sky[i] = CONFIG.darknessFloor + (1 - CONFIG.darknessFloor) * darknessFromIndex(i);
    }
    var cloud = new Float32Array(101);
    var precip = new Float32Array(101);
    for (var p = 0; p <= 100; p++) {
      cloud[p] = Math.pow(1 - p / 100, CONFIG.cloudExponent);
      precip[p] = 1 - (p / 100) * CONFIG.precipWeight;
    }
    return { sky: sky, cloud: cloud, precip: precip };
  }

  /** 月の寄与(0〜1) → 掛ける係数。ラスタ描画では1フレームに1回しか呼ばない。 */
  function moonFactor(moonBrightness) {
    return 1 - clamp(moonBrightness, 0, 1) * CONFIG.moonWeight;
  }

  /** スコア → 表示の段階 */
  function bandOf(score) {
    for (var i = 0; i < BANDS.length; i++) {
      if (score >= BANDS[i].min) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }

  /** スコア → 段階の添字(0が最良)。ラスタ描画で色を引くのに使う */
  function bandIndex(score) {
    for (var i = 0; i < BANDS.length; i++) {
      if (score >= BANDS[i].min) return i;
    }
    return BANDS.length - 1;
  }

  var api = {
    evaluate: evaluate,
    quick: quick,
    darknessFromIndex: darknessFromIndex,
    buildTables: buildTables,
    moonFactor: moonFactor,
    bandOf: bandOf,
    bandIndex: bandIndex,
    BANDS: BANDS,
    CONFIG: CONFIG
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.StarsScore = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
