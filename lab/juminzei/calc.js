/*
 * 個人住民税(市町村民税+道府県民税)の概算ロジック
 *
 * 根拠(一次情報):
 * - 総務省「地方税制度|個人住民税」 https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_06.html (2026年7月29日参照)
 *   所得割の標準税率10%(道府県民税4%+市町村民税6%。政令指定都市は道府県2%+市8%)、
 *   均等割4,000円(道府県1,000円+市町村3,000円)、2024(令和6)年度から森林環境税(国税)1,000円を併せて徴収、
 *   基礎控除は最高43万円、扶養控除33万円、特定扶養控除45万円。
 * - 地方税法(昭和25年法律第226号) https://laws.e-gov.go.jp/law/325AC0000000226 (2026年7月29日参照)
 *   第35条・第314条の3(所得割の税率)、第38条・第310条(均等割の標準税率)、
 *   第314条の2(所得控除。基礎控除43万円/29万円/15万円、扶養控除33万円ほか)、
 *   第37条・第314条の6(調整控除)。
 * - 所得税法(昭和40年法律第33号)第28条第3項(給与所得控除額)
 *   https://laws.e-gov.go.jp/law/340AC0000000033 (2026年7月29日参照。2026年4月1日施行版)
 *
 * 制度・料率の時点:
 * - 税率・控除額はいずれも 2026(令和8)年7月29日時点の現行規定。
 * - 給与所得控除は令和7年度税制改正後(最低保障額65万円)の第28条第3項による。
 *   これは令和7年分以後の所得税、令和8年度分以後の個人住民税に対応する。
 * - 満額の均等割は 4,000円 + 森林環境税1,000円 = 5,000円を既定値とする(自治体により上乗せあり)。
 *
 * 前提:
 * - 収入は給与収入1か所のみ。所得控除は基礎控除・社会保険料控除・配偶者控除・扶養控除のみを見る。
 * - 生命保険料控除・医療費控除・住宅ローン控除・ふるさと納税などの税額控除は含まない。
 * - 所得税法第28条第4項の「別表第五」(収入660万円未満の給与所得の速算表)は使わず、
 *   第3項の算式で計算する。実際の税額と数百円ずれることがある。
 * - 非課税限度額(自治体の条例で定める)の判定は行わない。
 * - 指定都市かどうかで所得割の合計10%・調整控除の合計5%は変わらないため区別しない。
 */
(function (global) {
  "use strict";

  var BASIC_DEDUCTION = 430000;      // 基礎控除(合計所得2,400万円以下)
  var SPOUSE_DEDUCTION = 330000;     // 配偶者控除(一般)
  var DEPENDENT_DEDUCTION = 330000;  // 扶養控除(一般の控除対象扶養親族)
  var HUMAN_DIFF_UNIT = 50000;       // 人的控除額の差(基礎・配偶者・一般扶養とも5万円)
  var INCOME_RATE = 0.10;            // 所得割の標準税率(道府県4%+市町村6%)
  var ADJUST_RATE = 0.05;            // 調整控除の率(道府県2%+市町村3%)
  var ADJUST_THRESHOLD = 2000000;    // 調整控除の区分となる合計課税所得金額
  var DEFAULT_KINTOUWARI = 5000;     // 均等割4,000円+森林環境税1,000円

  var MAX_INCOME = 1000000000;       // 入力上限(10億円)
  var MAX_DEPENDENTS = 20;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function floorTo(value, unit) {
    return Math.floor(value / unit) * unit;
  }

  /**
   * 給与所得控除額を求める(所得税法第28条第3項)。
   * @param {number} incomeYen 給与等の収入金額(円。0以上)
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_income"}}
   *   value は円。端数処理はしない(法文どおりの算式値をそのまま返す)。
   */
  function kyuyoDeduction(incomeYen) {
    if (!isFiniteNumber(incomeYen) || incomeYen < 0 || incomeYen > MAX_INCOME) {
      return { ok: false, code: "invalid_income" };
    }
    var v;
    if (incomeYen <= 1900000) v = 650000;
    else if (incomeYen <= 3600000) v = 650000 + (incomeYen - 1900000) * 0.3;
    else if (incomeYen <= 6600000) v = 1160000 + (incomeYen - 3600000) * 0.2;
    else if (incomeYen <= 8500000) v = 1760000 + (incomeYen - 6600000) * 0.1;
    else v = 1950000;
    return { ok: true, value: v };
  }

  /**
   * 調整控除額を求める(地方税法第37条・第314条の6)。
   * @param {number} taxableIncomeYen 合計課税所得金額(円。0以上)
   * @param {number} humanDiffYen 人的控除額の差の合計(円。基礎控除分5万円を含む)
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_taxable"|"invalid_human_diff"}}
   *   value は円(端数処理なし)。合計課税所得が200万円超のときは
   *   「人的控除差の合計 −(合計課税所得 − 200万円)」が5万円を下回れば5万円として計算するため、
   *   最低額は 50,000 × 5% = 2,500円になる。
   */
  function adjustmentCredit(taxableIncomeYen, humanDiffYen) {
    if (!isFiniteNumber(taxableIncomeYen) || taxableIncomeYen < 0) {
      return { ok: false, code: "invalid_taxable" };
    }
    if (!isFiniteNumber(humanDiffYen) || humanDiffYen < 0) {
      return { ok: false, code: "invalid_human_diff" };
    }
    if (taxableIncomeYen <= 0) return { ok: true, value: 0 };
    var base;
    if (taxableIncomeYen <= ADJUST_THRESHOLD) {
      base = Math.min(humanDiffYen, taxableIncomeYen);
    } else {
      base = Math.max(humanDiffYen - (taxableIncomeYen - ADJUST_THRESHOLD), HUMAN_DIFF_UNIT);
    }
    return { ok: true, value: base * ADJUST_RATE };
  }

  /**
   * 給与収入から翌年度の個人住民税(所得割+均等割)を概算する。
   * @param {number} incomeYen 年収(給与等の収入金額。円。0以上10億円以下)
   * @param {number} socialInsuranceYen 1年間に支払った社会保険料の額(円。0以上)
   * @param {number} [spouseCount=0] 配偶者控除の対象となる配偶者の人数(0または1)
   * @param {number} [dependentCount=0] 一般の控除対象扶養親族の人数(0〜20)
   * @param {number} [kintouwariYen=5000] 均等割の年額(円。森林環境税1,000円を含む。0以上10万円以下)
   * @returns {{ok:true, salaryDeductionYen:number, salaryIncomeYen:number,
   *            totalDeductionYen:number, taxableIncomeYen:number,
   *            incomeTaxBeforeCreditYen:number, adjustmentCreditYen:number,
   *            incomeLevyYen:number, perCapitaLevyYen:number,
   *            totalYen:number, monthlyYen:number}
   *          |{ok:false, code:"invalid_income"|"invalid_insurance"|"invalid_spouse"|"invalid_dependents"|"invalid_kintouwari"}}
   *   端数処理: 課税所得金額は1,000円未満切捨て、所得割額は100円未満切捨て(地方税法第20条の4の2)。
   *   monthlyYen は総額÷12を小数第1位で四捨五入した参考値(実際は6月〜翌年5月の12回、初回で端数調整)。
   */
  function calculate(incomeYen, socialInsuranceYen, spouseCount, dependentCount, kintouwariYen) {
    var spouse = spouseCount === undefined || spouseCount === null ? 0 : spouseCount;
    var deps = dependentCount === undefined || dependentCount === null ? 0 : dependentCount;
    var kintou = kintouwariYen === undefined || kintouwariYen === null ? DEFAULT_KINTOUWARI : kintouwariYen;

    var d = kyuyoDeduction(incomeYen);
    if (!d.ok) return d;
    if (!isFiniteNumber(socialInsuranceYen) || socialInsuranceYen < 0 || socialInsuranceYen > MAX_INCOME) {
      return { ok: false, code: "invalid_insurance" };
    }
    if (!isFiniteNumber(spouse) || spouse < 0 || spouse > 1 || Math.floor(spouse) !== spouse) {
      return { ok: false, code: "invalid_spouse" };
    }
    if (!isFiniteNumber(deps) || deps < 0 || deps > MAX_DEPENDENTS || Math.floor(deps) !== deps) {
      return { ok: false, code: "invalid_dependents" };
    }
    if (!isFiniteNumber(kintou) || kintou < 0 || kintou > 100000) {
      return { ok: false, code: "invalid_kintouwari" };
    }

    var salaryIncome = Math.max(0, incomeYen - d.value);
    var totalDeduction = BASIC_DEDUCTION + socialInsuranceYen +
      SPOUSE_DEDUCTION * spouse + DEPENDENT_DEDUCTION * deps;
    var taxable = Math.max(0, floorTo(salaryIncome - totalDeduction, 1000));

    var beforeCredit = taxable * INCOME_RATE;
    var humanDiff = HUMAN_DIFF_UNIT * (1 + spouse + deps);
    var adj = adjustmentCredit(taxable, humanDiff);
    var adjValue = adj.ok ? adj.value : 0;
    var levy = taxable > 0 ? Math.max(0, floorTo(beforeCredit - adjValue, 100)) : 0;
    var total = levy + kintou;

    return {
      ok: true,
      salaryDeductionYen: Math.round(d.value),
      salaryIncomeYen: Math.round(salaryIncome),
      totalDeductionYen: Math.round(totalDeduction),
      taxableIncomeYen: taxable,
      incomeTaxBeforeCreditYen: Math.round(beforeCredit),
      adjustmentCreditYen: Math.round(adjValue),
      incomeLevyYen: levy,
      perCapitaLevyYen: kintou,
      totalYen: total,
      monthlyYen: Math.round(total / 12 * 10) / 10
    };
  }

  var api = {
    kyuyoDeduction: kyuyoDeduction,
    adjustmentCredit: adjustmentCredit,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JuminzeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
