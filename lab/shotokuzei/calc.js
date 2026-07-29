/*
 * 所得税額 計算(速算表) の計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁「タックスアンサー No.2260 所得税の税率」(令和7年4月1日現在法令等)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm (2026年7月29日参照)
 *   所得税の速算表(7段階・5%〜45%)と控除額、および復興特別所得税(基準所得税額の2.1%)。
 *
 * 前提:
 * - 入力は「課税される所得金額」(各種所得控除を差し引いたあとの金額)。収入や年収ではない。
 * - 課税される所得金額は1,000円未満を切り捨てる(国税庁の速算表の前提)。
 * - 復興特別所得税は基準所得税額(=ここでは所得税額)の2.1%。平成25年〜令和19年分に適用。
 * - 「所得税及び復興特別所得税の額」は100円未満を切り捨てる。
 * - 税額控除(住宅ローン控除・配当控除など)、源泉徴収税額、予定納税は含まない。
 * - 分離課税(株式譲渡・退職所得など)は対象外。総合課税の超過累進税率のみ。
 */
(function (global) {
  "use strict";

  var MAX_INCOME = 1e12; // 1兆円。これを超える入力は誤入力とみなす

  /**
   * 所得税の速算表(令和7年4月1日現在法令等)
   * lower: この段階が始まる課税所得(円、その額を含む)
   * rate: 税率(小数)
   * deduction: 控除額(円)
   */
  var BRACKETS = [
    { lower: 0, rate: 0.05, deduction: 0 },
    { lower: 1950000, rate: 0.10, deduction: 97500 },
    { lower: 3300000, rate: 0.20, deduction: 427500 },
    { lower: 6950000, rate: 0.23, deduction: 636000 },
    { lower: 9000000, rate: 0.33, deduction: 1536000 },
    { lower: 18000000, rate: 0.40, deduction: 2796000 },
    { lower: 40000000, rate: 0.45, deduction: 4796000 }
  ];

  var RECONSTRUCTION_PERMILLE = 21; // 2.1% を 21/1000 として整数演算する

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 課税される所得金額を1,000円未満切り捨てにする
   * @param {number} taxableIncome 課税される所得金額(円)
   * @returns {number} 1,000円単位に切り捨てた課税所得(円)
   */
  function roundDownToThousand(taxableIncome) {
    return Math.floor(taxableIncome / 1000) * 1000;
  }

  /**
   * 課税所得が属する速算表の段階を返す
   * @param {number} taxableIncome 課税される所得金額(円、1,000円未満切り捨て済みでなくてよい)
   * @returns {{ok:true, rate:number, deduction:number, lower:number, upper:(number|null)}
   *          |{ok:false, code:"invalid_income"}}
   *   rate は小数(0.05 など)、upper はその段階の上限(円、最上位段階は null)
   */
  function bracket(taxableIncome) {
    if (!isFiniteNumber(taxableIncome) || taxableIncome < 0 || taxableIncome > MAX_INCOME) {
      return { ok: false, code: "invalid_income" };
    }
    var v = roundDownToThousand(taxableIncome);
    var i = 0;
    for (var k = 0; k < BRACKETS.length; k++) {
      if (v >= BRACKETS[k].lower) i = k;
    }
    return {
      ok: true,
      rate: BRACKETS[i].rate,
      deduction: BRACKETS[i].deduction,
      lower: BRACKETS[i].lower,
      upper: i + 1 < BRACKETS.length ? BRACKETS[i + 1].lower - 1000 : null
    };
  }

  /**
   * 課税される所得金額から所得税額・復興特別所得税額・合計税額を求める
   * @param {number} taxableIncome 課税される所得金額(円)。0以上 1兆円以下
   * @returns {{ok:true, taxableIncome:number, rate:number, deduction:number,
   *            incomeTax:number, reconstructionTax:number, totalTax:number,
   *            totalTaxRounded:number, effectiveRate:number}
   *          |{ok:false, code:"invalid_income"}}
   *   taxableIncome: 1,000円未満を切り捨てた課税所得(円)
   *   incomeTax: 所得税額(円、1円未満切り捨て)
   *   reconstructionTax: 復興特別所得税額(円、1円未満切り捨て)
   *   totalTax: 所得税+復興特別所得税(円)
   *   totalTaxRounded: 100円未満を切り捨てた納付税額(円)
   *   effectiveRate: 合計税額 ÷ 課税所得(%、小数第2位で四捨五入。課税所得0のときは0)
   */
  function calculate(taxableIncome) {
    var b = bracket(taxableIncome);
    if (!b.ok) return b;
    var v = roundDownToThousand(taxableIncome);
    var incomeTax = Math.floor(v * b.rate - b.deduction);
    if (incomeTax < 0) incomeTax = 0;
    var reconstructionTax = Math.floor((incomeTax * RECONSTRUCTION_PERMILLE) / 1000);
    var totalTax = incomeTax + reconstructionTax;
    var totalTaxRounded = Math.floor(totalTax / 100) * 100;
    var effectiveRate = v > 0 ? Math.round((totalTax / v) * 10000) / 100 : 0;
    return {
      ok: true,
      taxableIncome: v,
      rate: b.rate,
      deduction: b.deduction,
      incomeTax: incomeTax,
      reconstructionTax: reconstructionTax,
      totalTax: totalTax,
      totalTaxRounded: totalTaxRounded,
      effectiveRate: effectiveRate
    };
  }

  /**
   * あと1円多く稼いだときにかかる税率(限界税率)を返す
   * @param {number} taxableIncome 課税される所得金額(円)
   * @returns {{ok:true, marginalRate:number, marginalRateWithReconstruction:number,
   *            nextBracketAt:(number|null), toNextBracket:(number|null)}
   *          |{ok:false, code:"invalid_income"}}
   *   marginalRate: 所得税だけの限界税率(%)
   *   marginalRateWithReconstruction: 復興特別所得税込みの限界税率(%、小数第3位で四捨五入)
   *   nextBracketAt: 次の段階が始まる課税所得(円、最上位段階は null)
   *   toNextBracket: 次の段階まであといくらか(円、最上位段階は null)
   */
  function marginal(taxableIncome) {
    var b = bracket(taxableIncome);
    if (!b.ok) return b;
    var v = roundDownToThousand(taxableIncome);
    var nextAt = b.upper === null ? null : b.upper + 1000;
    return {
      ok: true,
      marginalRate: Math.round(b.rate * 10000) / 100,
      marginalRateWithReconstruction: Math.round(b.rate * 1.021 * 100000) / 1000,
      nextBracketAt: nextAt,
      toNextBracket: nextAt === null ? null : nextAt - v
    };
  }

  /**
   * 速算表そのものを返す(画面の表を組み立てるため)
   * @returns {{ok:true, rows:Array<{lower:number, upper:(number|null), rate:number, deduction:number}>}}
   *   rate は小数、upper は各段階の上限(円、最上位段階は null)
   */
  function table() {
    return {
      ok: true,
      rows: BRACKETS.map(function (b, i) {
        return {
          lower: b.lower,
          upper: i + 1 < BRACKETS.length ? BRACKETS[i + 1].lower - 1000 : null,
          rate: b.rate,
          deduction: b.deduction
        };
      })
    };
  }

  var api = {
    calculate: calculate,
    bracket: bracket,
    marginal: marginal,
    table: table
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShotokuzeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
