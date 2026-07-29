/*
 * <ツール名> の計算ロジック(ひな形)
 *
 * 根拠(一次情報):
 * - <機関名>「<資料名>」 <URL>(<参照日>)
 *
 * 前提:
 * - <どんな条件での計算か。何を含み何を含まないか>
 */
(function (global) {
  "use strict";

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * <何を計算するか>
   * @param {number} a <引数の意味と単位>
   * @param {number} b <引数の意味と単位>
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_a"|"invalid_b"}}
   *   エラーは必ず code で返す(画面側で言語ごとの文言に変える)
   */
  function calculate(a, b) {
    if (!isFiniteNumber(a) || a <= 0) return { ok: false, code: "invalid_a" };
    if (!isFiniteNumber(b) || b <= 0) return { ok: false, code: "invalid_b" };
    return { ok: true, value: a * b };
  }

  var api = {
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SampleCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
