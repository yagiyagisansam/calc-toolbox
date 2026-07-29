/*
 * 動画の容量・録画可能時間 計算ロジック
 *
 * 根拠(一次情報):
 * - NIST「Prefixes for binary multiples」 https://physics.nist.gov/cuu/Units/binary.html
 *   (2026年7月29日参照)
 *   ・情報の分野で キロ/メガ/ギガ を2進の倍数の意味で使うのは混乱のもとであり、
 *     2進の倍数には kibi(2^10) / mebi(2^20) / gibi(2^30) を用いる(IEC 80000-13)。
 *   ・SI接頭語としての ギガ は 10^9。記憶装置メーカーは 10^9 バイトで容量を表示するのが一般的。
 * - 国際単位系(SI)の接頭語 https://www.nist.gov/pml/owm/metric-si-prefixes (2026年7月29日参照)
 *
 * 前提:
 * - ビットレートの Mbps は SI の意味で 1 Mbps = 1,000,000 bit/s とする。
 * - 1 バイト = 8 ビット。
 * - 容量は次の2通りで返す。どちらも同じバイト数を別の単位で書いたもの。
 *     GB  = バイト数 ÷ 1,000,000,000   (10進。SDカードなどに書かれている容量の数え方)
 *     GiB = バイト数 ÷ 1,073,741,824   (2進。パソコンのファイルサイズ表示に多い数え方)
 * - 実際のファイルには音声・コンテナのオーバーヘッドが乗り、カードもフォーマットで
 *   数%使われるため、結果はあくまで目安。使える容量の割合(usableRatio)で補正できる。
 * - 可変ビットレート(VBR)では平均ビットレートを入れて概算する。
 */
(function (global) {
  "use strict";

  var BITRATE_MAX = 100000;   // Mbps。業務用の高ビットレートも入る十分な上限
  var MINUTES_MAX = 1000000;  // 分。約2年
  var CAPACITY_MAX = 1000000; // GB。1PB相当

  var GB = 1e9;
  var GIB = 1073741824;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function checkRatio(usableRatio) {
    if (usableRatio === undefined || usableRatio === null) return 1;
    if (!isFiniteNumber(usableRatio) || usableRatio <= 0 || usableRatio > 1) return null;
    return usableRatio;
  }

  /**
   * ビットレートと収録時間から、動画ファイルのおおよその容量を求める。
   *   バイト数 = ビットレート(Mbps) × 1,000,000 ÷ 8 × 秒数
   * @param {number} bitrateMbps ビットレート(Mbps、0超100000以下)
   * @param {number} minutes 収録時間(分、0以上1000000以下)
   * @returns {{ok:true, bytes:number, gb:number, gib:number, mb:number, mib:number, seconds:number}
   *          |{ok:false, code:"invalid_bitrate"|"invalid_minutes"}}
   *   gb は10進(1GB=10^9バイト)、gib は2進(1GiB=2^30バイト)。いずれも小数第2位で四捨五入。
   */
  function fileSize(bitrateMbps, minutes) {
    if (!isFiniteNumber(bitrateMbps) || bitrateMbps <= 0 || bitrateMbps > BITRATE_MAX) {
      return { ok: false, code: "invalid_bitrate" };
    }
    if (!isFiniteNumber(minutes) || minutes < 0 || minutes > MINUTES_MAX) {
      return { ok: false, code: "invalid_minutes" };
    }
    var seconds = minutes * 60;
    var bytes = bitrateMbps * 1e6 / 8 * seconds;
    return {
      ok: true,
      seconds: seconds,
      bytes: Math.round(bytes),
      gb: round2(bytes / GB),
      gib: round2(bytes / GIB),
      mb: round2(bytes / 1e6),
      mib: round2(bytes / 1048576)
    };
  }

  /**
   * カード容量とビットレートから、おおよその録画可能時間を求める。
   *   秒数 = 容量(バイト) × 8 ÷ (ビットレート(Mbps) × 1,000,000)
   * @param {number} capacity カードやドライブの容量(数値)
   * @param {number} bitrateMbps ビットレート(Mbps、0超100000以下)
   * @param {string} [unit="GB"] 容量の単位。"GB"(10^9バイト)または "GiB"(2^30バイト)
   * @param {number} [usableRatio=1] 実際に使える容量の割合(0超1以下)。0.95なら95%が使える想定
   * @returns {{ok:true, seconds:number, hours:number, minutes:number, remainSeconds:number,
   *            totalMinutes:number, bytes:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_bitrate"|"invalid_unit"|"invalid_ratio"}}
   *   seconds は切り捨てた整数秒。hours/minutes/remainSeconds はそれを時分秒に分けたもの。
   */
  function recordingTime(capacity, bitrateMbps, unit, usableRatio) {
    if (unit === undefined || unit === null) unit = "GB";
    if (!isFiniteNumber(capacity) || capacity <= 0 || capacity > CAPACITY_MAX) {
      return { ok: false, code: "invalid_capacity" };
    }
    if (!isFiniteNumber(bitrateMbps) || bitrateMbps <= 0 || bitrateMbps > BITRATE_MAX) {
      return { ok: false, code: "invalid_bitrate" };
    }
    var factor;
    if (unit === "GB") factor = GB;
    else if (unit === "GiB") factor = GIB;
    else return { ok: false, code: "invalid_unit" };

    var ratio = checkRatio(usableRatio);
    if (ratio === null) return { ok: false, code: "invalid_ratio" };

    var bytes = capacity * factor * ratio;
    var seconds = Math.floor(bytes * 8 / (bitrateMbps * 1e6));
    return {
      ok: true,
      bytes: Math.round(bytes),
      seconds: seconds,
      hours: Math.floor(seconds / 3600),
      minutes: Math.floor(seconds % 3600 / 60),
      remainSeconds: seconds % 60,
      totalMinutes: round2(seconds / 60)
    };
  }

  /**
   * 収録時間を決められた容量に収めるために必要なビットレートの上限を求める。
   *   ビットレート(Mbps) = 容量(バイト) × 8 ÷ 秒数 ÷ 1,000,000
   * @param {number} capacity 容量(数値)
   * @param {number} minutes 収録時間(分、0超)
   * @param {string} [unit="GB"] 容量の単位("GB" または "GiB")
   * @returns {{ok:true, bitrateMbps:number}
   *          |{ok:false, code:"invalid_capacity"|"invalid_minutes"|"invalid_unit"}}
   *   bitrateMbps は小数第2位で四捨五入
   */
  function maxBitrate(capacity, minutes, unit) {
    if (unit === undefined || unit === null) unit = "GB";
    if (!isFiniteNumber(capacity) || capacity <= 0 || capacity > CAPACITY_MAX) {
      return { ok: false, code: "invalid_capacity" };
    }
    if (!isFiniteNumber(minutes) || minutes <= 0 || minutes > MINUTES_MAX) {
      return { ok: false, code: "invalid_minutes" };
    }
    var factor;
    if (unit === "GB") factor = GB;
    else if (unit === "GiB") factor = GIB;
    else return { ok: false, code: "invalid_unit" };

    return { ok: true, bitrateMbps: round2(capacity * factor * 8 / (minutes * 60) / 1e6) };
  }

  var api = {
    fileSize: fileSize,
    recordingTime: recordingTime,
    maxBitrate: maxBitrate,
    GB: GB,
    GIB: GIB
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BitrateCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
