/*
 * メッツ(METs)による消費エネルギーと身体活動量の計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「健康づくりのための運動指針2006(エクササイズガイド2006)」参考資料
 *   「１ｴｸｻｻｲｽﾞの身体活動量に相当するエネルギー消費量」
 *   簡易換算式: エネルギー消費量(kcal) ＝ 1.05 × ｴｸｻｻｲｽﾞ(ﾒｯﾂ・時) × 体重(kg)
 *   ※「安静時のエネルギー消費量も含めた総エネルギー消費量」と明記されている
 *   https://www.mhlw.go.jp/shingi/2006/07/dl/s0725-9f-4.pdf (2026年7月29日参照)
 * - 厚生労働省「健康づくりのための身体活動・運動ガイド2023」(令和6年1月)
 *   「強度が３メッツ以上の身体活動を週23メッツ・時以上行うことを推奨する」
 *   https://www.mhlw.go.jp/content/001194020.pdf (2026年7月29日参照)
 * - 厚生労働省 e-ヘルスネット「メッツ / METs」
 *   「安静座位時を1とした時と比較して何倍のエネルギーを消費するか」(立位≒2、歩行≒3、ジョギング≒6)
 *   https://kennet.mhlw.go.jp/information/information/dictionary/exercise/ys-004.html (2026年7月29日参照)
 *
 * 制度・基準の時点:
 * - 週23メッツ・時の推奨値は「健康づくりのための身体活動・運動ガイド2023」(令和6年1月公表)による。
 *   これは「健康づくりのための身体活動基準2013」の推奨値を引き継いだもの。
 *
 * 前提:
 * - kcal は安静時の消費分を含む総エネルギー消費量。ダイエットで「運動によって余分に消費した分」を
 *   見たい場合は netKcal(安静時1メッツ分を差し引いた値)を使う。
 * - netKcal は上記の簡易換算式から 1.05 × (メッツ − 1) × 時間 × 体重 として導いた派生値。
 *   メッツが1未満のときは0とする。
 * - 週の推奨値(23メッツ・時)の対象になるのは強度3メッツ以上の身体活動のみ。
 *
 * 丸め:
 * - メッツ・時は小数第2位、kcal は小数第1位に四捨五入する(表示のための丸め)。
 */
(function (global) {
  "use strict";

  var COEF = 1.05;          // エクササイズガイド2006の簡易換算式の係数
  var GUIDELINE_METS = 3;   // 週23メッツ・時の対象となる下限強度
  var GUIDELINE_WEEKLY = 23; // 推奨する週の身体活動量(メッツ・時)

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  function validate(mets, minutes, weightKg) {
    if (!isNum(mets) || mets < 0.5 || mets > 30) return { ok: false, code: "invalid_mets" };
    if (!isNum(minutes) || minutes <= 0 || minutes > 1440) return { ok: false, code: "invalid_minutes" };
    if (!isNum(weightKg) || weightKg <= 0 || weightKg > 300) return { ok: false, code: "invalid_weight" };
    return { ok: true };
  }

  /**
   * 1回の運動の身体活動量(メッツ・時)と消費エネルギー(kcal)を求める。
   * @param {number} mets メッツ値(運動の強度)。0.5〜30
   * @param {number} minutes 運動時間(分)。0より大きく1440以下
   * @param {number} weightKg 体重(kg)。0より大きく300以下
   * @returns {{ok:true, hours:number, exerciseMetsHour:number, kcal:number, netKcal:number}
   *          |{ok:false, code:"invalid_mets"|"invalid_minutes"|"invalid_weight"}}
   *   exerciseMetsHour = メッツ × 時間(小数第2位)。kcal は安静時分を含む総消費(小数第1位)。
   *   netKcal は安静時1メッツ分を差し引いた値(小数第1位、0未満は0)。
   */
  function calculate(mets, minutes, weightKg) {
    var v = validate(mets, minutes, weightKg);
    if (!v.ok) return v;
    var hours = minutes / 60;
    var ex = mets * hours;
    var kcal = COEF * ex * weightKg;
    var net = COEF * Math.max(0, mets - 1) * hours * weightKg;
    return {
      ok: true,
      hours: round2(hours),
      exerciseMetsHour: round2(ex),
      kcal: round1(kcal),
      netKcal: round1(net)
    };
  }

  /**
   * 1週間の身体活動量(メッツ・時/週)を求め、推奨値(週23メッツ・時)と比べる。
   * @param {number} mets メッツ値(運動の強度)
   * @param {number} minutes 1回あたりの運動時間(分)
   * @param {number} timesPerWeek 週の実施回数。1〜7の整数でなくてもよいが0より大きく50以下
   * @returns {{ok:true, weeklyMetsHour:number, countsForGuideline:boolean,
   *            meetsGuideline:boolean, shortfallMetsHour:number}
   *          |{ok:false, code:"invalid_mets"|"invalid_minutes"|"invalid_times"}}
   *   countsForGuideline は強度が3メッツ以上かどうか(3メッツ未満は推奨値の対象外)。
   *   shortfallMetsHour は週23メッツ・時に足りない量(達成していれば0)。
   */
  function weekly(mets, minutes, timesPerWeek) {
    if (!isNum(mets) || mets < 0.5 || mets > 30) return { ok: false, code: "invalid_mets" };
    if (!isNum(minutes) || minutes <= 0 || minutes > 1440) return { ok: false, code: "invalid_minutes" };
    if (!isNum(timesPerWeek) || timesPerWeek <= 0 || timesPerWeek > 50) return { ok: false, code: "invalid_times" };

    var w = round2(mets * (minutes / 60) * timesPerWeek);
    var counts = mets >= GUIDELINE_METS;
    var meets = counts && w >= GUIDELINE_WEEKLY;
    return {
      ok: true,
      weeklyMetsHour: w,
      countsForGuideline: counts,
      meetsGuideline: meets,
      shortfallMetsHour: counts ? Math.max(0, round2(GUIDELINE_WEEKLY - w)) : GUIDELINE_WEEKLY
    };
  }

  /**
   * 1回分と1週間分をまとめて求める。
   * @param {number} mets メッツ値
   * @param {number} minutes 1回あたりの運動時間(分)
   * @param {number} weightKg 体重(kg)
   * @param {number} timesPerWeek 週の実施回数
   * @returns {{ok:true, per:object, week:object, weeklyKcal:number}|{ok:false, code:string}}
   *   weeklyKcal は1回分の総消費エネルギー × 週の回数(小数第1位)。
   */
  function summary(mets, minutes, weightKg, timesPerWeek) {
    var per = calculate(mets, minutes, weightKg);
    if (!per.ok) return per;
    var w = weekly(mets, minutes, timesPerWeek);
    if (!w.ok) return w;
    return {
      ok: true,
      per: per,
      week: w,
      weeklyKcal: round1(COEF * mets * (minutes / 60) * weightKg * timesPerWeek)
    };
  }

  var api = {
    calculate: calculate,
    weekly: weekly,
    summary: summary
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.MetsCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
