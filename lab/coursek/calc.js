/*
 * 登山コース定数・消費エネルギーの計算ロジック
 *
 * 根拠(出典):
 * - 山と溪谷オンライン「体力度を数値化する『コース定数』とは?」(2024年7月1日掲載)
 *   https://www.yamakei-online.com/yama-ya/detail.php?id=363 (2026年7月29日参照)
 *   鹿屋体育大学 山本正嘉教授が考案。
 *   コース定数 = 1.8×行動時間(h) + 0.3×歩行距離(km) + 10.0×登りの累積標高差(km) + 0.6×下りの累積標高差(km)
 *   行動中のエネルギー消費量(kcal) = コース定数 × (体重 + ザックの重量)
 *   体力度の目安: 10前後=体力的にやさしく初心者向き / 20前後=一般的な登山者向き /
 *                 30前後=日帰り登山の場合は健脚者向き / 40以上=日帰りでは困難、1泊以上の計画が必要
 *
 * 前提:
 * - 累積標高差は入力をメートルで受け取り、式に入れる際にキロメートルへ換算する(÷1000)。
 * - 行動時間は休憩を含まない標準コースタイム(ガイドブックやアプリの標準値)を想定する。
 * - 消費エネルギーは行動中のもので、基礎代謝や休憩中の消費は含まない。
 * - 体重は装備(ザック)込みの重量を入れる。
 * - 個人差・季節・雪の有無・天候は考慮しない目安値。
 */
(function (global) {
  "use strict";

  var HOURS_MAX = 100; // 行動時間の上限(h)
  var KM_MAX = 300; // 歩行距離の上限(km)
  var ELEV_MAX = 20000; // 累積標高差の上限(m)
  var WEIGHT_MIN = 20; // 体重+装備の下限(kg)
  var WEIGHT_MAX = 200; // 体重+装備の上限(kg)

  // 体力度の区分(下限値, ラベル, 説明)。出典の「10前後/20前後/30前後/40以上」を
  // その中間(15/25/35)で区切ったもの。
  var LEVELS = [
    [35, "40以上", "日帰りでは困難。1泊以上の計画が必要"],
    [25, "30前後", "日帰り登山の場合は健脚者向き"],
    [15, "20前後", "一般的な登山者向き"],
    [0, "10前後", "体力的にやさしく初心者向き"]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /**
   * コース定数(体力度の指標)を求める。
   * @param {number} hours コースタイム・行動時間(時間、0より大きくHOURS_MAX以下)
   * @param {number} km 歩行距離(km、0より大きくKM_MAX以下)
   * @param {number} upM 登りの累積標高差(m、0以上ELEV_MAX以下)
   * @param {number} downM 下りの累積標高差(m、0以上ELEV_MAX以下)
   * @returns {{ok:true, constant:number, parts:{time:number, distance:number, up:number, down:number}}
   *          |{ok:false, code:"invalid_hours"|"invalid_km"|"invalid_up"|"invalid_down"}}
   *   constant: コース定数(小数第1位で四捨五入)
   *   parts: 内訳(それぞれ小数第2位で四捨五入)。どの要素が効いているかを画面で見せるため
   */
  function constant(hours, km, upM, downM) {
    if (!isFiniteNumber(hours) || hours <= 0 || hours > HOURS_MAX) {
      return { ok: false, code: "invalid_hours" };
    }
    if (!isFiniteNumber(km) || km <= 0 || km > KM_MAX) {
      return { ok: false, code: "invalid_km" };
    }
    if (!isFiniteNumber(upM) || upM < 0 || upM > ELEV_MAX) {
      return { ok: false, code: "invalid_up" };
    }
    if (!isFiniteNumber(downM) || downM < 0 || downM > ELEV_MAX) {
      return { ok: false, code: "invalid_down" };
    }
    var time = 1.8 * hours;
    var distance = 0.3 * km;
    var up = 10.0 * (upM / 1000);
    var down = 0.6 * (downM / 1000);
    return {
      ok: true,
      constant: round(time + distance + up + down, 1),
      parts: {
        time: round(time, 2),
        distance: round(distance, 2),
        up: round(up, 2),
        down: round(down, 2)
      }
    };
  }

  /**
   * コース定数の値から体力度の目安を返す。
   * @param {number} courseConstant コース定数(0以上)
   * @returns {{ok:true, label:string, description:string}|{ok:false, code:"invalid_constant"}}
   */
  function level(courseConstant) {
    if (!isFiniteNumber(courseConstant) || courseConstant < 0) {
      return { ok: false, code: "invalid_constant" };
    }
    for (var i = 0; i < LEVELS.length; i++) {
      if (courseConstant >= LEVELS[i][0]) {
        return { ok: true, label: LEVELS[i][1], description: LEVELS[i][2] };
      }
    }
    return { ok: false, code: "invalid_constant" };
  }

  /**
   * コース定数・体力度・行動中の消費エネルギーをまとめて求める。
   * @param {number} hours コースタイム・行動時間(時間)
   * @param {number} km 歩行距離(km)
   * @param {number} upM 登りの累積標高差(m)
   * @param {number} downM 下りの累積標高差(m)
   * @param {number} weightKg 体重＋装備の重量(kg、WEIGHT_MIN〜WEIGHT_MAX)
   * @returns {{ok:true, constant:number, parts:object, kcal:number, label:string,
   *            description:string, kcalPerHour:number}
   *          |{ok:false, code:string}}
   *   kcal: 行動中の消費エネルギー(kcal、1の位で四捨五入)
   *   kcalPerHour: 1時間あたりの消費エネルギー(kcal、1の位で四捨五入)
   */
  function calculate(hours, km, upM, downM, weightKg) {
    var c = constant(hours, km, upM, downM);
    if (!c.ok) return c;
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    var lv = level(c.constant);
    var kcal = c.constant * weightKg;
    return {
      ok: true,
      constant: c.constant,
      parts: c.parts,
      kcal: Math.round(kcal),
      kcalPerHour: Math.round(kcal / hours),
      label: lv.ok ? lv.label : "",
      description: lv.ok ? lv.description : ""
    };
  }

  var api = {
    constant: constant,
    level: level,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CoursekCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
