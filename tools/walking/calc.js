/*
 * ウォーキング消費カロリー計算ロジック(METs方式)
 *
 * 計算方法:
 * - 消費エネルギー(kcal) = 1.05 × METs × 時間(h) × 体重(kg)
 *   (厚生労働省「健康づくりのための運動指針2006(エクササイズガイド)」の式)
 * - 歩く速さごとのMETs値は「身体活動のメッツ(METs)表」(国立健康・栄養研究所)より:
 *   ゆっくり(約3.2km/h)=2.8 / ふつう(約4.0km/h)=3.0 / やや速め(約4.8km/h)=3.5 /
 *   速歩(約5.6km/h)=4.3 / かなり速い(約6.4km/h)=5.0
 * - 脂肪換算は体脂肪1kg≒7,200kcalの目安で計算(e-ヘルスネット)
 */
(function (global) {
  "use strict";

  var METS = {
    slow: 2.8,
    normal: 3.0,
    brisk: 3.5,
    fast: 4.3,
    veryfast: 5.0
  };

  /**
   * ウォーキングの消費カロリーを計算する。
   * @param {number} weightKg 体重(kg)
   * @param {number} minutes 歩いた時間(分)
   * @param {string} speed 歩く速さ "slow"|"normal"|"brisk"|"fast"|"veryfast"
   * @returns {{ok: true, kcal: number, fatG: number, mets: number}
   *          |{ok: false, code: string}}
   *   kcal: 消費エネルギー(kcal) / fatG: 脂肪換算(g) / mets: 使用したMETs値
   *   code: "invalid_weight" | "invalid_minutes" | "invalid_speed"
   */
  function calories(weightKg, minutes, speed) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return { ok: false, code: "invalid_minutes" };
    }
    if (!Object.prototype.hasOwnProperty.call(METS, speed)) {
      return { ok: false, code: "invalid_speed" };
    }
    var mets = METS[speed];
    var raw = 1.05 * mets * (minutes / 60) * weightKg;
    return {
      ok: true,
      kcal: Math.round(raw),
      fatG: Math.round(raw / 7.2),
      mets: mets
    };
  }

  // 速さ区分ごとの代表速度(km/h)。METs表の区分(画面の表記)と同じ値
  var SPEED_KMH_ADV = { slow: 3.2, normal: 4.0, brisk: 4.8, fast: 5.6, veryfast: 6.4 };

  /**
   * 目標消費カロリーに必要な歩行時間を逆算する。
   * 式: 時間(h) = 目標kcal ÷ (1.05 × METs × 体重kg)(本体と同じ厚労省の式の逆算)
   * 丸め方針: 分は切り上げ(その時間歩けば目標に届くことを示すため)。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} targetKcal 目標消費カロリー(kcal・1〜5000)
   * @param {string} speed 歩く速さ "slow"|"normal"|"brisk"|"fast"|"veryfast"
   * @returns {{ok:true, minutes:number, mets:number, kcalPerHour:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_weight" | "invalid_kcal" | "invalid_speed"
   */
  function minutesForKcal(weightKg, targetKcal, speed) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof targetKcal !== "number" || !isFinite(targetKcal) || targetKcal <= 0 || targetKcal > 5000) {
      return { ok: false, code: "invalid_kcal" };
    }
    if (!Object.prototype.hasOwnProperty.call(METS, speed)) {
      return { ok: false, code: "invalid_speed" };
    }
    var perHour = 1.05 * METS[speed] * weightKg;
    return {
      ok: true,
      minutes: Math.ceil(targetKcal / perHour * 60),
      mets: METS[speed],
      kcalPerHour: Math.round(perHour)
    };
  }

  /**
   * 歩いた距離から時間と消費カロリーを計算する。
   * 速さ区分の代表速度(km/h)で 時間 = 距離 ÷ 速度 とし、
   * 消費エネルギー = 1.05 × METs × 時間(h) × 体重(kg)。脂肪換算は1kg≒7,200kcalの目安。
   * 丸め方針: 分・kcal・脂肪gは整数に四捨五入。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} km 歩いた距離(km・0.1〜100)
   * @param {string} speed 歩く速さ
   * @returns {{ok:true, minutes:number, kcal:number, fatG:number, kmh:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_weight" | "invalid_distance" | "invalid_speed"
   */
  function caloriesByDistance(weightKg, km, speed) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof km !== "number" || !isFinite(km) || km < 0.1 || km > 100) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!Object.prototype.hasOwnProperty.call(METS, speed)) {
      return { ok: false, code: "invalid_speed" };
    }
    var hours = km / SPEED_KMH_ADV[speed];
    var raw = 1.05 * METS[speed] * hours * weightKg;
    return {
      ok: true,
      minutes: Math.round(hours * 60),
      kcal: Math.round(raw),
      fatG: Math.round(raw / 7.2),
      kmh: SPEED_KMH_ADV[speed]
    };
  }

  /**
   * 毎日の歩行習慣を続けたときの合計消費カロリーと脂肪換算を計算する。
   * 脂肪換算は体脂肪1kg≒7,200kcalの目安。食事が変わらない前提の概算で、
   * 実際の体重変化は個人差が大きい。
   * 丸め方針: kcal・脂肪gは整数に四捨五入。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} minutesPerDay 1日の歩行時間(分・1〜1440)
   * @param {string} speed 歩く速さ
   * @param {number} days 続ける日数(1〜365)
   * @returns {{ok:true, kcalPerDay:number, totalKcal:number, fatG:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_weight" | "invalid_minutes" | "invalid_speed" | "invalid_days"
   */
  function habitTotal(weightKg, minutesPerDay, speed, days) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof minutesPerDay !== "number" || !isFinite(minutesPerDay) || minutesPerDay < 1 || minutesPerDay > 1440) {
      return { ok: false, code: "invalid_minutes" };
    }
    if (!Object.prototype.hasOwnProperty.call(METS, speed)) {
      return { ok: false, code: "invalid_speed" };
    }
    if (typeof days !== "number" || !isFinite(days) || days < 1 || days > 365) {
      return { ok: false, code: "invalid_days" };
    }
    var rawPerDay = 1.05 * METS[speed] * (minutesPerDay / 60) * weightKg;
    var rawTotal = rawPerDay * days;
    return {
      ok: true,
      kcalPerDay: Math.round(rawPerDay),
      totalKcal: Math.round(rawTotal),
      fatG: Math.round(rawTotal / 7.2)
    };
  }

  var api = {
    habitTotal: habitTotal,
    caloriesByDistance: caloriesByDistance,
    minutesForKcal: minutesForKcal,
    calories: calories,
    METS: METS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WalkingCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
