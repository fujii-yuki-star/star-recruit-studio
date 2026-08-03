// @vitest-environment jsdom
// 欄の配置の保存（ADR-0033 決定4/5）。**設定のせいで画面が開けない**を作らないことを固定する。
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPanelLayout, getPanelLayout, setPanelLayout } from './appSettings';
import { emptyLayout } from '../domain/layout/panelLayout';

beforeEach(() => {
  localStorage.clear();
});

describe('欄の配置の保存', () => {
  it('保存したものを読み戻せる', () => {
    setPanelLayout('timeline', { ...emptyLayout(), left: { panelId: 'a' } });
    expect(getPanelLayout('timeline')).toEqual({ ...emptyLayout(), left: { panelId: 'a' } });
  });

  it('画面ごとに分けて持つ（別の画面の配置を読まない）', () => {
    setPanelLayout('timeline', { ...emptyLayout(), left: { panelId: 'a' } });
    expect(getPanelLayout('scene')).toBeNull();
  });

  it('まだ何も保存していなければ null（呼び出し側が既定を使う）', () => {
    expect(getPanelLayout('timeline')).toBeNull();
  });

  it('壊れた値は「無い」と同じ扱い（読めない設定で画面を開けなくしない）', () => {
    localStorage.setItem('app.panelLayout.timeline', '{壊れた');
    expect(getPanelLayout('timeline')).toBeNull();
  });

  it('JSON として読めても形が違えば落ちない（手で書いた・別の版が書いた値）', () => {
    // 数値が入っている／`sizes` が無い／子が配列でない、のいずれでも例外を投げず、描ける形か null を返す。
    for (const broken of ['{"left":5}', '{"left":{"dir":"column","children":[{"panelId":"a"},{"panelId":"b"}]}}', '{"left":{"children":"x"}}', '[]']) {
      localStorage.setItem('app.panelLayout.timeline', broken);
      expect(() => getPanelLayout('timeline')).not.toThrow();
    }
    // `sizes` が無いだけなら、等分として読めるので中身は残る（黙って捨てない）。
    localStorage.setItem('app.panelLayout.timeline', '{"left":{"dir":"column","children":[{"panelId":"a"},{"panelId":"b"}]}}');
    expect(getPanelLayout('timeline')?.left).not.toBeNull();
  });

  it('「配置を既定に戻す」＝保存を消す（次に開くと既定が使われる）', () => {
    setPanelLayout('timeline', { ...emptyLayout(), left: { panelId: 'a' } });
    clearPanelLayout('timeline');
    expect(getPanelLayout('timeline')).toBeNull();
  });
});
