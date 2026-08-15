/*
 * 起動。
 * このページは CSP の script-src を 'self' のままにしてあり、HTML に直接
 * <script> を書けないので、起動処理も外部ファイルに置いている。
 */
(function () {
  "use strict";

  function showFatal(message) {
    var status = document.getElementById("status");
    if (status) {
      status.hidden = false;
      status.textContent = message;
      status.classList.add("is-error");
    }
  }

  function boot() {
    if (!window.maplibregl) {
      showFatal("地図の読み込みに失敗しました。ページを再読み込みしてください。");
      return;
    }
    // MapLibre の "csp" ビルドは Web Worker を実ファイルから読む。
    // blob URL を使わないので、CSP を worker-src 'self' のままにできる。
    window.maplibregl.setWorkerUrl("./vendor/maplibre-gl-csp-worker.js");

    if (!window.StarsApp) {
      showFatal("ページの読み込みに失敗しました。再読み込みしてください。");
      return;
    }
    window.StarsApp.start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
