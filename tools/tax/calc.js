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

  /**
   * 複数商品(最大8行)の税込合計を税率別内訳つきで計算する。
   * 国税庁の適格請求書(インボイス)の考え方に合わせ、消費税は「税率ごとの合計(税抜)」に
   * 対して1回だけ計算する(商品ごとに端数処理しない)。
   * 端数処理は rounding で選択: "floor"=1円未満切り捨て(既定・実務で最も一般的) /
   * "round"=四捨五入 / "ceil"=切り上げ。
   * @param {Array<{price:number, rate:number}>} items 行の配列(1〜8件)。
   *   price: 税抜金額(円・整数・1〜999,999,999) / rate: 8 または 10
   * @param {string} [rounding="floor"] 端数処理
   * @returns {{ok:true, base8:number, tax8:number, total8:number,
   *            base10:number, tax10:number, total10:number,
   *            base:number, tax:number, total:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_items" | "invalid_row" | "invalid_rounding"
   */
  function itemsTotal(items, rounding) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 8) {
      return { ok: false, code: "invalid_items" };
    }
    var mode = rounding === undefined || rounding === null ? "floor" : rounding;
    if (mode !== "floor" && mode !== "round" && mode !== "ceil") {
      return { ok: false, code: "invalid_rounding" };
    }
    var base8 = 0;
    var base10 = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !isFiniteNumber(it.price) || it.price !== Math.floor(it.price) ||
          it.price < PRICE_MIN_YEN || it.price > PRICE_MAX_YEN) {
        return { ok: false, code: "invalid_row" };
      }
      if (it.rate === 8) base8 += it.price;
      else if (it.rate === 10) base10 += it.price;
      else return { ok: false, code: "invalid_row" };
    }
    var f = mode === "floor" ? Math.floor : mode === "ceil" ? Math.ceil : Math.round;
    var tax8 = f(base8 * 8 / 100);
    var tax10 = f(base10 * 10 / 100);
    return {
      ok: true,
      base8: base8, tax8: tax8, total8: base8 + tax8,
      base10: base10, tax10: tax10, total10: base10 + tax10,
      base: base8 + base10, tax: tax8 + tax10, total: base8 + tax8 + base10 + tax10
    };
  }

  /**
   * 源泉徴収税額(個人への原稿料・講演料・デザイン料などの報酬)を計算する。
   * 100万円以下: 支払額 × 10.21% / 100万円超: 102,100円 + (支払額 − 100万円) × 20.42%。
   * 税額の1円未満は切り捨て。税率は復興特別所得税を含む(国税庁 タックスアンサー No.2792)。
   * @param {number} amountYen 報酬額(円・整数・1〜999,999,999)
   * @returns {{ok:true, tax:number, net:number}|{ok:false, code:string}}
   *   tax: 源泉徴収税額 / net: 差引支払額。code: "invalid_price"
   */
  function withholding(amountYen) {
    if (!isFiniteNumber(amountYen) || amountYen !== Math.floor(amountYen) ||
        amountYen < PRICE_MIN_YEN || amountYen > PRICE_MAX_YEN) {
      return { ok: false, code: "invalid_price" };
    }
    var tax;
    if (amountYen <= 1000000) {
      tax = Math.floor(amountYen * 1021 / 10000);
    } else {
      tax = Math.floor(102100 + (amountYen - 1000000) * 2042 / 10000);
    }
    return { ok: true, tax: tax, net: amountYen - tax };
  }

  var api = {
    withholding: withholding,
    itemsTotal: itemsTotal,
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
