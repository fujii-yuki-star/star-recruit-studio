import { beforeEach, describe, expect, it } from 'vitest';
import { useStartupJobStore } from './startupJobStore';

// 頼まれた書き出し先の持ち回り（ADR-0042・#1184）。
// ⚠️ **store 単体でも留める**（PR レビュー 🟡）＝画面ごしにしか見ていないと、
// 画面の作りが変わったときに**この約束だけ壊れても緑のまま**になる。
describe('頼まれた書き出し先', () => {
  beforeEach(() => {
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null });
  });

  // ⚠️ **1回きり**＝残すと、次に人が押した書き出しまで同じ所へ書く。
  it('取り出せるのは1回だけ', () => {
    const st = useStartupJobStore.getState();
    st.setPendingExport('C:/頼まれた.mp4', true);
    expect(st.takePendingExport()).toEqual({ out: 'C:/頼まれた.mp4', forwarded: true });
    expect(useStartupJobStore.getState().pendingExportOut, '取り出したのに残っている').toBeNull();
    expect(st.takePendingExport(), '2回目も取り出せている').toBeNull();
  });

  it('頼まれていなければ、何も返さない', () => {
    expect(useStartupJobStore.getState().takePendingExport()).toBeNull();
  });

  // ⚠️ **渡された回かどうかを連れていく**＝終わったときに閉じてよいかの判断に要る（決定③）。
  it('渡された回かどうかを、そのまま連れていく', () => {
    const st = useStartupJobStore.getState();
    st.setPendingExport('C:/a.mp4', false);
    expect(st.takePendingExport()?.forwarded).toBe(false);
  });
});

// 起動のときに何か頼まれているか（PR #1197 レビュー 🔴）。
// ⚠️ **これが「分からない」の間は、自動で動画を開いてはいけない**＝開くと、
// AI が指した動画ではなく**直前の動画が書き出される**（しかも成功として返る）。
describe('頼まれごとが分かったか', () => {
  it('最初は「分からない」', () => {
    useStartupJobStore.setState({ requestKnown: 'unknown' });
    expect(useStartupJobStore.getState().requestKnown).toBe('unknown');
  });

  it('分かったら、頼まれごとの有無で答えが変わる', () => {
    useStartupJobStore.getState().setRequestKnown('job');
    expect(useStartupJobStore.getState().requestKnown).toBe('job');
    useStartupJobStore.getState().setRequestKnown('none');
    expect(useStartupJobStore.getState().requestKnown).toBe('none');
  });
});
