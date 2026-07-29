/*
 * 贈与税(暦年課税) の計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.4408「贈与税の計算と税率(暦年課税)」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/zoyo/4408.htm (2026年7月29日参照)
 *   ページ表記の基準時点: 令和7年4月1日現在法令等
 *   ・基礎控除額 110万円
 *   ・一般贈与財産用(一般税率)の速算表 / 特例贈与財産用(特例税率)の速算表
 *   ・特例税率は「直系尊属(父母・祖父母など)から、贈与を受けた年の1月1日時点で18歳以上の者への贈与」に適用
 *     (令和4年3月31日以前の贈与は20歳以上)
 * - 国税通則法第119条第1項(国税の確定金額は100円未満切捨て)
 *   https://laws.e-gov.go.jp/law/337AC0000000066 (2026年7月29日参照)
 *
 * 前提:
 * - 1年間(1月1日〜12月31日)に「1人がもらった財産の合計額」に対する暦年課税の贈与税のみを計算する
 * - 相続時精算課税、住宅取得等資金・教育資金・結婚子育て資金の各非課税特例、配偶者控除(おしどり贈与)は含まない
 * - 一般贈与財産と特例贈与財産が同じ年に混在する場合の按分計算は扱わない(どちらか一方の前提で計算する)
 * - 金額の丸め: 税額は1円未満を切り捨てたうえで、さらに100円未満を切り捨てる(国税通則法第119条第1項)
 */
(function (global) {
  "use strict";

  var BASIC_DEDUCTION = 1100000; // 基礎控除 110万円
  var AMOUNT_MAX = 1e12; // 入力上限 1兆円(桁あふれ防止)

  // [基礎控除後の課税価格の上限(円), 税率, 控除額(円)] / 上限 Infinity は最上位区分
  var GENERAL_TABLE = [
    [2000000, 0.10, 0],
    [3000000, 0.15, 100000],
    [4000000, 0.20, 250000],
    [6000000, 0.30, 650000],
    [10000000, 0.40, 1250000],
    [15000000, 0.45, 1750000],
    [30000000, 0.50, 2500000],
    [Infinity, 0.55, 4000000]
  ];

  var SPECIAL_TABLE = [
    [2000000, 0.10, 0],
    [4000000, 0.15, 100000],
    [6000000, 0.20, 300000],
    [10000000, 0.30, 900000],
    [15000000, 0.40, 1900000],
    [30000000, 0.45, 2650000],
    [45000000, 0.50, 4150000],
    [Infinity, 0.55, 6400000]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 100円未満切捨て(国税通則法第119条第1項) */
  function floorTo100(yen) {
    return Math.floor(yen / 100) * 100;
  }

  function pickRow(table, taxableYen) {
    for (var i = 0; i < table.length; i++) {
      if (taxableYen <= table[i][0]) return table[i];
    }
    return table[table.length - 1];
  }

  /**
   * 1年間の贈与額から、暦年課税の課税価格(基礎控除後)を求める。
   * @param {number} amountYen 1年間にもらった財産の合計額(円)。0〜1兆円
   * @returns {{ok:true, taxableYen:number}|{ok:false, code:"invalid_amount"}}
   */
  function taxableAmount(amountYen) {
    if (!isFiniteNumber(amountYen) || amountYen < 0 || amountYen > AMOUNT_MAX) {
      return { ok: false, code: "invalid_amount" };
    }
    return { ok: true, taxableYen: Math.max(0, amountYen - BASIC_DEDUCTION) };
  }

  /**
   * 指定した税率表(一般/特例)で贈与税額を計算する。
   * @param {number} amountYen 1年間にもらった財産の合計額(円)
   * @param {"general"|"special"} rateType "general"=一般税率 / "special"=特例税率
   * @returns {{ok:true, taxableYen:number, rate:number, deductionYen:number,
   *            taxYen:number, netYen:number, effectiveRate:number}
   *          |{ok:false, code:"invalid_amount"|"invalid_rate_type"}}
   *   rate は小数(0.10 = 10%)。taxYen は100円未満切捨て後の金額。
   *   netYen は贈与額から税額を引いた手残り。effectiveRate は贈与額に対する税負担率(%、小数第2位で四捨五入)。
   */
  function calculate(amountYen, rateType) {
    if (rateType !== "general" && rateType !== "special") {
      return { ok: false, code: "invalid_rate_type" };
    }
    var t = taxableAmount(amountYen);
    if (!t.ok) return t;
    var table = rateType === "special" ? SPECIAL_TABLE : GENERAL_TABLE;
    var row = pickRow(table, t.taxableYen);
    var raw = t.taxableYen === 0 ? 0 : t.taxableYen * row[1] - row[2];
    var taxYen = floorTo100(Math.max(0, raw));
    return {
      ok: true,
      taxableYen: t.taxableYen,
      rate: row[1],
      deductionYen: row[2],
      taxYen: taxYen,
      netYen: amountYen - taxYen,
      effectiveRate: amountYen > 0 ? Math.round((taxYen / amountYen) * 10000) / 100 : 0
    };
  }

  /**
   * 一般税率と特例税率の両方を同時に計算する。
   * @param {number} amountYen 1年間にもらった財産の合計額(円)
   * @returns {{ok:true, taxableYen:number, general:object, special:object}
   *          |{ok:false, code:"invalid_amount"}}
   */
  function both(amountYen) {
    var g = calculate(amountYen, "general");
    if (!g.ok) return g;
    var s = calculate(amountYen, "special");
    return { ok: true, taxableYen: g.taxableYen, general: g, special: s };
  }

  /**
   * 特例税率(特例贈与財産)の適用可否を判定する。
   * @param {boolean} isLinealAscendant 贈与者が受贈者の直系尊属(父母・祖父母など)か
   * @param {number} ageOnJan1 贈与を受けた年の1月1日時点の受贈者の年齢(歳)。0〜130
   * @returns {{ok:true, rateType:"general"|"special", isSpecial:boolean}
   *          |{ok:false, code:"invalid_age"}}
   */
  function rateTypeOf(isLinealAscendant, ageOnJan1) {
    if (!isFiniteNumber(ageOnJan1) || ageOnJan1 < 0 || ageOnJan1 > 130) {
      return { ok: false, code: "invalid_age" };
    }
    var isSpecial = isLinealAscendant === true && ageOnJan1 >= 18;
    return { ok: true, rateType: isSpecial ? "special" : "general", isSpecial: isSpecial };
  }

  /**
   * 基礎控除110万円の範囲で贈与し続けた場合に、目標額を渡し終えるまでの年数を求める。
   * @param {number} totalYen 渡したい合計額(円)。0〜1兆円
   * @param {number} [perYearYen=1100000] 1年あたりの贈与額(円)。1〜1兆円
   * @returns {{ok:true, years:number, perYearYen:number, lastYearYen:number}
   *          |{ok:false, code:"invalid_amount"|"invalid_per_year"}}
   *   years は切り上げた年数。lastYearYen は最終年に渡す端数(円)。
   */
  function yearsToGive(totalYen, perYearYen) {
    var per = perYearYen === undefined ? BASIC_DEDUCTION : perYearYen;
    if (!isFiniteNumber(totalYen) || totalYen <= 0 || totalYen > AMOUNT_MAX) {
      return { ok: false, code: "invalid_amount" };
    }
    if (!isFiniteNumber(per) || per <= 0 || per > AMOUNT_MAX) {
      return { ok: false, code: "invalid_per_year" };
    }
    var years = Math.ceil(totalYen / per);
    var rest = totalYen - (years - 1) * per;
    return { ok: true, years: years, perYearYen: per, lastYearYen: Math.round(rest) };
  }

  var api = {
    BASIC_DEDUCTION: BASIC_DEDUCTION,
    taxableAmount: taxableAmount,
    calculate: calculate,
    both: both,
    rateTypeOf: rateTypeOf,
    yearsToGive: yearsToGive
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ZoyozeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
