/*
 * 過焦点距離(ハイパーフォーカルディスタンス)の計算ロジック
 *
 * 基準の時点: 2026年7月時点。光学の関係式そのものなので年度による変動はない。
 *
 * 根拠(一次情報):
 * - 東芝テリー株式会社「知っていると便利な光学知識 - 被写界深度と過焦点距離・過焦点系列」
 *   https://www.toshiba-teli.co.jp/technology/technical/t0019_DoF_HyperfocalDistance.htm (2026年7月29日参照)
 *   ・「"過焦点距離(Hyperfocal Distance)"は、この距離(H)にピントを合わせると、
 *      無限遠からH/2の距離まで被写界深度となる撮影距離のことです。」
 *   ・過焦点距離は、無限遠にピントを合わせたときの前側被写界深度に相当し、
 *     光学倍率が決まらないため実効F値ではなくF値を用いる
 *   ・掲載の計算例: 焦点距離 f=50mm、F値 F=2、許容錯乱円径 δ=3.45μm(画素ピッチ)のとき
 *     過焦点距離 H = 362,318.8mm(約362.3m)。→ H = f²/(F×δ) = 2500/(2×0.00345)
 *   ・過焦点系列(Hyperfocal Sequence)は H, H/2, H/3, … と整数で割った数列で、
 *     「数列に示される数にピントを合わせたときの両隣が被写界深度の遠点と近点を示す」
 *   ・許容錯乱円径について、銀塩フィルム時代から一般に「画面対角線の1/1300である0.033mm など」が
 *     使われてきたこと、マシンビジョンでは画素ピッチやエアリーディスク径を用いることが説明されている
 *
 * 前提:
 * - この式はニュートンの結像公式に基づき、過焦点距離を前側焦点から測った値として求める。
 *   レンズの主点から測る流儀では H + f になるが、通常の撮影距離では差は無視できる。
 * - 許容錯乱円径はセンサーサイズの対角線の1/1300を既定値とする(上記の一般的な考え方)。
 *   実際に許せるボケの大きさは、鑑賞サイズや等倍表示するかで変わる。
 * - 回折や収差は考慮しない。絞り込みすぎると回折で解像が落ちるため、計算どおりにはならない。
 * - 丸めは、過焦点距離を m 単位で小数第2位まで(四捨五入)。
 */
(function (global) {
  "use strict";

  var FOCAL_MIN = 1;        // 焦点距離(mm)の入力下限
  var FOCAL_MAX = 3000;     // 焦点距離(mm)の入力上限
  var FNUM_MIN = 0.5;       // F値の入力下限
  var FNUM_MAX = 128;       // F値の入力上限
  var COC_MIN = 0.0001;     // 許容錯乱円径(mm)の入力下限
  var COC_MAX = 1;          // 許容錯乱円径(mm)の入力上限
  var COC_DIVISOR = 1300;   // 許容錯乱円径 = 画面対角線 ÷ 1300
  var SEQ_MAX = 20;         // 過焦点系列で扱う分母の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * センサーの寸法から許容錯乱円径を求める(対角線の1/1300)
   * @param {number} widthMm センサーの横の長さ(mm)
   * @param {number} heightMm センサーの縦の長さ(mm)
   * @returns {{ok:true, diagonalMm:number, cocMm:number}|{ok:false, code:"invalid_size"}}
   *   diagonalMm と cocMm は小数第4位で四捨五入
   */
  function cocFromSensor(widthMm, heightMm) {
    if (!isFiniteNumber(widthMm) || widthMm <= 0 || widthMm > 1000) {
      return { ok: false, code: "invalid_size" };
    }
    if (!isFiniteNumber(heightMm) || heightMm <= 0 || heightMm > 1000) {
      return { ok: false, code: "invalid_size" };
    }
    var diag = Math.sqrt(widthMm * widthMm + heightMm * heightMm);
    return {
      ok: true,
      diagonalMm: Math.round(diag * 10000) / 10000,
      cocMm: Math.round(diag / COC_DIVISOR * 10000) / 10000
    };
  }

  /**
   * 過焦点距離を計算する
   * @param {number} focalMm 焦点距離(mm)。ズームなら実際に使う焦点距離
   * @param {number} fNumber F値(絞り値)
   * @param {number} cocMm 許容錯乱円径(mm)
   * @returns {{ok:true, hyperfocalMm:number, hyperfocalM:number, nearM:number}
   *          |{ok:false, code:"invalid_focal"|"invalid_fnumber"|"invalid_coc"}}
   *   hyperfocalMm は丸めない生の値(mm)。hyperfocalM と nearM は m 単位で小数第2位。
   *   nearM は過焦点距離にピントを置いたときの手前側の限界(H/2)で、そこから無限遠までが被写界深度
   */
  function hyperfocal(focalMm, fNumber, cocMm) {
    if (!isFiniteNumber(focalMm) || focalMm < FOCAL_MIN || focalMm > FOCAL_MAX) {
      return { ok: false, code: "invalid_focal" };
    }
    if (!isFiniteNumber(fNumber) || fNumber < FNUM_MIN || fNumber > FNUM_MAX) {
      return { ok: false, code: "invalid_fnumber" };
    }
    if (!isFiniteNumber(cocMm) || cocMm < COC_MIN || cocMm > COC_MAX) {
      return { ok: false, code: "invalid_coc" };
    }
    var h = (focalMm * focalMm) / (fNumber * cocMm);
    return {
      ok: true,
      hyperfocalMm: h,
      hyperfocalM: round2(h / 1000),
      nearM: round2(h / 2000)
    };
  }

  /**
   * 過焦点系列(H, H/2, H/3, …)を作る
   * @param {number} focalMm 焦点距離(mm)
   * @param {number} fNumber F値
   * @param {number} cocMm 許容錯乱円径(mm)
   * @param {number} count 何項まで出すか(2〜20の整数)
   * @returns {{ok:true, rows:Array<{n:number, focusM:number, nearM:number, farM:(number|null)}>}
   *          |{ok:false, code:"invalid_focal"|"invalid_fnumber"|"invalid_coc"|"invalid_count"}}
   *   focusM はピントを合わせる距離 H/n(m)。nearM は近点 H/(n+1)、farM は遠点 H/(n-1)。
   *   n=1(過焦点距離そのもの)の遠点は無限遠なので farM は null
   */
  function sequence(focalMm, fNumber, cocMm, count) {
    var base = hyperfocal(focalMm, fNumber, cocMm);
    if (!base.ok) return base;
    if (!isFiniteNumber(count) || Math.floor(count) !== count || count < 2 || count > SEQ_MAX) {
      return { ok: false, code: "invalid_count" };
    }
    var h = base.hyperfocalMm;
    var rows = [];
    for (var n = 1; n <= count; n++) {
      rows.push({
        n: n,
        focusM: round2(h / n / 1000),
        nearM: round2(h / (n + 1) / 1000),
        farM: n === 1 ? null : round2(h / (n - 1) / 1000)
      });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    hyperfocal: hyperfocal,
    sequence: sequence,
    cocFromSensor: cocFromSensor,
    COC_DIVISOR: COC_DIVISOR
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HyperfocalCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
