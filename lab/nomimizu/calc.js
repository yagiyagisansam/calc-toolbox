/*
 * 登山の必要水分量 計算ロジック
 *
 * 根拠(一次情報):
 * - 山本正嘉「登山時のエネルギー・水分補給に関する『現実的』な指針の作成」
 *   登山医学 vol.32 (1) 36-44, 2012
 *   図5「行動中におけるエネルギーと水分補給の指針」に示された a式・b式と補給の指針。
 *   図5の内容を掲載した解説記事(2026年7月29日参照):
 *   https://machida77.hatenadiary.jp/entry/20230712/1689118089
 *
 * 原典の式(図5):
 *   「行動中」のエネルギー(kcal)と水分(mL)の消費量
 *     a式 = 体重(kg) × 行動時間(h) × 5
 *     b式 = (体重(kg) + ザック・衣服・靴などの重量(kg))
 *           × (1.8×行動時間(h) + 0.3×水平方向への歩行距離(km)
 *              + 10.0×累積の上昇距離(km) + 0.6×累積の下降距離(km))
 *   補給の指針
 *     1) a式で脱水量を求める場合、「5」という係数は個人差や季節を考えて増減してもよい。
 *        特に環境温が25℃以上(夏日)の場合には 6〜7 とする。
 *     3) 水分補給は消費量の7割以上を目安とし、最低でも1時間ごとに補給する。
 *        一部は行動開始前に補給してもよい(250〜500mL程度)。
 *        行動時間が3時間を超える場合は塩分など電解質の補給も行う。
 *
 * 前提:
 * - a式・b式が示すのは「登山条件が最もよい時」の消費量。強風・暑熱・悪路・積雪などでは
 *   消費量は2倍以上になることがある(原典の注記)。
 * - エネルギー(kcal)と水分(mL)は同じ数値になる。
 * - 「補給量」は消費量の7割以上。ここでは下限を7割、上限を消費量そのものとして幅で示す。
 * - 医学的な指示ではなく計画の目安。体調・持病・服薬がある場合は医師の指示を優先すること。
 */
(function (global) {
  "use strict";

  var INTAKE_RATIO_MIN = 0.7; // 消費量の7割以上を補給する(原典の指針)
  var DEFAULT_COEF = 5; // a式の係数(標準)
  var HOT_COEF_MIN = 6; // 環境温25℃以上(夏日)の係数
  var HOT_COEF_MAX = 7;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function checkWeight(v) {
    return isFiniteNumber(v) && v > 0 && v <= 200;
  }
  function checkHours(v) {
    return isFiniteNumber(v) && v > 0 && v <= 24;
  }
  function checkDistance(v) {
    return isFiniteNumber(v) && v >= 0 && v <= 200;
  }

  /**
   * a式(簡易式)で行動中の消費量と補給量を求める
   * 消費量(mL) = 体重(kg) × 行動時間(h) × 係数
   * @param {number} weightKg 体重(kg)。0より大きく200以下
   * @param {number} hours 行動予定時間(h)。0より大きく24以下
   * @param {number} coef 係数。標準5、環境温25℃以上(夏日)は6〜7。1以上10以下
   * @returns {{ok:true, consumptionMl:number, consumptionKcal:number,
   *            intakeMinMl:number, intakeMaxMl:number, coef:number}
   *          |{ok:false, code:"invalid_weight"|"invalid_hours"|"invalid_coef"}}
   *   consumptionMl: 行動中の脱水量(mL、1mL未満四捨五入)。同じ数値がエネルギー(kcal)にもなる
   *   intakeMinMl: 補給量の下限(消費量の7割、1mL未満四捨五入)
   *   intakeMaxMl: 補給量の上限(消費量と同量)
   */
  function simple(weightKg, hours, coef) {
    if (!checkWeight(weightKg)) return { ok: false, code: "invalid_weight" };
    if (!checkHours(hours)) return { ok: false, code: "invalid_hours" };
    if (coef === undefined) coef = DEFAULT_COEF;
    if (!isFiniteNumber(coef) || coef < 1 || coef > 10) return { ok: false, code: "invalid_coef" };
    var ml = weightKg * hours * coef;
    return {
      ok: true,
      consumptionMl: Math.round(ml),
      consumptionKcal: Math.round(ml),
      intakeMinMl: Math.round(ml * INTAKE_RATIO_MIN),
      intakeMaxMl: Math.round(ml),
      coef: coef
    };
  }

  /**
   * b式(汎用式)で行動中の消費量と補給量を求める
   * 消費量 = (体重+装備重量) × (1.8×時間 + 0.3×水平距離 + 10.0×累積上昇 + 0.6×累積下降)
   * @param {number} weightKg 体重(kg)。0より大きく200以下
   * @param {number} gearKg ザック・衣服・靴などの重量(kg)。0以上200以下
   * @param {number} hours 行動予定時間(h)。0より大きく24以下
   * @param {number} horizontalKm 水平方向への歩行距離(km)。0以上200以下
   * @param {number} ascentKm 累積の上昇距離(km)。0以上200以下(標高差1,000mなら1.0)
   * @param {number} descentKm 累積の下降距離(km)。0以上200以下
   * @returns {{ok:true, consumptionMl:number, consumptionKcal:number,
   *            intakeMinMl:number, intakeMaxMl:number, totalWeightKg:number, constant:number}
   *          |{ok:false, code:"invalid_weight"|"invalid_gear"|"invalid_hours"|"invalid_distance"}}
   *   constant: 括弧の中の「エネルギーと水分の消費定数」(小数第3位で四捨五入)
   */
  function general(weightKg, gearKg, hours, horizontalKm, ascentKm, descentKm) {
    if (!checkWeight(weightKg)) return { ok: false, code: "invalid_weight" };
    if (!isFiniteNumber(gearKg) || gearKg < 0 || gearKg > 200) return { ok: false, code: "invalid_gear" };
    if (!checkHours(hours)) return { ok: false, code: "invalid_hours" };
    if (!checkDistance(horizontalKm) || !checkDistance(ascentKm) || !checkDistance(descentKm)) {
      return { ok: false, code: "invalid_distance" };
    }
    var total = weightKg + gearKg;
    var k = 1.8 * hours + 0.3 * horizontalKm + 10.0 * ascentKm + 0.6 * descentKm;
    var ml = total * k;
    return {
      ok: true,
      consumptionMl: Math.round(ml),
      consumptionKcal: Math.round(ml),
      intakeMinMl: Math.round(ml * INTAKE_RATIO_MIN),
      intakeMaxMl: Math.round(ml),
      totalWeightKg: Math.round(total * 100) / 100,
      constant: Math.round(k * 1000) / 1000
    };
  }

  /**
   * 補給量から持っていく水のペースを求める
   * @param {number} intakeMl 行動中に補給する量(mL)。0より大きく20000以下
   * @param {number} hours 行動予定時間(h)。0より大きく24以下
   * @returns {{ok:true, perHourMl:number, preHydrationMinMl:number, preHydrationMaxMl:number,
   *            needsElectrolyte:boolean, waterWeightKg:number}
   *          |{ok:false, code:"invalid_intake"|"invalid_hours"}}
   *   perHourMl: 1時間あたりの補給量(mL、1mL未満四捨五入)。最低1時間ごとに補給する
   *   preHydrationMinMl/MaxMl: 行動開始前に飲んでおく量(250〜500mL、原典の指針)
   *   needsElectrolyte: 行動時間が3時間を超えるか(超えるなら塩分など電解質の補給も行う)
   *   waterWeightKg: 補給量を水の重さに直した値(kg、1mL=1gとして小数第2位で四捨五入)
   */
  function pace(intakeMl, hours) {
    if (!isFiniteNumber(intakeMl) || intakeMl <= 0 || intakeMl > 20000) {
      return { ok: false, code: "invalid_intake" };
    }
    if (!checkHours(hours)) return { ok: false, code: "invalid_hours" };
    return {
      ok: true,
      perHourMl: Math.round(intakeMl / hours),
      preHydrationMinMl: 250,
      preHydrationMaxMl: 500,
      needsElectrolyte: hours > 3,
      waterWeightKg: Math.round(intakeMl / 10) / 100
    };
  }

  var api = {
    simple: simple,
    general: general,
    pace: pace,
    DEFAULT_COEF: DEFAULT_COEF,
    HOT_COEF_MIN: HOT_COEF_MIN,
    HOT_COEF_MAX: HOT_COEF_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NomimizuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
