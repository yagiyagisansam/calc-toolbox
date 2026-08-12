/*
 * 最小限の PNG デコーダ / グレースケールエンコーダ(開発用スクリプト専用)。
 *
 * 外部パッケージを入れずに済ませるために自前で持つ。zlib は Node 標準を使う。
 * 対応範囲は「このリポジトリで実際に扱う形式」だけに絞ってある:
 *   - デコード: bitDepth 8 / colorType 0(グレー) 2(RGB) 4(グレー+α) 6(RGBA) / 非インターレース
 *   - エンコード: bitDepth 8 / colorType 0(グレー) のみ
 * 上記以外は明示的にエラーにする(黙って壊れた値を返さないため)。
 *
 * 参照: PNG Specification (Third Edition), W3C
 * https://www.w3.org/TR/png-3/
 */
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// colorType → 1画素あたりのチャンネル数
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * PNG を復号して生の画素配列にする。
 * @param {Buffer} buf PNG のバイト列
 * @returns {{width:number, height:number, channels:number, data:Uint8Array}}
 *          data は上から下・左から右の順に channels バイトずつ並ぶ
 */
export function decodePNG(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("PNG のシグネチャが一致しません");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`未対応の bitDepth: ${bitDepth}`);
  if (interlace !== 0) throw new Error("インターレース PNG は未対応");
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`未対応の colorType: ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new Error("IDAT の展開後の長さが足りません");
  }

  const out = new Uint8Array(stride * height);
  // フィルタの解除(PNG spec 9.2 の Recon 関数)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0; // 左
      const b = y > 0 ? out[up + x] : 0; // 上
      const c = x >= channels && y > 0 ? out[up + x - channels] : 0; // 左上
      const v = raw[src + x];
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`未知のフィルタ種別: ${filter} (行 ${y})`);
      }
      out[dst + x] = r & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/**
 * 8bit グレースケール PNG を作る。
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} gray 長さ width*height の輝度配列
 * @returns {Buffer}
 */
export function encodeGrayPNG(width, height, gray) {
  if (gray.length !== width * height) {
    throw new Error("画素数が width*height と一致しません");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 0; // colorType: グレースケール
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 各行を「上との差分(filter 2)」で符号化する。光害画像は縦方向の相関が強く、
  // フィルタなしより圧縮が効く。
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 2;
    const dst = y * (width + 1) + 1;
    const src = y * width;
    const up = src - width;
    for (let x = 0; x < width; x++) {
      const b = y > 0 ? gray[up + x] : 0;
      raw[dst + x] = (gray[src + x] - b) & 0xff;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
