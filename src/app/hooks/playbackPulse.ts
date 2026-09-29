// 本体の再生の時計を**外から1歩進める**入口と、別窓が開いているかの印（ADR-0050）。
//
// ⚠️ **本体の窓が隠れると時計が止まる**＝時計は描く合図（`requestAnimationFrame`）で回るが、
// 窓が最小化される・別窓の全画面に覆われると合図が来なくなる（Windows では止め方を変える設定も効かない）。
// 別窓で再生を見ている間は、**別窓の合図で本体の時計を1歩ずつ進める**。位置の決め方は本体のまま
// （`playbackTick` は始めた実時刻から測る＝余計に呼ばれても位置はずれない）。

let pulse: (() => void) | null = null;
let previewOpen = false;

/** 本体の時計が、1歩進める関数を預ける（再生していないときは `null`）。 */
export function setPlaybackPulse(fn: (() => void) | null): void {
  pulse = fn;
}

/** 1歩進める（再生していなければ何もしない）。 */
export function pulsePlayback(): void {
  pulse?.();
}

/** 別窓が開いているか（本体で使う）。 */
export function setPreviewWindowOpen(open: boolean): void {
  previewOpen = open;
}

/**
 * 別窓が開いているか。⚠️ **本体が隠れても再生を止めない**ために使う＝別窓で見ているのに、
 * 本体が最小化されただけで止まると、別窓の意味が無くなる。
 */
export function isPreviewWindowOpen(): boolean {
  return previewOpen;
}
