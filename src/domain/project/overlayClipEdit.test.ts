import { describe, expect, it } from 'vitest';
import { TIMELINE_MIN_CLIP_SEC } from '../constants';
import { applyClipEdge } from './overlayClipEdit';

// #561：以前は「差分」で受け渡し、送り手と受け手が同じ下限で二重にクランプしていたため、下限へ厳密に戻らなかった。
// 最小長 0.5 では `5 - 4.5` が二進で厳密なので辻褄が合っていただけで、0.1 にすると下限割れ／17桁が出る。
// この関数が**唯一のクランプ**になったので、下限に当たった長さは**定数そのもの**になる。
const MIN = TIMELINE_MIN_CLIP_SEC;

describe('applyClipEdge（クリップの端を動かす・#561）', () => {
  const clip = { startSec: 2, durationSec: 3 }; // end = 5

  it('move：開始を動かす（長さは変えない）', () => {
    expect(applyClipEdge(clip, 'move', 4, 0, MIN)).toEqual({ startSec: 4, durationSec: 3 });
  });

  it('move：開始の下限でクランプする（下限は呼び出し側の座標系＝アンカー開始/0）', () => {
    expect(applyClipEdge(clip, 'move', -10, 0, MIN)).toEqual({ startSec: 0, durationSec: 3 });
    // グローバル秒で呼ぶ場合＝アンカー場面の開始より前へは行かない。
    expect(applyClipEdge({ startSec: 12, durationSec: 3 }, 'move', 5, 10, MIN)).toEqual({ startSec: 10, durationSec: 3 });
  });

  it('trim-end：終了を動かして長さを変える（開始は固定）', () => {
    expect(applyClipEdge(clip, 'trim-end', 8, 0, MIN)).toEqual({ startSec: 2, durationSec: 6 });
  });

  it('trim-start：開始を動かして長さを変える（終了は固定）', () => {
    expect(applyClipEdge(clip, 'trim-start', 3, 0, MIN)).toEqual({ startSec: 3, durationSec: 2 });
  });

  it('trim-start：開始の下限でクランプし、長さは終了から逆算する', () => {
    expect(applyClipEdge(clip, 'trim-start', -10, 0, MIN)).toEqual({ startSec: 0, durationSec: 5 });
  });

  // 本題：下限に当たったときの長さが**定数と厳密に一致**する（0.1 でも端数が出ない）。
  it('最小長でクランプしたときの長さは定数そのもの（端数も下限割れも出ない）', () => {
    const byEnd = applyClipEdge(clip, 'trim-end', -100, 0, MIN);
    expect(byEnd.durationSec).toBe(MIN); // 0.09999999999999964 でも 0.10000000000000009 でもない
    const byStart = applyClipEdge(clip, 'trim-start', 100, 0, MIN);
    expect(byStart.durationSec).toBe(MIN);
    expect(byStart.startSec).toBeGreaterThanOrEqual(0);
  });

  // 二重クランプ（＝送り手がクランプ済みの端を渡してくる）でも結果が動かない。
  // プレビュー（TimelineView）と確定（editClip）が同じ関数を通す以上、この性質が「ドロップでスナップバックしない」の根拠になる。
  it('もう一度同じ関数へ通しても結果が変わらない（冪等）', () => {
    for (const mode of ['move', 'trim-start', 'trim-end'] as const) {
      for (const edge of [-100, -1, 0, 2.5, 4.999, 100]) {
        const once = applyClipEdge(clip, mode, edge, 0, MIN);
        const edge2 = mode === 'trim-end' ? once.startSec + once.durationSec : once.startSec;
        expect(applyClipEdge(once, mode, edge2, 0, MIN), `${mode}/${edge}`).toEqual(once);
      }
    }
  });

  // 旧実装は `Math.min(Math.max(0, …), end - MIN)` の順で、end < MIN のとき開始が負になり
  // schema（`OverlayClip.startSec >= 0`）を破っていた。到達性は UI でなく schema 基準で見る。
  it('極端に短いクリップでも開始が下限を割らない（schema の startSec ≥ 0 を優先）', () => {
    const tiny = { startSec: 0, durationSec: MIN / 2 }; // end < MIN（壊れた/古いデータ）
    const r = applyClipEdge(tiny, 'trim-start', 100, 0, MIN);
    expect(r.startSec).toBe(0);
    expect(r.durationSec).toBeGreaterThan(0); // schema: durationSec > 0
  });

  // #561 の再現条件を総当たりで潰す。旧経路（`長さ + (クランプ済みの端 - 元の端)`）は代表値の多くで下限へ戻らなかった。
  // ここでは**不変条件**を直接見る：長さは下限を下回らず、下限で止まったなら定数と厳密に一致し、開始は 0 未満にならない。
  it('端をどこへ動かしても、下限割れ・端数・負の開始が出ない（総当たり）', () => {
    const olds = [
      { startSec: 0, durationSec: 3 }, { startSec: 2, durationSec: 3 },
      { startSec: 1.7, durationSec: 0.35 }, { startSec: 12.5, durationSec: 8 },
    ];
    let atMin = 0;
    for (const old of olds) {
      const end = old.startSec + old.durationSec;
      for (let i = -50; i <= 250; i++) {
        const edge = old.startSec + i / 10; // 0.1 刻みの代表値
        for (const mode of ['move', 'trim-start', 'trim-end'] as const) {
          const r = applyClipEdge(old, mode, edge, 0, MIN);
          expect(r.startSec, `${mode}/${edge}`).toBeGreaterThanOrEqual(0);
          expect(r.durationSec, `${mode}/${edge}`).toBeGreaterThan(0);
          if (mode !== 'move') {
            expect(r.durationSec, `${mode}/${edge}`).toBeGreaterThanOrEqual(MIN); // 0.09999999999999964 を出さない
            if (r.durationSec <= MIN) { expect(r.durationSec).toBe(MIN); atMin++; } // 0.10000000000000009 も出さない
            // 動かしていない側の端は保つ（trim は片側固定）。
            if (mode === 'trim-end') expect(r.startSec).toBe(old.startSec);
            else expect(r.startSec + r.durationSec).toBeCloseTo(end, 10);
          }
        }
      }
    }
    expect(atMin).toBeGreaterThan(0); // 下限に当たるケースを実際に通っている（空振りで緑にしない）
  });

  // 0.1 秒格子へ量子化していないことの担保（#561 の設計判断）。
  // 量子化すると格子に乗らない場面境界への吸着が黙って捨てられる（3.25 へ合わせたのに 3.3 へ動く）。
  it('格子に乗らない位置へも合わせられる（ドラッグ結果を量子化しない）', () => {
    expect(applyClipEdge(clip, 'move', 3.25, 0, MIN).startSec).toBe(3.25);
    expect(applyClipEdge(clip, 'trim-end', 5.25, 0, MIN).durationSec).toBe(3.25);
  });
});
