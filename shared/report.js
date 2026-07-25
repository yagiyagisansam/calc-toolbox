// 不具合の報告(report.html)
// 送信先はアンケートツールと同じSupabaseプロジェクト。接続設定は tools/poll/config.js を共用する。
// anonキーは公開前提のキーで、このページからできるのは bug_reports へのINSERTだけ(RLSと列権限で制限)。
// CSPで require-trusted-types-for 'script' を指定しているため、DOMの組み立てに innerHTML は使わない。
(function () {
  "use strict";

  var form = document.getElementById("report-form");
  var toolSel = document.getElementById("tool");
  var msg = document.getElementById("message");
  var btn = document.getElementById("send-btn");
  var box = document.getElementById("report-result");
  if (!form || !toolSel || !msg || !btn || !box) return;

  // ---- 表示 ----
  function show(text, isError) {
    box.textContent = "";
    var p = document.createElement("p");
    if (isError) p.className = "result-error";
    p.textContent = text;
    box.appendChild(p);
    box.hidden = false;
  }

  // ---- 端末識別子(連投の抑制にだけ使う。個人を特定する情報は含まない) ----
  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function reporterId() {
    var s = storage();
    var key = "bugReporter";
    var id = s ? s.getItem(key) : null;
    if (typeof id === "string" && id.length >= 8 && id.length <= 64) return id;
    var buf = new Uint8Array(16);
    window.crypto.getRandomValues(buf);
    id = Array.prototype.map.call(buf, function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
    if (s) { try { s.setItem(key, id); } catch (e) { /* 保存できなくても送信はできる */ } }
    return id;
  }

  // ---- URLの ?tool= でツールを初期選択する ----
  function preselect() {
    var m = /[?&]tool=([a-z0-9-]{1,40})(&|$)/.exec(window.location.search);
    if (!m) return;
    var slug = m[1];
    for (var i = 0; i < toolSel.options.length; i++) {
      if (toolSel.options[i].value === slug) { toolSel.selectedIndex = i; return; }
    }
  }

  // ---- 送信 ----
  function conf() {
    var c = window.POLL_CONFIG;
    return (c && typeof c.url === "string" && c.url && typeof c.anonKey === "string" && c.anonKey) ? c : null;
  }

  function send(tool, message) {
    var c = conf();
    return fetch(c.url.replace(/\/+$/, "") + "/rest/v1/bug_reports", {
      method: "POST",
      headers: {
        "apikey": c.anonKey,
        "Authorization": "Bearer " + c.anonKey,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ tool: tool, message: message, reporter: reporterId() })
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 429) return { ok: false, code: "rate" };
      return { ok: false, code: "rejected" };
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var tool = toolSel.value;
    var text = msg.value.trim();
    if (!tool) { show("どのツールの不具合かを選んでください。", true); return; }
    if (text.length < 5) { show("不具合の内容を5文字以上で書いてください。", true); return; }
    if (text.length > 1000) { show("不具合の内容は1000文字までです。", true); return; }
    if (!conf()) { show("ただいま報告を受け付けられません。時間をおいて試してください。", true); return; }

    btn.disabled = true;
    show("送信しています…", false);
    send(tool, text).then(function (r) {
      if (r.ok) {
        form.hidden = true;
        show("送信しました。ご協力ありがとうございます。", false);
        return;
      }
      btn.disabled = false;
      if (r.code === "network") {
        show("通信に失敗しました。電波の良い場所で試してください。", true);
      } else if (r.code === "rate") {
        show("短時間に多く送信されています。しばらく待ってから試してください。", true);
      } else {
        show("送信できませんでした。しばらく待ってから試してください。", true);
      }
    });
  });

  preselect();
})();
