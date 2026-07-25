/*
 * データ容量換算ロジック
 *
 * 計算方法:
 * - 2進接頭辞(1KB=1024B): OSのファイルサイズ表示などで使われる方式
 * - 10進接頭辞(1KB=1000B): ストレージ製品の容量表記(国際単位系のSI接頭辞)
 * - 指定した基数(1024または1000)でB/KB/MB/GB/TBをすべて計算する
 * - 表示は小数第4位で四捨五入
 */
(function (global) {
  "use strict";

  var UNITS = ["b", "kb", "mb", "gb", "tb"];

  function round4(x) { return Math.round(x * 10000) / 10000; }

  /**
   * データ容量を全単位に換算する。
   * @param {number} value 数値
   * @param {string} unit 入力の単位 "b"|"kb"|"mb"|"gb"|"tb"
   * @param {number} base 基数 1024 または 1000
   * @returns {{ok: true, b: number, kb: number, mb: number, gb: number, tb: number}
   *          |{ok: false, code: string}}  code: "invalid_value" | "invalid_unit" | "invalid_base"
   */
  function convert(value, unit, base) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 1e15) {
      return { ok: false, code: "invalid_value" };
    }
    var idx = UNITS.indexOf(unit);
    if (idx === -1) return { ok: false, code: "invalid_unit" };
    if (base !== 1024 && base !== 1000) return { ok: false, code: "invalid_base" };
    var bytes = value * Math.pow(base, idx);
    var out = { ok: true };
    for (var i = 0; i < UNITS.length; i++) {
      out[UNITS[i]] = round4(bytes / Math.pow(base, i));
    }
    return out;
  }

  /**
   * ファイル容量と回線速度から、ダウンロードにかかる時間を計算する。
   *
   * bit/Byte変換: 回線速度の Mbps は「メガビット毎秒」。ファイル容量の Byte は
   * 1 Byte = 8 bit なので、Mbps を MB/s に直すには 8 で割る(例: 100Mbps = 12.5MB/s)。
   * 計算では容量をビットに直し(バイト数 × 8)、速度(Mbps × 1,000,000 bit/s)で割る。
   * 回線速度の M は通信分野の慣習どおり 10進(1M = 1,000,000)で扱う。
   *
   * 実効速度: 実際の通信は TCP/IP のオーバーヘッドや回線の混雑があるため、
   * 理論値の 70% 程度を目安とする(一般に用いられる概算の目安)。
   *
   * 丸め: 秒は小数第2位で四捨五入。
   *
   * @param {number} value ファイル容量の数値
   * @param {string} unit 容量の単位 "b"|"kb"|"mb"|"gb"|"tb"
   * @param {number} mbps 回線速度(Mbps)
   * @param {number} base 容量の基数 1024 または 1000
   * @returns {{ok:true, seconds:number, secondsEffective:number, bytes:number, mbPerSec:number}
   *          |{ok:false, code:string}} code: "invalid_value"|"invalid_unit"|"invalid_base"|"invalid_speed"
   */
  function downloadTime(value, unit, mbps, base) {
    var conv = convert(value, unit, base);
    if (!conv.ok) return conv;
    if (typeof mbps !== "number" || !isFinite(mbps) || mbps <= 0 || mbps > 1e6) {
      return { ok: false, code: "invalid_speed" };
    }
    var bytes = value * Math.pow(base, UNITS.indexOf(unit));
    var bits = bytes * 8;
    var seconds = bits / (mbps * 1e6);
    var secondsEffective = seconds / 0.7;
    return {
      ok: true,
      seconds: Math.round(seconds * 100) / 100,
      secondsEffective: Math.round(secondsEffective * 100) / 100,
      bytes: bytes,
      mbPerSec: Math.round((mbps / 8) * 100) / 100
    };
  }

  /**
   * 容量から「写真何枚・音楽何曲・動画何時間ぶんか」の目安を計算する。
   *
   * 目安の係数(いずれも一般的な概算値。実際は画質・音質・アプリにより大きく変わる):
   * - 写真: 1枚 約4MB(スマホ標準カメラのJPEG)
   * - 音楽: 1曲 約8MB(4分・256kbps相当の圧縮音源)
   * - 動画: 1時間 約2GB(フルHD画質の視聴・録画の中間的な目安)
   * 係数のMB/GBは10進(1MB=1,000,000B、1GB=10億B)で扱う。
   *
   * 丸め: 枚数・曲数は切り捨て、動画時間は小数第1位で四捨五入。
   *
   * @param {number} value 容量の数値
   * @param {string} unit 単位 "b"|"kb"|"mb"|"gb"|"tb"
   * @param {number} base 基数 1024 または 1000
   * @returns {{ok:true, photos:number, songs:number, videoHours:number, bytes:number}
   *          |{ok:false, code:string}}
   */
  function capacityUsage(value, unit, base) {
    var conv = convert(value, unit, base);
    if (!conv.ok) return conv;
    var bytes = value * Math.pow(base, UNITS.indexOf(unit));
    return {
      ok: true,
      photos: Math.floor(bytes / 4e6),
      songs: Math.floor(bytes / 8e6),
      videoHours: Math.round((bytes / 2e9) * 10) / 10,
      bytes: bytes
    };
  }

  var api = {
    capacityUsage: capacityUsage,
    downloadTime: downloadTime, convert: convert, UNITS: UNITS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ByteCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
