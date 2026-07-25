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

  /**
   * 表記の加熱時間を、主なワット数(500/600/700/800/1000W)すべてに一括換算した表を返す。
   * 換算は convert と同じ「電力(W)×時間(秒)が一定」の考え方を使う。
   * 丸め方針: seconds は四捨五入、rounded10 は10秒単位に切り上げ(convert と同じ)。
   * @param {number} seconds 表記の加熱時間(秒)
   * @param {number} fromW 表記のワット数
   * @returns {{ok:true, rows:Array<{w:number, seconds:number, rounded10:number}>}
   *          |{ok:false, code:string}}
   *   code: "invalid_time" | "invalid_watt"
   */
  function multiTable(seconds, fromW) {
    var watts = [500, 600, 700, 800, 1000];
    var rows = [];
    for (var i = 0; i < watts.length; i++) {
      var r = convert(seconds, fromW, watts[i]);
      if (!r.ok) return r;
      rows.push({ w: watts[i], seconds: r.seconds, rounded10: r.rounded10 });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    multiTable: multiTable,
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
