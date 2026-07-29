/*
 * 相続税 概算計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.4152「相続税の計算」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4152.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.4155「相続税の税率」(相続税の速算表)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4155.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.4132「相続人の範囲と法定相続分」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4132.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.4158「配偶者の税額の軽減」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4158.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 *
 * 前提:
 * - 基礎控除額 = 3,000万円 + 600万円 × 法定相続人の数(平成27年1月1日以後の相続)
 * - 遺産は法定相続分どおりに分けたものとして計算する概算。実際の分割割合・特例は反映しない
 * - 小規模宅地等の特例、生命保険金/退職金の非課税枠、債務控除、生前贈与加算、
 *   相続時精算課税、未成年者控除・障害者控除・2割加算などは含まない
 * - 法定相続分に応ずる取得金額は1,000円未満を切り捨て(申告書の記載単位に合わせる)
 * - 各人の算出税額および相続税の総額は1円未満を切り捨て
 * - 配偶者の税額軽減は「配偶者が法定相続分どおりに取得した」前提のため、配偶者の税額は全額が軽減される
 */
(function (global) {
  "use strict";

  var MAN = 10000; // 1万円 = 10000円

  // 相続税の速算表(国税庁 No.4155)。[法定相続分に応ずる取得金額の上限(円), 税率, 控除額(円)]
  // 最終行の上限は Infinity(6億円超)
  var RATE_TABLE = [
    [10000000, 0.10, 0],
    [30000000, 0.15, 500000],
    [50000000, 0.20, 2000000],
    [100000000, 0.30, 7000000],
    [200000000, 0.40, 17000000],
    [300000000, 0.45, 27000000],
    [600000000, 0.50, 42000000],
    [Infinity, 0.55, 72000000]
  ];

  var BASE_DEDUCTION = 30000000; // 3,000万円
  var PER_HEIR_DEDUCTION = 6000000; // 600万円

  var MAX_ESTATE_MAN = 10000000; // 遺産総額の上限: 1,000億円(万円単位)
  var MAX_COUNT = 20; // 子・親・兄弟姉妹それぞれの人数の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isCount(v) {
    return isFiniteNumber(v) && v >= 0 && v <= MAX_COUNT && Math.floor(v) === v;
  }

  /**
   * 速算表を適用して税額を求める。
   * @param {number} amountYen 法定相続分に応ずる取得金額(円)
   * @returns {number} 税額(円・1円未満切り捨て)
   */
  function applyRate(amountYen) {
    if (amountYen <= 0) return 0;
    for (var i = 0; i < RATE_TABLE.length; i++) {
      if (amountYen <= RATE_TABLE[i][0]) {
        return Math.floor(amountYen * RATE_TABLE[i][1] - RATE_TABLE[i][2]);
      }
    }
    return 0;
  }

  /**
   * 法定相続人の構成と法定相続分を求める(国税庁 No.4132)。
   * 第1順位=子、第2順位=直系尊属(親)、第3順位=兄弟姉妹。上位の順位がいれば下位は相続人にならない。
   * @param {boolean} hasSpouse 配偶者がいるか
   * @param {number} children 子の人数(0以上の整数)
   * @param {number} parents 直系尊属(親)の人数(0以上の整数)
   * @param {number} siblings 兄弟姉妹の人数(0以上の整数)
   * @returns {{ok:true, heirCount:number, groupType:"children"|"parents"|"siblings"|"spouse_only",
   *            groupCount:number, spouseShare:number, groupShareEach:number}
   *          |{ok:false, code:"invalid_spouse"|"invalid_children"|"invalid_parents"|"invalid_siblings"|"no_heir"}}
   *   spouseShare は配偶者1人の法定相続分、groupShareEach は子等1人あたりの法定相続分(いずれも小数)
   */
  function heirs(hasSpouse, children, parents, siblings) {
    if (typeof hasSpouse !== "boolean") return { ok: false, code: "invalid_spouse" };
    if (!isCount(children)) return { ok: false, code: "invalid_children" };
    if (!isCount(parents)) return { ok: false, code: "invalid_parents" };
    if (!isCount(siblings)) return { ok: false, code: "invalid_siblings" };

    var groupType, groupCount, spouseShare, groupTotalShare;
    if (children > 0) {
      groupType = "children";
      groupCount = children;
      spouseShare = hasSpouse ? 1 / 2 : 0;
      groupTotalShare = hasSpouse ? 1 / 2 : 1;
    } else if (parents > 0) {
      groupType = "parents";
      groupCount = parents;
      spouseShare = hasSpouse ? 2 / 3 : 0;
      groupTotalShare = hasSpouse ? 1 / 3 : 1;
    } else if (siblings > 0) {
      groupType = "siblings";
      groupCount = siblings;
      spouseShare = hasSpouse ? 3 / 4 : 0;
      groupTotalShare = hasSpouse ? 1 / 4 : 1;
    } else if (hasSpouse) {
      groupType = "spouse_only";
      groupCount = 0;
      spouseShare = 1;
      groupTotalShare = 0;
    } else {
      return { ok: false, code: "no_heir" };
    }

    return {
      ok: true,
      heirCount: (hasSpouse ? 1 : 0) + groupCount,
      groupType: groupType,
      groupCount: groupCount,
      spouseShare: spouseShare,
      groupShareEach: groupCount > 0 ? groupTotalShare / groupCount : 0
    };
  }

  /**
   * 相続税の総額と一人あたりの負担額を概算する。
   * @param {number} estateMan 遺産総額(万円。債務・葬式費用を差し引いた正味の遺産額)
   * @param {boolean} hasSpouse 配偶者がいるか
   * @param {number} children 子の人数(0以上の整数)
   * @param {number} parents 直系尊属(親)の人数(0以上の整数)
   * @param {number} siblings 兄弟姉妹の人数(0以上の整数)
   * @returns {{ok:true, heirCount:number, groupType:string, groupCount:number,
   *            basicDeductionYen:number, taxableEstateYen:number, totalTaxYen:number,
   *            spouseTaxYen:number, spouseReliefYen:number, eachGroupTaxYen:number,
   *            netTotalTaxYen:number, taxable:boolean}
   *          |{ok:false, code:"invalid_estate"|"invalid_spouse"|"invalid_children"|"invalid_parents"|"invalid_siblings"|"no_heir"}}
   *   totalTaxYen は相続税の総額(配偶者の税額軽減を適用する前)。
   *   spouseTaxYen は配偶者が法定相続分どおりに取得した場合の税額で、同額が spouseReliefYen として軽減される。
   *   netTotalTaxYen は配偶者の税額軽減を適用した後に実際に納める税額の合計。
   *   eachGroupTaxYen は子(または親・兄弟姉妹)1人あたりの税額。
   */
  function calculate(estateMan, hasSpouse, children, parents, siblings) {
    if (!isFiniteNumber(estateMan) || estateMan < 0 || estateMan > MAX_ESTATE_MAN) {
      return { ok: false, code: "invalid_estate" };
    }
    var h = heirs(hasSpouse, children, parents, siblings);
    if (!h.ok) return h;

    var estateYen = Math.round(estateMan * MAN);
    var basicDeductionYen = BASE_DEDUCTION + PER_HEIR_DEDUCTION * h.heirCount;
    var taxableEstateYen = Math.max(0, estateYen - basicDeductionYen);

    // 法定相続分で按分し、1,000円未満を切り捨てて速算表を適用する
    var spouseAmount = Math.floor((taxableEstateYen * h.spouseShare) / 1000) * 1000;
    var groupAmount = Math.floor((taxableEstateYen * h.groupShareEach) / 1000) * 1000;
    var spouseTaxBase = applyRate(spouseAmount);
    var groupTaxBase = applyRate(groupAmount);
    var totalTaxYen = spouseTaxBase + groupTaxBase * h.groupCount;

    // 配偶者が法定相続分どおりに取得した場合、その税額は全額が軽減される(No.4158)
    var spouseTaxYen = h.spouseShare > 0 ? spouseTaxBase : 0;
    var spouseReliefYen = spouseTaxYen;

    return {
      ok: true,
      heirCount: h.heirCount,
      groupType: h.groupType,
      groupCount: h.groupCount,
      basicDeductionYen: basicDeductionYen,
      taxableEstateYen: taxableEstateYen,
      totalTaxYen: totalTaxYen,
      spouseTaxYen: spouseTaxYen,
      spouseReliefYen: spouseReliefYen,
      eachGroupTaxYen: groupTaxBase,
      netTotalTaxYen: totalTaxYen - spouseReliefYen,
      taxable: taxableEstateYen > 0
    };
  }

  /**
   * 相続税がかからない遺産総額の上限(基礎控除額)を求める。
   * @param {boolean} hasSpouse 配偶者がいるか
   * @param {number} children 子の人数(0以上の整数)
   * @param {number} parents 直系尊属(親)の人数(0以上の整数)
   * @param {number} siblings 兄弟姉妹の人数(0以上の整数)
   * @returns {{ok:true, heirCount:number, basicDeductionYen:number, basicDeductionMan:number}
   *          |{ok:false, code:string}}
   */
  function basicDeduction(hasSpouse, children, parents, siblings) {
    var h = heirs(hasSpouse, children, parents, siblings);
    if (!h.ok) return h;
    var yen = BASE_DEDUCTION + PER_HEIR_DEDUCTION * h.heirCount;
    return {
      ok: true,
      heirCount: h.heirCount,
      basicDeductionYen: yen,
      basicDeductionMan: yen / MAN
    };
  }

  var api = {
    heirs: heirs,
    applyRate: applyRate,
    basicDeduction: basicDeduction,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SouzokuzeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
