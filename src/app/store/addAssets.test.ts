// 素材を**まとめて取り込む**（#858）。
//
// ⚠️ **この振る舞いが store にある理由**＝当初は取り込みボタン側で1件ずつ回していたが、
// `addAsset`/`addAssetByPath` は**失敗しても投げず**に `importError` を立てて戻るので、
// ボタン側の `try/catch` は**実機では一度も動かない**（テストだけが緑になる形）。さらに
// 取り込み中は**黙って return** するため、まとめて渡すと数件が理由なしに消える（§2-5）。
// 取り込みの状態（`isImporting`/`importError`/採番）を持っている側で回すのが唯一の正しい置き場所。
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { resetAssetIdReservations } from "./assetImport";
import { useProjectStore } from './projectStore';
import * as assetFsMod from '../../infrastructure/assetFs';
import { IMPORT_BUSY_MESSAGE } from '../uiLabels';

const BUSY = /書き出し/;

// ⚠️ **番号の予約は起動中ずっと残る**（#712・α-7 出口監査 🟡）＝素材の番号を使い回すと、
// 前の写真を上書きする。テストの間は毎回まっさらにする（**ファイルの直下に置く**＝
// describe の中に入れると、その describe のテストにしか効かない）。
afterEach(() => resetAssetIdReservations());

describe('projectStore addAssets（まとめて取り込む・#858）', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [], assetSrcById: {}, importError: null, importProgress: null,
      isImporting: false, saveStatus: 'saved',
      // 採番済みの動画にする＝`listProjectSummaries`（ディスク）へ行かせない。
      meta: { ...st.meta, projectId: 'proj_20260827_0001' },
    }));
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    // 取り込みの実体（Rust 側）は呼ばない＝ここで見たいのは**回し方**。
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue(null);
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const paths = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `C:/pics/photo${i + 1}.png`);

  it('選んだ数だけ素材が増える', async () => {
    await useProjectStore.getState().addAssets(paths(3));
    expect(useProjectStore.getState().assets).toHaveLength(3);
  });

  /**
   * ⚠️ **採番が衝突しない**（11.2）＝`asset_NNN` は `get().assets` を見て採るので、
   * 並行に走らせると**同じ番号を2つ**採る。直列で回していることを、番号の重複なしで固定する。
   */
  it('番号が重ならない（直列で回している）', async () => {
    await useProjectStore.getState().addAssets(paths(5));
    const ids = useProjectStore.getState().assets.map((a) => a.assetId);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(['asset_001', 'asset_002', 'asset_003', 'asset_004', 'asset_005']);
  });

  /**
   * ⚠️ **失敗しても止めない**（§2-5）＝1件の失敗で全部を捨てると、入った分まで取り込み直しになる。
   */
  it('途中で失敗しても残りを続け、入った分は残る', async () => {
    vi.spyOn(assetFsMod, 'importAssetByPath').mockImplementation(async (_id, _f, src) => {
      if (String(src).includes('photo2')) throw new Error('コピーできません');
      return null;
    });
    await useProjectStore.getState().addAssets(paths(3));
    const names = useProjectStore.getState().assets.map((a) => a.displayName);
    expect(names).toEqual(['photo1', 'photo3']); // 失敗した1件だけが落ちる
  });

  // ⚠️ **何が入らなかったかを名前で示す**（§2-5＝次の行動が取れる）。
  it('取り込めなかったものの名前を出す（絶対パスを丸ごと出さない）', async () => {
    vi.spyOn(assetFsMod, 'importAssetByPath').mockImplementation(async (_id, _f, src) => {
      if (String(src).includes('photo1') || String(src).includes('photo3')) throw new Error('だめ');
      return null;
    });
    await useProjectStore.getState().addAssets(paths(3));
    const msg = useProjectStore.getState().importError ?? '';
    expect(msg).toContain('2件');
    expect(msg).toContain('photo1.png');
    expect(msg).toContain('photo3.png');
    expect(msg).not.toContain('C:/pics'); // 置き場所まで出すと読みにくい
  });

  /**
   * ⚠️ **1件だけ失敗したときは、その理由をそのまま出す**（ADR-0026②）＝
   * まとめて渡したかどうかで案内が変わらない（単発で取り込んだときと同じ文言）。
   */
  it('1件だけ失敗したときは件数を足さず、その理由をそのまま出す', async () => {
    vi.spyOn(assetFsMod, 'importAssetByPath').mockRejectedValue(new Error('だめ'));
    await useProjectStore.getState().addAssets(['C:/pics/one.png']);
    const solo = useProjectStore.getState().importError;

    useProjectStore.setState({ assets: [], importError: null });
    await useProjectStore.getState().addAssetByPath('C:/pics/one.png');
    expect(solo).toBe(useProjectStore.getState().importError);
    expect(solo).not.toContain('1件を取り込めませんでした');
  });

  /**
   * ⚠️ **この検査は最後の枝を単独では捕まえられない**（変異チェックで確認）＝案内は**各件の直前**で
   * 消しているので、最後にもう一度消しても消さなくても結果は同じ（実際、その行は死んでいたので外した）。
   * ここで固定しているのは**「成功し終えたときに古い失敗が残っていない」**という挙動そのもの。
   */
  it('全部入ったら案内を残さない（成功に警告を出さない）', async () => {
    useProjectStore.setState({ importError: '前の失敗' });
    await useProjectStore.getState().addAssets(paths(2));
    expect(useProjectStore.getState().importError).toBeNull();
  });

  /**
   * ⚠️ **入口で1回だけ断る**＝取り込み中に渡されたものが**黙って落ちる**のを防ぐ（§2-5）。
   * 単発の `addAssetByPath` は取り込み中を黙って return するので、そのまま回すと
   * 「入りました」の顔で数件だけ消える。
   */
  it('書き出し中は1件も取り込まず、理由を出す', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().addAssets(paths(3));
    expect(useProjectStore.getState().assets).toHaveLength(0);
    expect(useProjectStore.getState().importError).toMatch(BUSY);
  });

  it('取り込み中は受け付けず、いつやり直せばよいかを出す', async () => {
    useProjectStore.setState({ isImporting: true });
    await useProjectStore.getState().addAssets(paths(3));
    expect(useProjectStore.getState().assets).toHaveLength(0);
    // ⚠️ **黙って落とさない**（§2-5）＝単発は黙って return するが、まとめて渡すと N 件が消える。
    expect(useProjectStore.getState().importError).toBe(IMPORT_BUSY_MESSAGE);
  });

  /**
   * ⚠️ **途中で横取りされたら打ち切って名前に挙げる**＝一括の**途中は無ロック**（各件が `finally` で
   * 下ろす）なので、隙に BGM 取り込み等がロックを取ると、次の1件は取り込み側で**黙って return** し、
   * `importError` も立たないため**成功として数えてしまう**（入ったつもりで消える）。
   */
  it('途中で別の取り込みに横取りされたら、残りを成功として数えない', async () => {
    // 1件目が**終わった後**（取り込み側が `finally` でロックを下ろした後）に、
    // 別経路（BGM 取り込み等）がロックを取った状況を作る。
    const real = useProjectStore.getState().addAssetByPath;
    let done = 0;
    useProjectStore.setState({
      addAssetByPath: async (path: string) => {
        await real(path);
        if (++done === 1) useProjectStore.setState({ isImporting: true });
      },
    });
    try {
      await useProjectStore.getState().addAssets(paths(3));
    } finally {
      useProjectStore.setState({ addAssetByPath: real });
    }
    expect(useProjectStore.getState().assets).toHaveLength(1); // 入ったのは1件だけ
    const msg = useProjectStore.getState().importError ?? '';
    expect(msg).toContain('2件'); // 残り2件は「入らなかった」として名前が出る
    expect(msg).toContain('photo2.png');
    expect(msg).toContain('photo3.png');
  });

  // ⚠️ **1件だけのときは進み具合を出さない**＝一瞬出て消える表示は雑音になる。
  it('複数のときだけ進み具合を出し、終わったら消す', async () => {
    const seen: ({ done: number; total: number } | null)[] = [];
    vi.spyOn(assetFsMod, 'importAssetByPath').mockImplementation(async () => {
      seen.push(useProjectStore.getState().importProgress);
      return null;
    });
    await useProjectStore.getState().addAssets(paths(2));
    expect(seen).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }]);
    expect(useProjectStore.getState().importProgress).toBeNull(); // 終わったら消す

    seen.length = 0;
    useProjectStore.setState({ assets: [] });
    await useProjectStore.getState().addAssets(paths(1));
    expect(seen).toEqual([null]); // 1件だけなら出さない
  });

  it('何も選ばれなければ何もしない', async () => {
    useProjectStore.setState({ importError: '前の失敗' });
    await useProjectStore.getState().addAssets([]);
    expect(useProjectStore.getState().assets).toHaveLength(0);
    expect(useProjectStore.getState().importError).toBe('前の失敗'); // 消しもしない
  });
});
