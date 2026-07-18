/*
 * 消費税(税込⇔税抜)計算ロジック
 *
 * 税率の根拠(一次情報):
 * - 標準税率10%・軽減税率8%(飲食料品(酒類・外食を除く)と定期購読新聞)
 *   出典: 国税庁「消費税の軽減税率制度について」
 *   https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/index.htm
 *
 * 前提(ページにも明記):
 * - 端数(1円未満)は四捨五入で計算。実際の端数処理(切り捨て・切り上げ・四捨五入)は
 *   事業者ごとに異なるため、店頭の金額と1円単位で差が出ることがある
 */
(function (global) {
  "use strict";

  var PRICE_MIN_YEN = 1;
  var PRICE_MAX_YEN = 999999999;
  var RATES = [8, 10];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 消費税を計算する。
   * @param {number} priceYen 金額(円・整数)
   * @param {number} ratePercent 税率(8 または 10)
   * @param {string} direction "add"(税抜→税込) | "remove"(税込→税抜)
   * @returns {{ok: true, taxExcluded: number, taxAmount: number, taxIncluded: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_price" | "invalid_rate" | "invalid_direction"
   */
  function calculate(priceYen, ratePercent, direction) {
    if (!isFiniteNumber(priceYen) || priceYen !== Math.floor(priceYen) ||
        priceYen < PRICE_MIN_YEN || priceYen > PRICE_MAX_YEN) {
      return { ok: false, code: "invalid_price" };
    }
    if (RATES.indexOf(ratePercent) === -1) {
      return { ok: false, code: "invalid_rate" };
    }
    if (direction !== "add" && direction !== "remove") {
      return { ok: false, code: "invalid_direction" };
    }
    var r = ratePercent / 100;
    var excluded, tax, included;
    if (direction === "add") {
      excluded = priceYen;
      tax = Math.round(priceYen * r);
      included = excluded + tax;
    } else {
      included = priceYen;
      excluded = Math.round(priceYen / (1 + r));
      tax = included - excluded;
    }
    return { ok: true, taxExcluded: excluded, taxAmount: tax, taxIncluded: included };
  }

  var api = {
    calculate: calculate,
    PRICE_MIN_YEN: PRICE_MIN_YEN,
    PRICE_MAX_YEN: PRICE_MAX_YEN,
    RATES: RATES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TaxCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
