/*
 * 言語切替のリンクにクエリ文字列を引き継ぐ
 *
 * 投票ページ(tools/poll/v.html)のように「?id=…」で中身が決まるページでは、
 * 言語を切り替えたときに同じクエリのまま移動する必要がある。
 * 言語切替の帯は scripts/build/i18n/inject_links.mjs がパスだけで生成するため、
 * クエリはこのスクリプトが実行時に足す。
 *
 * 読み込むのは noindex のページだけ(inject_links.mjs が自動で付ける)。
 */
(function () {
  "use strict";
  var q = location.search;
  if (!q) return;
  var links = document.querySelectorAll("nav.lang-switch a[href]");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href");
    if (href.indexOf("?") === -1) links[i].setAttribute("href", href + q);
  }
})();
