/*
 * カフェイン摂取量計算ロジック
 *
 * 計算方法:
 * - 摂取量(mg) = Σ(飲み物のカフェイン濃度 mg/100ml × 量 ml ÷ 100)
 * - 濃度は日本食品標準成分表の浸出液の値等(コーヒー60・紅茶30・せん茶20・
 *   ほうじ茶20・ウーロン茶20・玉露160 mg/100ml、コーラ約10、エナジードリンクは製品差大)
 * - 目安: 健康な成人1日400mgまで(海外機関の評価)。妊娠中はより少なく(200〜300mg)
 */
(function (global) {
  "use strict";

  var DRINKS = {
    coffee: { per100: 60, label: "コーヒー(ドリップ)" },
    instant: { per100: 57, label: "インスタントコーヒー" },
    gyokuro: { per100: 160, label: "玉露" },
    sencha: { per100: 20, label: "緑茶(せん茶)" },
    hojicha: { per100: 20, label: "ほうじ茶" },
    oolong: { per100: 20, label: "ウーロン茶" },
    blacktea: { per100: 30, label: "紅茶" },
    cola: { per100: 10, label: "コーラ" },
    energy: { per100: 32, label: "エナジードリンク(製品差大)" },
    decaf: { per100: 1, label: "カフェインレスコーヒー" }
  };
  var LIMIT_ADULT = 400;
  var LIMIT_PREGNANT = 200;

  /**
   * カフェイン摂取量を合計する。
   * @param {Array<{drink: string, ml: number}>} items 飲んだもののリスト(1〜20件)
   * @returns {{ok: true, totalMg: number, pctAdult: number, pctPregnant: number}
   *          |{ok: false, code: string}}
   *   pctAdult: 成人の目安400mgに対する% / pctPregnant: 200mgに対する%
   *   code: "invalid_items" | "invalid_drink" | "invalid_ml"
   */
  function total(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      return { ok: false, code: "invalid_items" };
    }
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !DRINKS.hasOwnProperty(it.drink)) return { ok: false, code: "invalid_drink" };
      if (typeof it.ml !== "number" || !isFinite(it.ml) || it.ml <= 0 || it.ml > 5000) {
        return { ok: false, code: "invalid_ml" };
      }
      sum += DRINKS[it.drink].per100 * it.ml / 100;
    }
    return {
      ok: true,
      totalMg: Math.round(sum),
      pctAdult: Math.round(sum / LIMIT_ADULT * 100),
      pctPregnant: Math.round(sum / LIMIT_PREGNANT * 100)
    };
  }

  // 詳細機能用の前提: カフェインの半減期は約5時間(健康な成人の一般的な平均値。
  // 実際は2.5〜10時間程度と個人差が大きい)。1杯はドリップコーヒー150ml(60mg/100ml)≒90mg
  var HALF_LIFE_H_ADV = 5;
  var CUP_MG_ADV = 90;
  var SLEEP_AFFECT_MG = 100;

  function parseHhmmAdv(hhmm) {
    if (typeof hhmm !== "string" || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    var h = parseInt(hhmm.split(":")[0], 10);
    var m = parseInt(hhmm.split(":")[1], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  function fmtHhmmAdv(totalMin) {
    var m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return (h < 10 ? "0" + h : "" + h) + ":" + (mm < 10 ? "0" + mm : "" + mm);
  }

  /**
   * コーヒーを飲んだ時刻・杯数から、就寝時に体内に残るカフェイン量を計算する。
   * 半減期約5時間(一般的な平均値・個人差大)として 残量 = 摂取量 × 0.5^(経過時間÷5)。
   * 1杯はドリップコーヒー150ml≒90mgで計算。就寝時刻が飲む時刻より前なら翌日の就寝とみなす。
   * 100mg以上残ると眠りに影響しやすいという目安で affectSleep を返す。
   * 丸め方針: mgは整数、時間は小数第1位に四捨五入。
   * @param {string} drinkTime 飲む時刻 "HH:MM"
   * @param {string} bedTime 就寝予定時刻 "HH:MM"
   * @param {number} cups コーヒーの杯数(1〜10・整数)
   * @returns {{ok:true, intakeMg:number, hoursUntilBed:number, remainingMg:number,
   *            affectSleep:boolean}
   *          |{ok:false, code:string}}
   *   code: "invalid_drink_time" | "invalid_bed_time" | "invalid_cups"
   */
  function remainingAtBed(drinkTime, bedTime, cups) {
    var d = parseHhmmAdv(drinkTime);
    if (d === null) return { ok: false, code: "invalid_drink_time" };
    var b = parseHhmmAdv(bedTime);
    if (b === null) return { ok: false, code: "invalid_bed_time" };
    if (typeof cups !== "number" || !isFinite(cups) || cups !== Math.floor(cups) || cups < 1 || cups > 10) {
      return { ok: false, code: "invalid_cups" };
    }
    var mins = ((b - d) % 1440 + 1440) % 1440;
    var hours = mins / 60;
    var intake = cups * CUP_MG_ADV;
    var remMg = Math.round(intake * Math.pow(0.5, hours / HALF_LIFE_H_ADV));
    return {
      ok: true,
      intakeMg: intake,
      hoursUntilBed: Math.round(hours * 10) / 10,
      remainingMg: remMg,
      affectSleep: remMg >= SLEEP_AFFECT_MG
    };
  }

  /**
   * 就寝時に残るカフェインを100mg未満にするための「最後の1杯の時刻」を逆算する。
   * 必要な間隔 = 5時間 × log2(摂取量mg ÷ 100)。摂取量が100mg以下なら制限なし(anytime)。
   * 前提(半減期・1杯の量)は remainingAtBed と同じ。
   * 丸め方針: 時間は小数第1位、時刻は分単位に四捨五入。
   * @param {string} bedTime 就寝予定時刻 "HH:MM"
   * @param {number} cups コーヒーの杯数(1〜10・整数)
   * @returns {{ok:true, anytime:true, intakeMg:number}
   *          |{ok:true, anytime:false, intakeMg:number, hoursBefore:number, latestTime:string}
   *          |{ok:false, code:string}}  code: "invalid_bed_time" | "invalid_cups"
   */
  function lastCupTime(bedTime, cups) {
    var b = parseHhmmAdv(bedTime);
    if (b === null) return { ok: false, code: "invalid_bed_time" };
    if (typeof cups !== "number" || !isFinite(cups) || cups !== Math.floor(cups) || cups < 1 || cups > 10) {
      return { ok: false, code: "invalid_cups" };
    }
    var intake = cups * CUP_MG_ADV;
    if (intake <= SLEEP_AFFECT_MG) {
      return { ok: true, anytime: true, intakeMg: intake };
    }
    var hoursBefore = HALF_LIFE_H_ADV * Math.log2(intake / SLEEP_AFFECT_MG);
    return {
      ok: true,
      anytime: false,
      intakeMg: intake,
      hoursBefore: Math.round(hoursBefore * 10) / 10,
      latestTime: fmtHhmmAdv(b - hoursBefore * 60)
    };
  }

  var api = {
    lastCupTime: lastCupTime,
    remainingAtBed: remainingAtBed, total: total, DRINKS: DRINKS, LIMIT_ADULT: LIMIT_ADULT, LIMIT_PREGNANT: LIMIT_PREGNANT };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.CaffeineCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
