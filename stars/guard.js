/*
 * ページの入り口で効かせる小さな防御。各ページで最初に読み込む。
 *
 * ここで扱うのは「HTTPヘッダーを付けられない配信先」でも効かせられるものだけ。
 * このサイトは GitHub Pages で配信していて、X-Frame-Options や
 * Content-Security-Policy の frame-ancestors のような
 * *ヘッダーでしか効かない* 指定が使えない
 * (frame-ancestors は <meta> に書いても browser に無視される)。
 * その穴をスクリプト側で塞ぐ。
 */
(function (global) {
  "use strict";

  /*
   * 枠(iframe)の中で表示されるのを拒む。
   *
   * 狙いはクリックジャッキング ── 他所のページがこのサイトを透明な枠で重ね、
   * 利用者が別のものを押したつもりで「申請」ボタンを押させる手口。
   * 申請は管理者が承認するまで公開されないので被害は限定的だが、
   * 枠の中で開く正当な理由がそもそも無いので一律で拒む。
   *
   * 上位ページの場所は読み取れない(別オリジンなら例外になる)ので、
   * 読み取れたかどうかで判断せず、「自分が最上位か」だけを見る。
   */
  try {
    if (global.top !== global.self) {
      // 枠から抜け出す。抜けられない場合(sandbox 指定など)に備えて中身も隠す。
      global.top.location = global.self.location.href;
      document.documentElement.style.display = "none";
    }
  } catch (e) {
    // 上位が別オリジンで location を書けない = 抜け出せない。中身を出さない。
    document.documentElement.style.display = "none";
  }
})(typeof window !== "undefined" ? window : globalThis);
