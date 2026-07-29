/*
 * 塗料の必要量・缶数 計算ロジック
 *
 * 根拠(一次情報・実務資料):
 * - 児玉塗料店「塗装に必要な塗布量の計算方法」 https://www.kodama-t.co.jp/paint-top/tofuryou/
 *   (2026年7月29日参照)
 *   必要量 = 1平方メートルあたりの使用量(kg/m2) × 塗装面積(m2)、
 *   缶数 = 必要量 ÷ 1缶の内容量、という考え方。
 *   例: 使用量0.11kg/m2 × 150m2 = 16.5kg、16.5kg ÷ 15kg缶 = 1.1缶。
 * - 塗料メーカーの製品仕様に記載された「標準塗布量(kg/m2/回)」「標準塗り面積(m2/L)」を
 *   入力値として使う。メーカーによって「使用量」「標準所要量」など呼び方が異なる。
 *
 * 前提:
 * - 標準塗布量・標準塗り面積は「1回塗りあたり」の値として扱う。実際の塗り回数(下塗り・
 *   中塗り・上塗りなど)を掛けて必要量を出す。
 * - 塗料は飛散・ローラーやハケへの残り・下地への吸い込みでロスが出るため、ロス率で割り増す。
 * - 缶数は切り上げる(缶は分けて買えないため)。
 * - 素材(モルタル・サイディング・鉄部など)や下地の状態、施工方法(ローラー/吹き付け)で
 *   必要量は変わる。最終的には必ず塗料メーカーのカタログ値と施工業者の見積りで確認すること。
 * - 金額や重量は小数第2位で四捨五入して返す。
 */
(function (global) {
  "use strict";

  var AREA_MAX = 1000000;   // m2
  var COATS_MAX = 10;       // 塗り回数
  var LOSS_MAX = 100;       // ロス率(%)
  var RATE_MAX = 100;       // 標準塗布量(kg/m2)の上限
  var SPREAD_MAX = 1000;    // 標準塗り面積(m2/L)の上限
  var CAN_MAX = 10000;      // 1缶の内容量の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function validateCommon(areaM2, coats, lossPercent) {
    if (!isFiniteNumber(areaM2) || areaM2 <= 0 || areaM2 > AREA_MAX) {
      return { ok: false, code: "invalid_area" };
    }
    if (!isFiniteNumber(coats) || coats !== Math.floor(coats) || coats < 1 || coats > COATS_MAX) {
      return { ok: false, code: "invalid_coats" };
    }
    if (!isFiniteNumber(lossPercent) || lossPercent < 0 || lossPercent > LOSS_MAX) {
      return { ok: false, code: "invalid_loss" };
    }
    return null;
  }

  function cansOf(required, canSize) {
    // 浮動小数の誤差でちょうど割り切れる場合に1缶多くならないよう、ごくわずかな余裕を見る
    return Math.ceil(required / canSize - 1e-9);
  }

  /**
   * 標準塗布量(kg/m2/回)から必要な塗料の重さと缶数を求める。
   *   必要量(kg) = 塗装面積(m2) × 標準塗布量(kg/m2/回) × 塗り回数 × (1 + ロス率/100)
   *   缶数       = 必要量 ÷ 1缶の内容量(切り上げ)
   * @param {number} areaM2 塗装面積(m2、0超1000000以下)
   * @param {number} kgPerM2 標準塗布量(kg/m2/回、0超100以下)。塗料カタログの「使用量」等
   * @param {number} coats 塗り回数(1以上10以下の整数)
   * @param {number} lossPercent ロス率(%、0以上100以下)。飛散や吸い込みの割増し分
   * @param {number} [canKg] 1缶の内容量(kg、0超10000以下)。省略すると缶数を計算しない
   * @returns {{ok:true, requiredKg:number, perCoatKg:number, cans:(number|null),
   *            purchaseKg:(number|null), surplusKg:(number|null)}
   *          |{ok:false, code:"invalid_area"|"invalid_rate"|"invalid_coats"|"invalid_loss"|"invalid_can"}}
   *   requiredKg はロス率込みの必要量、perCoatKg は1回塗りあたりの必要量(ロス率込み)、
   *   purchaseKg は買う缶の合計内容量、surplusKg は余る量。
   */
  function byCoverage(areaM2, kgPerM2, coats, lossPercent, canKg) {
    var err = validateCommon(areaM2, coats, lossPercent);
    if (err) return err;
    if (!isFiniteNumber(kgPerM2) || kgPerM2 <= 0 || kgPerM2 > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    var required = areaM2 * kgPerM2 * coats * (1 + lossPercent / 100);
    var out = {
      ok: true,
      requiredKg: round2(required),
      perCoatKg: round2(required / coats),
      cans: null,
      purchaseKg: null,
      surplusKg: null
    };
    if (canKg === undefined || canKg === null) return out;
    if (!isFiniteNumber(canKg) || canKg <= 0 || canKg > CAN_MAX) {
      return { ok: false, code: "invalid_can" };
    }
    var cans = cansOf(required, canKg);
    out.cans = cans;
    out.purchaseKg = round2(cans * canKg);
    out.surplusKg = round2(cans * canKg - required);
    return out;
  }

  /**
   * 標準塗り面積(m2/L/回)から必要な塗料の量(L)と缶数を求める。
   *   必要量(L) = 塗装面積(m2) × 塗り回数 ÷ 標準塗り面積(m2/L/回) × (1 + ロス率/100)
   *   缶数      = 必要量 ÷ 1缶の内容量(切り上げ)
   * @param {number} areaM2 塗装面積(m2、0超1000000以下)
   * @param {number} m2PerL 標準塗り面積(m2/L/回、0超1000以下)。1Lで塗れる面積
   * @param {number} coats 塗り回数(1以上10以下の整数)
   * @param {number} lossPercent ロス率(%、0以上100以下)
   * @param {number} [canL] 1缶の内容量(L、0超10000以下)。省略すると缶数を計算しない
   * @returns {{ok:true, requiredL:number, perCoatL:number, cans:(number|null),
   *            purchaseL:(number|null), surplusL:(number|null)}
   *          |{ok:false, code:"invalid_area"|"invalid_spread"|"invalid_coats"|"invalid_loss"|"invalid_can"}}
   */
  function bySpreadRate(areaM2, m2PerL, coats, lossPercent, canL) {
    var err = validateCommon(areaM2, coats, lossPercent);
    if (err) return err;
    if (!isFiniteNumber(m2PerL) || m2PerL <= 0 || m2PerL > SPREAD_MAX) {
      return { ok: false, code: "invalid_spread" };
    }
    var required = areaM2 * coats / m2PerL * (1 + lossPercent / 100);
    var out = {
      ok: true,
      requiredL: round2(required),
      perCoatL: round2(required / coats),
      cans: null,
      purchaseL: null,
      surplusL: null
    };
    if (canL === undefined || canL === null) return out;
    if (!isFiniteNumber(canL) || canL <= 0 || canL > CAN_MAX) {
      return { ok: false, code: "invalid_can" };
    }
    var cans = cansOf(required, canL);
    out.cans = cans;
    out.purchaseL = round2(cans * canL);
    out.surplusL = round2(cans * canL - required);
    return out;
  }

  /**
   * 外壁の塗装面積のごく粗い見積り(延床面積 × 係数)。
   * 一戸建ての外壁面積は延床面積のおよそ1.2〜1.7倍とされる目安を使う。
   * @param {number} floorAreaM2 延床面積(m2、0超10000以下)
   * @param {number} [factor=1.3] 係数(1以上3以下)
   * @returns {{ok:true, wallAreaM2:number}|{ok:false, code:"invalid_area"|"invalid_factor"}}
   *   あくまで目安。正確な面積は図面か実測で確認すること。
   */
  function estimateWallArea(floorAreaM2, factor) {
    if (factor === undefined || factor === null) factor = 1.3;
    if (!isFiniteNumber(floorAreaM2) || floorAreaM2 <= 0 || floorAreaM2 > 10000) {
      return { ok: false, code: "invalid_area" };
    }
    if (!isFiniteNumber(factor) || factor < 1 || factor > 3) {
      return { ok: false, code: "invalid_factor" };
    }
    return { ok: true, wallAreaM2: round2(floorAreaM2 * factor) };
  }

  var api = {
    byCoverage: byCoverage,
    bySpreadRate: bySpreadRate,
    estimateWallArea: estimateWallArea,
    AREA_MAX: AREA_MAX,
    COATS_MAX: COATS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaintCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
