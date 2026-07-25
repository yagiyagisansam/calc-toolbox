// みんなの投票 ホーム(公開一覧の表示)
// クリックジャッキング対策: iframe内に埋め込まれたら自分自身をトップに出す
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.hidden = true; }
}

(function () {
  "use strict";

  function renderList(el, items, ranked, emptyMsg) {
    el.replaceChildren();
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "pb-empty";
      p.textContent = emptyMsg || "まだ公開アンケートがありません。最初の1件を作ってみましょう。";
      el.appendChild(p);
      return;
    }
    items.forEach(function (it, i) {
      var a = document.createElement("a");
      a.className = "pb-item";
      a.href = "./v.html?id=" + encodeURIComponent(it.id);
      if (ranked) {
        var rk = document.createElement("span");
        rk.className = "pb-rank";
        rk.textContent = i + 1;
        a.appendChild(rk);
      }
      var q = document.createElement("span");
      q.className = "qq";
      q.textContent = it.question;
      var t = document.createElement("span");
      t.className = "tt";
      t.textContent = Number(it.total).toLocaleString() + "票";
      a.appendChild(q);
      a.appendChild(t);
      el.appendChild(a);
    });
  }

  function fail(el) {
    el.replaceChildren();
    var p = document.createElement("p");
    p.className = "pb-empty";
    p.textContent = "読み込みに失敗しました。再読み込みしてください。";
    el.appendChild(p);
  }

  var popEl = document.getElementById("popular");
  var recEl = document.getElementById("recent");
  var popSeg = document.getElementById("pop-period");
  var popNote = document.getElementById("pop-note");
  var popRequest = 0;

  // 人気ランキング(期間別)。days=null は全期間
  function loadPopular(days, label) {
    var req = ++popRequest;
    popEl.replaceChildren();
    var loading = document.createElement("p");
    loading.className = "pb-empty";
    loading.textContent = "読み込み中…";
    popEl.appendChild(loading);
    popNote.textContent = days === null ? "投票数の多い順" : "直近" + label + "の投票数順";
    PollNet.listPublic("popular", 5, days).then(function (r) {
      if (req !== popRequest) return; // 古いリクエストの結果は捨てる
      if (r.ok) {
        renderList(popEl, r.items.filter(function (it) { return days === null || it.total > 0; }), true,
          days === null ? null : "この期間に投票されたアンケートはまだありません。");
      } else {
        fail(popEl);
      }
    });
  }

  [].forEach.call(popSeg.querySelectorAll("button"), function (btn) {
    btn.addEventListener("click", function () {
      [].forEach.call(popSeg.querySelectorAll("button"), function (b) { b.classList.toggle("on", b === btn); });
      var d = btn.dataset.days;
      loadPopular(d === "" ? null : parseInt(d, 10), btn.textContent);
    });
  });

  if (!PollNet.ready()) {
    document.getElementById("setup-note").hidden = false;
    popEl.replaceChildren();
    recEl.replaceChildren();
  } else {
    loadPopular(null, "");
    PollNet.listPublic("new", 10).then(function (r) {
      if (r.ok) renderList(recEl, r.items, false); else fail(recEl);
    });
  }

  // この端末で作ったアンケート(localStorage)
  var mine = [];
  try { mine = JSON.parse(window.localStorage.getItem("pollMine")) || []; } catch (e) { mine = []; }
  if (mine.length) {
    document.getElementById("mine-sec").hidden = false;
    var mineEl = document.getElementById("mine");
    mine.slice(0, 10).forEach(function (m) {
      var a = document.createElement("a");
      a.className = "pb-item";
      a.href = "./v.html?id=" + encodeURIComponent(m.id);
      var q = document.createElement("span");
      q.className = "qq";
      q.textContent = m.q;
      a.appendChild(q);
      mineEl.appendChild(a);
    });
  }
})();
