/*
 * 割引計算ロジック
 *
 * 計算方法:
 * - 割引後価格 = 定価 × (1 − 割引率÷100)(円未満四捨五入)
 * - 値引き額 = 定価 − 割引後価格(合計が定価と一致するよう差額で計算)
 * - 割引率の逆算 = (1 − 売価÷定価) × 100(小数第1位で四捨五入)
 */
(function (global) {
  "use strict";

  function num(v, min, max) {
    return typeof v === "number" && isFinite(v) && v >= min && v <= max;
  }

  /**
   * ○%オフ後の価格を計算する。
   * @param {number} price 定価(円)
   * @param {number} pct 割引率(%)
   * @returns {{ok: true, sale: number, saved: number}|{ok: false, code: string}}
   *   code: "invalid_price" | "invalid_pct"
   */
  function off(price, pct) {
    if (!num(price, 0.01, 100000000)) return { ok: false, code: "invalid_price" };
    if (!num(pct, 0, 100)) return { ok: false, code: "invalid_pct" };
    var sale = Math.round(price * (1 - pct / 100));
    return { ok: true, sale: sale, saved: Math.round(price) - sale };
  }

  /**
   * 定価と売価から割引率を逆算する。
   * @returns {{ok: true, pct: number}|{ok: false, code: string}}
   */
  function rate(price, sale) {
    if (!num(price, 0.01, 100000000)) return { ok: false, code: "invalid_price" };
    if (typeof sale !== "number" || !isFinite(sale) || sale < 0 || sale > price) {
      return { ok: false, code: "invalid_sale" };
    }
    return { ok: true, pct: Math.round((1 - sale / price) * 1000) / 10 };
  }

  var api = { off: off, rate: rate };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.WaribikiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
