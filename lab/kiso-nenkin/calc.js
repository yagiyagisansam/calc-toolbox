/*
 * 老齢基礎年金(国民年金)の受給額 計算ロジック
 *
 * 根拠(一次情報):
 * - 日本年金機構「老齢基礎年金の受給要件・支給開始時期・年金額」
 *   https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/jukyu-yoken/20150401-02.html (2026年7月29日参照)
 *   受給資格期間は10年以上。年金額は満額×(納付済月数+免除月数×国庫負担割合等)÷480。
 *   平成21年4月以降の免除期間: 全額免除 1/2、4分の3免除(=4分の1納付) 5/8、
 *   半額免除(=半額納付) 6/8、4分の1免除(=4分の3納付) 7/8。
 *   平成21年3月分までの免除期間: 全額免除 1/3、4分の1納付 1/2、半額納付 2/3、4分の3納付 5/6。
 *   付加保険料を納めた期間は 200円 × 付加保険料納付月数 が年額に上乗せされる。
 * - 日本年金機構「令和8年4月分からの年金額等について」
 *   https://www.nenkin.go.jp/oshirase/taisetu/kojin/2026/202604/0401.html (2026年7月29日参照)
 *   令和8年度の老齢基礎年金(満額)は月額70,608円(昭和31年4月2日以後生まれ)、
 *   昭和31年4月1日以前生まれは月額70,408円。前年度から1.9%の引上げ。
 * - 厚生労働省「令和8年度の年金額改定についてお知らせします」(令和8年1月23日 報道発表)
 *   https://www.mhlw.go.jp/content/12600000/001672868.pdf (2026年7月29日参照)
 * - 日本年金機構「年金額の端数処理」
 *   https://www.nenkin.go.jp/service/jukyu/seido/kyotsu/nenkingaku/20140421-01.html (2026年7月30日参照)
 *   個人の年金額に1円未満の端数が生じたときは、50銭未満は切捨て・50銭以上1円未満は1円に切上げ
 *   (100円単位の端数処理が適用されるのは法定の満額そのもの)。
 *
 * 制度・料率の時点:
 * - 満額の既定値 847,300円 は令和8(2026)年度の額(月額70,608円 × 12か月 = 847,296円 を、
 *   国民年金法の端数処理(50円未満切捨て・50円以上100円未満切上げ)で100円単位にしたもの)。
 *   同じ端数処理で昭和31年4月1日以前生まれの月額70,408円は年額844,900円となり、
 *   日本年金機構が公表している「844,900円」と一致する。
 * - 満額は毎年度改定されるため、年度が変わったら参照年度の満額を入れ直すこと。
 *
 * 前提:
 * - 480月(20歳〜60歳の40年)を分母とする本来の計算式。昭和16年4月1日以前生まれの特例は扱わない。
 * - 繰上げ受給・繰下げ受給による減額・増額、振替加算、合算対象期間(カラ期間)は扱わない。
 * - 学生納付特例・納付猶予の期間は、追納しない限り年金額に反映されないため月数に含めない。
 */
(function (global) {
  "use strict";

  var FULL_MONTHS = 480;                 // 満額となる月数(40年)
  var ELIGIBLE_MONTHS = 120;             // 受給資格期間(10年)
  var DEFAULT_FULL_AMOUNT = 847300;      // 令和8年度の満額(年額・円)
  var FUKA_YEN_PER_MONTH = 200;          // 付加年金(200円 × 付加保険料納付月数)

  // 免除期間に乗じる割合。[全額免除, 4分の3免除, 半額免除, 4分の1免除]
  var RATES_NEW = [1 / 2, 5 / 8, 6 / 8, 7 / 8];  // 平成21年4月以降
  var RATES_OLD = [1 / 3, 1 / 2, 2 / 3, 5 / 6];  // 平成21年3月分まで

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isMonths(v) {
    return isFiniteNumber(v) && v >= 0 && v <= FULL_MONTHS && Math.floor(v) === v;
  }

  /**
   * 個人の年金額の1円単位への端数処理(50銭未満切捨て・50銭以上1円未満切上げ)。
   * 100円単位の端数処理は法定の満額に対するもので、月数に応じて計算した個人の額には適用しない。
   * @param {number} yen 端数処理前の年額(円)
   * @returns {number} 1円単位に丸めた年額(円)
   */
  function roundYen(yen) {
    return Math.round(yen);
  }

  /**
   * 免除月数に乗じる割合を返す。
   * @param {"new"|"old"} era "new"=平成21年4月以降 / "old"=平成21年3月分まで
   * @returns {{ok:true, full:number, threeQuarter:number, half:number, quarter:number}
   *          |{ok:false, code:"invalid_era"}}
   *   full=全額免除、threeQuarter=4分の3免除、half=半額免除、quarter=4分の1免除に対する割合。
   */
  function exemptionRates(era) {
    var r = era === "old" ? RATES_OLD : era === "new" ? RATES_NEW : null;
    if (!r) return { ok: false, code: "invalid_era" };
    return { ok: true, full: r[0], threeQuarter: r[1], half: r[2], quarter: r[3] };
  }

  function sumMonths(paid, list, rates) {
    return paid + list[0] * rates[0] + list[1] * rates[1] + list[2] * rates[2] + list[3] * rates[3];
  }

  /**
   * 平成21年4月以降の期間だけで老齢基礎年金の年額・月額を計算する。
   * @param {number} paidMonths 保険料納付済月数(0〜480。第2号・第3号被保険者期間を含む)
   * @param {number} [fullExemptMonths=0] 全額免除の月数(0〜480)
   * @param {number} [threeQuarterExemptMonths=0] 4分の3免除の月数(0〜480)
   * @param {number} [halfExemptMonths=0] 半額免除の月数(0〜480)
   * @param {number} [quarterExemptMonths=0] 4分の1免除の月数(0〜480)
   * @param {number} [fullAmountYen=847300] 参照年度の満額(年額・円。1円〜300万円)
   * @returns {{ok:true, eligible:boolean, totalMonths:number, creditedMonths:number,
   *            annualYen:number, monthlyYen:number, ratePercent:number}
   *          |{ok:false, code:"invalid_paid"|"invalid_full"|"invalid_three_quarter"|"invalid_half"|"invalid_quarter"|"invalid_full_amount"|"months_over_limit"}}
   *   creditedMonths は割合をかけた後の月数(小数第2位で四捨五入)。480月を上限とする。
   *   annualYen は 満額 × creditedMonths ÷ 480 を1円単位に丸めた額(50銭未満切捨て・50銭以上切上げ)。
   *   monthlyYen は annualYen ÷ 12 の1円未満切捨て。
   *   eligible は 納付済+免除の実月数が120月(10年)以上かどうか。false でも金額は計算して返す。
   */
  function calculate(paidMonths, fullExemptMonths, threeQuarterExemptMonths,
                     halfExemptMonths, quarterExemptMonths, fullAmountYen) {
    return calculateMixed(
      paidMonths,
      [fullExemptMonths, threeQuarterExemptMonths, halfExemptMonths, quarterExemptMonths],
      [0, 0, 0, 0],
      fullAmountYen
    );
  }

  /**
   * 平成21年4月以降と平成21年3月分まで、両方の免除期間をあわせて計算する。
   * @param {number} paidMonths 保険料納付済月数(0〜480)
   * @param {Array<number>} newExemptMonths 平成21年4月以降の免除月数
   *   [全額免除, 4分の3免除, 半額免除, 4分の1免除] の順(各0〜480)
   * @param {Array<number>} oldExemptMonths 平成21年3月分までの免除月数(同じ並び)
   * @param {number} [fullAmountYen=847300] 参照年度の満額(年額・円)
   * @returns {{ok:true, eligible:boolean, totalMonths:number, creditedMonths:number,
   *            annualYen:number, monthlyYen:number, ratePercent:number}
   *          |{ok:false, code:string}}
   *   ratePercent は満額に対する割合(%。小数第1位で四捨五入)。
   */
  function calculateMixed(paidMonths, newExemptMonths, oldExemptMonths, fullAmountYen) {
    var codes = ["invalid_full", "invalid_three_quarter", "invalid_half", "invalid_quarter"];
    var amount = fullAmountYen === undefined || fullAmountYen === null ? DEFAULT_FULL_AMOUNT : fullAmountYen;
    var newList = normalizeList(newExemptMonths);
    var oldList = normalizeList(oldExemptMonths);

    if (!isMonths(paidMonths)) return { ok: false, code: "invalid_paid" };
    if (!newList || !oldList) return { ok: false, code: "invalid_full" };
    var i;
    for (i = 0; i < 4; i++) {
      if (!isMonths(newList[i]) || !isMonths(oldList[i])) return { ok: false, code: codes[i] };
    }
    if (!isFiniteNumber(amount) || amount <= 0 || amount > 3000000) {
      return { ok: false, code: "invalid_full_amount" };
    }

    var totalMonths = paidMonths;
    for (i = 0; i < 4; i++) totalMonths += newList[i] + oldList[i];
    if (totalMonths > FULL_MONTHS) return { ok: false, code: "months_over_limit" };

    var credited = sumMonths(paidMonths, newList, RATES_NEW) + sumMonths(0, oldList, RATES_OLD);
    credited = Math.min(credited, FULL_MONTHS);

    var annual = roundYen(amount * credited / FULL_MONTHS);
    return {
      ok: true,
      eligible: totalMonths >= ELIGIBLE_MONTHS,
      totalMonths: totalMonths,
      creditedMonths: Math.round(credited * 100) / 100,
      annualYen: annual,
      monthlyYen: Math.floor(annual / 12),
      ratePercent: Math.round(credited / FULL_MONTHS * 1000) / 10
    };
  }

  function normalizeList(list) {
    if (list === undefined || list === null) return [0, 0, 0, 0];
    if (!Array.isArray(list)) return null;
    var out = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      var v = list[i];
      out[i] = v === undefined || v === null ? 0 : v;
    }
    return out;
  }

  /**
   * 付加年金の年額を求める(200円 × 付加保険料納付月数)。
   * @param {number} months 付加保険料を納めた月数(0〜480)
   * @returns {{ok:true, annualYen:number}|{ok:false, code:"invalid_months"}}
   */
  function fukaNenkin(months) {
    if (!isMonths(months)) return { ok: false, code: "invalid_months" };
    return { ok: true, annualYen: FUKA_YEN_PER_MONTH * months };
  }

  var api = {
    exemptionRates: exemptionRates,
    calculate: calculate,
    calculateMixed: calculateMixed,
    fukaNenkin: fukaNenkin
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KisoNenkinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
