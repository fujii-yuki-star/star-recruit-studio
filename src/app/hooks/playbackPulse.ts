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

let previewHidden = false;

/** 別窓が隠れているか（本体で使う・別窓からの知らせで変わる）。 */
export function setPreviewWindowHidden(hidden: boolean): void {
  previewHidden = hidden;
}

/**
 * **本体が隠れても再生を続けてよいか**＝別窓が開いていて、しかも見えているときだけ（時計は別窓の合図で進む）。
 * ⚠️ 別窓も隠れている（両方とも最小化）と合図が来ない＝時計は止まるのに音だけ実時間で進む（#1274 レビュー）。
 */
export function keepsPlayingWhileHidden(): boolean {
  return previewOpen && !previewHidden;
}
