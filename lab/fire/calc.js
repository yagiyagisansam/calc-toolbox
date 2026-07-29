/*
 * FIRE必要資産(4%ルール)の計算ロジック
 *
 * 根拠(出典):
 * - FIRE SIMULATOR「トリニティスタディに基づく4%ルールの理論と日本での実践」
 *   https://firesim.jp/fire/articles/basics/four-percent-rule (2026年7月29日参照)
 *   4%ルール = 初年度に資産の4%を引き出し、翌年以降はインフレ率に合わせて引出額を増やす方法。
 *   トリニティスタディ(1926〜1995年の米国市場、株式75%・債券25%)で30年後に資産が残る確率98%。
 *   必要資産の倍率は 1 ÷ 取り崩し率(4%→25倍、3.5%→約28.6倍、3%→約33.3倍)。
 * - 達成年数は年金終価(積立の将来価値)の式を年数について解いたもの。
 *   将来価値 FV = C(1+r)^n + P((1+r)^n − 1)/r を FV = T として n について解くと
 *   n = log((T·r + P) / (C·r + P)) / log(1 + r)  (C:現在資産, P:毎年の積立額, r:年利回り)
 *
 * 前提:
 * - 金額の単位はすべて万円。積立は年1回・期末払い、利回りは毎年一定の複利とする。
 * - 税金(運用益に約20.315%)・手数料・インフレ・為替は考慮しない概算。
 * - 取り崩し率は「初年度の引出額 ÷ 資産」であり、毎年同率で引き出す意味ではない。
 */
(function (global) {
  "use strict";

  var EXPENSE_MAX = 100000; // 年間支出の上限(万円)
  var ASSET_MAX = 1000000; // 資産の上限(万円)
  var RATE_MIN = 0.1; // 取り崩し率の下限(%)
  var RATE_MAX = 20; // 取り崩し率の上限(%)
  var RETURN_MIN = -20; // 想定利回りの下限(%)
  var RETURN_MAX = 30; // 想定利回りの上限(%)
  var YEARS_MAX = 200; // これを超える達成年数は「到達しない」とみなす

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する(表示のブレを防ぐため計算結果は必ずここを通す) */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /**
   * 必要資産(FIRE達成に必要な金融資産額)を求める。
   * @param {number} annualExpenseMan 年間支出(万円、0より大きくEXPENSE_MAX以下)
   * @param {number} withdrawalRatePct 年間の取り崩し率(%、RATE_MIN〜RATE_MAX)
   * @returns {{ok:true, requiredMan:number, multiple:number, monthlyExpenseMan:number}
   *          |{ok:false, code:"invalid_expense"|"invalid_rate"}}
   *   requiredMan: 必要資産(万円、小数第1位で四捨五入)
   *   multiple: 年間支出の何倍か(小数第1位で四捨五入)
   *   monthlyExpenseMan: 月あたりの支出(万円、小数第2位で四捨五入)
   */
  function required(annualExpenseMan, withdrawalRatePct) {
    if (!isFiniteNumber(annualExpenseMan) || annualExpenseMan <= 0 || annualExpenseMan > EXPENSE_MAX) {
      return { ok: false, code: "invalid_expense" };
    }
    if (!isFiniteNumber(withdrawalRatePct) || withdrawalRatePct < RATE_MIN || withdrawalRatePct > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    var rate = withdrawalRatePct / 100;
    return {
      ok: true,
      requiredMan: round(annualExpenseMan / rate, 1),
      multiple: round(1 / rate, 1),
      monthlyExpenseMan: round(annualExpenseMan / 12, 2)
    };
  }

  /**
   * 現在資産と毎年の積立から、必要資産に到達するまでの年数を求める。
   * @param {number} annualExpenseMan 年間支出(万円)
   * @param {number} withdrawalRatePct 取り崩し率(%)
   * @param {number} currentMan 現在の金融資産(万円、0以上)
   * @param {number} annualSaveMan 毎年の積立額(万円、0以上)
   * @param {number} returnPct 想定利回り(年率%、RETURN_MIN〜RETURN_MAX)
   * @returns {{ok:true, requiredMan:number, multiple:number, years:number, months:number,
   *            shortfallMan:number, alreadyReached:boolean}
   *          |{ok:false, code:"invalid_expense"|"invalid_rate"|"invalid_current"
   *                          |"invalid_save"|"invalid_return"|"unreachable"}}
   *   years: 達成までの年数(小数第1位で四捨五入)。すでに到達済みなら0
   *   months: 達成までの月数に直した値(小数を12倍して四捨五入)
   *   shortfallMan: 不足額(万円、小数第1位で四捨五入)
   *   到達に200年超かかる/永久に届かない場合は code:"unreachable"
   */
  function simulate(annualExpenseMan, withdrawalRatePct, currentMan, annualSaveMan, returnPct) {
    var base = required(annualExpenseMan, withdrawalRatePct);
    if (!base.ok) return base;
    if (!isFiniteNumber(currentMan) || currentMan < 0 || currentMan > ASSET_MAX) {
      return { ok: false, code: "invalid_current" };
    }
    if (!isFiniteNumber(annualSaveMan) || annualSaveMan < 0 || annualSaveMan > EXPENSE_MAX) {
      return { ok: false, code: "invalid_save" };
    }
    if (!isFiniteNumber(returnPct) || returnPct < RETURN_MIN || returnPct > RETURN_MAX) {
      return { ok: false, code: "invalid_return" };
    }

    var target = annualExpenseMan / (withdrawalRatePct / 100);
    var r = returnPct / 100;
    var years;

    if (currentMan >= target) {
      years = 0;
    } else if (r === 0) {
      if (annualSaveMan <= 0) return { ok: false, code: "unreachable" };
      years = (target - currentMan) / annualSaveMan;
    } else {
      var num = target * r + annualSaveMan;
      var den = currentMan * r + annualSaveMan;
      if (den <= 0 || num <= 0) return { ok: false, code: "unreachable" };
      years = Math.log(num / den) / Math.log(1 + r);
    }
    if (!isFinite(years) || years < 0 || years > YEARS_MAX) {
      return { ok: false, code: "unreachable" };
    }

    return {
      ok: true,
      requiredMan: base.requiredMan,
      multiple: base.multiple,
      years: round(years, 1),
      months: Math.round(years * 12),
      shortfallMan: round(Math.max(0, target - currentMan), 1),
      alreadyReached: currentMan >= target
    };
  }

  /**
   * 月々の支出を減らすと必要資産がいくら下がるかを求める。
   * @param {number} monthlyCutMan 月あたりの支出削減額(万円、0より大きく1000以下)
   * @param {number} withdrawalRatePct 取り崩し率(%)
   * @returns {{ok:true, annualCutMan:number, reducedMan:number}
   *          |{ok:false, code:"invalid_cut"|"invalid_rate"}}
   *   reducedMan: 必要資産の減少額(万円、小数第1位で四捨五入)
   */
  function impactOfMonthlyCut(monthlyCutMan, withdrawalRatePct) {
    if (!isFiniteNumber(monthlyCutMan) || monthlyCutMan <= 0 || monthlyCutMan > 1000) {
      return { ok: false, code: "invalid_cut" };
    }
    if (!isFiniteNumber(withdrawalRatePct) || withdrawalRatePct < RATE_MIN || withdrawalRatePct > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    var annual = monthlyCutMan * 12;
    return {
      ok: true,
      annualCutMan: round(annual, 2),
      reducedMan: round(annual / (withdrawalRatePct / 100), 1)
    };
  }

  var api = {
    required: required,
    simulate: simulate,
    impactOfMonthlyCut: impactOfMonthlyCut
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.FireCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
