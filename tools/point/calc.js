/*
 * 割引とポイント還元の比較計算ロジック(どっちが得?)
 *
 * 計算方法:
 * - 割引: 支払額 = 価格 × (1 − 割引率/100)
 * - ポイント還元: 支払額は定価のまま。獲得ポイント = 価格 × 還元率/100 を
 *   後日使うとみなした実質負担 = 価格 × (1 − 還元率/100)
 * - ただしポイントは「支払った100+r円分の価値に対してr円分」なので、
 *   割引に換算すると 還元率r% ≒ 割引率 100r/(100+r) %(例: 10%還元≒9.09%オフ)
 * - 得かどうかの判定は割引率と割引換算率の比較(丸め前の値で判定)
 * - 金額は円未満四捨五入、換算率は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * 「○%オフ」と「○%ポイント還元」を比較する。
   * @param {number} price 定価(円)
   * @param {number} discountPct 割引率(%・0以上100未満)
   * @param {number} pointPct ポイント還元率(%・0〜100)
   * @returns {{ok: true, discounted: number, pointNet: number, pointValue: number,
   *            pointEquivPct: number, better: string}
   *          |{ok: false, code: string}}
   *   discounted: 割引後の支払額 / pointNet: 還元の実質負担額 /
   *   pointValue: 獲得ポイント / pointEquivPct: 還元の割引換算率(%) /
   *   better: "discount" | "point" | "even"
   *   code: "invalid_price" | "invalid_discount" | "invalid_point"
   */
  function compare(price, discountPct, pointPct) {
    if (typeof price !== "number" || !isFinite(price) || price <= 0 || price > 10000000) {
      return { ok: false, code: "invalid_price" };
    }
    if (typeof discountPct !== "number" || !isFinite(discountPct) || discountPct < 0 || discountPct >= 100) {
      return { ok: false, code: "invalid_discount" };
    }
    if (typeof pointPct !== "number" || !isFinite(pointPct) || pointPct < 0 || pointPct > 100) {
      return { ok: false, code: "invalid_point" };
    }
    var equivRaw = 100 * pointPct / (100 + pointPct);
    return {
      ok: true,
      discounted: Math.round(price * (1 - discountPct / 100)),
      pointNet: Math.round(price * (1 - pointPct / 100)),
      pointValue: Math.round(price * pointPct / 100),
      pointEquivPct: round2(equivRaw),
      better: discountPct > equivRaw ? "discount" : discountPct < equivRaw ? "point" : "even"
    };
  }

  var api = {
    compare: compare
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PointCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
