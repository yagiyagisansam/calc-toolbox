// Supabaseプロジェクトの接続設定(セットアップ完了後に値を入れる)
// - url:     プロジェクトURL(例: "https://abcdefghijklmnop.supabase.co")
// - anonKey: 公開用のanonキー(公開しても安全な設計のキー)
// 注意: 秘密の service_role キーは絶対にここへ書かないこと。
// 両方が空の間は、アンケート作成・投票ページに「準備中」と表示される。
var POLL_CONFIG = {
  url: "",
  anonKey: ""
};
