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

  /**
   * 割引の重ね掛け(○%オフからさらに○%オフ)。
   * 最終価格 = 定価 × (1 − p1/100) × (1 − p2/100)(円未満四捨五入)。
   * 実質割引率 = (1 − 掛け合わせ) × 100(小数第1位で四捨五入)。
   * 例: 20%オフ+10%オフは28%オフであり、30%オフにはならない。
   * naivePct は単純合計(p1+p2)で、勘違いしやすい値として表示用に返す。
   * @param {number} price 定価(円・0.01〜1億)
   * @param {number} pct1 1回目の割引率(%・0〜100)
   * @param {number} pct2 2回目の割引率(%・0〜100)
   * @returns {{ok:true, sale:number, saved:number, effectivePct:number, naivePct:number}
   *          |{ok:false, code:string}}  code: "invalid_price" | "invalid_pct"
   */
  function doubleOff(price, pct1, pct2) {
    if (!num(price, 0.01, 100000000)) return { ok: false, code: "invalid_price" };
    if (!num(pct1, 0, 100) || !num(pct2, 0, 100)) return { ok: false, code: "invalid_pct" };
    var factor = (1 - pct1 / 100) * (1 - pct2 / 100);
    var sale = Math.round(price * factor);
    return {
      ok: true,
      sale: sale,
      saved: Math.round(price) - sale,
      effectivePct: Math.round((1 - factor) * 1000) / 10,
      naivePct: Math.round((pct1 + pct2) * 10) / 10
    };
  }

  /**
   * 「○円引きクーポン」と「○%オフクーポン」の比較。
   * 円引き後 = 定価 − 値引き額(0円未満は0円で打ち切り・円未満四捨五入)。
   * %オフ後 = 定価 × (1 − 割引率/100)(円未満四捨五入)。
   * better: 支払いが安い方("yen" | "pct" | "even")。diff は両者の差額。
   * @param {number} price 定価(円・0.01〜1億)
   * @param {number} yenOff 値引き額(円・0〜1億)
   * @param {number} pctOff 割引率(%・0〜100)
   * @returns {{ok:true, byYen:number, byPct:number, better:string, diff:number}
   *          |{ok:false, code:string}}  code: "invalid_price" | "invalid_yen" | "invalid_pct"
   */
  function couponCompare(price, yenOff, pctOff) {
    if (!num(price, 0.01, 100000000)) return { ok: false, code: "invalid_price" };
    if (typeof yenOff !== "number" || !isFinite(yenOff) || yenOff < 0 || yenOff > 100000000) {
      return { ok: false, code: "invalid_yen" };
    }
    if (!num(pctOff, 0, 100)) return { ok: false, code: "invalid_pct" };
    var byYen = Math.max(0, Math.round(price - yenOff));
    var byPct = Math.round(price * (1 - pctOff / 100));
    return {
      ok: true,
      byYen: byYen,
      byPct: byPct,
      better: byYen < byPct ? "yen" : byPct < byYen ? "pct" : "even",
      diff: Math.abs(byYen - byPct)
    };
  }

  var api = {
    couponCompare: couponCompare,
    doubleOff: doubleOff, off: off, rate: rate };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.WaribikiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
