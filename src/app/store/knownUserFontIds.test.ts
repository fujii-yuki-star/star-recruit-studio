// 書き出しの門へ渡してよい**持ち込みフォントの一覧**（PR #909 レビュー 🟡）。
//
// ⚠️ **門そのもののテストでは守れない**＝`exportStartBlock` は入力を直接受け取るので、
// **渡す側**を間違えても門のテストは緑のまま通る（実際に見落とした）。ここで配線を固定する。
import { beforeEach, describe, expect, it } from 'vitest';
import { knownUserFontIds } from './timelineStore';
import { useProjectStore } from './projectStore';

beforeEach(() => {
  useProjectStore.setState({ userFontIds: null, userFontsUnreadable: false } as never);
});

describe('knownUserFontIds（タイムライン形式の門へ渡す一覧）', () => {
  it('まだ調べていなければ渡さない', () => {
    expect(knownUserFontIds()).toBeNull();
  });

  it('調べてあれば渡す', () => {
    useProjectStore.setState({ userFontIds: ['user_font_001'] } as never);
    expect([...(knownUserFontIds() ?? [])]).toEqual(['user_font_001']);
  });

  /**
   * ⚠️ **一度成功したあとに読めなくなると、一覧は古いまま残る**＝それを「調べた」ものとして
   * 使うと、もう手元に無いフォントを**あることにして**書き出してしまう（ADR-0038）。
   * 場面形式の2画面（`ExportScreen`／`PrecheckScreen`）と同じ規則にする（ADR-0026②）。
   */
  it('読めなかったときは、古い一覧を渡さない', () => {
    useProjectStore.setState({ userFontIds: ['user_font_001'], userFontsUnreadable: true } as never);
    expect(knownUserFontIds()).toBeNull();
  });
});
