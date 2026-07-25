/*
 * 坪・平方メートル・畳 変換ロジック
 *
 * 換算値の根拠(一次情報):
 * - 1坪 = 400/121 ㎡(約3.31㎡)。1尺=10/33mの定義から 1坪=(6尺)²=400/121㎡
 *   取引・証明への尺貫法の使用は計量法で禁止されており、坪表記は慣用的な参考値
 *   出典: 計量法(平成4年法律第51号) https://laws.e-gov.go.jp/law/404AC0000000051
 * - 畳1枚 = 1.62㎡(壁心面積ベースの下限基準)
 *   出典: 不動産公正取引協議会連合会「不動産の表示に関する公正競争規約施行規則」
 *   https://www.rftc.jp/koseikyosokiyaku/
 *
 * 前提:
 * - 畳の実寸は地域・種類(京間・中京間・江戸間・団地間)で異なるため、
 *   広告表示基準の1.62㎡/枚による概算
 */
(function (global) {
  "use strict";

  var VALUE_MIN = 0.01;
  var VALUE_MAX = 100000;
  var SQM_PER_TSUBO = 400 / 121;
  var SQM_PER_JO = 1.62;
  var UNITS = ["sqm", "tsubo", "jo"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 面積を3単位へ相互変換する。
   * @param {number} value 面積の値
   * @param {string} fromUnit "sqm"(㎡) | "tsubo"(坪) | "jo"(畳)
   * @returns {{ok: true, sqm: number, tsubo: number, jo: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convert(value, fromUnit) {
    if (!isFiniteNumber(value) || value < VALUE_MIN || value > VALUE_MAX) {
      return { ok: false, code: "invalid_value" };
    }
    if (UNITS.indexOf(fromUnit) === -1) {
      return { ok: false, code: "invalid_unit" };
    }
    var sqm =
      fromUnit === "sqm" ? value :
      fromUnit === "tsubo" ? value * SQM_PER_TSUBO :
      value * SQM_PER_JO;
    return {
      ok: true,
      sqm: round2(sqm),
      tsubo: round2(sqm / SQM_PER_TSUBO),
      jo: round2(sqm / SQM_PER_JO)
    };
  }

  /**
   * 土地面積と建ぺい率・容積率から、建てられる建物の上限を計算する。
   *
   * - 建築面積の上限 = 土地面積 × 建ぺい率 ÷ 100
   *   (建ぺい率: 土地を真上から見たとき、建物が占めてよい面積の割合)
   * - 延べ床面積の上限 = 土地面積 × 容積率 ÷ 100
   *   (容積率: 全フロアの床面積の合計が土地面積の何%まで許されるか)
   * - 参考の階数 = 容積率 ÷ 建ぺい率(建ぺい率いっぱいに建てた場合の単純計算)
   * 建ぺい率・容積率は都市計画で用途地域ごとに定められる(建築基準法52・53条)。
   * 実際は斜線制限・高さ制限等でさらに制限されることがある。
   *
   * 丸め: 面積・階数は小数第2位で四捨五入。坪は 1坪 = 400/121㎡ で換算。
   * @param {number} landSqm 土地面積(㎡)
   * @param {number} kenpeiPct 建ぺい率(%)(1〜100)
   * @param {number} yosekiPct 容積率(%)(1〜2000)
   * @returns {{ok:true, buildingSqm:number, buildingTsubo:number,
   *            floorSqm:number, floorTsubo:number, floorsHint:number}
   *          |{ok:false, code:string}} code: "invalid_value"|"invalid_kenpei"|"invalid_yoseki"
   */
  function buildingLimits(landSqm, kenpeiPct, yosekiPct) {
    if (!isFiniteNumber(landSqm) || landSqm < VALUE_MIN || landSqm > VALUE_MAX) {
      return { ok: false, code: "invalid_value" };
    }
    if (!isFiniteNumber(kenpeiPct) || kenpeiPct < 1 || kenpeiPct > 100) {
      return { ok: false, code: "invalid_kenpei" };
    }
    if (!isFiniteNumber(yosekiPct) || yosekiPct < 1 || yosekiPct > 2000) {
      return { ok: false, code: "invalid_yoseki" };
    }
    var building = landSqm * kenpeiPct / 100;
    var floor = landSqm * yosekiPct / 100;
    return {
      ok: true,
      buildingSqm: round2(building),
      buildingTsubo: round2(building / SQM_PER_TSUBO),
      floorSqm: round2(floor),
      floorTsubo: round2(floor / SQM_PER_TSUBO),
      floorsHint: round2(yosekiPct / kenpeiPct)
    };
  }

  /**
   * 物件価格と面積から坪単価・㎡単価を計算する。
   * 坪単価 = 価格 ÷ 坪数、㎡単価 = 価格 ÷ ㎡数(1坪 = 400/121㎡ で換算)。
   * 丸め: 小数第2位で四捨五入。価格の単位は入力のまま(万円なら結果も万円)。
   * @param {number} price 価格(例: 万円)(0より大きい)
   * @param {number} value 面積の値
   * @param {string} unit 面積の単位 "sqm" | "tsubo" | "jo"
   * @returns {{ok:true, perTsubo:number, perSqm:number, tsubo:number, sqm:number}
   *          |{ok:false, code:string}} code: "invalid_price"|"invalid_value"|"invalid_unit"
   */
  function pricePerArea(price, value, unit) {
    if (!isFiniteNumber(price) || price <= 0 || price > 1e9) {
      return { ok: false, code: "invalid_price" };
    }
    var conv = convert(value, unit);
    if (!conv.ok) return conv;
    var sqm =
      unit === "sqm" ? value :
      unit === "tsubo" ? value * SQM_PER_TSUBO :
      value * SQM_PER_JO;
    var tsubo = sqm / SQM_PER_TSUBO;
    return {
      ok: true,
      perTsubo: round2(price / tsubo),
      perSqm: round2(price / sqm),
      tsubo: round2(tsubo),
      sqm: round2(sqm)
    };
  }

  var api = {
    pricePerArea: pricePerArea,
    buildingLimits: buildingLimits,
    convert: convert,
    VALUE_MIN: VALUE_MIN,
    VALUE_MAX: VALUE_MAX,
    SQM_PER_TSUBO: SQM_PER_TSUBO,
    SQM_PER_JO: SQM_PER_JO
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TsuboCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
