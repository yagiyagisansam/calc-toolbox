/*
 * BPM→ディレイタイム(ms)の計算ロジック
 *
 * 根拠(出典):
 * - 「音楽テンポBPM - 音符msec計算方法(ディレイ編)」
 *   https://nac-s.blogspot.com/2021/09/music-bpm-msec.html (2026年7月29日参照)
 *   基本式: 60000ms(1分) ÷ BPM = 1拍(4分音符)の長さ
 *   音符ごとの倍率: 2分音符 2.0倍 / 付点4分 1.5倍 / 付点8分 0.75倍 /
 *                   8分 0.5倍 / 付点16分 0.375倍 / 16分 0.25倍
 *   例(BPM120): 60000 ÷ 120 = 500ms(4分音符)、8分 250ms、16分 125ms、付点4分 750ms
 * - 3連符は音符の長さの3分の2(1拍を3等分するため)。付点は1.5倍。これは記譜法上の定義。
 *
 * 前提:
 * - 4分音符を1拍とする拍子(4/4など)を前提とする。
 * - LFOレート(Hz)は 1000 ÷ ミリ秒 で求めた「1秒あたりの周期数」。
 * - 実機のディレイでは、機種によって指定できる最小単位や上限がある。
 */
(function (global) {
  "use strict";

  var BPM_MIN = 20;
  var BPM_MAX = 999;
  // 音符の分母(1=全音符, 2=2分音符, 4=4分音符, 8=8分音符, 16=16分音符, 32=32分音符)
  var DENOMINATORS = [1, 2, 4, 8, 16, 32];
  var MODIFIERS = { normal: 1, dotted: 1.5, triplet: 2 / 3 };
  var NOTE_NAMES = { 1: "全音符", 2: "2分音符", 4: "4分音符", 8: "8分音符", 16: "16分音符", 32: "32分音符" };
  var MODIFIER_NAMES = { normal: "", dotted: "付点", triplet: "3連" };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /**
   * BPMから4分音符(1拍)の長さを求める。
   * @param {number} bpm テンポ(BPM_MIN〜BPM_MAX)
   * @returns {{ok:true, ms:number}|{ok:false, code:"invalid_bpm"}}
   *   ms: 4分音符の長さ(ミリ秒、小数第2位で四捨五入)
   */
  function quarterMs(bpm) {
    if (!isFiniteNumber(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
      return { ok: false, code: "invalid_bpm" };
    }
    return { ok: true, ms: round(60000 / bpm, 2) };
  }

  /**
   * BPMと音符の種類からディレイタイム(ms)とLFOレート(Hz)を求める。
   * @param {number} bpm テンポ(BPM_MIN〜BPM_MAX)
   * @param {number} denominator 音符の分母(1/2/4/8/16/32)
   * @param {string} [modifier="normal"] "normal"(通常) / "dotted"(付点) / "triplet"(3連)
   * @returns {{ok:true, ms:number, hz:number, name:string}
   *          |{ok:false, code:"invalid_bpm"|"invalid_denominator"|"invalid_modifier"}}
   *   ms: 音符の長さ(ミリ秒、小数第2位で四捨五入)
   *   hz: LFOレート(Hz = 1000 ÷ ms、小数第3位で四捨五入)
   *   name: 音符の名前(例: "付点8分音符")
   */
  function noteMs(bpm, denominator, modifier) {
    if (!isFiniteNumber(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
      return { ok: false, code: "invalid_bpm" };
    }
    if (!isFiniteNumber(denominator) || DENOMINATORS.indexOf(denominator) === -1) {
      return { ok: false, code: "invalid_denominator" };
    }
    var mod = modifier === undefined ? "normal" : modifier;
    if (!Object.prototype.hasOwnProperty.call(MODIFIERS, mod)) {
      return { ok: false, code: "invalid_modifier" };
    }
    // 4分音符の長さを基準に、音符の分母と付点・3連の倍率を掛ける
    var ms = (60000 / bpm) * (4 / denominator) * MODIFIERS[mod];
    return {
      ok: true,
      ms: round(ms, 2),
      hz: round(1000 / ms, 3),
      name: MODIFIER_NAMES[mod] + NOTE_NAMES[denominator]
    };
  }

  /**
   * 指定したBPMでの音符一覧(通常・付点・3連)をまとめて返す。
   * @param {number} bpm テンポ(BPM_MIN〜BPM_MAX)
   * @returns {{ok:true, rows:Array<{denominator:number, name:string,
   *            normalMs:number, dottedMs:number, tripletMs:number, normalHz:number}>}
   *          |{ok:false, code:"invalid_bpm"}}
   */
  function table(bpm) {
    var q = quarterMs(bpm);
    if (!q.ok) return q;
    var rows = DENOMINATORS.map(function (d) {
      return {
        denominator: d,
        name: NOTE_NAMES[d],
        normalMs: noteMs(bpm, d, "normal").ms,
        dottedMs: noteMs(bpm, d, "dotted").ms,
        tripletMs: noteMs(bpm, d, "triplet").ms,
        normalHz: noteMs(bpm, d, "normal").hz
      };
    });
    return { ok: true, rows: rows };
  }

  var api = {
    quarterMs: quarterMs,
    noteMs: noteMs,
    table: table
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BpmDelayCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
