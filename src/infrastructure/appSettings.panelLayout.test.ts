// @vitest-environment jsdom
// 欄の配置の保存（ADR-0033 決定4/5）。**設定のせいで画面が開けない**を作らないことを固定する。
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPanelLayout, getPanelLayout, setPanelLayout } from './appSettings';

beforeEach(() => {
  localStorage.clear();
});

describe('欄の配置の保存', () => {
  it('保存したものを読み戻せる', () => {
    setPanelLayout('timeline', { left: { panelId: 'a' } });
    expect(getPanelLayout('timeline')).toEqual({ left: { panelId: 'a' } });
  });

  it('画面ごとに分けて持つ（別の画面の配置を読まない）', () => {
    setPanelLayout('timeline', { left: { panelId: 'a' } });
    expect(getPanelLayout('scene')).toBeNull();
  });

  it('まだ何も保存していなければ null（呼び出し側が既定を使う）', () => {
    expect(getPanelLayout('timeline')).toBeNull();
  });

  it('壊れた値は「無い」と同じ扱い（読めない設定で画面を開けなくしない）', () => {
    localStorage.setItem('app.panelLayout.timeline', '{壊れた');
    expect(getPanelLayout('timeline')).toBeNull();
  });

  it('「配置を既定に戻す」＝保存を消す（次に開くと既定が使われる）', () => {
    setPanelLayout('timeline', { left: { panelId: 'a' } });
    clearPanelLayout('timeline');
    expect(getPanelLayout('timeline')).toBeNull();
  });
});
