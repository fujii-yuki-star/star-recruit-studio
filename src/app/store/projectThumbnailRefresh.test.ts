// 一覧の小さな絵の焼き直し判定（#397・PR #889 レビュー 🟡）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/projectFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/projectFs')>()),
  saveProjectThumbnail: vi.fn(async () => {}),
}));
vi.mock('../../renderer/export/projectThumbnail', () => ({
  renderProjectThumbnail: vi.fn(async () => 'data:image/png;base64,AA=='),
}));

import { useProjectStore } from './projectStore';
import { saveProjectThumbnail } from '../../infrastructure/projectFs';
import { renderProjectThumbnail } from '../../renderer/export/projectThumbnail';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';

const template = { templateId: 'tmpl_001', category: 'title', layers: [] } as unknown as Template;
const scene = { sceneId: 'scene_001', templateId: 'tmpl_001', durationSec: 5 } as unknown as Scene;

/** 同じ中身（＝同じ印になる）の状態を作る。複製直後がまさにこの形。 */
function setSameContent(): void {
  useProjectStore.setState({
    scenes: [scene],
    assets: [],
    templates: [template],
    assetSrcById: {},
    templateAssetSrcById: {},
  } as never);
}

beforeEach(() => {
  vi.mocked(saveProjectThumbnail).mockClear();
  vi.mocked(renderProjectThumbnail).mockClear();
  setSameContent();
});
afterEach(() => vi.clearAllMocks());

// ⚠️ 印は**1つだけ**を覚える（画面の都合の値なので文書にも store にも持たない）＝
// テストごとに別の動画 id を使い、前のテストの印に依存しないようにする。
describe('_refreshProjectThumbnail（焼き直しを飛ばす判定）', () => {
  const refresh = (id: string) => useProjectStore.getState()._refreshProjectThumbnail(id);

  it('同じ動画で絵に効くものが変わっていなければ焼き直さない', async () => {
    await refresh('proj_a1');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1);
    await refresh('proj_a1');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1); // 2回目は飛ばす
  });

  /**
   * ⚠️ **中身が同じ別の動画は飛ばさない**（PR #889 レビュー 🟡）。
   * 複製した直後は元と中身が同一＝印も同じになるので、印だけで比べると
   * **一度も焼いていない側の絵が焼かれないまま**になる（一覧に絵が出ない）。
   */
  it('中身が同じでも別の動画なら焼く', async () => {
    await refresh('proj_b1');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1);
    await refresh('proj_b2'); // 複製直後＝中身が同一なので印も同じ
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveProjectThumbnail).mock.calls[1][0]).toBe('proj_b2');
  });

  it('絵に効くものが変われば同じ動画でも焼き直す', async () => {
    await refresh('proj_c1');
    useProjectStore.setState({ scenes: [{ ...scene, durationSec: 9 }] } as never);
    await refresh('proj_c1');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(2);
  });

  /** ⚠️ 描けなかったときは印を覚えない（次の保存でもう一度試す＝一覧が永久に絵なしにならない）。 */
  it('描けなかったら印を覚えない（次にまた試す）', async () => {
    vi.mocked(renderProjectThumbnail).mockResolvedValueOnce(null as never);
    await refresh('proj_d1');
    expect(saveProjectThumbnail).not.toHaveBeenCalled();
    await refresh('proj_d1');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1);
  });
});
