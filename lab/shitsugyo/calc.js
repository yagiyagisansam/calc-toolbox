/*
 * 失業保険(雇用保険の基本手当) 計算ロジック
 *
 * 根拠(一次情報):
 * - ハローワークインターネットサービス「基本手当について」
 *   https://www.hellowork.mhlw.go.jp/insurance/insurance_basicbenefit.html (2026年7月29日参照)
 * - ハローワークインターネットサービス「基本手当の所定給付日数」
 *   https://www.hellowork.mhlw.go.jp/insurance/insurance_benefitdays.html (2026年7月29日参照)
 * - 厚生労働省「令和7年8月1日からの基本手当日額等の適用について」
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000160564_00048.html (2026年7月29日参照)
 * - 厚生労働省リーフレット「雇用保険の基本手当日額が変更になります(令和7年8月1日から)」
 *   https://www.mhlw.go.jp/content/001520021.pdf (2026年7月29日参照)
 *   賃金日額・基本手当日額の上下限、および給付率の計算式はこのリーフレットの値。
 *
 * 前提:
 * - 金額は「令和7年8月1日から」適用のもの。上下限額は毎年8月1日に改定されるため、
 *   令和8年8月1日以降は値が変わる。
 * - 賃金日額 = 離職前6か月に毎月きまって支払われた賃金の合計 ÷ 180(賞与・臨時の賃金は含まない)。
 * - 離職時の年齢は15歳以上65歳未満を対象とする(65歳以上は高年齢求職者給付金で制度が異なる)。
 * - 「会社都合」は特定受給資格者および一部の特定理由離職者、「自己都合」はそれ以外の一般の離職者。
 * - 就職困難者(障害者等)の給付日数、給付制限期間、再就職手当、失業認定日ごとの支給は扱わない。
 * - 実際の支給額はハローワークの認定によって決まる。ここでの計算は目安。
 */
(function (global) {
  "use strict";

  // 令和7年8月1日から適用。離職時の年齢区分ごとの賃金日額上限・基本手当日額上限(円)
  var AGE_LIMITS = [
    { maxAge: 29, wageUpper: 14510, benefitUpper: 7255, senior: false },
    { maxAge: 44, wageUpper: 16110, benefitUpper: 8055, senior: false },
    { maxAge: 59, wageUpper: 17740, benefitUpper: 8870, senior: false },
    { maxAge: 64, wageUpper: 16940, benefitUpper: 7623, senior: true }
  ];
  var WAGE_LOWER = 3014; // 賃金日額の下限額(全年齢)
  var BENEFIT_LOWER = 2411; // 基本手当日額の下限額(全年齢)

  // 給付率の折れ点(令和7年8月1日から)
  var BEND_LOW = 5340; // ここ未満は一律80%
  var BEND_HIGH_UNDER60 = 13140; // 59歳以下: ここを超えると一律50%
  var BEND_HIGH_SENIOR = 11800; // 60〜64歳: ここを超えると一律45%
  var SPAN_UNDER60 = 7800; // 13,140 - 5,340
  var SPAN_SENIOR = 6460; // 11,800 - 5,340

  // 所定給付日数。被保険者であった期間の区分は
  // [1年未満, 1年以上5年未満, 5年以上10年未満, 10年以上20年未満, 20年以上]
  var DAYS_GENERAL = [null, 90, 90, 120, 150]; // 一般の離職者(自己都合・定年など)
  var DAYS_SPECIAL = [ // 特定受給資格者および一部の特定理由離職者(倒産・解雇等)
    { maxAge: 29, days: [90, 90, 120, 180, 180] },
    { maxAge: 34, days: [90, 120, 180, 210, 240] },
    { maxAge: 44, days: [90, 150, 180, 240, 270] },
    { maxAge: 59, days: [90, 180, 240, 270, 330] },
    { maxAge: 64, days: [90, 150, 180, 210, 240] }
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function ageLimits(age) {
    for (var i = 0; i < AGE_LIMITS.length; i++) {
      if (age <= AGE_LIMITS[i].maxAge) return AGE_LIMITS[i];
    }
    return null;
  }

  /**
   * 被保険者であった期間(年)を所定給付日数表の列番号に変換する
   * @param {number} insuredYears 被保険者であった期間(年。6か月なら0.5)
   * @returns {number} 0=1年未満 1=1年以上5年未満 2=5年以上10年未満 3=10年以上20年未満 4=20年以上
   */
  function periodIndex(insuredYears) {
    if (insuredYears < 1) return 0;
    if (insuredYears < 5) return 1;
    if (insuredYears < 10) return 2;
    if (insuredYears < 20) return 3;
    return 4;
  }

  /**
   * 離職前6か月の賃金合計から賃金日額を求める(上下限を当てはめる前後の両方を返す)
   * @param {number} wage6mTotal 離職前6か月に毎月きまって支払われた賃金の合計(円)
   * @param {number} age 離職時の年齢(歳。15以上65未満の整数)
   * @returns {{ok:true, rawDailyWage:number, dailyWage:number, capped:("upper"|"lower"|null),
   *            wageUpper:number, wageLower:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_age"}}
   *   rawDailyWage: 合計÷180 を1円未満切り捨てした額
   *   dailyWage: 上下限を当てはめたあとの賃金日額(円)
   *   capped: 上限に張り付いたら "upper"、下限なら "lower"、そうでなければ null
   */
  function dailyWage(wage6mTotal, age) {
    if (!isFiniteNumber(age) || age < 15 || age >= 65 || Math.floor(age) !== age) {
      return { ok: false, code: "invalid_age" };
    }
    if (!isFiniteNumber(wage6mTotal) || wage6mTotal <= 0 || wage6mTotal > 1e9) {
      return { ok: false, code: "invalid_wage" };
    }
    var lim = ageLimits(age);
    var raw = Math.floor(wage6mTotal / 180);
    var w = raw;
    var capped = null;
    if (w > lim.wageUpper) { w = lim.wageUpper; capped = "upper"; }
    else if (w < WAGE_LOWER) { w = WAGE_LOWER; capped = "lower"; }
    return {
      ok: true,
      rawDailyWage: raw,
      dailyWage: w,
      capped: capped,
      wageUpper: lim.wageUpper,
      wageLower: WAGE_LOWER
    };
  }

  /**
   * 賃金日額と離職時の年齢から基本手当日額を求める
   * @param {number} w 賃金日額(円。上下限を当てはめたあとの額)
   * @param {number} age 離職時の年齢(歳。15以上65未満の整数)
   * @returns {{ok:true, benefit:number, rate:number, benefitUpper:number, benefitLower:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_age"}}
   *   benefit: 基本手当日額(円、1円未満切り捨て。上下限を当てはめたあと)
   *   rate: 実際の給付率(%、小数第1位で四捨五入)
   */
  function dailyBenefit(w, age) {
    if (!isFiniteNumber(age) || age < 15 || age >= 65 || Math.floor(age) !== age) {
      return { ok: false, code: "invalid_age" };
    }
    if (!isFiniteNumber(w) || w <= 0 || w > 1e7) {
      return { ok: false, code: "invalid_wage" };
    }
    var lim = ageLimits(age);
    var y;
    if (lim.senior) {
      if (w < BEND_LOW) y = 0.8 * w;
      else if (w <= BEND_HIGH_SENIOR) {
        y = Math.min(0.8 * w - 0.35 * ((w - BEND_LOW) / SPAN_SENIOR) * w, 0.05 * w + 4720);
      } else y = 0.45 * w;
    } else {
      if (w < BEND_LOW) y = 0.8 * w;
      else if (w <= BEND_HIGH_UNDER60) {
        y = 0.8 * w - 0.3 * ((w - BEND_LOW) / SPAN_UNDER60) * w;
      } else y = 0.5 * w;
    }
    y = Math.floor(y);
    if (y > lim.benefitUpper) y = lim.benefitUpper;
    if (y < BENEFIT_LOWER) y = BENEFIT_LOWER;
    return {
      ok: true,
      benefit: y,
      rate: Math.round((y / w) * 1000) / 10,
      benefitUpper: lim.benefitUpper,
      benefitLower: BENEFIT_LOWER
    };
  }

  /**
   * 所定給付日数を求める
   * @param {number} age 離職時の年齢(歳。15以上65未満の整数)
   * @param {number} insuredYears 被保険者であった期間(年。6か月なら0.5)
   * @param {string} reason 離職理由。"self"=自己都合など一般の離職者 / "company"=会社都合(特定受給資格者等)
   * @returns {{ok:true, days:number, periodIndex:number}
   *          |{ok:false, code:"invalid_age"|"invalid_years"|"invalid_reason"|"insufficient_insured_period"}}
   *   insufficient_insured_period は受給資格の被保険者期間が足りないとき
   *   (自己都合は原則1年、会社都合は6か月)
   */
  function benefitDays(age, insuredYears, reason) {
    if (!isFiniteNumber(age) || age < 15 || age >= 65 || Math.floor(age) !== age) {
      return { ok: false, code: "invalid_age" };
    }
    if (!isFiniteNumber(insuredYears) || insuredYears < 0 || insuredYears > 60) {
      return { ok: false, code: "invalid_years" };
    }
    if (reason !== "self" && reason !== "company") {
      return { ok: false, code: "invalid_reason" };
    }
    var idx = periodIndex(insuredYears);
    if (reason === "self") {
      if (idx === 0) return { ok: false, code: "insufficient_insured_period" };
      return { ok: true, days: DAYS_GENERAL[idx], periodIndex: idx };
    }
    if (insuredYears < 0.5) return { ok: false, code: "insufficient_insured_period" };
    for (var i = 0; i < DAYS_SPECIAL.length; i++) {
      if (age <= DAYS_SPECIAL[i].maxAge) {
        return { ok: true, days: DAYS_SPECIAL[i].days[idx], periodIndex: idx };
      }
    }
    return { ok: false, code: "invalid_age" };
  }

  /**
   * 基本手当の総額までまとめて計算する
   * @param {number} wage6mTotal 離職前6か月に毎月きまって支払われた賃金の合計(円)
   * @param {number} age 離職時の年齢(歳。15以上65未満の整数)
   * @param {number} insuredYears 被保険者であった期間(年。6か月なら0.5)
   * @param {string} reason "self"=自己都合など一般の離職者 / "company"=会社都合(特定受給資格者等)
   * @returns {{ok:true, rawDailyWage:number, dailyWage:number, capped:(string|null),
   *            benefit:number, rate:number, days:number, total:number, monthlyApprox:number}
   *          |{ok:false, code:string}}
   *   total: 基本手当日額 × 所定給付日数(円)
   *   monthlyApprox: 1か月(28日)あたりの支給額の目安(円)。認定日は原則4週に1回のため
   */
  function calculate(wage6mTotal, age, insuredYears, reason) {
    var d = benefitDays(age, insuredYears, reason);
    if (!d.ok) return d;
    var w = dailyWage(wage6mTotal, age);
    if (!w.ok) return w;
    var b = dailyBenefit(w.dailyWage, age);
    if (!b.ok) return b;
    return {
      ok: true,
      rawDailyWage: w.rawDailyWage,
      dailyWage: w.dailyWage,
      capped: w.capped,
      benefit: b.benefit,
      rate: b.rate,
      days: d.days,
      total: b.benefit * d.days,
      monthlyApprox: b.benefit * 28
    };
  }

  var api = {
    calculate: calculate,
    dailyWage: dailyWage,
    dailyBenefit: dailyBenefit,
    benefitDays: benefitDays
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShitsugyoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
