/*
 * 自動車重量税(乗用車・検査対象軽自動車 自家用)の計算ロジック
 *
 * 根拠(一次情報):
 * - 国土交通省「自動車重量税額について」
 *   https://www.mlit.go.jp/jidosha/jidosha_fr1_000076.html (2026年7月29日参照)
 *   同ページから配布されている税額表PDF(2026年5月1日からの税額。令和8年度税制改正後)
 *   ・継続検査等の場合  https://www.mlit.go.jp/jidosha/content/001884517.pdf
 *   ・新車新規登録等の場合 https://www.mlit.go.jp/jidosha/content/001999427.pdf
 *
 * 税額表から読み取った単価(2026年5月1日から適用):
 *  乗用車(自家用) 車両重量0.5トンごと・1年あたり
 *    本則税率        2,500円   (継続検査2年 = 5,000円/0.5t)
 *    当分の間税率    4,100円   (継続検査2年 = 8,200円/0.5t)
 *    13年経過        5,700円   (継続検査2年 = 11,400円/0.5t)
 *    18年経過        6,300円   (継続検査2年 = 12,600円/0.5t)
 *  検査対象軽自動車(自家用) 1年あたり(重量に関係なく定額)
 *    本則税率 2,500円 / 当分の間税率 3,300円 / 13年経過 4,100円 / 18年経過 4,400円
 *  エコカー減税(新車新規登録等のみ)は本則税率からの軽減で、100円未満切捨て
 *    免税 / 75%軽減 / 50%軽減 / 25%軽減
 *
 * 前提(2026年7月29日時点の制度):
 * - 自家用の乗用車(0.5トンきざみ、最大3トンまで)と検査対象軽自動車(二輪を除く)のみを扱う
 * - 事業用・トラック・バス・特種用途車・二輪車には対応していない
 * - 「13年経過」「18年経過」は新車新規登録(軽は初度検査)からの経過で判定する重課で、
 *   継続検査等のときに適用される。新車新規登録時には適用されない
 * - エコカー減税(75%・50%・25%軽減)は新車新規登録等のときの区分。継続検査等では
 *   免税か本則税率か当分の間税率のいずれかになる
 * - 車両重量は0.5トン(500kg)ごとに切り上げて段数を数える(0.5トン以下=1段、最大6段=3トン)
 */
(function (global) {
  "use strict";

  var MAX_WEIGHT_KG = 3000; // 乗用車の税額表は3トンまで
  var STEP_KG = 500;
  var MAX_STEP = 6;

  // 1年・1段(0.5トン)あたりの単価(円)
  var RATE_PER_YEAR = {
    passenger: { standard: 2500, normal: 4100, over13: 5700, over18: 6300 },
    kei: { standard: 2500, normal: 3300, over13: 4100, over18: 4400 }
  };

  // 区分ごとの「本則税率に対する係数」。normal/over13/over18 は別単価を使う
  var REDUCTION = { exempt: 0, reduce75: 0.25, reduce50: 0.50, reduce25: 0.75, standard: 1 };

  var GRADES = ["exempt", "reduce75", "reduce50", "reduce25", "standard", "normal", "over13", "over18"];
  var YEARS = [1, 2, 3];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 車両重量から税額表の段数(0.5トンきざみ)を求める。
   * @param {number} weightKg 車両重量(kg。1〜3000)
   * @returns {number} 段数(1〜6)。0.5トン以下は1、2.6トンなら6
   */
  function weightStep(weightKg) {
    return Math.min(MAX_STEP, Math.max(1, Math.ceil(weightKg / STEP_KG)));
  }

  /**
   * 自動車重量税額を計算する。
   * @param {number} weightKg 車両重量(kg。1〜3000。軽自動車のときは無視される)
   * @param {number} years 車検の有効期間(年。1・2・3のいずれか。新車の乗用車は3、継続検査は2)
   * @param {"exempt"|"reduce75"|"reduce50"|"reduce25"|"standard"|"normal"|"over13"|"over18"} grade
   *   exempt   : エコカー減税で免税
   *   reduce75 : 本則税率から75%軽減(新車新規登録等のみ)
   *   reduce50 : 本則税率から50%軽減(新車新規登録等のみ)
   *   reduce25 : 本則税率から25%軽減(新車新規登録等のみ)
   *   standard : 本則税率(エコカー)
   *   normal   : 当分の間税率(エコカー以外・13年未満)
   *   over13   : 当分の間税率(13年経過)
   *   over18   : 当分の間税率(18年経過)
   * @param {boolean} [isKei] 検査対象軽自動車(二輪を除く)なら true
   * @returns {{ok:true, taxYen:number, step:number, baseYen:number, perYearYen:number}
   *          |{ok:false, code:"invalid_weight"|"invalid_years"|"invalid_grade"}}
   *   baseYen: 軽減前の税額(本則税率または当分の間税率の額)
   *   perYearYen: 適用した1年あたりの単価(軽自動車は1台あたり、乗用車は0.5トンあたり)
   *   丸め: 軽減後の税額は100円未満を切り捨てる(税額表と同じ)
   */
  function calculate(weightKg, years, grade, isKei) {
    var kei = isKei === true;
    if (!kei && (!isFiniteNumber(weightKg) || weightKg <= 0 || weightKg > MAX_WEIGHT_KG)) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!isFiniteNumber(years) || YEARS.indexOf(years) < 0) {
      return { ok: false, code: "invalid_years" };
    }
    if (typeof grade !== "string" || GRADES.indexOf(grade) < 0) {
      return { ok: false, code: "invalid_grade" };
    }

    var rates = kei ? RATE_PER_YEAR.kei : RATE_PER_YEAR.passenger;
    var step = kei ? 1 : weightStep(weightKg);

    var perYear;
    var factor;
    if (grade === "normal" || grade === "over13" || grade === "over18") {
      perYear = rates[grade];
      factor = 1;
    } else {
      perYear = rates.standard;
      factor = REDUCTION[grade];
    }

    var base = perYear * step * years;
    var tax = Math.floor((base * factor) / 100) * 100;
    return {
      ok: true,
      taxYen: tax,
      step: step,
      baseYen: base,
      perYearYen: perYear
    };
  }

  /**
   * 初度登録(軽は初度検査)からの経過年数から、継続検査時に適用される重課区分を返す。
   * @param {number} elapsedYears 初度登録からの経過年数(0以上100以下)
   * @returns {{ok:true, grade:"normal"|"over13"|"over18"}|{ok:false, code:"invalid_elapsed"}}
   */
  function gradeByAge(elapsedYears) {
    if (!isFiniteNumber(elapsedYears) || elapsedYears < 0 || elapsedYears > 100) {
      return { ok: false, code: "invalid_elapsed" };
    }
    if (elapsedYears >= 18) return { ok: true, grade: "over18" };
    if (elapsedYears >= 13) return { ok: true, grade: "over13" };
    return { ok: true, grade: "normal" };
  }

  var api = {
    weightStep: weightStep,
    calculate: calculate,
    gradeByAge: gradeByAge
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JuryozeiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
