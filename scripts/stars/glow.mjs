/*
 * 地上の発光量(VIIRS夜間光)から「その場所の空の明るさ」を近似する開発用モジュール。
 *
 * なぜ必要か:
 *   VIIRS が測っているのは「その画素から上に出ている光」であって「その画素の上空の
 *   明るさ」ではない。そのまま使うと、都心のすぐ隣にある暗い山頂(例: 富士山頂)が
 *   外洋と同じ「最高の星空」になってしまう。実際には近隣の都市の光が大気で散乱して
 *   空を明るくするので、周囲の発光を距離で減衰させながら足し込む必要がある。
 *
 * モデル:
 *   ある地点の空の明るさへの寄与を、距離 r の光源について
 *       k(r) ∝ (r² + h²)^(-1.25)
 *   とする。h は散乱が起きる大気の実効的な高さ(既定 10km)。
 *   これは Garstang / Walker の「空の明るさは距離のおよそ 2.5 乗に反比例する」
 *   という古典的な経験則を、光源直上で発散しないように滑らかにしたもの。
 *   出典: Walker, M. F. (1977) PASP 89, 405「The effects of urban lighting on the
 *   brightness of the night sky」/ Garstang, R. H. (1986) PASP 98, 364
 *
 * 実装:
 *   上のカーネルの畳み込みを直接やると重いので、半径の異なる複数のガウスぼかしの
 *   重み付き和で近似する。各ガウスの重みは、そのスケールが担当する円環における
 *   k(r) の積分 ∫ 2πr·k(r) dr から決める。
 *   ガウスぼかしは「箱ぼかし3回」で近似する(分離可能で O(n) )。
 *
 * 限界(サイト側に明記すること):
 *   地形による遮蔽(山が街明かりを隠す)、大気の状態、光の色や配光は考慮しない。
 *   出てくるのは絶対的な空の明るさではなく、比較のための相対指標である。
 */

/*
 * 箱ぼかし1回。ウィンドウは [x-r, x+r] の 2r+1 画素、端は縁の値で埋める(clamp)。
 * 走査しながら「右端を足して左端を引く」ので画像サイズに対して O(n)。
 * 添字を1つでも間違えると総和が保存されず縞や滲みが出るため、
 * glow.test.mjs でインパルス応答(総和・対称性・ピーク位置)を検証している。
 */
function boxBlurH(src, dst, w, h, r) {
  const scale = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // x=0 のウィンドウ: 左側の r 画素は src[0] にクランプされるので (r+1) 個ぶん
    let acc = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * scale;
      acc +=
        src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

/** 箱ぼかし1回(垂直)。水平版と同じ規則。 */
function boxBlurV(src, dst, w, h, r) {
  const scale = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = src[x] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * scale;
      acc +=
        src[Math.min(y + r + 1, h - 1) * w + x] - src[Math.max(y - r, 0) * w + x];
    }
  }
}

/**
 * ガウスぼかしの近似(箱ぼかし3回)。
 * @param {Float32Array} src 入力(破壊しない)
 * @param {number} w 幅
 * @param {number} h 高さ
 * @param {number} sigma 標準偏差(画素)
 * @returns {Float32Array} 新しい配列
 */
export function gaussianBlur(src, w, h, sigma) {
  if (sigma < 0.5) return Float32Array.from(src);
  // 箱ぼかしを3回重ねてガウスに近づけるときの箱の半径
  const boxWidth = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  const r = Math.max(1, Math.round((boxWidth - 1) / 2));

  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return a;
}

/**
 * 散乱カーネル k(r) = (r²+h²)^-1.25 を、与えたスケール群に配分したときの重みを返す。
 * 各スケール i は円環 [√(σ_{i-1}σ_i), √(σ_i σ_{i+1})] を担当するものとして
 * ∫ 2πr·k(r) dr を数値積分する。
 * @param {number[]} sigmas 各スケールの標準偏差(km)
 * @param {number} scaleHeightKm 大気の実効高さ h(km)
 * @returns {number[]} 合計が1になる重み
 */
export function scatterWeights(sigmas, scaleHeightKm) {
  const h2 = scaleHeightKm * scaleHeightKm;
  const k = (r) => Math.pow(r * r + h2, -1.25);

  // 各スケールが担当する半径の境界(隣接スケールとの幾何平均)
  const edges = [0];
  for (let i = 0; i < sigmas.length - 1; i++) {
    edges.push(Math.sqrt(sigmas[i] * sigmas[i + 1]));
  }
  // 最外は最大スケールの3倍までを見る(それより遠くの寄与は無視できる)
  edges.push(sigmas[sigmas.length - 1] * 3);

  const weights = sigmas.map((_, i) => {
    const r0 = edges[i];
    const r1 = edges[i + 1];
    const steps = 256;
    let sum = 0;
    for (let s = 0; s < steps; s++) {
      const r = r0 + ((r1 - r0) * (s + 0.5)) / steps;
      sum += 2 * Math.PI * r * k(r) * ((r1 - r0) / steps);
    }
    return sum;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((v) => v / total);
}

/**
 * 発光量ラスタから空の明るさ(スカイグロウ)ラスタを作る。
 * @param {Float32Array} emission 発光量(線形スケール)
 * @param {number} width
 * @param {number} height
 * @param {object} opts
 * @param {number} opts.kmPerPixel 1画素あたりの距離(km)
 * @param {number[]} opts.scalesKm ぼかし半径(km)の一覧
 * @param {number} opts.scaleHeightKm 大気の実効高さ(km)
 * @returns {{glow: Float32Array, weights: number[]}}
 */
export function skyGlow(emission, width, height, opts) {
  const { kmPerPixel, scalesKm, scaleHeightKm } = opts;
  const weights = scatterWeights(scalesKm, scaleHeightKm);

  const glow = new Float32Array(emission.length);
  scalesKm.forEach((km, i) => {
    const sigmaPx = km / kmPerPixel;
    const blurred = gaussianBlur(emission, width, height, sigmaPx);
    const w = weights[i];
    for (let j = 0; j < glow.length; j++) glow[j] += blurred[j] * w;
  });

  return { glow, weights };
}
