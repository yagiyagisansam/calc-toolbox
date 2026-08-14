/*
 * ブラウザで tests.json を流すだけの確認用ページの中身。
 *
 * もともと test.html にインラインで書いていたが、そのためだけに
 * このページの CSP が script-src に 'unsafe-inline' を許していた。
 * 公開されるページで例外を1つ残すより、ファイルに出して
 * 他のページと同じ script-src 'self' に揃えるほうがよい。
 *
 * 表の組み立ても innerHTML をやめて要素を作る形にしてある
 * (このサイトで innerHTML を使う場所を1つも残さないため)。
 */
(function () {
  "use strict";

  /** Node用ランナー(scripts/run_tests.mjs)と同じ「期待値の部分一致」判定 */
  function matches(expect, actual) {
    if (expect !== null && typeof expect === "object") {
      if (actual === null || typeof actual !== "object") return false;
      return Object.keys(expect).every(function (k) {
        return matches(expect[k], actual[k]);
      });
    }
    return expect === actual;
  }

  function cell(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  fetch("./tests.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (spec) {
      // 単一モジュール形式(module/global)と複数モジュール形式(modules)の両方に対応する
      var globals = spec.modules ? Object.keys(spec.modules) : [spec.global];
      var defaultGlobal = spec.global || globals[0];
      var rows = document.getElementById("rows");
      var pass = 0;

      spec.cases.forEach(function (c) {
        var actual;
        var ok;
        try {
          var api = window[c.global || defaultGlobal];
          if (!api) throw new Error("モジュールが読み込まれていません: " + (c.global || defaultGlobal));
          actual = api[c.func].apply(null, c.args);
          ok = matches(c.expect, actual);
        } catch (err) {
          actual = String(err);
          ok = false;
        }
        if (ok) pass++;

        var tr = document.createElement("tr");
        tr.appendChild(cell(ok ? "OK" : "NG"));
        tr.appendChild(cell(c.name));
        tr.appendChild(
          cell(ok ? "" : "期待: " + JSON.stringify(c.expect) + " / 実際: " + JSON.stringify(actual))
        );
        rows.appendChild(tr);
      });

      document.getElementById("summary").textContent =
        pass + " / " + spec.cases.length + " 件通過" + (pass === spec.cases.length ? "(全通過)" : "(失敗あり)");
    })
    .catch(function (err) {
      document.getElementById("summary").textContent = "tests.json を読み込めませんでした: " + err;
    });
})();
