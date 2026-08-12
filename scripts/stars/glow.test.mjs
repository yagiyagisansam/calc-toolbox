#!/usr/bin/env node
/*
 * glow.mjs の検証。使い方: node scripts/stars/glow.test.mjs
 *
 * ぼかしは添字を1つ間違えるだけで総和が保存されず、光害ラスタに縞や偏りが出る。
 * 実際に一度その不具合を出しているので、インパルス応答を必ず検証する。
 */
import { gaussianBlur, scatterWeights, skyGlow } from "./glow.mjs";

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? "  " + detail : ""}`);
    failed++;
  }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

const W = 200;
const H = 120;
const CX = 100;
const CY = 60;

console.log("gaussianBlur:");
for (const sigma of [2, 5, 10, 25]) {
  // ぼかしが画像の端に届くと、端の値を引き伸ばす処理のぶんだけ総和がずれる。
  // ここで見たいのは端の挙動ではないので、光源から端まで 8σ 以上を確保する。
  const w = Math.max(200, Math.ceil(sigma * 16) + 1);
  const h = w;
  const cx = w >> 1;
  const cy = h >> 1;
  const src = new Float32Array(w * h);
  src[cy * w + cx] = 1000;
  const out = gaussianBlur(src, w, h, sigma);

  let sum = 0;
  let max = -Infinity;
  let argmax = -1;
  for (let i = 0; i < out.length; i++) {
    sum += out[i];
    if (out[i] > max) {
      max = out[i];
      argmax = i;
    }
  }
  const py = Math.floor(argmax / w);
  const px = argmax % w;
  const at = (dy, dx) => out[(cy + dy) * w + (cx + dx)];
  const d = Math.max(1, Math.round(sigma));

  // 総和が保存される = 光の量が勝手に増減しない
  check(`sigma=${sigma} 総和が保存される`, near(sum, 1000, 1), `sum=${sum.toFixed(2)}`);
  // ピークが動かない = 地図上で光源の位置がずれない
  check(`sigma=${sigma} ピーク位置が中心`, px === cx && py === cy, `peak=${px},${py}`);
  // 左右・上下対称
  check(
    `sigma=${sigma} 左右対称`,
    near(at(0, -d), at(0, d), Math.abs(at(0, d)) * 1e-6 + 1e-9),
    `${at(0, -d)} vs ${at(0, d)}`
  );
  check(
    `sigma=${sigma} 上下対称`,
    near(at(-d, 0), at(d, 0), Math.abs(at(d, 0)) * 1e-6 + 1e-9),
    `${at(-d, 0)} vs ${at(d, 0)}`
  );
  // 単調減少(中心から離れるほど暗い)
  check(
    `sigma=${sigma} 中心から単調に減衰`,
    at(0, 0) > at(0, d) && at(0, d) > at(0, 3 * d),
    `${at(0, 0)} > ${at(0, d)} > ${at(0, 3 * d)}`
  );
}

// 一様な画像はぼかしても値が変わらない(端の処理が正しいことの確認)
{
  const src = new Float32Array(W * H).fill(50);
  const out = gaussianBlur(src, W, H, 25);
  let min = Infinity;
  let max = -Infinity;
  for (const v of out) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  check("一様な画像は端まで値が変わらない", near(min, 50, 1e-3) && near(max, 50, 1e-3), `${min}..${max}`);
}

// 光源がなければどこも0(ありもしない明るさを作らない)
{
  const out = gaussianBlur(new Float32Array(W * H), W, H, 25);
  check("光源ゼロなら出力もゼロ", out.every((v) => v === 0));
}

console.log("scatterWeights:");
{
  const sigmas = [3, 10, 30, 90, 250];
  const w = scatterWeights(sigmas, 10);
  check("重みの合計が1", near(w.reduce((a, b) => a + b, 0), 1, 1e-9));
  check("重みがすべて正", w.every((v) => v > 0));
  // 散乱の寄与は大気の実効高さ(10km)付近の距離が最大になる
  const maxIdx = w.indexOf(Math.max(...w));
  check("寄与が最大なのは中距離", maxIdx === 1 || maxIdx === 2, `maxIdx=${maxIdx}`);
}

console.log("skyGlow:");
{
  // 1点の光源から、距離が離れるほど空の明るさが下がること
  const src = new Float32Array(W * H);
  src[CY * W + CX] = 1000;
  const { glow } = skyGlow(src, W, H, {
    kmPerPixel: 2.7,
    scalesKm: [3, 10, 30, 90, 250],
    scaleHeightKm: 10
  });
  const at = (dx) => glow[CY * W + CX + dx];
  check("光源から離れるほど暗い", at(1) > at(10) && at(10) > at(50) && at(50) > 0);
  check("負の値が出ない", glow.every((v) => v >= 0));
}

console.log(failed === 0 ? "\nすべて通過" : `\n${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
