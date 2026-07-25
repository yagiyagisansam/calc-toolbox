/*
 * チップ計算ロジック
 *
 * 計算方法:
 * - チップ = 金額 × チップ率 ÷ 100
 * - 合計 = 金額 + チップ
 * - 1人あたり = 合計 ÷ 人数
 * - 外貨の小数(セント)を扱うため小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * チップと合計を計算する。
   * @param {number} amount 飲食代などの金額
   * @param {number} pct チップ率(%・0〜50)
   * @param {number} [people=1] 割り勘の人数(1〜50)
   * @returns {{ok: true, tip: number, total: number, perPerson: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_amount" | "invalid_pct" | "invalid_people"
   */
  function calc(amount, pct, people) {
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 1000000) {
      return { ok: false, code: "invalid_amount" };
    }
    if (typeof pct !== "number" || !isFinite(pct) || pct < 0 || pct > 50) {
      return { ok: false, code: "invalid_pct" };
    }
    var n = people === undefined || people === null ? 1 : people;
    if (typeof n !== "number" || !isFinite(n) || n !== Math.floor(n) || n < 1 || n > 50) {
      return { ok: false, code: "invalid_people" };
    }
    var tip = amount * pct / 100;
    var total = amount + tip;
    return { ok: true, tip: round2(tip), total: round2(total), perPerson: round2(total / n) };
  }

  /**
   * 支払い総額からチップ率を逆算する。
   * チップ率 = (支払総額 − 元の金額) ÷ 元の金額 × 100(小数第1位で四捨五入)。
   * チップ額は小数第2位で四捨五入。verdict はアメリカの一般的な水準(15〜20%)による目安:
   * 15%以上 "enough" / 0超〜15%未満 "low" / 0% "none"(判定は丸め前の値で行う)。
   * @param {number} paidTotal 実際に支払った総額(チップ込み・0.01〜200万)
   * @param {number} baseAmount 元の金額(チップを掛ける前の飲食代・0.01〜100万)
   * @returns {{ok:true, tip:number, pct:number, verdict:string}|{ok:false, code:string}}
   *   code: "invalid_amount" | "invalid_paid"(元の金額より少ない支払いを含む)
   */
  function reverse(paidTotal, baseAmount) {
    if (typeof baseAmount !== "number" || !isFinite(baseAmount) || baseAmount <= 0 || baseAmount > 1000000) {
      return { ok: false, code: "invalid_amount" };
    }
    if (typeof paidTotal !== "number" || !isFinite(paidTotal) || paidTotal <= 0 ||
        paidTotal > 2000000 || paidTotal < baseAmount) {
      return { ok: false, code: "invalid_paid" };
    }
    var tip = paidTotal - baseAmount;
    var pctRaw = tip / baseAmount * 100;
    return {
      ok: true,
      tip: round2(tip),
      pct: Math.round(pctRaw * 10) / 10,
      verdict: pctRaw >= 15 ? "enough" : pctRaw > 0 ? "low" : "none"
    };
  }

  /**
   * サービス料込み請求でのチップ上乗せ要否の目安。
   * 請求書に15%以上のサービス料(service charge / gratuity)が含まれていれば
   * 追加チップは不要が一般的(need=false)。15%未満なら、合計が15%・18%になるまでの
   * 追加額の目安を返す(小数第2位で四捨五入)。
   * @param {number} baseAmount サービス料を掛ける前の金額(0.01〜100万)
   * @param {number} servicePct 請求書のサービス料率(%・0〜50)
   * @returns {{ok:true, need:boolean, add15:number, add18:number}|{ok:false, code:string}}
   *   code: "invalid_amount" | "invalid_pct"
   */
  function serviceAdvice(baseAmount, servicePct) {
    if (typeof baseAmount !== "number" || !isFinite(baseAmount) || baseAmount <= 0 || baseAmount > 1000000) {
      return { ok: false, code: "invalid_amount" };
    }
    if (typeof servicePct !== "number" || !isFinite(servicePct) || servicePct < 0 || servicePct > 50) {
      return { ok: false, code: "invalid_pct" };
    }
    var need = servicePct < 15;
    return {
      ok: true,
      need: need,
      add15: need ? round2(baseAmount * (15 - servicePct) / 100) : 0,
      add18: servicePct < 18 ? round2(baseAmount * (18 - servicePct) / 100) : 0
    };
  }

  var api = {
    serviceAdvice: serviceAdvice,
    reverse: reverse, calc: calc };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.TipCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
