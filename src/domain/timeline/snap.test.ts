// 帯の吸着（#686 段階4・ADR-0034 決定12）。
import { describe, expect, it } from 'vitest';
import { snapTime, timeSnapTargets, visibleTimeRange, TIME_SNAP_KIND } from './snap';

const clip = (id: string, startSec: number, durationSec: number) => ({ id, startSec, durationSec });

describe('timeSnapTargets（どこへ寄せるか）', () => {
  const base = {
    clips: [clip('clip_001', 0, 3), clip('clip_002', 5, 2)],
    exceptId: 'clip_001',
    playheadSec: 4,
    visible: { fromSec: 0, toSec: 20 },
  };

  it('再生位置・0秒・他の帯の端を集める', () => {
    expect(timeSnapTargets(base)).toEqual([
      { sec: 4, kind: TIME_SNAP_KIND.playhead },
      { sec: 0, kind: TIME_SNAP_KIND.origin },
      { sec: 5, kind: TIME_SNAP_KIND.clipEdge },
      { sec: 7, kind: TIME_SNAP_KIND.clipEdge },
    ]);
  });

  it('**自分自身は入れない**（自分の端に吸い付いても動かない）', () => {
    expect(timeSnapTargets(base).some((t) => t.sec === 3)).toBe(false); // clip_001 の終わり
  });

  it('**見えている時間帯の外は入れない**（なぜ止まったか分からない吸着を作らない）', () => {
    const narrow = timeSnapTargets({ ...base, visible: { fromSec: 4.5, toSec: 6 } });
    expect(narrow.map((t) => t.sec)).toEqual([5]); // 再生位置(4)も 0秒も画面の外
  });

  it('同じ時刻は二重に持たない（同点の判定が入力順で揺れる）', () => {
    const dup = timeSnapTargets({ ...base, playheadSec: 5 });
    expect(dup.filter((t) => t.sec === 5)).toHaveLength(1);
    expect(dup[0].kind).toBe(TIME_SNAP_KIND.playhead); // 意味の強い方が残る
  });
});

describe('snapTime（いちばん近い1つへ寄せる）', () => {
  const targets = [
    { sec: 5, kind: TIME_SNAP_KIND.clipEdge },
    { sec: 10, kind: TIME_SNAP_KIND.playhead },
  ] as const;

  it('しきい値の中なら寄せて、寄せ先を返す', () => {
    const r = snapTime({ edges: [4.9], targets: [...targets], thresholdSec: 0.2 });
    expect(r.deltaSec).toBeCloseTo(0.1, 6);
    expect(r.guide).toEqual({ sec: 5, kind: TIME_SNAP_KIND.clipEdge });
  });

  it('しきい値の外なら動かさない', () => {
    expect(snapTime({ edges: [4.5], targets: [...targets], thresholdSec: 0.2 }))
      .toEqual({ deltaSec: 0, guide: null });
  });

  it('**どちらの端でも寄る**（運ぶときは開始と終わりの両方を見る）', () => {
    // 帯 [3.0, 4.95) の**終わり**が 5 に近い＝全体を +0.05 動かす。
    const r = snapTime({ edges: [3, 4.95], targets: [...targets], thresholdSec: 0.2 });
    expect(r.deltaSec).toBeCloseTo(0.05, 6);
  });

  it('近い方を選ぶ（遠い方に引っぱられない）', () => {
    const r = snapTime({ edges: [9.9, 5.3], targets: [...targets], thresholdSec: 0.5 });
    expect(r.guide?.sec).toBe(10);
    expect(r.deltaSec).toBeCloseTo(0.1, 6);
  });

  it('同じ距離なら**先に渡された候補**（偶然に任せない）', () => {
    const r = snapTime({ edges: [7.5], targets: [...targets], thresholdSec: 3 });
    expect(r.guide?.sec).toBe(5); // 5 と 10 は等距離＝先頭を採る
  });

  it('ちょうど重なっていても**寄せ先は返す**（線が出ないと理由が読めない）', () => {
    const r = snapTime({ edges: [5], targets: [...targets], thresholdSec: 0.2 });
    expect(r.deltaSec).toBe(0);
    expect(r.guide).not.toBeNull();
  });

  it('しきい値が 0 以下なら効かせない（倍率が測れないときに全部吸い付かない）', () => {
    expect(snapTime({ edges: [5], targets: [...targets], thresholdSec: 0 }))
      .toEqual({ deltaSec: 0, guide: null });
  });

  it('候補が無ければ動かさない', () => {
    expect(snapTime({ edges: [5], targets: [], thresholdSec: 1 })).toEqual({ deltaSec: 0, guide: null });
  });
});

describe('visibleTimeRange（見えている時間帯）', () => {
  const base = { scrollLeft: 360, clientWidth: 900, labelPx: 84, pxPerSec: 36 };

  it('左端は**送った量そのもの**（列の名前の欄ぶんを引かない）', () => {
    // ⚠️ 引くと欄の裏に隠れているぶん（84px＝36px/秒で 2.3秒）まで寄り先に入り、
    // 見えない時刻に線が出る。時刻 t の位置は「欄の幅 + t×倍率」なので、送った量＝左端の時刻。
    expect(visibleTimeRange(base).fromSec).toBeCloseTo(10, 6);
  });

  it('右端は**欄が隠すぶん**を引く（欄は左に貼り付いている）', () => {
    expect(visibleTimeRange(base).toSec).toBeCloseTo((360 + 900 - 84) / 36, 6);
  });

  it('先頭では 0 から（負にしない）', () => {
    expect(visibleTimeRange({ ...base, scrollLeft: 0 }).fromSec).toBe(0);
  });

  it('欄より狭い枠でも左右が逆転しない', () => {
    expect(visibleTimeRange({ ...base, scrollLeft: 0, clientWidth: 40 }))
      .toEqual({ fromSec: 0, toSec: 0 });
  });

  it('倍率が測れないときは空（全部が寄り先になるのを防ぐ）', () => {
    expect(visibleTimeRange({ ...base, pxPerSec: 0 })).toEqual({ fromSec: 0, toSec: 0 });
  });
});
