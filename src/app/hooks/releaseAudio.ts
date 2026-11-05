// 鳴らし終えた音の後片づけ（負荷・耐久の点検 2026-10-22）。
//
// 前は止めるとき `pause()` だけだった＝要素が音源（数十 MB になる data URL も）を掴んだまま、
// 捨てられるまで再生の資源（読み込んだ音・再生器）を持ち続けた。止める所でこれを呼ぶ。
// ⚠️ **自分で `new Audio()` した要素だけ**に使う＝React が描く `<audio>`／`<video>` に使うと、
//   開発時の StrictMode（同じ要素で外して付け直す）で `src` が戻らず、黙って鳴らなくなる。

/** 止めて、音源を外して、読み込んだものを手放す（同じ要素はもう使わない）。 */
export function releaseAudio(el: HTMLAudioElement): void {
  try {
    el.pause();
  } catch {
    /* 停止できない環境でも続ける */
  }
  el.onended = null;
  el.removeAttribute("src");
  try {
    // `src` を外した後の `load()` が、読み込んだ音と再生器を手放す合図（HTML の仕様の「空にする」手順）。
    el.load();
  } catch {
    /* 非実装（jsdom）でも無害 */
  }
}
