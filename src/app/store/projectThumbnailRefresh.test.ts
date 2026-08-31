// 一覧の小さな絵の焼き直し判定（#397・PR #889 レビュー 🟡）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/projectFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/projectFs')>()),
  saveProjectThumbnail: vi.fn(async () => {}),
  deleteProjectDoc: vi.fn(async () => {}),
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

// 消した動画へ**一覧の絵を書かない**（#927）。
//
// ⚠️ 焼き込みは保存の後に**投げっぱなし**で走るので `saveInFlight` に入らず、**削除の待ちからも
// 外れていた**＝消した後に着地すると `preview.png` だけのフォルダが復活する（一覧には出ないので
// 利用者からは気づけない残骸）。
describe('消した動画には焼かない（#927）', () => {
  it('削除のあとに焼き込みが来ても書かない', async () => {
    // 描くところまでは行くが、書く手前で止める（描画は止められない＝既に走っている）。
    await useProjectStore.getState().deleteProject('proj_gone');
    vi.mocked(saveProjectThumbnail).mockClear();
    await useProjectStore.getState()._refreshProjectThumbnail('proj_gone');
    expect(saveProjectThumbnail).not.toHaveBeenCalled();
  });

  it('別の動画は今までどおり焼く（消した1つだけを止める）', async () => {
    await useProjectStore.getState().deleteProject('proj_gone2');
    vi.mocked(saveProjectThumbnail).mockClear();
    await useProjectStore.getState()._refreshProjectThumbnail('proj_alive');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1);
  });

  it('消せなかったら印を戻す（消えていないのに焼けない、を作らない）', async () => {
    const { deleteProjectDoc } = await import('../../infrastructure/projectFs');
    vi.mocked(deleteProjectDoc).mockRejectedValueOnce(new Error('消せない'));
    await expect(useProjectStore.getState().deleteProject('proj_kept')).rejects.toThrow();
    vi.mocked(saveProjectThumbnail).mockClear();
    await useProjectStore.getState()._refreshProjectThumbnail('proj_kept');
    expect(saveProjectThumbnail).toHaveBeenCalledTimes(1);
  });
});

// 削除は**走っている焼き込みを全部**待つ（PR #934 レビュー 🔴）。
//
// ⚠️ 1枠で持つと、**続けて保存**したときに後から始まった焼き込みが枠を上書きし、
// **先に始まったほうが終わった時点で枠が空**になる（`finally` が無条件に空へ戻すため）。
// 空の枠を待っても素通りし、**まだ書いている最中の焼き込みとフォルダの削除がぶつかる**。
describe('削除は走っている焼き込みを全部待つ（#927 の続き）', () => {
  /** `saveProjectThumbnail` を手で着地させられるようにする。 */
  function controllable(): { release: () => void; started: Promise<void> } {
    let release = (): void => {};
    let markStarted = (): void => {};
    const started = new Promise<void>((res) => { markStarted = res; });
    vi.mocked(saveProjectThumbnail).mockImplementationOnce(
      () => new Promise<void>((res) => { markStarted(); release = () => res(); }),
    );
    return { release: () => release(), started };
  }

  it('2本走っているとき、後から始まったほうも待つ', async () => {
    const { deleteProjectDoc } = await import('../../infrastructure/projectFs');
    vi.mocked(deleteProjectDoc).mockClear();

    const a = controllable();
    const first = useProjectStore.getState()._refreshProjectThumbnail('proj_two_a');
    await a.started;
    const b = controllable();
    // 別の中身にして印の一致で飛ばされないようにする。
    useProjectStore.setState({ scenes: [{ ...scene, durationSec: 9 } as unknown as Scene] } as never);
    const second = useProjectStore.getState()._refreshProjectThumbnail('proj_two_b');
    await b.started;

    // 先に始まったほうだけ着地させる＝1枠で持っていると、ここで枠が空になる。
    a.release();
    await first;

    let deleted = false;
    const del = useProjectStore.getState().deleteProject('proj_two_b').then(() => { deleted = true; });
    // ⚠️ **十分に回してから見る**＝`deleteProject` は消す前に何度も await するので、
    // 1tick だけだと**待てていなくても** `deleted` はまだ false＝**バグを見逃す**（実際に見逃した）。
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((r) => { setTimeout(r, 0); });
    // まだ書いている最中なので、消し始めていない。
    expect(deleteProjectDoc).not.toHaveBeenCalled();
    expect(deleted).toBe(false);

    b.release();
    await second;
    await del;
    expect(deleteProjectDoc).toHaveBeenCalledWith('proj_two_b');
  });
});
