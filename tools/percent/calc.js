/*
 * パーセント計算ロジック
 *
 * 計算式:
 * - AはBの何%か: A ÷ B × 100
 * - AのB%はいくつか: A × B ÷ 100
 * - AからBへの増減率: (B − A) ÷ A × 100
 *
 * 前提(ページにも明記):
 * - 結果は小数第2位までの四捨五入(端数処理による差が出ることがある)
 */
(function (global) {
  "use strict";

  var VALUE_MAX = 1000000000;
  var PERCENT_MAX = 10000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function validPositive(v) {
    return isFiniteNumber(v) && v > 0 && v <= VALUE_MAX;
  }

  /**
   * AはBの何%か。
   * @returns {{ok: true, percent: number}|{ok: false, code: "invalid_part"|"invalid_whole"}}
   */
  function whatPercent(part, whole) {
    if (!isFiniteNumber(part) || part < 0 || part > VALUE_MAX) return { ok: false, code: "invalid_part" };
    if (!validPositive(whole)) return { ok: false, code: "invalid_whole" };
    return { ok: true, percent: round2(part / whole * 100) };
  }

  /**
   * AのB%はいくつか。
   * @returns {{ok: true, value: number}|{ok: false, code: "invalid_value"|"invalid_percent"}}
   */
  function percentOf(value, percent) {
    if (!validPositive(value)) return { ok: false, code: "invalid_value" };
    if (!isFiniteNumber(percent) || percent < 0 || percent > PERCENT_MAX) {
      return { ok: false, code: "invalid_percent" };
    }
    return { ok: true, value: round2(value * percent / 100) };
  }

  /**
   * AからBへの増減率(%)。増加は正、減少は負。
   * @returns {{ok: true, rate: number}|{ok: false, code: "invalid_from"|"invalid_to"}}
   */
  function changeRate(from, to) {
    if (!validPositive(from)) return { ok: false, code: "invalid_from" };
    if (!isFiniteNumber(to) || to < 0 || to > VALUE_MAX) return { ok: false, code: "invalid_to" };
    return { ok: true, rate: round2((to - from) / from * 100) };
  }

  /**
   * 変化率(%)を順番に掛け合わせて、結局何%変わったかを計算する。
   * 例: +10% のあと -10% → 1.10 × 0.90 = 0.99 で、合計 -1%(元より減る)。
   * 丸め: 結果は小数第2位で四捨五入。
   * @param {number[]} rates 変化率の配列(増加は正、減少は負。-100より大きく10000以下)。最大10件
   * @param {number} [startValue] 元の値(指定すると最終的な値も返す)
   * @returns {{ok:true, totalRate:number, finalValue?:number}
   *          |{ok:false, code:string}} code: "empty"|"too_many"|"invalid_rate"|"invalid_value"
   */
  function chainRates(rates, startValue) {
    if (!Array.isArray(rates) || rates.length === 0) return { ok: false, code: "empty" };
    if (rates.length > 10) return { ok: false, code: "too_many" };
    var factor = 1;
    for (var i = 0; i < rates.length; i++) {
      var p = rates[i];
      if (!isFiniteNumber(p) || p <= -100 || p > PERCENT_MAX) return { ok: false, code: "invalid_rate" };
      factor *= 1 + p / 100;
    }
    var out = { ok: true, totalRate: round2((factor - 1) * 100) };
    if (startValue !== undefined && startValue !== null) {
      if (!validPositive(startValue)) return { ok: false, code: "invalid_value" };
      out.finalValue = round2(startValue * factor);
    }
    return out;
  }

  /**
   * 「○%の変化を打ち消すには、逆に何%変えればよいか」を計算する。
   * +p% を打ち消す率 = (1 ÷ (1 + p/100) − 1) × 100。
   * 例: +25% を打ち消すには -20%(1.25 × 0.80 = 1)。増減は対称ではない点に注意。
   * 丸め: 小数第2位で四捨五入。
   * @param {number} rate 適用済みの変化率(%。増加は正、減少は負。-100より大きく10000以下)
   * @returns {{ok:true, cancel:number}|{ok:false, code:"invalid_rate"}}
   *   cancel: 打ち消しに必要な変化率(符号は元と逆になる)
   */
  function cancelRate(rate) {
    if (!isFiniteNumber(rate) || rate <= -100 || rate > PERCENT_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    return { ok: true, cancel: round2((1 / (1 + rate / 100) - 1) * 100) };
  }

  /**
   * 「○%変化した後の値」から元の値を逆算する。元の値 = 後の値 ÷ (1 + 率/100)。
   * 例: 5%増えて105になった → 元は100。20%引きで80になった → 元は100。
   * 丸め: 小数第2位で四捨五入。
   * @param {number} after 変化した後の値(0より大きい)
   * @param {number} rate 適用された変化率(%。増加は正、減少は負)
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_after"|"invalid_rate"}}
   */
  function beforeChange(after, rate) {
    if (!validPositive(after)) return { ok: false, code: "invalid_after" };
    if (!isFiniteNumber(rate) || rate <= -100 || rate > PERCENT_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    return { ok: true, value: round2(after / (1 + rate / 100)) };
  }

  var api = {
    beforeChange: beforeChange,
    cancelRate: cancelRate,
    chainRates: chainRates,
    whatPercent: whatPercent,
    percentOf: percentOf,
    changeRate: changeRate,
    VALUE_MAX: VALUE_MAX,
    PERCENT_MAX: PERCENT_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PercentCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
