/*
 * 説明ページのうち、データから作る部分。
 *
 * 段階の区切りや校正に使った地点の値を、この HTML に直接書いてしまうと、
 * 光害データを作り直したときに説明だけが古いまま残る。
 * 実際に使っているファイル(score.js の定義と lp-japan.json)から起こす。
 */
(function (global) {
  "use strict";

  var Score = global.StarsScore;
  var Palette = global.StarsPalette;

  function el(id) {
    return document.getElementById(id);
  }

  /** 段階の一覧(地図の凡例と同じ色・同じ区切り) */
  function renderBands() {
    var box = el("band-list");
    if (!box) return;
    Score.BANDS.forEach(function (band, i) {
      var row = document.createElement("div");
      row.className = "stars-band-row";

      var chip = document.createElement("span");
      chip.className = "stars-band-chip";
      chip.style.backgroundColor = Palette.BAND_COLORS_ON_MAP[i];
      row.appendChild(chip);

      var name = document.createElement("strong");
      name.textContent = band.label;
      row.appendChild(name);

      var range = document.createElement("span");
      range.className = "stars-band-range";
      var upper = i === 0 ? 100 : Score.BANDS[i - 1].min;
      range.textContent = band.min + "〜" + upper + "点";
      row.appendChild(range);

      var note = document.createElement("span");
      note.className = "stars-band-note";
      note.textContent = band.note;
      row.appendChild(note);

      box.appendChild(row);
    });
  }

  /** 光害データの作成日・使った夜の数・参照地点 */
  function renderLightPollution() {
    return fetch("./data/lp-japan.json")
      .then(function (r) {
        if (!r.ok) throw new Error("meta");
        return r.json();
      })
      .then(function (meta) {
        var info = el("lp-meta");
        if (info) {
          var span = meta.dates && meta.dates.length
            ? meta.dates[meta.dates.length - 1] + " 〜 " + meta.dates[0]
            : "不明";
          info.textContent =
            "現在のデータ: " +
            (meta.dates ? meta.dates.length : 0) +
            "夜ぶん（" + span + "）を合成／" +
            "解像度 約" + (Math.round(meta.kmPerPixel * 10) / 10) + "km／" +
            "作成 " + String(meta.generatedAt).slice(0, 10) +
            "／出典 " + meta.credit;
        }

        var tbody = el("ref-rows");
        if (tbody && meta.references) {
          meta.references.forEach(function (ref) {
            var tr = document.createElement("tr");
            var th = document.createElement("th");
            th.scope = "row";
            th.textContent = ref.name;
            tr.appendChild(th);
            tr.appendChild(cell(String(ref.value)));
            tr.appendChild(cell(String(ref.emission)));
            tbody.appendChild(tr);
          });
        }
      })
      .catch(function () {
        var info = el("lp-meta");
        if (info) info.textContent = "光害データの情報を読み込めませんでした。";
      });
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function start() {
    renderBands();
    renderLightPollution();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(typeof window !== "undefined" ? window : globalThis);
