/*
 * 音名⇔周波数 換算(12平均律) 計算ロジック
 *
 * 根拠(一次情報):
 * - ISO 16:1975 "Acoustics — Standard tuning frequency (Standard musical pitch)"
 *   国際標準の基準ピッチ。A4(1点イ)= 440 Hz。
 *   https://www.iso.org/standard/3601.html (2026年7月29日参照)
 * - MIDI 1.0 の規定により、A4 のノート番号は 69、中央ハ C4 は 60、C-1 は 0。
 *   https://midi.org/summary-of-midi-1-0-messages (2026年7月29日参照)
 * - 12平均律の周波数表(A4=440Hz基準の定義と JavaScript による実装例)
 *   https://ma-servant.com/equal_temperament_frequency_list/ (2026年7月29日参照)
 *
 * 用いる式:
 *   周波数 f(Hz) = 基準ピッチ × 2^((MIDIノート番号 − 69) / 12)
 *   セント差 cent = 1200 × log2(f2 / f1)   (半音 = 100セント、1オクターブ = 1200セント)
 *
 * 前提:
 * - 12平均律(equal temperament)のみを扱う。純正律・中全音律などは対象外。
 * - オクターブ表記は科学的表記(A4 = 440Hz、中央ハ = C4)。ヤマハ式の A3 表記とは1つずれる。
 * - 実際の楽器は倍音の伸び(インハーモニシティ)や温度で音程が変わるため、計算値は理論値。
 */
(function (global) {
  "use strict";

  var LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  var JP_NAMES = ["ハ", "嬰ハ", "ニ", "嬰ニ", "ホ", "ヘ", "嬰ヘ", "ト", "嬰ト", "イ", "嬰イ", "ロ"];
  var A4_MIDI = 69;
  var MIDI_MIN = 0; // C-1
  var MIDI_MAX = 127; // G9
  var REF_MIN = 380; // 基準ピッチの下限(Hz)
  var REF_MAX = 500; // 基準ピッチの上限(Hz)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function checkRef(refPitch) {
    return isFiniteNumber(refPitch) && refPitch >= REF_MIN && refPitch <= REF_MAX;
  }

  /**
   * 指定した小数位で四捨五入する(2進小数の誤差でちょうど半分の値が下振れするのを防ぐ)
   * @param {number} x 対象の数値
   * @param {number} digits 小数点以下の桁数(0以上)
   * @returns {number} 四捨五入した数値
   */
  function roundTo(x, digits) {
    if (!isFinite(x)) return x;
    var p = Math.pow(10, digits);
    return Math.round(parseFloat(x.toPrecision(12)) * p) / p;
  }

  /**
   * 音名の文字列をMIDIノート番号に変換する
   * @param {string} noteName 音名。例 "A4" "C#3" "Bb5" "F♯2" "E♭4" "C-1"
   *   英字1文字(A〜G)+ 変化記号(#/♯/b/♭、省略可)+ オクターブ番号(-1〜9)
   *   全角の英字・数字・記号(Ａ４、Ｃ＃３ など)も半角に直して受け付ける
   * @returns {{ok:true, midi:number}|{ok:false, code:"invalid_note"|"note_out_of_range"}}
   */
  function noteToMidi(noteName) {
    if (typeof noteName !== "string") return { ok: false, code: "invalid_note" };
    // 全角の英数字・＃を半角に直し(日本語キーボード対策)、全角マイナスも半角に寄せる
    var s = noteName
      .replace(/[Ａ-Ｚａ-ｚ０-９＃]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/[−－]/g, "-");
    // 記号を半角に寄せ、先頭の音名だけ大文字にする(小文字の b は変化記号なので残す)
    s = s.trim().replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
    s = s.charAt(0).toUpperCase() + s.slice(1);
    var m = /^([A-G])([#b]?)(-?\d{1,2})$/.exec(s);
    if (!m) return { ok: false, code: "invalid_note" };
    var base = LETTERS[m[1]];
    var acc = m[2] === "#" ? 1 : (m[2] === "b" ? -1 : 0);
    var octave = parseInt(m[3], 10);
    if (!isFinite(octave)) return { ok: false, code: "invalid_note" };
    var midi = (octave + 1) * 12 + base + acc;
    if (midi < MIDI_MIN || midi > MIDI_MAX) return { ok: false, code: "note_out_of_range" };
    return { ok: true, midi: midi };
  }

  /**
   * MIDIノート番号から周波数を求める
   * @param {number} midi MIDIノート番号(0〜127の整数)。A4は69
   * @param {number} refPitch 基準ピッチ A4 の周波数(Hz)。380〜500。省略時は440
   * @returns {{ok:true, freq:number, midi:number, name:string, nameFlat:string,
   *            nameJa:string, octave:number}
   *          |{ok:false, code:"invalid_midi"|"invalid_ref_pitch"}}
   *   freq: 周波数(Hz、小数第2位で四捨五入)
   *   name: シャープ表記の音名(例 "C#4") / nameFlat: フラット表記(例 "Db4")
   *   nameJa: 日本語の音名(例 "嬰ハ")
   */
  function midiToFreq(midi, refPitch) {
    if (refPitch === undefined) refPitch = 440;
    if (!checkRef(refPitch)) return { ok: false, code: "invalid_ref_pitch" };
    if (!isFiniteNumber(midi) || Math.floor(midi) !== midi || midi < MIDI_MIN || midi > MIDI_MAX) {
      return { ok: false, code: "invalid_midi" };
    }
    var f = refPitch * Math.pow(2, (midi - A4_MIDI) / 12);
    var pc = ((midi % 12) + 12) % 12;
    var octave = Math.floor(midi / 12) - 1;
    return {
      ok: true,
      freq: roundTo(f, 2),
      midi: midi,
      name: NAMES_SHARP[pc] + octave,
      nameFlat: NAMES_FLAT[pc] + octave,
      nameJa: JP_NAMES[pc],
      octave: octave
    };
  }

  /**
   * 音名から周波数を求める
   * @param {string} noteName 音名。例 "A4" "C#3" "Bb5"
   * @param {number} refPitch 基準ピッチ A4 の周波数(Hz)。380〜500。省略時は440
   * @returns {{ok:true, freq:number, midi:number, name:string, nameFlat:string,
   *            nameJa:string, octave:number}
   *          |{ok:false, code:"invalid_note"|"note_out_of_range"|"invalid_ref_pitch"}}
   */
  function noteToFreq(noteName, refPitch) {
    var m = noteToMidi(noteName);
    if (!m.ok) return m;
    return midiToFreq(m.midi, refPitch);
  }

  /**
   * 周波数から最も近い音名と、そこからのずれ(セント)を求める
   * @param {number} freq 周波数(Hz)。0より大きく20000以下
   * @param {number} refPitch 基準ピッチ A4 の周波数(Hz)。380〜500。省略時は440
   * @returns {{ok:true, name:string, nameFlat:string, nameJa:string, midi:number,
   *            octave:number, exactFreq:number, cents:number}
   *          |{ok:false, code:"invalid_freq"|"invalid_ref_pitch"|"note_out_of_range"}}
   *   exactFreq: その音名の理論上の周波数(Hz、小数第2位で四捨五入)
   *   cents: 入力の周波数が理論値から何セントずれているか(小数第1位で四捨五入。
   *          プラスなら高い。−50〜+50の範囲に入る)
   */
  function freqToNote(freq, refPitch) {
    if (refPitch === undefined) refPitch = 440;
    if (!checkRef(refPitch)) return { ok: false, code: "invalid_ref_pitch" };
    if (!isFiniteNumber(freq) || freq <= 0 || freq > 20000) {
      return { ok: false, code: "invalid_freq" };
    }
    var exact = A4_MIDI + 12 * (Math.log(freq / refPitch) / Math.LN2);
    var midi = Math.round(exact);
    if (midi < MIDI_MIN || midi > MIDI_MAX) return { ok: false, code: "note_out_of_range" };
    var info = midiToFreq(midi, refPitch);
    var cents = (exact - midi) * 100;
    return {
      ok: true,
      name: info.name,
      nameFlat: info.nameFlat,
      nameJa: info.nameJa,
      midi: midi,
      octave: info.octave,
      exactFreq: info.freq,
      cents: roundTo(cents, 1)
    };
  }

  /**
   * 2つの周波数の音程差をセントで求める
   * @param {number} f1 基準になる周波数(Hz)。0より大きく20000以下
   * @param {number} f2 比べる周波数(Hz)。0より大きく20000以下
   * @returns {{ok:true, cents:number, ratio:number}|{ok:false, code:"invalid_freq"}}
   *   cents: 1200 × log2(f2/f1)(小数第1位で四捨五入)。f2が高ければプラス
   *   ratio: f2 ÷ f1(小数第5位で四捨五入)
   */
  function cents(f1, f2) {
    if (!isFiniteNumber(f1) || f1 <= 0 || f1 > 20000) return { ok: false, code: "invalid_freq" };
    if (!isFiniteNumber(f2) || f2 <= 0 || f2 > 20000) return { ok: false, code: "invalid_freq" };
    return {
      ok: true,
      cents: roundTo(1200 * (Math.log(f2 / f1) / Math.LN2), 1),
      ratio: roundTo(f2 / f1, 5)
    };
  }

  /**
   * 周波数を指定したセントだけ動かす(セント補正)
   * @param {number} freq もとの周波数(Hz)。0より大きく20000以下
   * @param {number} centValue 動かす量(セント)。−4800以上4800以下
   * @returns {{ok:true, freq:number}|{ok:false, code:"invalid_freq"|"invalid_cents"}}
   *   freq: 補正後の周波数(Hz、小数第2位で四捨五入)
   */
  function shiftCents(freq, centValue) {
    if (!isFiniteNumber(freq) || freq <= 0 || freq > 20000) return { ok: false, code: "invalid_freq" };
    if (!isFiniteNumber(centValue) || centValue < -4800 || centValue > 4800) {
      return { ok: false, code: "invalid_cents" };
    }
    return { ok: true, freq: roundTo(freq * Math.pow(2, centValue / 1200), 2) };
  }

  var api = {
    noteToFreq: noteToFreq,
    noteToMidi: noteToMidi,
    midiToFreq: midiToFreq,
    freqToNote: freqToNote,
    cents: cents,
    shiftCents: shiftCents
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OnkaiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
