/*
 * 運動別消費カロリー計算ロジック(METs方式)
 *
 * 計算方法:
 * - 消費エネルギー(kcal) = 1.05 × METs × 時間(h) × 体重(kg)(厚労省の運動指針の式)
 * - METs値は国立健康・栄養研究所「身体活動のメッツ(METs)表」(2011改訂版)より
 * - 脂肪換算は体脂肪1kg≒7,200kcalの目安
 */
(function (global) {
  "use strict";

  var ACTIVITIES = {
    jogging: { mets: 7.0, label: "ジョギング(全般)" },
    running: { mets: 8.3, label: "ランニング(8km/h)" },
    cycling: { mets: 6.8, label: "サイクリング(16〜19km/h)" },
    swim_crawl: { mets: 5.8, label: "水泳(クロール・ゆっくり)" },
    swim_breast: { mets: 5.3, label: "水泳(平泳ぎ・レジャー)" },
    tennis: { mets: 7.3, label: "テニス(全般)" },
    tabletennis: { mets: 4.0, label: "卓球" },
    golf: { mets: 4.8, label: "ゴルフ(全般)" },
    strength: { mets: 3.5, label: "筋トレ(自重・軽〜中強度)" },
    yoga: { mets: 2.5, label: "ヨガ(ハタヨガ)" },
    jumprope: { mets: 8.8, label: "なわとび(ゆっくり)" },
    radio: { mets: 4.0, label: "ラジオ体操第一" },
    hiking: { mets: 6.5, label: "山登り(軽い荷物)" }
  };

  /**
   * 運動の消費カロリーを計算する。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} minutes 時間(分・1〜600)
   * @param {string} activity 運動の種類(ACTIVITIESのキー)
   * @returns {{ok: true, kcal: number, fatG: number, mets: number, label: string}
   *          |{ok: false, code: string}}
   *   code: "invalid_weight" | "invalid_minutes" | "invalid_activity"
   */
  function calories(weightKg, minutes, activity) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes < 1 || minutes > 600) {
      return { ok: false, code: "invalid_minutes" };
    }
    if (!ACTIVITIES.hasOwnProperty(activity)) return { ok: false, code: "invalid_activity" };
    var a = ACTIVITIES[activity];
    var raw = 1.05 * a.mets * (minutes / 60) * weightKg;
    return {
      ok: true,
      kcal: Math.round(raw),
      fatG: Math.round(raw / 7.2),
      mets: a.mets,
      label: a.label
    };
  }

  /**
   * 複数の運動の合計消費カロリーを計算する。
   * 各種目: 1.05 × METs × 時間(h) × 体重(kg)(本体と同じ厚労省の式)。
   * 脂肪換算は体脂肪1kg≒7,200kcalの目安。
   * 丸め方針: 各種目・合計とも整数に四捨五入(合計は丸める前の値を合算してから丸める)。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {Array<{activity:string, minutes:number}>} items 種目と時間のリスト(1〜5件)
   * @returns {{ok:true, totalKcal:number, fatG:number,
   *            items:Array<{key:string, label:string, mets:number, minutes:number, kcal:number}>}
   *          |{ok:false, code:string}}
   *   code: "invalid_weight" | "invalid_items" | "invalid_activity" | "invalid_minutes"
   */
  function totalCalories(weightKg, items) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 5) {
      return { ok: false, code: "invalid_items" };
    }
    var sum = 0;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !ACTIVITIES.hasOwnProperty(it.activity)) return { ok: false, code: "invalid_activity" };
      if (typeof it.minutes !== "number" || !isFinite(it.minutes) || it.minutes < 1 || it.minutes > 600) {
        return { ok: false, code: "invalid_minutes" };
      }
      var a = ACTIVITIES[it.activity];
      var raw = 1.05 * a.mets * (it.minutes / 60) * weightKg;
      sum += raw;
      out.push({ key: it.activity, label: a.label, mets: a.mets, minutes: it.minutes, kcal: Math.round(raw) });
    }
    return {
      ok: true,
      totalKcal: Math.round(sum),
      fatG: Math.round(sum / 7.2),
      items: out
    };
  }

  /**
   * 目標消費カロリーに必要な時間を全種目まとめて計算する(種目選びの比較用)。
   * 式: 時間(h) = 目標kcal ÷ (1.05 × METs × 体重kg)
   * 丸め方針: 分は切り上げ(その時間で目標に届くことを示すため)。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {number} targetKcal 目標消費カロリー(kcal・1〜5000)
   * @returns {{ok:true, items:Array<{key:string, label:string, mets:number, minutes:number}>}
   *          |{ok:false, code:string}}  code: "invalid_weight" | "invalid_kcal"
   */
  function minutesForKcalAll(weightKg, targetKcal) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof targetKcal !== "number" || !isFinite(targetKcal) || targetKcal <= 0 || targetKcal > 5000) {
      return { ok: false, code: "invalid_kcal" };
    }
    var keys = Object.keys(ACTIVITIES);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var a = ACTIVITIES[keys[i]];
      out.push({
        key: keys[i],
        label: a.label,
        mets: a.mets,
        minutes: Math.ceil(targetKcal / (1.05 * a.mets * weightKg) * 60)
      });
    }
    return { ok: true, items: out };
  }

  var api = {
    minutesForKcalAll: minutesForKcalAll,
    totalCalories: totalCalories, calories: calories, ACTIVITIES: ACTIVITIES };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SportsCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
