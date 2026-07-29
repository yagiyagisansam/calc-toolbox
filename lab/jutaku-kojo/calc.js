/*
 * 住宅ローン控除(住宅借入金等特別控除) 計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.1211-1「住宅の新築等をし、令和4年以降に居住の用に供した場合
 *   (住宅借入金等特別控除)」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1211-1.htm
 *   (2026年7月29日参照。ページ表記は「令和7年4月1日現在法令等」)
 *   ・控除額 = 住宅借入金等の年末残高等 × 0.7%。100円未満の端数金額は切り捨てる。
 *   ・借入限度額(新築・買取再販)
 *       認定長期優良住宅・認定低炭素住宅 令和4・5年入居 5,000万円 / 令和6・7年入居 4,500万円
 *         (特例対象個人は令和6・7年入居も5,000万円)
 *       ZEH水準省エネ住宅       令和4・5年 4,500万円 / 令和6・7年 3,500万円(特例対象個人4,500万円)
 *       省エネ基準適合住宅      令和4・5年 4,000万円 / 令和6・7年 3,000万円(特例対象個人4,000万円)
 *       その他の住宅            令和4・5年 3,000万円 / 令和6・7年は原則対象外
 *         (令和5年12月31日以前に建築確認を受けた等の場合は2,000万円・控除期間10年)
 *   ・控除期間は新築等で13年(上記「その他の住宅」の経過措置のみ10年)。
 *   ・特例対象個人 = 年齢40歳未満で配偶者がいる人、40歳以上で40歳未満の配偶者がいる人、
 *     または19歳未満の扶養親族がいる人(いずれも居住年の12月31日時点で判定)。
 *   ・合計所得金額2,000万円以下であること(特例居住用家屋・特例認定住宅等は1,000万円以下)。
 * - 総務省「新築・購入等で住宅ローンを組む方へ 個人住民税の住宅ローン控除がうけられる場合があります」
 *   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/090929.html
 *   (2026年7月29日参照)
 *   所得税から控除しきれなかった額は、翌年度の個人住民税から
 *   「前年分の所得税の課税総所得金額等の5%(97,500円を限度)」まで控除される。
 *
 * 前提:
 * - 本ロジックが持つ借入限度額の表は「新築・買取再販」の令和4〜7年入居分のみ。
 *   中古住宅(買取再販以外の既存住宅)や令和8年以降の入居分は、借入限度額を自分で指定する
 *   customLimit を使う(国税庁の解説が更新されるまで表には入れない)。
 * - 所得要件・床面積要件・入居時期などの適用要件そのものは判定しない。要件を満たす前提で
 *   金額だけを計算する。
 * - 住民税からの控除は「所得税から引ききれなかった額」が対象で、翌年度の住民税から引かれる。
 * - 連帯債務・ペアローンの場合は各自の持分に応じた年末残高を入れる。
 */
(function (global) {
  "use strict";

  var RATE = 0.007;              // 控除率 0.7%
  var BALANCE_MAX = 1000000000;  // 年末残高の上限(10億円)
  var RESIDENT_TAX_RATE = 0.05;  // 住民税の控除限度: 課税総所得金額等の5%
  var RESIDENT_TAX_CAP = 97500;  // 住民税の控除限度額(円)

  // 住宅の区分ごとの借入限度額(円)と控除期間(年)
  // [通常の借入限度額, 特例対象個人の借入限度額, 控除期間]
  var LIMITS = {
    "2022": {
      label: "令和4年・5年入居",
      types: {
        nintei:  [50000000, 50000000, 13],
        zeh:     [45000000, 45000000, 13],
        shoene:  [40000000, 40000000, 13],
        sonota:  [30000000, 30000000, 13]
      }
    },
    "2024": {
      label: "令和6年・7年入居",
      types: {
        nintei:  [45000000, 50000000, 13],
        zeh:     [35000000, 45000000, 13],
        shoene:  [30000000, 40000000, 13],
        sonota:  [0, 0, 0]
      }
    }
  };

  var HOUSE_TYPES = ["nintei", "zeh", "shoene", "sonota"];
  var PERIODS = ["2022", "2024"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 控除額の100円未満切り捨て(租税特別措置法の端数処理)。
   * @param {number} v 端数処理前の金額(円)
   * @returns {number} 100円未満を切り捨てた金額
   */
  function floor100(v) {
    return Math.floor(v / 100 + 1e-9) * 100;
  }

  /**
   * 住宅の区分と居住年から借入限度額・控除期間を求める。
   * @param {string} houseType 住宅の区分
   *   "nintei"(認定長期優良住宅・認定低炭素住宅) | "zeh"(ZEH水準省エネ住宅)
   *   | "shoene"(省エネ基準適合住宅) | "sonota"(その他の住宅)
   * @param {string} period 居住年の区分 "2022"(令和4・5年) | "2024"(令和6・7年)
   * @param {boolean} [specialPerson=false] 特例対象個人(子育て世帯・若者夫婦世帯)なら true
   * @returns {{ok:true, limit:number, years:number, periodLabel:string, eligible:boolean}
   *          |{ok:false, code:"invalid_house_type"|"invalid_period"}}
   *   eligible が false のとき(令和6・7年入居の「その他の住宅」)は limit が0になる。
   */
  function borrowingLimit(houseType, period, specialPerson) {
    if (HOUSE_TYPES.indexOf(houseType) === -1) return { ok: false, code: "invalid_house_type" };
    if (PERIODS.indexOf(period) === -1) return { ok: false, code: "invalid_period" };
    var p = LIMITS[period];
    var t = p.types[houseType];
    var limit = specialPerson ? t[1] : t[0];
    return {
      ok: true,
      limit: limit,
      years: t[2],
      periodLabel: p.label,
      eligible: limit > 0
    };
  }

  /**
   * その年の住宅ローン控除額(所得税・住民税の内訳つき)を計算する。
   *   控除額     = min(年末残高, 借入限度額) × 0.7%(100円未満切り捨て)
   *   所得税分   = min(控除額, その年の所得税額)
   *   住民税分   = min(控除額 − 所得税分, min(課税総所得金額等 × 5%, 97,500円))
   * @param {number} yearEndBalance 住宅ローンの年末残高(円、0以上10億円以下)
   * @param {string} houseType 住宅の区分("nintei"|"zeh"|"shoene"|"sonota")
   * @param {string} period 居住年の区分("2022"|"2024")
   * @param {number} incomeTax その年の所得税額(円、0以上)。住宅ローン控除を引く前の額
   * @param {number} [taxableIncome] 課税総所得金額等(円、0以上)。
   *   省略すると住民税からの控除は上限97,500円だけで判定する
   * @param {boolean} [specialPerson=false] 特例対象個人なら true
   * @param {number} [customLimit] 借入限度額を自分で指定する場合の金額(円)。
   *   指定すると houseType / period の表より優先される
   * @returns {{ok:true, limit:number, years:number, periodLabel:string,
   *            appliedBalance:number, deduction:number,
   *            fromIncomeTax:number, fromResidentTax:number, residentTaxCap:number,
   *            unusable:number, totalUsed:number, eligible:boolean}
   *          |{ok:false, code:string}}
   *   code: "invalid_balance"|"invalid_house_type"|"invalid_period"|"invalid_income_tax"
   *         |"invalid_taxable_income"|"invalid_custom_limit"|"not_eligible"
   *   unusable は所得税からも住民税からも引ききれず使えなかった額。
   */
  function calculate(yearEndBalance, houseType, period, incomeTax, taxableIncome, specialPerson, customLimit) {
    if (!isFiniteNumber(yearEndBalance) || yearEndBalance < 0 || yearEndBalance > BALANCE_MAX) {
      return { ok: false, code: "invalid_balance" };
    }
    if (!isFiniteNumber(incomeTax) || incomeTax < 0 || incomeTax > BALANCE_MAX) {
      return { ok: false, code: "invalid_income_tax" };
    }
    if (taxableIncome !== undefined && taxableIncome !== null &&
        (!isFiniteNumber(taxableIncome) || taxableIncome < 0 || taxableIncome > BALANCE_MAX)) {
      return { ok: false, code: "invalid_taxable_income" };
    }

    var limit, years, periodLabel, eligible;
    if (customLimit !== undefined && customLimit !== null) {
      if (!isFiniteNumber(customLimit) || customLimit <= 0 || customLimit > BALANCE_MAX) {
        return { ok: false, code: "invalid_custom_limit" };
      }
      limit = customLimit;
      years = 13;
      periodLabel = "手入力";
      eligible = true;
    } else {
      var b = borrowingLimit(houseType, period, specialPerson);
      if (!b.ok) return b;
      if (!b.eligible) return { ok: false, code: "not_eligible" };
      limit = b.limit;
      years = b.years;
      periodLabel = b.periodLabel;
      eligible = true;
    }

    var applied = Math.min(yearEndBalance, limit);
    var deduction = floor100(applied * RATE);

    var fromIncomeTax = Math.min(deduction, Math.floor(incomeTax));
    var rest = deduction - fromIncomeTax;

    var cap = RESIDENT_TAX_CAP;
    if (taxableIncome !== undefined && taxableIncome !== null) {
      cap = Math.min(Math.floor(taxableIncome * RESIDENT_TAX_RATE), RESIDENT_TAX_CAP);
    }
    var fromResidentTax = Math.min(rest, cap);

    return {
      ok: true,
      limit: limit,
      years: years,
      periodLabel: periodLabel,
      eligible: eligible,
      appliedBalance: applied,
      deduction: deduction,
      fromIncomeTax: fromIncomeTax,
      fromResidentTax: fromResidentTax,
      residentTaxCap: cap,
      totalUsed: fromIncomeTax + fromResidentTax,
      unusable: deduction - fromIncomeTax - fromResidentTax
    };
  }

  /**
   * 控除期間中の各年の控除額を、年末残高の推移から一覧で出す。
   * 年末残高は「初年度の残高から毎年一定額ずつ減る」という単純な仮定で概算する。
   * @param {number} firstYearBalance 初年度の年末残高(円、0超10億円以下)
   * @param {number} annualRepayment 1年に減る元金の額(円、0以上)
   * @param {string} houseType 住宅の区分
   * @param {string} period 居住年の区分
   * @param {boolean} [specialPerson=false] 特例対象個人なら true
   * @param {number} [customLimit] 借入限度額を自分で指定する場合の金額(円)
   * @returns {{ok:true, limit:number, years:number, total:number,
   *            rows:Array<{year:number, balance:number, deduction:number}>}
   *          |{ok:false, code:string}}
   *   total は控除期間中の控除額の合計(所得税額を考えない上限額)。
   */
  function schedule(firstYearBalance, annualRepayment, houseType, period, specialPerson, customLimit) {
    if (!isFiniteNumber(firstYearBalance) || firstYearBalance <= 0 || firstYearBalance > BALANCE_MAX) {
      return { ok: false, code: "invalid_balance" };
    }
    if (!isFiniteNumber(annualRepayment) || annualRepayment < 0 || annualRepayment > BALANCE_MAX) {
      return { ok: false, code: "invalid_repayment" };
    }
    var limit, years;
    if (customLimit !== undefined && customLimit !== null) {
      if (!isFiniteNumber(customLimit) || customLimit <= 0 || customLimit > BALANCE_MAX) {
        return { ok: false, code: "invalid_custom_limit" };
      }
      limit = customLimit;
      years = 13;
    } else {
      var b = borrowingLimit(houseType, period, specialPerson);
      if (!b.ok) return b;
      if (!b.eligible) return { ok: false, code: "not_eligible" };
      limit = b.limit;
      years = b.years;
    }

    var rows = [];
    var total = 0;
    for (var i = 0; i < years; i++) {
      var balance = Math.max(0, firstYearBalance - annualRepayment * i);
      var d = floor100(Math.min(balance, limit) * RATE);
      total += d;
      rows.push({ year: i + 1, balance: balance, deduction: d });
    }
    return { ok: true, limit: limit, years: years, total: total, rows: rows };
  }

  var api = {
    calculate: calculate,
    borrowingLimit: borrowingLimit,
    schedule: schedule,
    floor100: floor100,
    RATE: RATE,
    RESIDENT_TAX_CAP: RESIDENT_TAX_CAP,
    HOUSE_TYPES: HOUSE_TYPES,
    PERIODS: PERIODS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JutakuKojoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
