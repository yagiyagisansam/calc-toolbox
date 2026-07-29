/*
 * ポータブル電源の稼働時間・必要容量の計算ロジック
 *
 * 根拠(一次情報):
 * - Jackery Japan(メーカー)「ポータブル電源で電化製品を使える時間は?計算方法を分かりやすく解説」
 *   「ポータブル電源の稼働時間 = バッテリー容量(Wh) × 80% ÷ 使用する家電の消費電力の合計(W)」
 *   例: 容量3000Wh・消費電力950W → 3000 × 0.8 ÷ 950 = 2.52時間
 *   mAh表記の場合は「Ah × 電圧(V) = Wh」
 *   https://www.jackery.jp/blogs/power-station/using-time-of-power-station (2026年7月29日参照)
 *
 * 前提:
 * - 0.8(80%)はDC-AC変換ロスなどを見込んだ補正。機種により異なるため入力で変えられるようにしている
 * - 出典も明記しているとおり、算出される時間は理論上の参考値
 * - バッテリーの劣化、気温(低温では容量が下がる)、起動時の突入電力は考慮しない
 * - 冷蔵庫のように運転と停止を繰り返す家電は、定格消費電力で計算すると実際より短く出る
 * - 定格出力(W)を超える家電は動かせない。本ツールは出力の判定をしない
 * - 時間は小数第2位で四捨五入し、「◯時間◯分」は総分を四捨五入してから分解する
 */
(function (global) {
  "use strict";

  var MAX_WH = 1000000;
  var MAX_W = 100000;
  var MAX_HOURS = 10000;
  var EFF_MIN = 0.1;
  var EFF_MAX = 1;
  var DEFAULT_EFF = 0.8;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  function checkEff(v) {
    return isFiniteNumber(v) && v >= EFF_MIN && v <= EFF_MAX;
  }

  /**
   * ポータブル電源の容量と家電の消費電力から、使える時間を計算する。
   * @param {number} capacityWh ポータブル電源のバッテリー容量(Wh。0より大きく1,000,000以下)
   * @param {number} powerW 使用する家電の消費電力の合計(W。0より大きく100,000以下)
   * @param {number} efficiency 変換効率(0.1〜1.0)。省略時は0.8(出典の80%)
   * @returns {{ok:true, hours:number, hoursPart:number, minutesPart:number, usableWh:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_power"|"invalid_efficiency"}}
   *   hours は使える時間(小数第2位で四捨五入)、hoursPart/minutesPart は「◯時間◯分」に分けた値、
   *   usableWh は実際に使える電力量(容量 × 効率。小数第1位で四捨五入)。
   */
  function runtime(capacityWh, powerW, efficiency) {
    if (!isFiniteNumber(capacityWh) || capacityWh <= 0 || capacityWh > MAX_WH) {
      return { ok: false, code: "invalid_capacity" };
    }
    if (!isFiniteNumber(powerW) || powerW <= 0 || powerW > MAX_W) {
      return { ok: false, code: "invalid_power" };
    }
    if (efficiency === undefined) efficiency = DEFAULT_EFF;
    if (!checkEff(efficiency)) return { ok: false, code: "invalid_efficiency" };

    var usable = capacityWh * efficiency;
    var h = usable / powerW;
    var totalMinutes = Math.round(h * 60);
    return {
      ok: true,
      hours: round(h, 2),
      hoursPart: Math.floor(totalMinutes / 60),
      minutesPart: totalMinutes % 60,
      usableWh: round(usable, 1)
    };
  }

  /**
   * 使いたい家電と時間から、必要なポータブル電源の容量を計算する。
   * @param {number} powerW 家電の消費電力の合計(W。0より大きく100,000以下)
   * @param {number} hours 使用したい時間(h。0より大きく10,000以下)
   * @param {number} efficiency 変換効率(0.1〜1.0)。省略時は0.8
   * @returns {{ok:true, requiredWh:number, consumedWh:number}
   *          |{ok:false, code:"invalid_power"|"invalid_hours"|"invalid_efficiency"}}
   *   requiredWh は必要な容量(消費電力量 ÷ 効率。小数第1位で四捨五入)、
   *   consumedWh は実際に消費する電力量(消費電力 × 時間)。
   */
  function requiredCapacity(powerW, hours, efficiency) {
    if (!isFiniteNumber(powerW) || powerW <= 0 || powerW > MAX_W) {
      return { ok: false, code: "invalid_power" };
    }
    if (!isFiniteNumber(hours) || hours <= 0 || hours > MAX_HOURS) {
      return { ok: false, code: "invalid_hours" };
    }
    if (efficiency === undefined) efficiency = DEFAULT_EFF;
    if (!checkEff(efficiency)) return { ok: false, code: "invalid_efficiency" };

    var consumed = powerW * hours;
    return {
      ok: true,
      consumedWh: round(consumed, 1),
      requiredWh: round(consumed / efficiency, 1)
    };
  }

  /**
   * mAh表記の容量をWh(ワットアワー)に換算する。
   * @param {number} mAh 容量(mAh。0より大きく100,000,000以下)
   * @param {number} voltage セル電圧(V。0より大きく1,000以下)
   * @returns {{ok:true, wh:number}|{ok:false, code:"invalid_mah"|"invalid_voltage"}}
   *   wh は「Ah × V」を小数第2位で四捨五入した値。
   */
  function mahToWh(mAh, voltage) {
    if (!isFiniteNumber(mAh) || mAh <= 0 || mAh > 100000000) {
      return { ok: false, code: "invalid_mah" };
    }
    if (!isFiniteNumber(voltage) || voltage <= 0 || voltage > 1000) {
      return { ok: false, code: "invalid_voltage" };
    }
    return { ok: true, wh: round(mAh / 1000 * voltage, 2) };
  }

  var api = {
    runtime: runtime,
    requiredCapacity: requiredCapacity,
    mahToWh: mahToWh
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PortableCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
