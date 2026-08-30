// 取り消し・やり直しで**動画の身元（番号）を巻き戻さない**（差分再監査 🔴）。
//
// ⚠️ 番号は「編集の中身」ではなく**どのフォルダに保存するかを決める値**で、採るのは遅い
//（最初の保存か、最初の素材の取り込み）。採る前に積まれた履歴へ戻ると `projectId` が `""` に戻り、
// **次の自動保存が別の番号で別フォルダへ**書く＝素材は前のフォルダにあるので新しい方からは
// 全部「見つかりません」になり、一覧に同じ名前の動画が2つ残る。取り消しても素材は戻らない
//（`assets` は履歴の外＝ADR-0020）ので、**取り消しで壊れる**。
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';

const meta = () => useProjectStore.getState().meta;

beforeEach(() => {
  useProjectStore.setState({ past: [], future: [], projectName: '' } as never);
  useProjectStore.getState().setExportRun({ phase: 'idle' });
});

describe('取り消し・やり直しと動画の番号', () => {
  it('番号を採る前の状態へ戻しても、いまの番号を保つ', () => {
    // 番号が無いうちに1回編集（＝`projectId:""` のスナップショットが積まれる）。
    useProjectStore.setState({ meta: { ...meta(), projectId: '', projectName: '白紙' } } as never);
    useProjectStore.getState().pushHistory();
    useProjectStore.setState({ meta: { ...meta(), projectName: '会社紹介' } } as never);
    // ここで番号が採られる（最初の保存・素材の取り込み）。
    useProjectStore.setState({ meta: { ...meta(), projectId: 'proj_20260830_001' } } as never);

    useProjectStore.getState().undo();

    expect(meta().projectName).toBe('白紙'); // 中身は戻る
    expect(meta().projectId).toBe('proj_20260830_001'); // 身元は戻らない
  });

  it('やり直しでも保つ', () => {
    useProjectStore.setState({ meta: { ...meta(), projectId: '', projectName: '白紙' } } as never);
    useProjectStore.getState().pushHistory();
    useProjectStore.setState({ meta: { ...meta(), projectName: '会社紹介', projectId: 'proj_20260830_001' } } as never);
    useProjectStore.getState().undo();
    useProjectStore.getState().redo();

    expect(meta().projectName).toBe('会社紹介');
    expect(meta().projectId).toBe('proj_20260830_001');
  });

  it('番号がある状態どうしでは、履歴の番号をそのまま使う（別の動画の番号で上書きしない）', () => {
    useProjectStore.setState({ meta: { ...meta(), projectId: 'proj_20260830_001', projectName: 'あ' } } as never);
    useProjectStore.getState().pushHistory();
    useProjectStore.setState({ meta: { ...meta(), projectName: 'い' } } as never);

    useProjectStore.getState().undo();

    expect(meta().projectId).toBe('proj_20260830_001');
    expect(meta().projectName).toBe('あ');
  });
});
