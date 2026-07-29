/*
 * 減価償却費(定額法・定率法)の計算ロジック
 *
 * 制度の時点: 2026年7月時点。定額法は平成19年4月1日以後に取得した資産、
 *            定率法は平成24年4月1日以後に取得した資産(200%定率法)の償却率を使う。
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.2106「定額法と定率法による減価償却」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm (2026年7月29日参照)
 *   ・定額法: 各年の償却費の額 = 取得価額 × 定額法の償却率
 *   ・定率法(1年目): 取得価額 × 定率法の償却率
 *   ・定率法(2年目以降、調整前償却額 >= 償却保証額): 期首未償却残高 × 定率法の償却率
 *   ・定率法(調整前償却額 < 償却保証額になった年以後): 改定取得価額 × 改定償却率
 *   ・償却保証額 = 取得価額 × 保証率、改定取得価額 = その年の期首未償却残高
 *   ・年の中途で業務の用に供した場合は、12で除しその年に業務に使用していた月数を乗じる
 *   ・有形減価償却資産は取得価額から1円(備忘価額)を控除した金額まで償却できる
 * - 国税庁 タックスアンサー No.2100「減価償却のあらまし」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm (2026年7月29日参照)
 * - 減価償却資産の耐用年数等に関する省令(昭和40年大蔵省令第15号) 別表第八・別表第十(e-Gov法令検索)
 *   https://laws.e-gov.go.jp/law/340M50000040015 (2026年7月29日参照)
 *   ・別表第八: 平成19年4月1日以後に取得をされた減価償却資産の定額法の償却率表
 *   ・別表第十: 平成24年4月1日以後に取得をされた減価償却資産の定率法の償却率、改定償却率及び保証率の表
 *
 * 前提:
 * - 個人事業主(会計期間が1月1日〜12月31日)を想定する。法人は事業年度が異なるため月数の数え方が変わる。
 * - 事業専用(家事使用との按分なし)、residual は備忘価額1円まで償却する前提。
 * - 平成19年3月31日以前に取得した資産(旧定額法・旧定率法)、平成19年4月1日〜平成24年3月31日に
 *   取得した資産(250%定率法)には対応しない。
 * - 各年の償却費は1円未満切り捨てとする。返り値の guaranteeAmount(償却保証額)は
 *   表示用に1円未満を四捨五入した値で、償却保証額との大小判定自体は端数処理前の値で行う。
 * - 定率法で年の中途に使い始めた年は、まず年額の調整前償却額(期首未償却残高×償却率)を
 *   償却保証額と比べ、そのうえで償却限度額に月数按分を掛ける。
 * - 取得価額10万円未満のもの、使用可能期間1年未満のものは全額をその年の必要経費にできる
 *   (減価償却の対象外)。このツールは減価償却する場合の計算だけを行う。
 */
(function (global) {
  "use strict";

  var LIFE_MIN = 2;
  var LIFE_MAX = 100;
  var COST_MAX = 100000000000; // 取得価額の入力上限(常識的な範囲チェック)
  var MEMO_VALUE = 1;          // 備忘価額 1円

  var SL_RATE = [
    0.5, 0.334, 0.25, 0.2, 0.167, 0.143, 0.125, 0.112, 0.1, 0.091, 0.084, 0.077, 0.072,
    0.067, 0.063, 0.059, 0.056, 0.053, 0.05, 0.048, 0.046, 0.044, 0.042, 0.04, 0.039, 0.038,
    0.036, 0.035, 0.034, 0.033, 0.032, 0.031, 0.03, 0.029, 0.028, 0.028, 0.027, 0.026, 0.025,
    0.025, 0.024, 0.024, 0.023, 0.023, 0.022, 0.022, 0.021, 0.021, 0.02, 0.02, 0.02, 0.019,
    0.019, 0.019, 0.018, 0.018, 0.018, 0.017, 0.017, 0.017, 0.017, 0.016, 0.016, 0.016, 0.016,
    0.015, 0.015, 0.015, 0.015, 0.015, 0.014, 0.014, 0.014, 0.014, 0.014, 0.013, 0.013, 0.013,
    0.013, 0.013, 0.013, 0.013, 0.012, 0.012, 0.012, 0.012, 0.012, 0.012, 0.012, 0.011, 0.011,
    0.011, 0.011, 0.011, 0.011, 0.011, 0.011, 0.011, 0.01
  ];
  var DB_RATE = [
    1, 0.667, 0.5, 0.4, 0.333, 0.286, 0.25, 0.222, 0.2, 0.182, 0.167, 0.154, 0.143,
    0.133, 0.125, 0.118, 0.111, 0.105, 0.1, 0.095, 0.091, 0.087, 0.083, 0.08, 0.077, 0.074,
    0.071, 0.069, 0.067, 0.065, 0.063, 0.061, 0.059, 0.057, 0.056, 0.054, 0.053, 0.051, 0.05,
    0.049, 0.048, 0.047, 0.045, 0.044, 0.043, 0.043, 0.042, 0.041, 0.04, 0.039, 0.038, 0.038,
    0.037, 0.036, 0.036, 0.035, 0.034, 0.034, 0.033, 0.033, 0.032, 0.032, 0.031, 0.031, 0.03,
    0.03, 0.029, 0.029, 0.029, 0.028, 0.028, 0.027, 0.027, 0.027, 0.026, 0.026, 0.026, 0.025,
    0.025, 0.025, 0.024, 0.024, 0.024, 0.024, 0.023, 0.023, 0.023, 0.022, 0.022, 0.022, 0.022,
    0.022, 0.021, 0.021, 0.021, 0.021, 0.02, 0.02, 0.02
  ];
  var DB_REVISED = [
    null, 1, 1, 0.5, 0.334, 0.334, 0.334, 0.25, 0.25, 0.2, 0.2, 0.167, 0.167,
    0.143, 0.143, 0.125, 0.112, 0.112, 0.112, 0.1, 0.1, 0.091, 0.084, 0.084, 0.084, 0.077,
    0.072, 0.072, 0.072, 0.067, 0.067, 0.063, 0.063, 0.059, 0.059, 0.056, 0.056, 0.053, 0.053,
    0.05, 0.05, 0.048, 0.046, 0.046, 0.044, 0.044, 0.044, 0.042, 0.042, 0.04, 0.039, 0.039,
    0.038, 0.038, 0.038, 0.036, 0.035, 0.035, 0.034, 0.034, 0.033, 0.033, 0.032, 0.032, 0.031,
    0.031, 0.03, 0.03, 0.03, 0.029, 0.029, 0.027, 0.027, 0.027, 0.027, 0.027, 0.027, 0.026,
    0.026, 0.026, 0.024, 0.024, 0.024, 0.024, 0.023, 0.023, 0.023, 0.022, 0.022, 0.022, 0.022,
    0.022, 0.021, 0.021, 0.021, 0.021, 0.02, 0.02, 0.02
  ];
  var DB_GUARANTEE = [
    null, 0.11089, 0.12499, 0.108, 0.09911, 0.0868, 0.07909, 0.07126, 0.06552, 0.05992,
    0.05566, 0.0518, 0.04854, 0.04565, 0.04294, 0.04038, 0.03884, 0.03693, 0.03486, 0.03335,
    0.03182, 0.03052, 0.02969, 0.02841, 0.02716, 0.02624, 0.02568, 0.02463, 0.02366, 0.02286,
    0.02216, 0.02161, 0.02097, 0.02051, 0.01974, 0.0195, 0.01882, 0.0186, 0.01791, 0.01741,
    0.01694, 0.01664, 0.01664, 0.01634, 0.01601, 0.01532, 0.01499, 0.01475, 0.0144, 0.01422,
    0.01422, 0.0137, 0.0137, 0.01337, 0.01288, 0.01281, 0.01281, 0.0124, 0.0124, 0.01201,
    0.01201, 0.01165, 0.01165, 0.0113, 0.0113, 0.01097, 0.01097, 0.01065, 0.01034, 0.01034,
    0.01006, 0.01063, 0.01035, 0.01007, 0.0098, 0.00954, 0.00929, 0.00929, 0.00907, 0.00884,
    0.00929, 0.00907, 0.00885, 0.00864, 0.00885, 0.00864, 0.00844, 0.00863, 0.00844, 0.00825,
    0.00807, 0.0079, 0.00807, 0.0079, 0.00773, 0.00757, 0.00773, 0.00757, 0.00742
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function isInt(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }

  /**
   * 耐用年数から償却率を引く
   * @param {number} life 法定耐用年数(年。2〜100の整数)
   * @param {string} method 償却方法。"straight"=定額法 / "declining"=定率法(200%定率法)
   * @returns {{ok:true, rate:number, revisedRate:(number|null), guaranteeRate:(number|null)}
   *          |{ok:false, code:"invalid_life"|"invalid_method"}}
   *   rate は償却率、revisedRate は改定償却率、guaranteeRate は保証率(定額法では null)
   */
  function rateOf(life, method) {
    if (!isInt(life) || life < LIFE_MIN || life > LIFE_MAX) {
      return { ok: false, code: "invalid_life" };
    }
    var i = life - LIFE_MIN;
    if (method === "straight") {
      return { ok: true, rate: SL_RATE[i], revisedRate: null, guaranteeRate: null };
    }
    if (method === "declining") {
      return { ok: true, rate: DB_RATE[i], revisedRate: DB_REVISED[i], guaranteeRate: DB_GUARANTEE[i] };
    }
    return { ok: false, code: "invalid_method" };
  }

  /**
   * 各年の減価償却費と未償却残高の一覧を作る
   * @param {number} cost 取得価額(円。0より大きい値)
   * @param {number} life 法定耐用年数(年。2〜100の整数)
   * @param {string} method "straight"=定額法 / "declining"=定率法(200%定率法)
   * @param {number} startMonth 事業に使い始めた月(1〜12の整数)。初年度は (13-startMonth) か月分を按分する
   * @returns {{ok:true, method:string, rate:number, revisedRate:(number|null), guaranteeRate:(number|null),
   *            guaranteeAmount:(number|null), firstYearMonths:number,
   *            rows:Array<{year:number, months:number, depreciation:number, accumulated:number, remaining:number, switched:boolean}>,
   *            totalDepreciation:number}
   *          |{ok:false, code:"invalid_cost"|"invalid_life"|"invalid_method"|"invalid_month"}}
   *   rows は1年目から償却が終わる年まで。depreciation は1円未満切り捨て、
   *   remaining は年末の未償却残高で、最後の年に備忘価額1円が残る。
   *   switched は定率法で改定償却率による定額償却に切り替わった年に true。
   */
  function schedule(cost, life, method, startMonth) {
    if (!isFiniteNumber(cost) || cost <= 0 || cost > COST_MAX) {
      return { ok: false, code: "invalid_cost" };
    }
    var r = rateOf(life, method);
    if (!r.ok) return r;
    if (!isInt(startMonth) || startMonth < 1 || startMonth > 12) {
      return { ok: false, code: "invalid_month" };
    }

    var firstMonths = 13 - startMonth;
    var rows = [];
    var remaining = cost;
    var accumulated = 0;
    var guaranteeAmount = method === "declining" ? cost * r.guaranteeRate : null;
    var revisedBase = null; // 改定取得価額
    var year = 0;
    var limit = life + 2;

    while (remaining > MEMO_VALUE && year < limit) {
      year++;
      var months = year === 1 ? firstMonths : 12;
      var amount;
      var switched = false;

      if (method === "straight") {
        amount = cost * r.rate * (months / 12);
      } else if (revisedBase !== null) {
        amount = revisedBase * r.revisedRate * (months / 12);
      } else {
        var adjusted = remaining * r.rate; // 調整前償却額(年額)
        if (adjusted < guaranteeAmount) {
          revisedBase = remaining;         // 改定取得価額 = その年の期首未償却残高
          switched = true;
          amount = revisedBase * r.revisedRate * (months / 12);
        } else {
          amount = adjusted * (months / 12);
        }
      }

      amount = Math.floor(amount);
      if (amount > remaining - MEMO_VALUE) amount = remaining - MEMO_VALUE;
      if (amount < 0) amount = 0;

      remaining = remaining - amount;
      accumulated += amount;
      rows.push({
        year: year,
        months: months,
        depreciation: amount,
        accumulated: accumulated,
        remaining: remaining,
        switched: switched
      });
      if (amount === 0) break; // 進まなくなったら打ち切る(異常な入力への保険)
    }

    return {
      ok: true,
      method: method,
      rate: r.rate,
      revisedRate: r.revisedRate,
      guaranteeRate: r.guaranteeRate,
      guaranteeAmount: guaranteeAmount === null ? null : Math.round(guaranteeAmount),
      firstYearMonths: firstMonths,
      rows: rows,
      totalDepreciation: accumulated
    };
  }

  /**
   * 初年度の償却費だけを求める(確定申告で1年目の経費額だけ知りたいとき用)
   * @param {number} cost 取得価額(円)
   * @param {number} life 法定耐用年数(年)
   * @param {string} method "straight" / "declining"
   * @param {number} startMonth 事業に使い始めた月(1〜12)
   * @returns {{ok:true, months:number, depreciation:number, remaining:number}|{ok:false, code:string}}
   */
  function firstYear(cost, life, method, startMonth) {
    var s = schedule(cost, life, method, startMonth);
    if (!s.ok) return s;
    var row = s.rows[0];
    return { ok: true, months: row.months, depreciation: row.depreciation, remaining: row.remaining };
  }

  var api = {
    rateOf: rateOf,
    schedule: schedule,
    firstYear: firstYear,
    LIFE_MIN: LIFE_MIN,
    LIFE_MAX: LIFE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShokyakuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
