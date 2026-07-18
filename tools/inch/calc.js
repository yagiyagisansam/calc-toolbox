/*
 * インチ⇔cm・ポンド⇔kg 変換ロジック
 *
 * 換算値の根拠:
 * - 1インチ = 2.54cm(国際インチの定義値・誤差なし)
 * - 1ポンド = 0.45359237kg(国際ポンドの定義値・誤差なし)
 *   いずれもヤード・ポンド法の国際協定(1959年)による定義値。
 *   日本では取引・証明への使用は計量法によりメートル法が原則
 *   https://laws.e-gov.go.jp/law/404AC0000000051
 */
(function (global) {
  "use strict";

  var VALUE_MIN = 0.001;
  var VALUE_MAX = 1000000;
  var CM_PER_INCH = 2.54;
  var KG_PER_POUND = 0.45359237;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function validValue(v) {
    return isFiniteNumber(v) && v >= VALUE_MIN && v <= VALUE_MAX;
  }

  /**
   * 長さの変換。
   * @param {number} value 値
   * @param {string} fromUnit "in" | "cm"
   * @returns {{ok: true, inch: number, cm: number}|{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convertLength(value, fromUnit) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    if (fromUnit !== "in" && fromUnit !== "cm") return { ok: false, code: "invalid_unit" };
    var cm = fromUnit === "in" ? value * CM_PER_INCH : value;
    return { ok: true, inch: round2(cm / CM_PER_INCH), cm: round2(cm) };
  }

  /**
   * 重さの変換。
   * @param {number} value 値
   * @param {string} fromUnit "lb" | "kg"
   * @returns {{ok: true, lb: number, kg: number}|{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convertWeight(value, fromUnit) {
    if (!validValue(value)) return { ok: false, code: "invalid_value" };
    if (fromUnit !== "lb" && fromUnit !== "kg") return { ok: false, code: "invalid_unit" };
    var kg = fromUnit === "lb" ? value * KG_PER_POUND : value;
    return { ok: true, lb: round2(kg / KG_PER_POUND), kg: round2(kg) };
  }

  var api = {
    convertLength: convertLength,
    convertWeight: convertWeight,
    VALUE_MIN: VALUE_MIN,
    VALUE_MAX: VALUE_MAX,
    CM_PER_INCH: CM_PER_INCH,
    KG_PER_POUND: KG_PER_POUND
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.InchCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
