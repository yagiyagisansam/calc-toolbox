/*
 * 肥料の施肥量(N-P-K)の計算ロジック
 *
 * 根拠(一次情報):
 * - 肥料の品質の確保等に関する法律(昭和25年法律第127号)第2条第3項
 *   https://laws.e-gov.go.jp/law/325AC0000000127 (2026年7月29日参照)
 *   「保証成分量」とは、…その生産し、輸入し、又は販売する普通肥料につき、それが含有して
 *   いるものとして保証する主成分の最小量を百分比で表したものをいう。
 *   → 肥料袋の「14-14-14」などの数字は、肥料そのものの重さに対する成分の割合(%)である。
 *      したがって 肥料の重さ = 施したい成分量 ÷ (保証成分量% ÷ 100)
 * - 農林水産省「施肥基準」(作物ごとの施肥成分量。単位は kg/10a)
 *   https://www.maff.go.jp/j/seisan/kankyo/hozen_type/h_sehi_kizyun/pdf/tuti232.pdf
 *   (2026年7月29日参照)
 *
 * 単位について:
 * - 施肥基準の kg/10a は 1a=100m²、10a=1,000m² なので、
 *   1 kg/10a = 1,000 g ÷ 1,000 m² = 1 g/m² と、そのまま g/m² に読み替えられる
 *
 * 前提:
 * - 日本の肥料表示の「りん酸」「加里」は、慣行として五酸化二りん(P2O5)・酸化カリウム(K2O)
 *   に換算した量で表される。元素のP・Kそのものの量ではない
 * - 保証成分量は「最小量」の保証であり、実際の含有量はこれ以上のことがある
 * - 土壌にもともとある養分や堆肥からの供給は考慮していない。実際の施肥設計では
 *   土壌診断の結果に応じて減らす
 * - 丸め: 肥料の重さと各成分の量は小数第1位まで四捨五入
 */
(function (global) {
  "use strict";

  var MIN_AREA = 0.01, MAX_AREA = 1000000;      // m²
  var MIN_TARGET = 0.001, MAX_TARGET = 10000;   // g/m²
  var MIN_N_PERCENT = 0.1, MAX_PERCENT = 100;   // %

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  /**
   * 施したい成分量から、実際に撒く肥料の重さを求める。
   * @param {number} targetGram 施したい成分の量(g。0より大きい)
   * @param {number} guaranteePercent 肥料の保証成分量(%。0.1〜100)
   * @returns {{ok:true, fertilizerGram:number}
   *          |{ok:false, code:"invalid_target"|"invalid_guarantee"}}
   */
  function fertilizerAmount(targetGram, guaranteePercent) {
    if (!isFiniteNumber(targetGram) || targetGram <= 0 || targetGram > 100000000) {
      return { ok: false, code: "invalid_target" };
    }
    if (!isFiniteNumber(guaranteePercent) || guaranteePercent < MIN_N_PERCENT || guaranteePercent > MAX_PERCENT) {
      return { ok: false, code: "invalid_guarantee" };
    }
    return { ok: true, fertilizerGram: round1(targetGram / (guaranteePercent / 100)) };
  }

  /**
   * 施肥基準の kg/10a を g/m² に読み替える(1 kg/10a = 1 g/m²)。
   * @param {number} kgPer10a 施肥基準の値(kg/10a。0以上)
   * @returns {{ok:true, gramPerM2:number}|{ok:false, code:"invalid_standard"}}
   */
  function fromKgPer10a(kgPer10a) {
    if (!isFiniteNumber(kgPer10a) || kgPer10a < 0 || kgPer10a > 100000) {
      return { ok: false, code: "invalid_standard" };
    }
    return { ok: true, gramPerM2: kgPer10a };
  }

  /**
   * 面積と施したい窒素量、肥料の成分表示から、撒く肥料の重さと同時に入る成分量を求める。
   * @param {number} areaM2 面積(m²。0.01〜1000000)
   * @param {number} nPerM2Gram 施したい窒素量(g/m²。0より大きい)
   * @param {number} nPercent 肥料の窒素の保証成分量(%。0.1〜100)
   * @param {number} [pPercent] 肥料のりん酸の保証成分量(%。0〜100。既定0)
   * @param {number} [kPercent] 肥料の加里の保証成分量(%。0〜100。既定0)
   * @returns {{ok:true, totalNitrogenGram:number, fertilizerGram:number, fertilizerKg:number,
   *            phosphateGram:number, potashGram:number,
   *            fertilizerPerM2Gram:number, phosphatePerM2Gram:number, potashPerM2Gram:number}
   *          |{ok:false, code:"invalid_area"|"invalid_target"|"invalid_guarantee"
   *                          |"invalid_phosphate"|"invalid_potash"}}
   *   phosphateGram はりん酸(P2O5)として、potashGram は加里(K2O)としての量
   */
  function calculate(areaM2, nPerM2Gram, nPercent, pPercent, kPercent) {
    if (!isFiniteNumber(areaM2) || areaM2 < MIN_AREA || areaM2 > MAX_AREA) {
      return { ok: false, code: "invalid_area" };
    }
    if (!isFiniteNumber(nPerM2Gram) || nPerM2Gram < MIN_TARGET || nPerM2Gram > MAX_TARGET) {
      return { ok: false, code: "invalid_target" };
    }
    if (!isFiniteNumber(nPercent) || nPercent < MIN_N_PERCENT || nPercent > MAX_PERCENT) {
      return { ok: false, code: "invalid_guarantee" };
    }
    var p = pPercent === undefined || pPercent === null ? 0 : pPercent;
    var k = kPercent === undefined || kPercent === null ? 0 : kPercent;
    if (!isFiniteNumber(p) || p < 0 || p > MAX_PERCENT) return { ok: false, code: "invalid_phosphate" };
    if (!isFiniteNumber(k) || k < 0 || k > MAX_PERCENT) return { ok: false, code: "invalid_potash" };

    var totalN = areaM2 * nPerM2Gram;
    var fertilizer = totalN / (nPercent / 100);
    return {
      ok: true,
      totalNitrogenGram: round1(totalN),
      fertilizerGram: round1(fertilizer),
      fertilizerKg: Math.round((fertilizer / 1000) * 100) / 100,
      phosphateGram: round1((fertilizer * p) / 100),
      potashGram: round1((fertilizer * k) / 100),
      fertilizerPerM2Gram: round1(fertilizer / areaM2),
      phosphatePerM2Gram: round1((fertilizer * p) / 100 / areaM2),
      potashPerM2Gram: round1((fertilizer * k) / 100 / areaM2)
    };
  }

  var api = {
    fertilizerAmount: fertilizerAmount,
    fromKgPer10a: fromKgPer10a,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HiryoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
