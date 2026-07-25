// Supabase REST APIとの通信(アンケートの保存・投票・集計の取得)
// config.js の POLL_CONFIG(プロジェクトURLとanonキー)を使う。
// anonキーは公開前提のキー。書き込み・読み取りの権限はデータベース側(RLS)で制限しており、
// クライアントからは「作成」「投票」「集計の取得(poll_results)」しかできない。
(function (global) {
  "use strict";

  function conf() {
    var c = global.POLL_CONFIG;
    return (c && typeof c.url === "string" && typeof c.anonKey === "string") ? c : null;
  }

  // 設定済みかどうか(未設定の間、ページは「準備中」を表示する)
  function ready() {
    var c = conf();
    return !!(c && c.url && c.anonKey);
  }

  function headers() {
    var c = conf();
    return {
      "apikey": c.anonKey,
      "Authorization": "Bearer " + c.anonKey,
      "Content-Type": "application/json"
    };
  }

  function base() { return conf().url.replace(/\/+$/, ""); }

  // アンケートを保存する。IDが既に使われていたら {ok:false, code:"conflict"}
  // isPublic=true ならホームの公開一覧に載る
  function createPoll(id, question, options, isPublic) {
    var h = headers();
    h["Prefer"] = "return=minimal";
    return fetch(base() + "/rest/v1/polls", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ id: id, question: question, options: options, is_public: !!isPublic })
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 409) return { ok: false, code: "conflict" };
      return { ok: false, code: "rejected" };
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  // 質問・選択肢・現在の票数を取得する。存在しないIDなら {ok:false, code:"not_found"}
  function getResults(id) {
    return fetch(base() + "/rest/v1/rpc/poll_results", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_id: id })
    }).then(function (r) {
      if (!r.ok) return { ok: false, code: "rejected" };
      return r.json().then(function (data) {
        if (!data || !data.question) return { ok: false, code: "not_found" };
        return { ok: true, poll: data };
      });
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  // 1票入れる。同じ端末(voter)からの2票目は {ok:false, code:"already_voted"}
  function vote(id, voter, choice) {
    var h = headers();
    h["Prefer"] = "return=minimal";
    return fetch(base() + "/rest/v1/votes", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ poll_id: id, voter: voter, choice: choice })
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 409) return { ok: false, code: "already_voted" };
      return { ok: false, code: "rejected" };
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  // 公開アンケート一覧(sort: "popular" | "new")
  function listPublic(sort, limit) {
    return fetch(base() + "/rest/v1/rpc/public_polls", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ p_sort: sort || "new", p_limit: limit || 20 })
    }).then(function (r) {
      if (!r.ok) return { ok: false, code: "rejected" };
      return r.json().then(function (data) {
        return { ok: true, items: Array.isArray(data) ? data : [] };
      });
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  // 問題のあるアンケートの通報(1端末につき同じアンケートへ1回)
  function report(pollId, reporter) {
    var h = headers();
    h["Prefer"] = "return=minimal";
    return fetch(base() + "/rest/v1/reports", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ poll_id: pollId, reporter: reporter })
    }).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 409) return { ok: true };
      return { ok: false, code: "rejected" };
    }).catch(function () { return { ok: false, code: "network" }; });
  }

  global.PollNet = { ready: ready, createPoll: createPoll, getResults: getResults, vote: vote, listPublic: listPublic, report: report };
})(window);
