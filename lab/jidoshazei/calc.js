/*
 * 自動車税(種別割)の年額・月割・重課の計算ロジック
 *
 * 根拠(一次情報):
 * - 地方税法(昭和25年法律第226号) 第154条(自動車税の標準税率) 第1項第1号
 *   イ=営業用乗用車 / ロ=自家用乗用車(令和元年10月1日以後に初回新規登録を受けたもの)
 *   https://laws.e-gov.go.jp/law/325AC0000000226 (2026年7月29日参照)
 * - 地方税法 附則第12条の4 第1項(令和元年10月1日前に初回新規登録を受けた自家用乗用車の標準税率)
 *   同条第3項(いわゆる重課の読替え税率)
 * - 地方税法 附則第12条の3 第1項(重課の対象となる自動車と適用年度。営業用乗用車等の読替え税率)
 * - 地方税法 第155条(賦課期日=4月1日)、第157条(納税義務の発生・消滅に伴う月割)
 * - 地方税法 第20条の4の2 第3項(確定金額の100円未満切捨て)
 * - 東京都主税局「自動車税種別割」(2026年5月15日更新。月割課税と概ね15%の重課の実務上の説明)
 *   https://www.tax.metro.tokyo.lg.jp/kazei/automobiles/shubetsu (2026年7月29日参照)
 *
 * 制度の時点:
 * - 2026年7月29日時点の地方税法(e-Gov法令検索)の条文にもとづく標準税率。
 * - 標準税率であり、道府県の条例で異なる税率が定められている場合はその額になる(第154条第4項)。
 *
 * 前提:
 * - 乗用車(三輪の小型自動車を除く)のみを対象とする。トラック・バス・軽自動車は対象外。
 * - グリーン化特例(軽課)、環境性能割、減免は考慮しない。
 * - 重課は、ガソリン車・石油ガス車で平成27年3月31日までに初回新規登録を受けたものは
 *   初回新規登録から14年を経過した日の属する年度以後、軽油自動車等で平成29年3月31日までに
 *   初回新規登録を受けたものは12年を経過した日の属する年度以後に適用される(附則第12条の3第1項)。
 *   これは実務上の「4月1日時点で13年超のガソリン車 / 11年超のディーゼル車」と同じ結果になる。
 *
 * 丸め:
 * - 月割の税額は 年額 × 課税月数 ÷ 12 を計算し、100円未満を切り捨てる(第20条の4の2第3項)。
 */
(function (global) {
  "use strict";

  // 排気量の区分(上限cc)。第154条第1項第1号の「総排気量が◯リットル以下のもの」に対応
  var LIMITS = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 6000, Infinity];
  var LABELS = [
    "1,000cc以下", "1,000cc超1,500cc以下", "1,500cc超2,000cc以下", "2,000cc超2,500cc以下",
    "2,500cc超3,000cc以下", "3,000cc超3,500cc以下", "3,500cc超4,000cc以下", "4,000cc超4,500cc以下",
    "4,500cc超6,000cc以下", "6,000cc超"
  ];

  // 自家用乗用車・令和元年10月1日以後に初回新規登録(地方税法第154条第1項第1号ロ)
  var PRIVATE_NEW = [25000, 30500, 36000, 43500, 50000, 57000, 65500, 75500, 87000, 110000];
  // 自家用乗用車・令和元年9月30日までに初回新規登録(附則第12条の4第1項)
  var PRIVATE_OLD = [29500, 34500, 39500, 45000, 51000, 58000, 66500, 76500, 88000, 111000];
  // 上記の重課(附則第12条の4第3項)
  var PRIVATE_OLD_HEAVY = [33900, 39600, 45400, 51700, 58600, 66700, 76400, 87900, 101200, 127600];
  // 営業用乗用車(第154条第1項第1号イ)
  var BUSINESS = [7500, 8500, 9500, 13800, 15700, 17900, 20500, 23600, 27200, 40700];
  // 営業用乗用車の重課(附則第12条の3第1項の読替え)
  var BUSINESS_HEAVY = [8600, 9700, 10900, 15800, 18000, 20500, 23500, 27100, 31200, 46800];

  // 令和元年10月1日(自家用乗用車の税率引下げの施行日)
  var NEW_RATE_YEAR = 2019;
  var NEW_RATE_MONTH = 10;

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }
  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 年度(4月始まり)を返す。 @param {number} y 年 @param {number} m 月(1-12) @returns {number} 年度 */
  function fiscalYearOf(y, m) {
    return m >= 4 ? y : y - 1;
  }

  /**
   * 排気量から税率表の区分を求める。
   * @param {number} cc 総排気量(cc)。1〜20000
   * @returns {{ok:true, index:number, label:string}|{ok:false, code:"invalid_displacement"}}
   */
  function bracket(cc) {
    if (!isNum(cc) || cc <= 0 || cc > 20000) return { ok: false, code: "invalid_displacement" };
    for (var i = 0; i < LIMITS.length; i++) {
      if (cc <= LIMITS[i]) return { ok: true, index: i, label: LABELS[i] };
    }
    return { ok: false, code: "invalid_displacement" };
  }

  /**
   * 自動車税(種別割)の年額(標準税率)を求める。
   * @param {number} cc 総排気量(cc)
   * @param {"private"|"business"} use 用途。private=自家用 / business=営業用
   * @param {number} firstRegYear 初度登録(初回新規登録)の年(西暦、1950〜2100)
   * @param {number} firstRegMonth 初度登録の月(1〜12)
   * @param {number} fiscalYear 判定する年度(西暦。4月始まり。1950〜2100)
   * @param {"gasoline"|"diesel"|"eco"} [fuel="gasoline"] 燃料。gasoline=ガソリン・石油ガス /
   *   diesel=軽油 / eco=電気・天然ガス等(重課の対象外)
   * @returns {{ok:true, taxYen:number, baseTaxYen:number, heavy:boolean, heavyFromFiscalYear:(number|null),
   *            bracketLabel:string, rateEra:"new"|"old"|"business"}
   *          |{ok:false, code:"invalid_displacement"|"invalid_use"|"invalid_date"|"invalid_fuel"}}
   *   taxYen が実際に適用される年額(重課の場合は重課後の額)。baseTaxYen は重課前の額。
   */
  function annualTax(cc, use, firstRegYear, firstRegMonth, fiscalYear, fuel) {
    var b = bracket(cc);
    if (!b.ok) return b;
    if (use !== "private" && use !== "business") return { ok: false, code: "invalid_use" };
    var f = fuel === undefined || fuel === null || fuel === "" ? "gasoline" : fuel;
    if (f !== "gasoline" && f !== "diesel" && f !== "eco") return { ok: false, code: "invalid_fuel" };
    if (!isInt(firstRegYear) || firstRegYear < 1950 || firstRegYear > 2100) return { ok: false, code: "invalid_date" };
    if (!isInt(firstRegMonth) || firstRegMonth < 1 || firstRegMonth > 12) return { ok: false, code: "invalid_date" };
    if (!isInt(fiscalYear) || fiscalYear < 1950 || fiscalYear > 2100) return { ok: false, code: "invalid_date" };

    var i = b.index;
    var regFy = fiscalYearOf(firstRegYear, firstRegMonth);
    var isNewRate = firstRegYear > NEW_RATE_YEAR ||
      (firstRegYear === NEW_RATE_YEAR && firstRegMonth >= NEW_RATE_MONTH);

    // 重課の適用開始年度(附則第12条の3第1項)
    var heavyFrom = null;
    if (f === "gasoline" && (firstRegYear < 2015 || (firstRegYear === 2015 && firstRegMonth <= 3))) {
      heavyFrom = regFy + 14;
    } else if (f === "diesel" && (firstRegYear < 2017 || (firstRegYear === 2017 && firstRegMonth <= 3))) {
      heavyFrom = regFy + 12;
    }
    var heavy = heavyFrom !== null && fiscalYear >= heavyFrom;

    var base;
    var era;
    var heavyTable;
    if (use === "business") {
      base = BUSINESS[i];
      era = "business";
      heavyTable = BUSINESS_HEAVY[i];
    } else if (isNewRate) {
      base = PRIVATE_NEW[i];
      era = "new";
      // 令和元年10月1日以後に初回新規登録を受けた自家用乗用車には現行法上の重課規定がない
      heavyTable = null;
      heavy = false;
      heavyFrom = null;
    } else {
      base = PRIVATE_OLD[i];
      era = "old";
      heavyTable = PRIVATE_OLD_HEAVY[i];
    }

    return {
      ok: true,
      taxYen: heavy ? heavyTable : base,
      baseTaxYen: base,
      heavy: heavy,
      heavyFromFiscalYear: heavyFrom,
      bracketLabel: b.label,
      rateEra: era
    };
  }

  /**
   * 月割(中途の新規登録・抹消登録)の税額を求める。
   * 新規登録は「登録した月の翌月から年度末(3月)まで」、抹消登録は「4月から抹消した月まで」
   * を課税月数とする(地方税法第157条)。
   * @param {number} annualTaxYen 年額(円)。0以上1000万円以下
   * @param {number} month 登録または抹消の月(1〜12)
   * @param {"register"|"cancel"} kind register=新規登録 / cancel=抹消登録
   * @returns {{ok:true, months:number, taxYen:number, refundYen:number}
   *          |{ok:false, code:"invalid_tax"|"invalid_month"|"invalid_kind"}}
   *   taxYen は100円未満切捨て。refundYen は年額との差(抹消時の還付相当額)。
   */
  function prorate(annualTaxYen, month, kind) {
    if (!isNum(annualTaxYen) || annualTaxYen < 0 || annualTaxYen > 10000000) {
      return { ok: false, code: "invalid_tax" };
    }
    if (!isInt(month) || month < 1 || month > 12) return { ok: false, code: "invalid_month" };
    if (kind !== "register" && kind !== "cancel") return { ok: false, code: "invalid_kind" };

    var months = kind === "register"
      ? (month >= 4 ? 15 - month : 3 - month)
      : (month >= 4 ? month - 3 : month + 9);
    var tax = Math.floor((annualTaxYen * months) / 12 / 100) * 100;
    return {
      ok: true,
      months: months,
      taxYen: tax,
      refundYen: Math.max(0, Math.floor(annualTaxYen / 100) * 100 - tax)
    };
  }

  /**
   * 年額と月割をまとめて求める。
   * @param {{cc:number, use:string, firstRegYear:number, firstRegMonth:number,
   *          fiscalYear:number, fuel?:string, month?:number, kind?:string}} opts 入力値
   * @returns {{ok:true, annual:object, prorated:(object|null)}|{ok:false, code:string}}
   *   opts.month と opts.kind を指定したときだけ prorated を返す(指定しなければ null)。
   */
  function calculate(opts) {
    if (!opts || typeof opts !== "object") return { ok: false, code: "invalid_input" };
    var a = annualTax(opts.cc, opts.use, opts.firstRegYear, opts.firstRegMonth, opts.fiscalYear, opts.fuel);
    if (!a.ok) return a;
    var p = null;
    if (opts.month !== undefined && opts.month !== null && opts.kind) {
      p = prorate(a.taxYen, opts.month, opts.kind);
      if (!p.ok) return p;
    }
    return { ok: true, annual: a, prorated: p };
  }

  var api = {
    bracket: bracket,
    annualTax: annualTax,
    prorate: prorate,
    calculate: calculate,
    fiscalYearOf: fiscalYearOf
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JidoshazeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
