/*
 * 電子レンジ加熱時間換算ロジック(500W⇔600W⇔700Wなど)
 *
 * 計算方法:
 * - 加熱に必要なエネルギーは「電力(W)×時間(秒)」。同じエネルギーを与えるため
 *   換算後の時間(秒) = 元の時間(秒) × 元のワット数 ÷ 換算先ワット数
 * - 実用向けに10秒単位へ切り上げた目安も返す(レンジのダイヤルは10秒刻みが多い)
 * - あくまで目安。機種・食品の量や状態で仕上がりは変わる(ページに明記)
 */
(function (global) {
  "use strict";

  var W_MIN = 100;
  var W_MAX = 2000;
  var SEC_MAX = 24 * 3600;

  function validWatt(w) {
    return typeof w === "number" && isFinite(w) && w >= W_MIN && w <= W_MAX;
  }

  /**
   * 加熱時間をワット数間で換算する。
   * @param {number} seconds 元の加熱時間(秒)
   * @param {number} fromW 元のワット数
   * @param {number} toW 換算先のワット数
   * @returns {{ok: true, seconds: number, rounded10: number}
   *          |{ok: false, code: string}}
   *   seconds: 換算後の時間(秒・四捨五入) / rounded10: 10秒単位に切り上げた目安
   *   code: "invalid_time" | "invalid_watt"
   */
  function convert(seconds, fromW, toW) {
    if (typeof seconds !== "number" || !isFinite(seconds) || seconds <= 0 || seconds > SEC_MAX) {
      return { ok: false, code: "invalid_time" };
    }
    if (!validWatt(fromW) || !validWatt(toW)) {
      return { ok: false, code: "invalid_watt" };
    }
    var raw = seconds * fromW / toW;
    return {
      ok: true,
      seconds: Math.round(raw),
      rounded10: Math.ceil(raw / 10) * 10
    };
  }

  var api = {
    convert: convert,
    W_MIN: W_MIN,
    W_MAX: W_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.RenjiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
