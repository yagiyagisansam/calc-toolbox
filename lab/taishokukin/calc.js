/*
 * 退職金の税金・手取り 計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.1420「退職金を受け取ったとき(退職所得)」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1420.htm (2026年7月29日参照)
 *   退職所得控除額 = 勤続20年以下: 40万円×年数(80万円未満は80万円) / 20年超: 800万円+70万円×(年数-20)
 *   障害が直接の原因で退職した場合は上記に100万円を加算
 *   退職所得の金額 = (収入金額 - 退職所得控除額) × 1/2
 * - 国税庁 タックスアンサー No.2732「退職手当等に対する源泉徴収」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2732.htm (2026年7月29日参照)
 *   課税退職所得金額は1,000円未満切捨て。税額 = (課税退職所得金額×税率-控除額)×102.1%、1円未満切捨て
 * - 国税庁 タックスアンサー No.2260「所得税の税率」(令和7年分以降の速算表)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm (2026年7月29日参照)
 * - 総務省「平成25年1月1日以降の退職所得に対する住民税の特別徴収について」
 *   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/65871.html (2026年7月29日参照)
 *   退職所得の金額は1,000円未満切捨て。市町村民税6%・道府県民税4%。
 *   特別徴収税額はそれぞれ100円未満切捨て。10%税額控除は平成25年1月1日以後廃止。
 *
 * 前提(2026年7月29日時点の制度):
 * - 「退職所得の受給に関する申告書」を勤務先に提出済みであることを前提とする
 *   (未提出の場合は支払金額の20.42%が源泉徴収され、確定申告で精算する)
 * - 退職金だけを取り出した分離課税の計算。他の所得・所得控除・住宅ローン控除等は反映しない
 * - 勤続年数は1年未満の端数を1年に切り上げた「年数」を入力する前提
 * - 住民税は標準税率(市町村民税6%・道府県民税4%)。政令指定都市は内訳が2%/8%になるが合計10%は同じ
 * - 金額の丸め: 課税退職所得金額と退職所得の金額は1,000円未満切捨て、所得税等は1円未満切捨て、
 *   住民税は市町村民税・道府県民税それぞれ100円未満切捨て(法定の端数処理)
 */
(function (global) {
  "use strict";

  var MAX_AMOUNT = 1000000000; // 10億円(入力の上限)
  var MAX_YEARS = 70;

  // 所得税の速算表(令和7年分以降): [課税所得の上限, 税率(%), 控除額]
  // 税率は百分率の整数で持ち、taxable/100*率 と計算する(浮動小数の誤差を避けるため)
  var TAX_TABLE = [
    [1949000, 5, 0],
    [3299000, 10, 97500],
    [6949000, 20, 427500],
    [8999000, 23, 636000],
    [17999000, 33, 1536000],
    [39999000, 40, 2796000],
    [Infinity, 45, 4796000]
  ];

  var CITY_RATE_PERCENT = 6; // 市町村民税(特別区民税)
  var PREF_RATE_PERCENT = 4; // 道府県民税(都民税)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function floorTo(value, unit) {
    return Math.floor(value / unit) * unit;
  }

  /**
   * 退職所得控除額を求める。
   * @param {number} years 勤続年数(1〜70の整数。1年未満の端数は切り上げた値を渡す)
   * @param {boolean} [disability] 障害が直接の原因で退職した場合は true(100万円を加算)
   * @returns {{ok:true, deductionYen:number}|{ok:false, code:"invalid_years"}}
   */
  function retirementDeduction(years, disability) {
    if (!isFiniteNumber(years) || years !== Math.floor(years) || years < 1 || years > MAX_YEARS) {
      return { ok: false, code: "invalid_years" };
    }
    var d;
    if (years <= 20) {
      d = Math.max(400000 * years, 800000);
    } else {
      d = 8000000 + 700000 * (years - 20);
    }
    if (disability === true) d += 1000000;
    return { ok: true, deductionYen: d };
  }

  /**
   * 所得税の速算表から税額(復興特別所得税を含まない)を求める。
   * @param {number} taxableYen 課税退職所得金額(1,000円未満切捨て済み、0以上)
   * @returns {number} 所得税額(円。端数処理はしていない)
   */
  function incomeTaxByTable(taxableYen) {
    for (var i = 0; i < TAX_TABLE.length; i++) {
      if (taxableYen <= TAX_TABLE[i][0]) {
        return (taxableYen / 100) * TAX_TABLE[i][1] - TAX_TABLE[i][2];
      }
    }
    return 0;
  }

  /**
   * 退職金の所得税・復興特別所得税・住民税と手取り額を計算する。
   * @param {number} amountYen 退職金の額(円。源泉徴収される前の支給額)
   * @param {number} years 勤続年数(1〜70の整数)
   * @param {boolean} [disability] 障害が直接の原因で退職した場合 true
   * @param {"general"|"officer5"|"short5"} [kind] 退職手当等の区分
   *   general : 一般退職手当等(既定)。控除後の額に1/2を乗じる
   *   officer5: 特定役員退職手当等(役員等勤続年数5年以下)。1/2を乗じない
   *   short5  : 短期退職手当等(役員等以外で勤続5年以下)。控除後300万円までは1/2、超過分は全額
   * @returns {{ok:true, deductionYen:number, taxableIncomeYen:number, incomeTaxYen:number,
   *            cityTaxYen:number, prefTaxYen:number, residentTaxYen:number,
   *            totalTaxYen:number, netYen:number, effectiveRatePercent:number}
   *          |{ok:false, code:"invalid_amount"|"invalid_years"|"invalid_kind"}}
   *   effectiveRatePercent は 税金合計÷退職金 の百分率(小数第2位で四捨五入)
   */
  function calculate(amountYen, years, disability, kind) {
    if (!isFiniteNumber(amountYen) || amountYen <= 0 || amountYen > MAX_AMOUNT) {
      return { ok: false, code: "invalid_amount" };
    }
    var k = kind === undefined || kind === null ? "general" : kind;
    if (k !== "general" && k !== "officer5" && k !== "short5") {
      return { ok: false, code: "invalid_kind" };
    }
    var d = retirementDeduction(years, disability);
    if (!d.ok) return d;

    var over = amountYen - d.deductionYen; // 退職所得控除後の金額
    var income;                            // 退職所得の金額(1/2適用後)
    if (over <= 0) {
      income = 0;
    } else if (k === "officer5") {
      income = over;
    } else if (k === "short5") {
      income = over <= 3000000 ? over / 2 : 1500000 + (over - 3000000);
    } else {
      income = over / 2;
    }

    // 課税退職所得金額(=住民税の退職所得の金額)は1,000円未満切捨て
    var taxable = floorTo(income, 1000);

    // 所得税および復興特別所得税(所得税額×102.1%、1円未満切捨て)
    // ×1021/1000 の形で計算し、1.021 を直接掛けたときの浮動小数誤差を避ける
    var incomeTax = taxable > 0 ? Math.floor((incomeTaxByTable(taxable) * 1021) / 1000) : 0;

    // 住民税(分離課税)。市町村民税・道府県民税それぞれ100円未満切捨て
    var cityTax = floorTo((taxable / 100) * CITY_RATE_PERCENT, 100);
    var prefTax = floorTo((taxable / 100) * PREF_RATE_PERCENT, 100);
    var residentTax = cityTax + prefTax;

    var total = incomeTax + residentTax;
    return {
      ok: true,
      deductionYen: d.deductionYen,
      taxableIncomeYen: taxable,
      incomeTaxYen: incomeTax,
      cityTaxYen: cityTax,
      prefTaxYen: prefTax,
      residentTaxYen: residentTax,
      totalTaxYen: total,
      netYen: amountYen - total,
      effectiveRatePercent: Math.round((total / amountYen) * 10000) / 100
    };
  }

  /**
   * 税金がまったくかからない退職金の上限額(=退職所得控除額)を返す。
   * @param {number} years 勤続年数(1〜70の整数)
   * @param {boolean} [disability] 障害退職なら true
   * @returns {{ok:true, taxFreeLimitYen:number}|{ok:false, code:"invalid_years"}}
   */
  function taxFreeLimit(years, disability) {
    var d = retirementDeduction(years, disability);
    if (!d.ok) return d;
    return { ok: true, taxFreeLimitYen: d.deductionYen };
  }

  var api = {
    retirementDeduction: retirementDeduction,
    calculate: calculate,
    taxFreeLimit: taxFreeLimit
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TaishokukinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
