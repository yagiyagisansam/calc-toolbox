/*
 * 給与所得控除・給与所得の計算ロジック
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.1410「給与所得控除」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm (2026年7月29日参照)
 *   ・令和7年分以降の速算表 / 令和2年分から令和6年分の速算表 の2種類を掲載
 *
 * 制度の時点:
 * - 「令和7年分以降」の速算表は、令和7年度税制改正(基礎控除の見直し等)によるもの。
 * - 「令和2年分から令和6年分」の速算表も比較用に実装している。
 *
 * 前提:
 * - 給与収入(源泉徴収票の「支払金額」)1か所分だけを入れた場合の計算。
 *   2か所以上ある場合は合計額で速算表を適用する(国税庁の注記)。
 * - 給与所得控除額が給与収入を上回る場合、給与所得の金額は0円とする(マイナスにしない)。
 * - 給与収入が660万円未満の場合、実際の税額計算では所得税法別表第五
 *   (年末調整等のための給与所得控除後の給与等の金額の表)を使うため、
 *   速算表による本ツールの結果と数十円〜数百円ずれることがある。
 * - 所得金額調整控除(子ども・特別障害者等を有する者等の所得金額調整控除など)は考慮しない。
 *
 * 丸め:
 * - 速算表の計算結果は円単位。0.5円以上の端数が出ないよう Math.round で円未満を丸める
 *   (税率10%〜40%と定額の組合せなので、実際には1円未満の端数は生じない)。
 */
(function (global) {
  "use strict";

  var INCOME_MAX = 1000000000; // 10億円。これを超える入力は誤入力とみなす

  // 速算表。[収入の上限(この額まで), 率, 加算額]。率0の行は定額控除。
  // 上限 Infinity の行が最後。
  var TABLES = {
    // 令和7年分以降(国税庁 No.1410)
    r7: [
      [1900000, 0, 650000],
      [3600000, 0.3, 80000],
      [6600000, 0.2, 440000],
      [8500000, 0.1, 1100000],
      [Infinity, 0, 1950000]
    ],
    // 令和2年分から令和6年分(国税庁 No.1410)
    r2: [
      [1625000, 0, 550000],
      [1800000, 0.4, -100000],
      [3600000, 0.3, 80000],
      [6600000, 0.2, 440000],
      [8500000, 0.1, 1100000],
      [Infinity, 0, 1950000]
    ]
  };

  var LABELS = {
    r7: "令和7年分以降",
    r2: "令和2年分から令和6年分"
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function normalizeYear(year) {
    if (year === undefined || year === null || year === "") return "r7";
    return year;
  }

  /**
   * 給与所得控除額を求める。
   * @param {number} income 給与収入(年収、円)。0以上 INCOME_MAX 以下
   * @param {"r7"|"r2"} [year="r7"] 適用する速算表。"r7"=令和7年分以降 / "r2"=令和2〜6年分
   * @returns {{ok:true, deductionYen:number, rate:number, addYen:number, bracket:string, tableLabel:string}
   *          |{ok:false, code:"invalid_income"|"invalid_year"}}
   *   deductionYen は円単位(整数)。給与収入が控除額の下限を下回る場合は収入金額そのもの。
   */
  function deduction(income, year) {
    var y = normalizeYear(year);
    if (!isFiniteNumber(income) || income < 0 || income > INCOME_MAX) {
      return { ok: false, code: "invalid_income" };
    }
    var table = TABLES[y];
    if (!table) return { ok: false, code: "invalid_year" };

    var prev = 0;
    for (var i = 0; i < table.length; i++) {
      var row = table[i];
      if (income <= row[0]) {
        var raw = income * row[1] + row[2];
        // 控除額は収入金額を超えない(所得税法28条3項。超える場合は収入金額そのもの)
        var d = Math.round(Math.min(raw, income));
        return {
          ok: true,
          deductionYen: d,
          rate: row[1],
          addYen: row[2],
          bracket: bracketLabel(prev, row[0]),
          tableLabel: LABELS[y]
        };
      }
      prev = row[0];
    }
    return { ok: false, code: "invalid_income" };
  }

  function bracketLabel(lower, upper) {
    if (lower === 0) return "0円〜" + upper.toLocaleString("ja-JP") + "円";
    if (upper === Infinity) return (lower + 1).toLocaleString("ja-JP") + "円〜";
    return (lower + 1).toLocaleString("ja-JP") + "円〜" + upper.toLocaleString("ja-JP") + "円";
  }

  /**
   * 給与収入から給与所得控除額と給与所得の金額を求める。
   * @param {number} income 給与収入(年収、円)
   * @param {"r7"|"r2"} [year="r7"] 適用する速算表
   * @returns {{ok:true, incomeYen:number, deductionYen:number, salaryIncomeYen:number,
   *            deductionRatePct:number, bracket:string, tableLabel:string}
   *          |{ok:false, code:"invalid_income"|"invalid_year"}}
   *   salaryIncomeYen = 給与収入 − 給与所得控除額 (0円未満にはならない)。
   *   deductionRatePct は控除額が収入に占める割合(%)。小数第1位に丸める。収入0円のときは0。
   */
  function calculate(income, year) {
    var d = deduction(income, year);
    if (!d.ok) return d;
    var salary = Math.max(0, Math.round(income) - d.deductionYen);
    return {
      ok: true,
      incomeYen: Math.round(income),
      deductionYen: d.deductionYen,
      salaryIncomeYen: salary,
      deductionRatePct: income > 0 ? Math.round((d.deductionYen / income) * 1000) / 10 : 0,
      bracket: d.bracket,
      tableLabel: d.tableLabel
    };
  }

  /**
   * 令和7年分以降と令和2〜6年分を比較する。
   * @param {number} income 給与収入(年収、円)
   * @returns {{ok:true, r7:object, r2:object, diffDeductionYen:number, diffSalaryIncomeYen:number}
   *          |{ok:false, code:"invalid_income"}}
   *   diffDeductionYen = 令和7年分以降の控除額 − 令和2〜6年分の控除額(プラスなら控除が増えた)。
   */
  function compare(income) {
    var a = calculate(income, "r7");
    if (!a.ok) return a;
    var b = calculate(income, "r2");
    if (!b.ok) return b;
    return {
      ok: true,
      r7: a,
      r2: b,
      diffDeductionYen: a.deductionYen - b.deductionYen,
      diffSalaryIncomeYen: a.salaryIncomeYen - b.salaryIncomeYen
    };
  }

  var api = {
    deduction: deduction,
    calculate: calculate,
    compare: compare
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KyuyoKojoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
