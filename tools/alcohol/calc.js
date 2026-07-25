/*
 * 純アルコール量 計算ロジック
 *
 * 計算式の根拠(一次情報):
 * - 純アルコール量(g) = 摂取量(mL) × アルコール度数(%)/100 × 0.8(アルコールの比重)
 *   出典: 厚生労働省 e-ヘルスネット「飲酒量の単位」(健康日本21アクション支援システム)
 *   https://kennet.mhlw.go.jp/information/information/alcohol/a-02-001.html
 * - 生活習慣病のリスクを高める飲酒量: 1日あたり純アルコール 男性40g以上・女性20g以上
 *   出典: 厚生労働省「健康に配慮した飲酒に関するガイドライン」(2024)
 *   https://www.mhlw.go.jp/stf/newpage_38541.html
 *
 * 前提:
 * - 判定は「表示値(小数第1位に四捨五入した純アルコール量)」に対して行う
 * - ドリンク数は国際的に用いられる 1ドリンク=純アルコール10g で換算
 */
(function (global) {
  "use strict";

  var VOLUME_MIN_ML = 1;
  var VOLUME_MAX_ML = 10000;
  var ABV_MIN = 0.1;
  var ABV_MAX = 96;
  var RISK_THRESHOLD_G = { male: 40, female: 20 };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 純アルコール量を計算する。
   * @param {number} volumeMl 摂取量(mL)
   * @param {number} abvPercent アルコール度数(%)
   * @param {string} sex "male" | "female"(リスク判定の閾値に使用)
   * @returns {{ok: true, grams: number, drinks: number, exceedsRisk: boolean}
   *          |{ok: false, code: string}}
   *   code: "invalid_volume" | "invalid_abv" | "invalid_sex"
   */
  function calculate(volumeMl, abvPercent, sex) {
    if (!isFiniteNumber(volumeMl) || volumeMl < VOLUME_MIN_ML || volumeMl > VOLUME_MAX_ML) {
      return { ok: false, code: "invalid_volume" };
    }
    if (!isFiniteNumber(abvPercent) || abvPercent < ABV_MIN || abvPercent > ABV_MAX) {
      return { ok: false, code: "invalid_abv" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var grams = round1(volumeMl * (abvPercent / 100) * 0.8);
    return {
      ok: true,
      grams: grams,
      drinks: round1(grams / 10),
      exceedsRisk: grams >= RISK_THRESHOLD_G[sex]
    };
  }

  /**
   * 複数のお酒の純アルコール量を合計する。
   * 各行: 量(mL) × 度数(%)/100 × 0.8(本体と同じ式)。
   * 丸め方針: 各行のgは計算のまま合算し、合計gとドリンク数を小数第1位に四捨五入。
   * @param {Array<{ml:number, abv:number}>} items お酒のリスト(1〜5件)
   * @returns {{ok:true, grams:number, drinks:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_items" | "invalid_volume" | "invalid_abv"
   */
  function totalDrinks(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 5) {
      return { ok: false, code: "invalid_items" };
    }
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !isFiniteNumber(it.ml) || it.ml < VOLUME_MIN_ML || it.ml > VOLUME_MAX_ML) {
        return { ok: false, code: "invalid_volume" };
      }
      if (!isFiniteNumber(it.abv) || it.abv < ABV_MIN || it.abv > ABV_MAX) {
        return { ok: false, code: "invalid_abv" };
      }
      sum += it.ml * (it.abv / 100) * 0.8;
    }
    return {
      ok: true,
      grams: round1(sum),
      drinks: round1(sum / 10)
    };
  }

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
   * アルコールの分解にかかるおおよその時間を計算する。
   * 分解速度は体重1kgあたり約0.1g/時(広く使われる目安。体質・体調による個人差が大きく、
   * 同じ人でも日によって変わる)。時間 = 純アルコールg ÷ (体重kg × 0.1)。
   * 丸め方針: 時間・分解速度は小数第1位に四捨五入。
   * 飲み終わりの時刻(HH:MM)を渡すと、分解が終わるおおよその時刻も返す。
   * この結果は目安であり、運転可否の判断には使えない。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} gramsAlcohol 純アルコール量(g・1〜500)
   * @param {string} [endTime] 飲み終わりの時刻 "HH:MM"(任意)
   * @returns {{ok:true, hours:number, rateGPerHour:number, finishTime?:string, nextDay?:boolean}
   *          |{ok:false, code:string}}
   *   code: "invalid_weight" | "invalid_grams" | "invalid_end_time"
   */
  function breakdownTime(weightKg, gramsAlcohol, endTime) {
    if (!isFiniteNumber(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!isFiniteNumber(gramsAlcohol) || gramsAlcohol < 1 || gramsAlcohol > 500) {
      return { ok: false, code: "invalid_grams" };
    }
    var rate = weightKg * 0.1;
    var rawHours = gramsAlcohol / rate;
    var out = {
      ok: true,
      hours: round1(rawHours),
      rateGPerHour: round1(rate)
    };
    if (endTime !== undefined && endTime !== null && endTime !== "") {
      var end = parseHhmmAdv(endTime);
      if (end === null) return { ok: false, code: "invalid_end_time" };
      var endTotal = end + rawHours * 60;
      out.finishTime = fmtHhmmAdv(endTotal);
      out.nextDay = endTotal >= 1440;
    }
    return out;
  }

  var api = {
    breakdownTime: breakdownTime,
    totalDrinks: totalDrinks,
    calculate: calculate,
    VOLUME_MIN_ML: VOLUME_MIN_ML,
    VOLUME_MAX_ML: VOLUME_MAX_ML,
    ABV_MIN: ABV_MIN,
    ABV_MAX: ABV_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.AlcoholCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
