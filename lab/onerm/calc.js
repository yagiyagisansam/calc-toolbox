/*
 * 1RM(最大挙上重量)推定の計算ロジック
 *
 * 根拠:
 * - Omni Calculator "One-Rep Max Calculator"(Epley式の記載)
 *   https://www.omnicalculator.com/sports/one-rep-max (2026年7月29日参照)
 *   ・Epley式: 1RM = w ×(1 + r/30)
 * - Brzycki, M.(1993)"Strength testing - predicting a one-rep max from reps-to-fatigue",
 *   Journal of Physical Education, Recreation & Dance (JOPERD)
 *   ・Brzycki式: 1RM = w ÷(1.0278 − 0.0278 × r)
 *     この式は 1.0278 =37/36、0.0278 =1/36 なので 1RM = w × 36 ÷(37 − r)と同じ。
 *
 * 前提:
 * - 「限界まで(これ以上挙げられない回数まで)挙げた」セットの記録から推定する式である。
 *   余力を残したセットでは実際の1RMより低く出る。
 * - 反復回数が1回のときは、挙げた重量そのものが1RMなので、両式とも w を返す
 *  (Epley式をそのまま当てはめると w×31/30 になってしまうため、1回のときだけ特別扱いする)。
 * - どちらの式も推定値であり、実測の1RMとは数kgの差が出る。回数が多いほど誤差は大きくなる。
 *   Brzycki式は反復回数が37回で分母が0になるため、本ツールは回数を30回までに制限する。
 * - 重量の丸めは小数第1位(0.1kg)。%換算は小数第2位。
 */
(function (global) {
  "use strict";

  var WEIGHT_MIN = 1;
  var WEIGHT_MAX = 1000;
  var REPS_MIN = 1;
  var REPS_MAX = 30;
  var LOW_CONFIDENCE_REPS = 12; // これを超えると推定の誤差が大きくなる
  var FORMULAS = ["epley", "brzycki"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  function validate(weight, reps) {
    if (!isFiniteNumber(weight) || weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!isFiniteNumber(reps) || reps !== Math.floor(reps) || reps < REPS_MIN || reps > REPS_MAX) {
      return { ok: false, code: "invalid_reps" };
    }
    return { ok: true };
  }

  /** 1RMに対する倍率。reps=1 のときは 1(挙げた重量がそのまま1RM) */
  function factor(formula, reps) {
    if (reps === 1) return 1;
    if (formula === "brzycki") return 36 / (37 - reps);
    return 1 + reps / 30; // epley
  }

  /**
   * 挙上重量と反復回数から1RMを推定する。
   * Epley: 1RM = w ×(1 + r/30) / Brzycki: 1RM = w × 36 ÷(37 − r)
   * 反復回数が1回のときは、どちらの式でも w をそのまま返す。
   * @param {number} weight 扱った重量(kg、1〜1000)
   * @param {number} reps 限界までの反復回数(1〜30の整数)
   * @param {string} [formula="epley"] 推定式。"epley" または "brzycki"
   * @returns {{ok:true, oneRm:number, formula:string, lowConfidence:boolean}
   *          |{ok:false, code:"invalid_weight"|"invalid_reps"|"invalid_formula"}}
   *   oneRm: 推定1RM(kg、小数第1位で丸め)
   *   lowConfidence: 反復回数が12回を超え、推定の誤差が大きくなる範囲かどうか
   */
  function oneRm(weight, reps, formula) {
    var f = formula === undefined ? "epley" : formula;
    if (FORMULAS.indexOf(f) === -1) return { ok: false, code: "invalid_formula" };
    var v = validate(weight, reps);
    if (!v.ok) return v;
    return {
      ok: true,
      oneRm: round(weight * factor(f, reps), 1),
      formula: f,
      lowConfidence: reps > LOW_CONFIDENCE_REPS
    };
  }

  /**
   * Epley式とBrzycki式の両方で推定し、その平均も返す。
   * 2つの式は10回のときにちょうど同じ値(1RMの4/3倍)になり、
   * 回数が少ないとBrzyckiが低め、多いとBrzyckiが高めに出る。
   * @param {number} weight 扱った重量(kg、1〜1000)
   * @param {number} reps 限界までの反復回数(1〜30の整数)
   * @returns {{ok:true, epley:number, brzycki:number, average:number, lowConfidence:boolean}
   *          |{ok:false, code:"invalid_weight"|"invalid_reps"}}
   *   average は2式の平均(kg、小数第1位で丸め)
   */
  function bothFormulas(weight, reps) {
    var v = validate(weight, reps);
    if (!v.ok) return v;
    var e = weight * factor("epley", reps);
    var b = weight * factor("brzycki", reps);
    return {
      ok: true,
      epley: round(e, 1),
      brzycki: round(b, 1),
      average: round((e + b) / 2, 1),
      lowConfidence: reps > LOW_CONFIDENCE_REPS
    };
  }

  /**
   * 1RMから「◯回できる重量」を逆算する(推定式の逆算)。
   * Epley: w = 1RM ÷(1 + r/30) / Brzycki: w = 1RM ×(37 − r)÷ 36
   * @param {number} oneRmKg 1RM(kg、1〜1000)
   * @param {number} reps 反復回数(1〜30の整数)
   * @param {string} [formula="epley"] 推定式。"epley" または "brzycki"
   * @returns {{ok:true, weight:number, percent:number}
   *          |{ok:false, code:"invalid_weight"|"invalid_reps"|"invalid_formula"}}
   *   weight: その回数を挙げられる重量(kg、小数第1位で丸め)
   *   percent: 1RMに対する割合(%、小数第2位で丸め)
   */
  function weightForReps(oneRmKg, reps, formula) {
    var f = formula === undefined ? "epley" : formula;
    if (FORMULAS.indexOf(f) === -1) return { ok: false, code: "invalid_formula" };
    var v = validate(oneRmKg, reps);
    if (!v.ok) return v;
    var ratio = 1 / factor(f, reps);
    return { ok: true, weight: round(oneRmKg * ratio, 1), percent: round(ratio * 100, 2) };
  }

  /**
   * 反復回数ごとの「1RMに対する割合」の一覧(推定式の逆算から作る)。
   * @param {string} [formula="epley"] 推定式。"epley" または "brzycki"
   * @param {number} [maxReps=12] 何回まで並べるか(1〜30の整数)
   * @returns {{ok:true, rows:Array<{reps:number, percent:number}>}
   *          |{ok:false, code:"invalid_formula"|"invalid_reps"}}
   */
  function percentTable(formula, maxReps) {
    var f = formula === undefined ? "epley" : formula;
    var m = maxReps === undefined ? 12 : maxReps;
    if (FORMULAS.indexOf(f) === -1) return { ok: false, code: "invalid_formula" };
    if (!isFiniteNumber(m) || m !== Math.floor(m) || m < REPS_MIN || m > REPS_MAX) {
      return { ok: false, code: "invalid_reps" };
    }
    var rows = [];
    for (var r = 1; r <= m; r++) {
      rows.push({ reps: r, percent: round(100 / factor(f, r), 2) });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    oneRm: oneRm,
    bothFormulas: bothFormulas,
    weightForReps: weightForReps,
    percentTable: percentTable,
    FORMULAS: FORMULAS,
    REPS_MAX: REPS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OnermCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
