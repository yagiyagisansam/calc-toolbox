/*
 * ランニングペース 計算ロジック
 *
 * 計算方法:
 * - ペース(秒/km) = 総タイム(秒) ÷ 距離(km)
 * - 時速(km/h) = 距離 ÷ (総タイム÷3600)
 * - ゴールタイム(秒) = 距離 × ペース(秒/km)
 *
 * 前提(ページにも明記):
 * - 一定ペースで走った場合の算術計算(コースの起伏・信号待ち等は考慮しない)
 */
(function (global) {
  "use strict";

  var DISTANCE_MIN_KM = 0.1;
  var DISTANCE_MAX_KM = 1000;
  var TIME_MIN_SEC = 60;
  var TIME_MAX_SEC = 360000;
  var PACE_MIN_SEC = 60;
  var PACE_MAX_SEC = 3600;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 距離と総タイムからペース・時速を計算する。
   * @param {number} distanceKm 距離(km)
   * @param {number} totalSeconds 総タイム(秒)
   * @returns {{ok: true, paceSecPerKm: number, speedKmh: number}|{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_time"
   */
  function paceFor(distanceKm, totalSeconds) {
    if (!isFiniteNumber(distanceKm) || distanceKm < DISTANCE_MIN_KM || distanceKm > DISTANCE_MAX_KM) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!isFiniteNumber(totalSeconds) || totalSeconds < TIME_MIN_SEC || totalSeconds > TIME_MAX_SEC) {
      return { ok: false, code: "invalid_time" };
    }
    return {
      ok: true,
      paceSecPerKm: Math.round(totalSeconds / distanceKm),
      speedKmh: Math.round(distanceKm / (totalSeconds / 3600) * 100) / 100
    };
  }

  /**
   * 距離とペースからゴールタイムを計算する。
   * @param {number} distanceKm 距離(km)
   * @param {number} paceSecPerKm ペース(秒/km)
   * @returns {{ok: true, totalSeconds: number}|{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_pace"
   */
  function timeFor(distanceKm, paceSecPerKm) {
    if (!isFiniteNumber(distanceKm) || distanceKm < DISTANCE_MIN_KM || distanceKm > DISTANCE_MAX_KM) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!isFiniteNumber(paceSecPerKm) || paceSecPerKm < PACE_MIN_SEC || paceSecPerKm > PACE_MAX_SEC) {
      return { ok: false, code: "invalid_pace" };
    }
    return { ok: true, totalSeconds: Math.round(distanceKm * paceSecPerKm) };
  }

  var api = {
    paceFor: paceFor,
    timeFor: timeFor,
    DISTANCE_MIN_KM: DISTANCE_MIN_KM,
    DISTANCE_MAX_KM: DISTANCE_MAX_KM,
    TIME_MIN_SEC: TIME_MIN_SEC,
    TIME_MAX_SEC: TIME_MAX_SEC,
    PACE_MIN_SEC: PACE_MIN_SEC,
    PACE_MAX_SEC: PACE_MAX_SEC
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PaceCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
