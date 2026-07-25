/*
 * 利益率・原価率計算ロジック
 *
 * 計算方法:
 * - 粗利(利益) = 売価 − 原価
 * - 利益率(粗利率) = 粗利 ÷ 売価 × 100(売価基準。小数第1位で四捨五入)
 * - 原価率 = 原価 ÷ 売価 × 100
 * - 売価の逆算 = 原価 ÷ (1 − 目標利益率÷100)(円未満四捨五入)
 */
(function (global) {
  "use strict";

  function num(v, min, max) {
    return typeof v === "number" && isFinite(v) && v >= min && v <= max;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /**
   * 売価と原価から利益率・原価率を計算する。
   * @param {number} price 売価(円)
   * @param {number} cost 原価(円)
   * @returns {{ok: true, profit: number, marginPct: number, costPct: number}
   *          |{ok: false, code: string}}  code: "invalid_price" | "invalid_cost"
   */
  function analyze(price, cost) {
    if (!num(price, 0.01, 1000000000)) return { ok: false, code: "invalid_price" };
    if (!num(cost, 0, 1000000000)) return { ok: false, code: "invalid_cost" };
    var profit = price - cost;
    return {
      ok: true,
      profit: Math.round(profit * 100) / 100,
      marginPct: round1(profit / price * 100),
      costPct: round1(cost / price * 100)
    };
  }

  /**
   * 目標利益率から売価を逆算する。
   * @param {number} cost 原価(円)
   * @param {number} marginPct 目標利益率(%・100未満)
   * @returns {{ok: true, price: number}|{ok: false, code: string}}
   */
  function priceFor(cost, marginPct) {
    if (!num(cost, 0.01, 1000000000)) return { ok: false, code: "invalid_cost" };
    if (typeof marginPct !== "number" || !isFinite(marginPct) || marginPct < 0 || marginPct >= 100) {
      return { ok: false, code: "invalid_margin" };
    }
    return { ok: true, price: Math.round(cost / (1 - marginPct / 100)) };
  }

  /**
   * 損益分岐点: 赤字にならないために必要な販売数量と売上高を計算する。
   * 必要数量 = (固定費 + 目標利益) ÷ (販売単価 − 1個あたり変動費) を切り上げ(この数量以上で達成)。
   * 売上高 = 数量 × 単価(円未満四捨五入)。1個あたり利益(限界利益)は小数第2位、
   * 限界利益率は小数第1位で四捨五入。
   * @param {number} fixedCost 固定費(円・0〜10億。家賃・人件費など売れなくてもかかる費用)
   * @param {number} variableCost 1個あたり変動費(円・0〜10億。材料費・仕入れなど)
   * @param {number} unitPrice 販売単価(円・0.01〜10億)
   * @param {number} [targetProfit=0] 目標利益(円・0〜10億。0なら損益分岐点そのもの)
   * @returns {{ok:true, qty:number, sales:number, unitMargin:number, marginRatePct:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_fixed" | "invalid_variable" | "invalid_price" | "invalid_target" | "no_margin"
   */
  function breakEven(fixedCost, variableCost, unitPrice, targetProfit) {
    if (!num(fixedCost, 0, 1000000000)) return { ok: false, code: "invalid_fixed" };
    if (!num(variableCost, 0, 1000000000)) return { ok: false, code: "invalid_variable" };
    if (!num(unitPrice, 0.01, 1000000000)) return { ok: false, code: "invalid_price" };
    var target = targetProfit === undefined || targetProfit === null ? 0 : targetProfit;
    if (typeof target !== "number" || !isFinite(target) || target < 0 || target > 1000000000) {
      return { ok: false, code: "invalid_target" };
    }
    var margin = unitPrice - variableCost;
    if (margin <= 0) return { ok: false, code: "no_margin" };
    var qty = Math.ceil((fixedCost + target) / margin);
    return {
      ok: true,
      qty: qty,
      sales: Math.round(qty * unitPrice),
      unitMargin: Math.round(margin * 100) / 100,
      marginRatePct: round1(margin / unitPrice * 100)
    };
  }

  /**
   * フリマ・ネット販売の手取り利益: 販売手数料と送料を引いた実質利益を計算する。
   * 手数料 = 売価 × 手数料率(1円未満切り捨て。メルカリ等の主要フリマの端数処理に合わせる)。
   * 実質利益 = 売価 − 手数料 − 送料 − 原価(小数第2位で四捨五入)。
   * 実質利益率 = 実質利益 ÷ 売価 × 100(小数第1位で四捨五入)。
   * @param {number} price 売価(円・0.01〜10億)
   * @param {number} feePct 販売手数料率(%・0〜100未満。メルカリ10%など)
   * @param {number} shipCost 送料(円・0〜10億。出品者負担分)
   * @param {number} cost 原価・仕入れ値(円・0〜10億)
   * @returns {{ok:true, fee:number, profit:number, marginPct:number}|{ok:false, code:string}}
   *   code: "invalid_price" | "invalid_fee" | "invalid_ship" | "invalid_cost"
   */
  function netProfit(price, feePct, shipCost, cost) {
    if (!num(price, 0.01, 1000000000)) return { ok: false, code: "invalid_price" };
    if (typeof feePct !== "number" || !isFinite(feePct) || feePct < 0 || feePct >= 100) {
      return { ok: false, code: "invalid_fee" };
    }
    if (!num(shipCost, 0, 1000000000)) return { ok: false, code: "invalid_ship" };
    if (!num(cost, 0, 1000000000)) return { ok: false, code: "invalid_cost" };
    var fee = Math.floor(price * feePct / 100);
    var profit = Math.round((price - fee - shipCost - cost) * 100) / 100;
    return { ok: true, fee: fee, profit: profit, marginPct: round1(profit / price * 100) };
  }

  var api = {
    netProfit: netProfit,
    breakEven: breakEven, analyze: analyze, priceFor: priceFor };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.GenkaCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
