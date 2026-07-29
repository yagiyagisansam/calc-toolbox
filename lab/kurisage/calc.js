/*
 * 年金の繰上げ受給・繰下げ受給の増減額と損益分岐年齢の計算ロジック
 *
 * 根拠(一次情報):
 * - 日本年金機構「年金の繰上げ受給」(2024年8月19日更新)
 *   https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-01.html (2026年7月29日参照)
 *   ・減額率(最大24%) = 0.4% × 繰上げ請求月から65歳に達する日の前月までの月数
 *   ・昭和37年4月1日以前生まれの方の減額率は 0.5%(最大30%)
 * - 日本年金機構「年金の繰下げ受給」
 *   https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-02.html (2026年7月29日参照)
 *   ・増額率(最大84%) = 0.7% × 65歳に達した月から繰下げ申出月の前月までの月数
 *   ・75歳まで繰下げできるのは昭和27年4月2日以降生まれの方(昭和27年4月1日以前生まれは70歳・最大42%)
 *   ・繰下げの請求ができるのは66歳以後
 *
 * 制度の時点:
 * - 2026年7月29日時点の日本年金機構の掲載内容(令和4年4月施行の75歳までの繰下げを含む)にもとづく。
 *
 * 前提:
 * - 老齢基礎年金・老齢厚生年金の本体部分の増減のみを計算する。
 *   加給年金額・振替加算は増額の対象外(日本年金機構)。特別支給の老齢厚生年金の特例も対象外。
 * - 損益分岐年齢は「65歳から受け取り始めた場合の累計額」と「繰上げ・繰下げした場合の累計額」が
 *   並ぶ年齢。年金額の改定(物価・賃金スライド)、税・社会保険料、遺族年金への影響は考慮しない。
 *
 * 丸め:
 * - 増減率(%)は小数第1位に丸める(0.4%/0.7%刻みなので実際には小数第1位で割り切れる)。
 * - 年金額は円未満を四捨五入する。
 * - 損益分岐年齢は「累計が並ぶ月」を切り上げた月数で表す(その月に到達した時点で追い付く)。
 */
(function (global) {
  "use strict";

  var NORMAL_MONTHS = 65 * 12; // 780。本来の受給開始(65歳0か月)
  var MIN_MONTHS = 60 * 12;    // 720。繰上げの下限(60歳0か月)
  var MAX_MONTHS = 75 * 12;    // 900。繰下げの上限(75歳0か月)
  var LIMIT70_MONTHS = 70 * 12; // 840。昭和27年4月1日以前生まれの繰下げ上限

  // 生年月日の区分
  // b: 昭和37年4月2日以降生まれ(繰上げ0.4% / 繰下げ75歳まで)
  // a: 昭和27年4月2日〜昭和37年4月1日生まれ(繰上げ0.5% / 繰下げ75歳まで)
  // c: 昭和27年4月1日以前生まれ(繰上げ0.5% / 繰下げ70歳まで)
  var GROUPS = {
    b: { downPerMonth: 0.004, maxKurisageMonths: MAX_MONTHS, label: "昭和37年4月2日以降生まれ" },
    a: { downPerMonth: 0.005, maxKurisageMonths: MAX_MONTHS, label: "昭和27年4月2日〜昭和37年4月1日生まれ" },
    c: { downPerMonth: 0.005, maxKurisageMonths: LIMIT70_MONTHS, label: "昭和27年4月1日以前生まれ" }
  };

  var UP_PER_MONTH = 0.007; // 繰下げ増額率(1か月あたり0.7%)

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function normalizeGroup(g) {
    if (g === undefined || g === null || g === "") return "b";
    return g;
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 受給開始年齢から増減率・倍率・損益分岐年齢を求める。
   * @param {number} ageYears 受給開始の年齢(歳)。60〜75の整数
   * @param {number} ageMonths 受給開始の年齢のうち月数(0〜11の整数)
   * @param {"a"|"b"|"c"} [group="b"] 生年月日の区分(GROUPS参照)
   * @returns {{ok:true, startTotalMonths:number, offsetMonths:number,
   *            type:"kuriage"|"normal"|"kurisage", ratePct:number, factor:number,
   *            breakEvenYears:(number|null), breakEvenMonths:(number|null),
   *            breakEvenTotalMonths:(number|null), groupLabel:string}
   *          |{ok:false, code:"invalid_age"|"invalid_month"|"age_out_of_range"|"invalid_group"}}
   *   offsetMonths は65歳(780か月)からの月数。マイナスが繰上げ、プラスが繰下げ。
   *   ratePct はマイナスが減額、プラスが増額(単位%)。factor は本来の年金額に掛ける倍率。
   *   breakEven* は損益分岐年齢。65歳0か月ちょうど(増減なし)の場合は null。
   */
  function calculate(ageYears, ageMonths, group) {
    var g = normalizeGroup(group);
    if (!GROUPS[g]) return { ok: false, code: "invalid_group" };
    if (!isInt(ageYears) || ageYears < 60 || ageYears > 75) return { ok: false, code: "invalid_age" };
    var m = ageMonths === undefined || ageMonths === null ? 0 : ageMonths;
    if (!isInt(m) || m < 0 || m > 11) return { ok: false, code: "invalid_month" };

    var total = ageYears * 12 + m;
    if (total < MIN_MONTHS || total > MAX_MONTHS) return { ok: false, code: "age_out_of_range" };
    if (total > GROUPS[g].maxKurisageMonths) return { ok: false, code: "age_out_of_range" };

    var offset = total - NORMAL_MONTHS;
    var factor;
    var type;
    if (offset < 0) {
      type = "kuriage";
      factor = 1 - (-offset) * GROUPS[g].downPerMonth;
    } else if (offset < 12) {
      // 66歳前の請求は増額されない(繰下げ請求ができるのは66歳以後)
      type = "normal";
      factor = 1;
    } else {
      type = "kurisage";
      factor = 1 + offset * UP_PER_MONTH;
    }

    var be = breakEvenTotalMonths(total, factor);
    return {
      ok: true,
      startTotalMonths: total,
      offsetMonths: offset,
      type: type,
      ratePct: round1((factor - 1) * 100),
      factor: factor,
      breakEvenTotalMonths: be,
      breakEvenYears: be === null ? null : Math.floor(be / 12),
      breakEvenMonths: be === null ? null : be % 12,
      groupLabel: GROUPS[g].label
    };
  }

  /**
   * 損益分岐となる年齢(月数)を求める。
   * 65歳開始の累計 (T-780) と、start開始の累計 (T-start)×factor が並ぶ T を解く。
   * T = (start×factor − 780) ÷ (factor − 1)
   * @param {number} startTotalMonths 受給開始年齢(月数)
   * @param {number} factor 年金額の倍率
   * @returns {number|null} 損益分岐年齢(月数、切り上げ)。増減なしの場合は null
   */
  function breakEvenTotalMonths(startTotalMonths, factor) {
    if (factor === 1) return null;
    var t = (startTotalMonths * factor - NORMAL_MONTHS) / (factor - 1);
    if (!isFinite(t)) return null;
    return Math.ceil(t - 1e-9);
  }

  /**
   * 本来の年金額(65歳時点の年額)から、繰上げ・繰下げ後の年金額を求める。
   * @param {number} basePensionYen 本来の年金額(65歳時点の年額、円)。0以上1億円以下
   * @param {number} ageYears 受給開始の年齢(歳)
   * @param {number} ageMonths 受給開始の年齢のうち月数(0〜11)
   * @param {"a"|"b"|"c"} [group="b"] 生年月日の区分
   * @returns {{ok:true, annualYen:number, monthlyYen:number, diffAnnualYen:number,
   *            ratePct:number, type:string, breakEvenYears:(number|null), breakEvenMonths:(number|null)}
   *          |{ok:false, code:string}}
   *   annualYen は円未満四捨五入。monthlyYen は年額を12で割って円未満四捨五入した参考値。
   */
  function amount(basePensionYen, ageYears, ageMonths, group) {
    if (typeof basePensionYen !== "number" || !isFinite(basePensionYen) ||
        basePensionYen < 0 || basePensionYen > 100000000) {
      return { ok: false, code: "invalid_pension" };
    }
    var r = calculate(ageYears, ageMonths, group);
    if (!r.ok) return r;
    var annual = Math.round(basePensionYen * r.factor);
    return {
      ok: true,
      annualYen: annual,
      monthlyYen: Math.round(annual / 12),
      diffAnnualYen: annual - Math.round(basePensionYen),
      ratePct: r.ratePct,
      type: r.type,
      breakEvenYears: r.breakEvenYears,
      breakEvenMonths: r.breakEvenMonths
    };
  }

  /**
   * 60歳〜75歳(各歳0か月)の増減率と損益分岐年齢の一覧を作る。
   * @param {"a"|"b"|"c"} [group="b"] 生年月日の区分
   * @returns {{ok:true, rows:Array<{age:number, ratePct:number, breakEvenYears:(number|null), breakEvenMonths:(number|null)}>}
   *          |{ok:false, code:"invalid_group"}}
   */
  function table(group) {
    var g = normalizeGroup(group);
    if (!GROUPS[g]) return { ok: false, code: "invalid_group" };
    var rows = [];
    var maxAge = GROUPS[g].maxKurisageMonths / 12;
    for (var age = 60; age <= maxAge; age++) {
      var r = calculate(age, 0, g);
      if (!r.ok) continue;
      rows.push({
        age: age,
        ratePct: r.ratePct,
        breakEvenYears: r.breakEvenYears,
        breakEvenMonths: r.breakEvenMonths
      });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    calculate: calculate,
    amount: amount,
    table: table
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KurisageCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
