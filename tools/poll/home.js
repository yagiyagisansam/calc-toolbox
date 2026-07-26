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
      p.textContent = emptyMsg || T("まだ公開アンケートがありません。最初の1件を作ってみましょう。");
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
      t.textContent = T("{n}票", { n: Number(it.total).toLocaleString() });
      a.appendChild(q);
      a.appendChild(t);
      el.appendChild(a);
    });
  }

  function fail(el) {
    el.replaceChildren();
    var p = document.createElement("p");
    p.className = "pb-empty";
    p.textContent = T("読み込みに失敗しました。再読み込みしてください。");
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
    loading.textContent = T("読み込み中…");
    popEl.appendChild(loading);
    popNote.textContent = days === null ? T("投票数の多い順") : T("直近{period}の投票数順", { period: label });
    PollNet.listPublic("popular", 5, days).then(function (r) {
      if (req !== popRequest) return; // 古いリクエストの結果は捨てる
      if (r.ok) {
        renderList(popEl, r.items.filter(function (it) { return days === null || it.total > 0; }), true,
          days === null ? null : T("この期間に投票されたアンケートはまだありません。"));
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
  // 作成時に保存した削除キー(m.k)があるものは、この端末から自分で削除できる
  var MINE_KEY = "pollMine";
  var mine = [];
  try { mine = JSON.parse(window.localStorage.getItem(MINE_KEY)) || []; } catch (e) { mine = []; }

  function saveMine(list) {
    try { window.localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch (e) { /* 保存不可は無視 */ }
  }

  var mineSec = document.getElementById("mine-sec");
  var mineEl = document.getElementById("mine");
  var confirmBg = document.getElementById("del-confirm-bg");
  var confirmQ = document.getElementById("del-confirm-q");
  var pendingDelete = null;

  var delError = document.getElementById("del-error");

  function closeConfirm() {
    confirmBg.hidden = true;
    delError.hidden = true;
    pendingDelete = null;
  }

  function renderMine() {
    mineEl.replaceChildren();
    if (!mine.length) { mineSec.hidden = true; return; }
    mineSec.hidden = false;
    mine.slice(0, 10).forEach(function (m) {
      var row = document.createElement("div");
      row.className = "pb-item-row";

      var a = document.createElement("a");
      a.className = "pb-item";
      a.href = "./v.html?id=" + encodeURIComponent(m.id);
      var q = document.createElement("span");
      q.className = "qq";
      q.textContent = m.q;
      a.appendChild(q);
      row.appendChild(a);

      if (m.k) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "pb-item-del";
        del.textContent = T("削除");
        del.setAttribute("aria-label", T("{q} を削除する", { q: m.q }));
        del.addEventListener("click", function () {
          pendingDelete = m;
          confirmQ.textContent = m.q;
          delError.hidden = true;
          confirmBg.hidden = false;
          document.getElementById("del-no").focus();
        });
        row.appendChild(del);
      }
      mineEl.appendChild(row);
    });
  }

  document.getElementById("del-no").addEventListener("click", closeConfirm);
  confirmBg.addEventListener("click", function (e) { if (e.target === confirmBg) closeConfirm(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !confirmBg.hidden) closeConfirm();
  });

  document.getElementById("del-yes").addEventListener("click", function () {
    if (!pendingDelete) return;
    var target = pendingDelete;
    var btn = this;
    btn.disabled = true;
    btn.textContent = T("削除中…");
    PollNet.deletePoll(target.id, target.k).then(function (r) {
      btn.disabled = false;
      btn.textContent = T("はい、削除する");
      if (r.ok || r.code === "not_owner") {
        // 削除できた場合と、既に消えている場合はこの端末の一覧からも消す
        closeConfirm();
        mine = mine.filter(function (x) { return x.id !== target.id; });
        saveMine(mine);
        renderMine();
      } else {
        delError.textContent = T("削除できませんでした。通信状況を確認して、もう一度お試しください。");
        delError.hidden = false;
      }
    });
  });

  renderMine();
})();
