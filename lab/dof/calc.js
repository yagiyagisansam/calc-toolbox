/*
 * 被写界深度(Depth of Field)と過焦点距離の計算ロジック
 *
 * 根拠(一次情報):
 * - 東芝テリー株式会社「知っていると便利な光学知識 - 被写界深度と過焦点距離・過焦点系列」
 *   https://www.toshiba-teli.co.jp/technology/technical/t0019_DoF_HyperfocalDistance.htm
 *   (2026年7月29日参照)
 *   ・ニュートンの結像公式による式(x は前側焦点を原点とする被写体距離、負値をとる)
 *       前側被写界深度 DoF_F = (δ·Fe·x²)/(f² − δ·Fe·x)
 *       後側被写界深度 DoF_R = −(δ·Fe·x²)/(f² + δ·Fe·x)
 *       過焦点距離     H     = −f²/(δ·F)
 *   ・ガウスの結像公式による式は「上の式の x を a+f に置き換えれば求められる」
 *     (a は前側主点を原点とする被写体距離)
 *   ・実効F値 Fe は横倍率を含む値で、Fe = F × s/(s−f) の関係にある
 *
 * 上の関係を、撮影者が使いやすい「レンズから被写体までの距離 s(正の値)」で書き直すと
 *   前方被写界深度 = δ·F·s·(s−f) / (f² + δ·F·s)
 *   後方被写界深度 = δ·F·s·(s−f) / (f² − δ·F·s)   ※ f² ≦ δ·F·s のとき無限遠まで
 *   過焦点距離     = f²/(δ·F) + f
 * となる。写真の解説でよく見る「s²」を使った近似式は、s が f に対して十分大きいときの
 * 簡略形。本ツールは近似せず (s−f) を使った式で計算している。
 *
 * 許容錯乱円径δについて:
 * - 上記資料は「画面対角線の1/1300である0.033mm など」が一般に使われていると述べている
 * - 本ツールのセンサー別プリセットは、この 対角長÷1300 で求めた値を小数第3位まで丸めたもの
 *
 * 前提:
 * - 距離はレンズ(前側主点)から被写体までの距離。実際のカメラの距離目盛は撮像面基準のため、
 *   近接撮影では数cmのずれが出る
 * - 収差や回折は考慮していない。ピントの合う・合わないは実際には段階的に変化する
 * - 丸め: 距離はメートルで小数第3位まで四捨五入(1mm単位)
 */
(function (global) {
  "use strict";

  var MIN_FOCAL = 1, MAX_FOCAL = 2000;        // mm
  var MIN_FNUMBER = 0.5, MAX_FNUMBER = 100;
  var MIN_DISTANCE_M = 0.01, MAX_DISTANCE_M = 10000; // m
  var MIN_COC = 0.001, MAX_COC = 0.2;         // mm

  // センサー別の許容錯乱円径(mm)。対角長÷1300 を小数第3位に丸めた値
  var COC_PRESETS = {
    "medium44x33": 0.042, // 中判(44×33mm) 対角54.9mm
    "fullframe": 0.033,   // 35mmフルサイズ(36×24mm) 対角43.27mm
    "apsc15": 0.022,      // APS-C(23.5×15.6mm) 対角28.21mm
    "apsc16": 0.021,      // APS-C(22.3×14.9mm) 対角26.82mm
    "m43": 0.017,         // マイクロフォーサーズ(17.3×13mm) 対角21.64mm
    "type1": 0.012        // 1型(13.2×8.8mm) 対角15.86mm
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  /**
   * センサーの呼び名から許容錯乱円径(mm)を返す。
   * @param {string} key "medium44x33"|"fullframe"|"apsc15"|"apsc16"|"m43"|"type1"
   * @returns {{ok:true, cocMm:number}|{ok:false, code:"invalid_sensor"}}
   */
  function cocForSensor(key) {
    if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(COC_PRESETS, key)) {
      return { ok: false, code: "invalid_sensor" };
    }
    return { ok: true, cocMm: COC_PRESETS[key] };
  }

  /**
   * 過焦点距離を求める(この距離にピントを合わせると、その半分から無限遠まで被写界深度に入る)。
   * @param {number} focalMm 焦点距離(mm。1〜2000)
   * @param {number} fNumber F値(0.5〜100)
   * @param {number} cocMm 許容錯乱円径(mm。0.001〜0.2)
   * @returns {{ok:true, hyperfocalM:number}
   *          |{ok:false, code:"invalid_focal"|"invalid_fnumber"|"invalid_coc"}}
   */
  function hyperfocal(focalMm, fNumber, cocMm) {
    if (!isFiniteNumber(focalMm) || focalMm < MIN_FOCAL || focalMm > MAX_FOCAL) {
      return { ok: false, code: "invalid_focal" };
    }
    if (!isFiniteNumber(fNumber) || fNumber < MIN_FNUMBER || fNumber > MAX_FNUMBER) {
      return { ok: false, code: "invalid_fnumber" };
    }
    if (!isFiniteNumber(cocMm) || cocMm < MIN_COC || cocMm > MAX_COC) {
      return { ok: false, code: "invalid_coc" };
    }
    var hMm = (focalMm * focalMm) / (cocMm * fNumber) + focalMm;
    return { ok: true, hyperfocalM: round3(hMm / 1000) };
  }

  /**
   * 被写界深度(手前側・奥側・合計)と、ピントが合って見える範囲の前後端を求める。
   * @param {number} focalMm 焦点距離(mm。1〜2000)
   * @param {number} fNumber F値(0.5〜100)
   * @param {number} distanceM 被写体までの距離(m。0.01〜10000。焦点距離より大きいこと)
   * @param {number} cocMm 許容錯乱円径(mm。0.001〜0.2)
   * @returns {{ok:true, nearM:number, farM:number|null, frontM:number, rearM:number|null,
   *            totalM:number|null, hyperfocalM:number, isFarInfinite:boolean}
   *          |{ok:false, code:"invalid_focal"|"invalid_fnumber"|"invalid_distance"|"invalid_coc"}}
   *   nearM: ピントが合って見える手前端までの距離 / farM: 奥端(無限遠のときは null)
   *   frontM: 前方被写界深度 / rearM: 後方被写界深度(無限遠のときは null)
   *   totalM: 被写界深度の合計(無限遠のときは null)
   *   isFarInfinite: 奥側が無限遠に達しているか
   */
  function calculate(focalMm, fNumber, distanceM, cocMm) {
    var h = hyperfocal(focalMm, fNumber, cocMm);
    if (!h.ok) return h;
    if (!isFiniteNumber(distanceM) || distanceM < MIN_DISTANCE_M || distanceM > MAX_DISTANCE_M) {
      return { ok: false, code: "invalid_distance" };
    }
    var s = distanceM * 1000; // mm
    if (s <= focalMm) return { ok: false, code: "invalid_distance" };

    var k = cocMm * fNumber * s;       // δ·F·s
    var f2 = focalMm * focalMm;
    var num = k * (s - focalMm);       // δ·F·s·(s−f)

    var frontMm = num / (f2 + k);
    var isInfinite = f2 - k <= 0;
    var rearMm = isInfinite ? null : num / (f2 - k);

    return {
      ok: true,
      nearM: round3((s - frontMm) / 1000),
      farM: isInfinite ? null : round3((s + rearMm) / 1000),
      frontM: round3(frontMm / 1000),
      rearM: isInfinite ? null : round3(rearMm / 1000),
      totalM: isInfinite ? null : round3((frontMm + rearMm) / 1000),
      hyperfocalM: h.hyperfocalM,
      isFarInfinite: isInfinite
    };
  }

  var api = {
    cocForSensor: cocForSensor,
    hyperfocal: hyperfocal,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.DofCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
