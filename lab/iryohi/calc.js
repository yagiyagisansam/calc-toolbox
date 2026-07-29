/*
 * 医療費控除額と還付額の目安を計算するロジック
 *
 * 制度の時点: 令和7年4月1日現在の法令等(国税庁タックスアンサーの適用時点)。
 *            2026年7月時点でこの取扱いに変更はない。
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.1120「医療費を支払ったとき(医療費控除)」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm (2026年7月29日参照)
 *   ・控除額 = (実際に支払った医療費の合計額 - 保険金などで補填される金額) - 10万円
 *   ・その年の総所得金額等が200万円未満の人は、10万円ではなく総所得金額等の5パーセントの金額
 *   ・控除額の上限は200万円
 *   ・保険金などで補填される金額は、その給付の目的となった医療費の金額を限度として差し引く
 *     (引ききれない金額が生じても、ほかの医療費からは差し引かない)
 * - 国税庁 タックスアンサー No.2260「所得税の税率」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm (2026年7月29日参照)
 *   ・所得税の速算表(5%〜45%の7段階)
 *   ・平成25年から令和19年までの各年分は、所得税と併せて復興特別所得税
 *     (原則としてその年分の基準所得税額の2.1パーセント)を申告・納付する
 * - 総務省「個人住民税」(所得割の標準税率10%)
 *   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_06.html (2026年7月29日参照)
 *
 * 前提:
 * - 還付額は「医療費控除によって課税所得が減った分 × 税率」で求める概算。
 *   実際の還付額は、その人の課税所得・ほかの控除・源泉徴収税額によって変わる。
 * - 所得税率は、医療費控除を引いた後の課税所得に適用される税率を使う。
 *   控除によって税率の段階(ブラケット)をまたぐ場合、この概算より還付は小さくなる。
 * - 住民税は所得割の標準税率10%で計算する(実際は翌年度の住民税が減る形になる)。
 * - セルフメディケーション税制(No.1129)との選択適用は考慮しない(併用はできない)。
 * - 金額はすべて1円未満切り捨てで扱う。
 */
(function (global) {
  "use strict";

  var THRESHOLD_FIXED = 100000;      // 原則の足切り額 10万円
  var INCOME_BORDER = 2000000;       // 総所得金額等がこの額未満なら5%を使う
  var THRESHOLD_RATIO = 0.05;        // 総所得金額等の5パーセント
  var DEDUCTION_CAP = 2000000;       // 医療費控除額の上限 200万円
  var RECONSTRUCTION_RATE = 0.021;   // 復興特別所得税 基準所得税額の2.1パーセント
  var RESIDENT_RATE = 0.10;          // 個人住民税 所得割の標準税率 10パーセント

  var MONEY_MAX = 100000000;         // 医療費・補填額の入力上限(常識的な範囲チェック)
  var INCOME_MAX = 1000000000;       // 総所得金額等の入力上限
  var RATE_MAX = 45;                 // 所得税率の上限(速算表の最高税率)

  /* 所得税の速算表: [課税所得の上限(この額未満), 税率(%), 控除額(円)]。最後の行が最高税率 */
  var TAX_BRACKETS = [
    [1950000, 5, 0],
    [3300000, 10, 97500],
    [6950000, 20, 427500],
    [9000000, 23, 636000],
    [18000000, 33, 1536000],
    [40000000, 40, 2796000],
    [Infinity, 45, 4796000]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 足切り額(10万円か総所得金額等の5%か)を求める
   * @param {number} totalIncome 総所得金額等(円)
   * @returns {{ok:true, threshold:number, usesRatio:boolean}|{ok:false, code:"invalid_income"}}
   *   threshold は1円未満切り捨て。usesRatio は5%の方が使われたかどうか
   */
  function threshold(totalIncome) {
    if (!isFiniteNumber(totalIncome) || totalIncome < 0 || totalIncome > INCOME_MAX) {
      return { ok: false, code: "invalid_income" };
    }
    if (totalIncome < INCOME_BORDER) {
      return { ok: true, threshold: Math.floor(totalIncome * THRESHOLD_RATIO), usesRatio: true };
    }
    return { ok: true, threshold: THRESHOLD_FIXED, usesRatio: false };
  }

  /**
   * 医療費控除額を計算する
   * @param {number} medical 1年間に実際に支払った医療費の合計額(円)
   * @param {number} compensated 保険金などで補填された金額(円)
   * @param {number} totalIncome 総所得金額等(円)
   * @returns {{ok:true, netMedical:number, threshold:number, usesRatio:boolean, deduction:number, capped:boolean}
   *          |{ok:false, code:"invalid_medical"|"invalid_compensated"|"invalid_income"}}
   *   netMedical は補填後の医療費(0未満にはしない)、deduction は控除額(0〜200万円、1円未満切り捨て)
   */
  function deduction(medical, compensated, totalIncome) {
    if (!isFiniteNumber(medical) || medical < 0 || medical > MONEY_MAX) {
      return { ok: false, code: "invalid_medical" };
    }
    if (!isFiniteNumber(compensated) || compensated < 0 || compensated > MONEY_MAX) {
      return { ok: false, code: "invalid_compensated" };
    }
    var th = threshold(totalIncome);
    if (!th.ok) return th;

    var net = Math.max(0, Math.floor(medical - compensated));
    var raw = Math.max(0, net - th.threshold);
    var capped = raw > DEDUCTION_CAP;
    return {
      ok: true,
      netMedical: net,
      threshold: th.threshold,
      usesRatio: th.usesRatio,
      deduction: capped ? DEDUCTION_CAP : raw,
      capped: capped
    };
  }

  /**
   * 医療費控除で戻る(減る)税額の目安を計算する
   * @param {number} medical 1年間に実際に支払った医療費の合計額(円)
   * @param {number} compensated 保険金などで補填された金額(円)
   * @param {number} totalIncome 総所得金額等(円)
   * @param {number} taxRate 適用される所得税率(パーセント。5・10・20・23・33・40・45 のいずれか)
   * @returns {{ok:true, deduction:number, threshold:number, capped:boolean,
   *            incomeTax:number, reconstructionTax:number, residentTax:number, total:number}
   *          |{ok:false, code:"invalid_medical"|"invalid_compensated"|"invalid_income"|"invalid_rate"}}
   *   incomeTax は還付される所得税、reconstructionTax は同時に減る復興特別所得税(所得税×2.1%)、
   *   residentTax は翌年度に減る住民税(控除額×10%)。いずれも1円未満切り捨て
   */
  function refund(medical, compensated, totalIncome, taxRate) {
    var d = deduction(medical, compensated, totalIncome);
    if (!d.ok) return d;
    if (!isFiniteNumber(taxRate) || taxRate < 0 || taxRate > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    var incomeTax = Math.floor(d.deduction * (taxRate / 100));
    var reconstructionTax = Math.floor(incomeTax * RECONSTRUCTION_RATE);
    var residentTax = Math.floor(d.deduction * RESIDENT_RATE);
    return {
      ok: true,
      deduction: d.deduction,
      threshold: d.threshold,
      capped: d.capped,
      incomeTax: incomeTax,
      reconstructionTax: reconstructionTax,
      residentTax: residentTax,
      total: incomeTax + reconstructionTax + residentTax
    };
  }

  /**
   * 課税される所得金額から所得税の税率と速算表の控除額を引く
   * @param {number} taxable 課税される所得金額(円)。各種所得控除を引いた後の金額
   * @returns {{ok:true, rate:number, quickDeduction:number}|{ok:false, code:"invalid_taxable"}}
   *   rate はパーセント表記(5〜45)
   */
  function taxRateFromTaxable(taxable) {
    if (!isFiniteNumber(taxable) || taxable < 0 || taxable > INCOME_MAX) {
      return { ok: false, code: "invalid_taxable" };
    }
    for (var i = 0; i < TAX_BRACKETS.length; i++) {
      if (taxable < TAX_BRACKETS[i][0]) {
        return { ok: true, rate: TAX_BRACKETS[i][1], quickDeduction: TAX_BRACKETS[i][2] };
      }
    }
    return { ok: true, rate: 45, quickDeduction: 4796000 };
  }

  var api = {
    threshold: threshold,
    deduction: deduction,
    refund: refund,
    taxRateFromTaxable: taxRateFromTaxable,
    DEDUCTION_CAP: DEDUCTION_CAP,
    TAX_BRACKETS: TAX_BRACKETS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.IryohiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
