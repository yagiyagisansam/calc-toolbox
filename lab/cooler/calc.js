/*
 * クーラーボックスの保冷剤・氷の必要量 計算ロジック
 *
 * 根拠:
 * - アウトドアギア解説「クーラーボックスに入れる保冷剤の量の目安」(RANK KING、2025年4月1日更新)
 *   https://outdoor.rank-king.jp/article/727 (2026年7月29日参照)
 *   ・一般的な目安: 「保冷剤の量はクーラーボックスの1/4程度を目安」
 *   ・釣りの場合の目安: 「クーラーボックスのリットル数×100g」
 *
 * 前提:
 * - 上記の出典に「泊数による倍率」「外気温による倍率」の記載はない。
 *   本ツールの泊数計算は「1日ごとに同じ量を補充する」と考えた単純合計であり、出典の数値ではない。
 *   外気温は数値を変えず、注意点の表示にだけ使う。
 * - 保冷剤・氷の体積は、密度を水と同じ(1g = 1cm³ = 0.001L)として重さから換算する
 * - 断熱性能(真空断熱パネル・発泡ウレタンなど)、予冷の有無、開閉回数は考慮しない目安
 */
(function (global) {
  "use strict";

  var GRAM_PER_LITER = 100; // 出典: 容量(L) × 100g
  var QUARTER = 0.25; // 出典: 容量の1/4程度

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  function checkCapacity(capacityL) {
    return isFiniteNumber(capacityL) && capacityL > 0 && capacityL <= 1000;
  }

  /**
   * 「容量(L)×100g」の目安で保冷剤の量を求める。
   * @param {number} capacityL クーラーボックスの容量(L)。0超〜1000
   * @param {number} [days=1] 保冷したい日数(日)。1〜30。1日ごとに同量を補充する前提の単純合計
   * @returns {{ok:true, gramPerDay:number, totalGram:number, volumeL:number, days:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_days"}}
   *   volumeL は密度1g/cm³として換算した体積(L、小数第1位で四捨五入)。
   */
  function coolantByWeight(capacityL, days) {
    var d = days === undefined ? 1 : days;
    if (!checkCapacity(capacityL)) return { ok: false, code: "invalid_capacity" };
    if (!isFiniteNumber(d) || d < 1 || d > 30) return { ok: false, code: "invalid_days" };
    var perDay = capacityL * GRAM_PER_LITER;
    var total = perDay * d;
    return {
      ok: true,
      gramPerDay: Math.round(perDay),
      totalGram: Math.round(total),
      volumeL: round1(total / 1000),
      days: Math.floor(d)
    };
  }

  /**
   * 「容量の1/4程度」の目安で保冷剤の量を求める。
   * @param {number} capacityL クーラーボックスの容量(L)。0超〜1000
   * @returns {{ok:true, volumeL:number, gram:number}|{ok:false, code:"invalid_capacity"}}
   *   volumeL は小数第1位、gram は整数で四捨五入。
   */
  function coolantByQuarter(capacityL) {
    if (!checkCapacity(capacityL)) return { ok: false, code: "invalid_capacity" };
    var vol = capacityL * QUARTER;
    return { ok: true, volumeL: round1(vol), gram: Math.round(vol * 1000) };
  }

  /**
   * 保冷剤と食材を入れたときの空き容量を求める。
   * @param {number} capacityL クーラーボックスの容量(L)。0超〜1000
   * @param {number} coolantVolumeL 保冷剤・氷の体積(L)。0〜1000
   * @param {number} foodL 食材・飲み物の体積(L)。0〜1000
   * @returns {{ok:true, usedL:number, remainL:number, fits:boolean, usageRate:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_coolant"|"invalid_food"}}
   *   remainL は残りの容量(L、マイナスなら入りきらない)。usageRate は使用率(%、小数第1位)。
   */
  function space(capacityL, coolantVolumeL, foodL) {
    if (!checkCapacity(capacityL)) return { ok: false, code: "invalid_capacity" };
    if (!isFiniteNumber(coolantVolumeL) || coolantVolumeL < 0 || coolantVolumeL > 1000) {
      return { ok: false, code: "invalid_coolant" };
    }
    if (!isFiniteNumber(foodL) || foodL < 0 || foodL > 1000) return { ok: false, code: "invalid_food" };
    var used = coolantVolumeL + foodL;
    return {
      ok: true,
      usedL: round1(used),
      remainL: round1(capacityL - used),
      fits: used <= capacityL,
      usageRate: round1((used / capacityL) * 100)
    };
  }

  /**
   * 容量・泊数・食材の量から、保冷剤の量と空き容量をまとめて求める。
   * @param {number} capacityL クーラーボックスの容量(L)。0超〜1000
   * @param {number} nights 泊数(泊)。0〜29(0なら日帰り=1日)
   * @param {number} foodL 食材・飲み物の体積(L)。0〜1000
   * @param {"weight"|"quarter"} [basis="weight"] 目安の取り方
   *   "weight"=容量×100g/日 / "quarter"=容量の1/4(泊数によらない)
   * @returns {{ok:true, days:number, coolantGram:number, coolantVolumeL:number,
   *            usedL:number, remainL:number, fits:boolean, usageRate:number, basis:string}
   *          |{ok:false, code:string}}
   */
  function plan(capacityL, nights, foodL, basis) {
    var b = basis === undefined ? "weight" : basis;
    if (b !== "weight" && b !== "quarter") return { ok: false, code: "invalid_basis" };
    if (!checkCapacity(capacityL)) return { ok: false, code: "invalid_capacity" };
    if (!isFiniteNumber(nights) || nights < 0 || nights > 29) return { ok: false, code: "invalid_nights" };
    var days = Math.floor(nights) + 1;
    var coolantGram, coolantVolumeL;
    if (b === "weight") {
      var w = coolantByWeight(capacityL, days);
      if (!w.ok) return w;
      coolantGram = w.totalGram;
      coolantVolumeL = w.volumeL;
    } else {
      var q = coolantByQuarter(capacityL);
      if (!q.ok) return q;
      coolantGram = q.gram;
      coolantVolumeL = q.volumeL;
    }
    var s = space(capacityL, coolantVolumeL, foodL);
    if (!s.ok) return s;
    return {
      ok: true,
      days: days,
      basis: b,
      coolantGram: coolantGram,
      coolantVolumeL: coolantVolumeL,
      usedL: s.usedL,
      remainL: s.remainL,
      fits: s.fits,
      usageRate: s.usageRate
    };
  }

  /**
   * 外気温を4段階に区分する(表示する注意点の出し分けに使う。必要量は変えない)。
   * @param {number} tempC 外気温(℃)。-30〜60
   * @returns {{ok:true, key:"mild"|"warm"|"hot"|"very_hot"}|{ok:false, code:"invalid_temp"}}
   *   mild=25℃未満 / warm=25℃以上30℃未満 / hot=30℃以上35℃未満 / very_hot=35℃以上
   */
  function temperatureBand(tempC) {
    if (!isFiniteNumber(tempC) || tempC < -30 || tempC > 60) return { ok: false, code: "invalid_temp" };
    if (tempC >= 35) return { ok: true, key: "very_hot" };
    if (tempC >= 30) return { ok: true, key: "hot" };
    if (tempC >= 25) return { ok: true, key: "warm" };
    return { ok: true, key: "mild" };
  }

  var api = {
    GRAM_PER_LITER: GRAM_PER_LITER,
    coolantByWeight: coolantByWeight,
    coolantByQuarter: coolantByQuarter,
    space: space,
    plan: plan,
    temperatureBand: temperatureBand
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CoolerCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
