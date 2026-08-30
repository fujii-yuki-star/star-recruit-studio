// 「場面形式の動画を開いているか」の判定（差分再監査 6巡目 🟡）。
//
// ⚠️ **同じ問いを画面ごとに書き直さない**＝棚からの取り込み・「素材を追加」・会社の見た目の反映・
// サイドバーの「今の動画」が同じ式を見る。どれか1つの条件だけで見ると取りこぼす：
// 番号だけだと**白紙から作った直後**を、状態と場面だけだと**番号だけ採った文書**を落とす。
import { describe, expect, it } from 'vitest';
import { hasOpenProject } from './projectStore';

const st = (over: { projectId?: string; status?: string; scenes?: unknown[] } = {}) => ({
  meta: { projectId: over.projectId ?? '' },
  status: over.status ?? 'idle',
  scenes: over.scenes ?? [],
});

describe('hasOpenProject', () => {
  it('何も開いていなければ false（ここで取り込むと、画面に出ていない空の動画が作られる）', () => {
    expect(hasOpenProject(st())).toBe(false);
  });

  it('読み込んだ動画は true（番号がある）', () => {
    expect(hasOpenProject(st({ projectId: 'proj_20260101_001' }))).toBe(true);
  });

  it('白紙から作った直後は true（番号はまだ無い）', () => {
    expect(hasOpenProject(st({ status: 'ready' }))).toBe(true);
  });

  it('場面があれば true（番号も状態も無くても）', () => {
    expect(hasOpenProject(st({ scenes: [{}] }))).toBe(true);
  });

  it('番号だけ採った文書も true（ウィザードの途中で素材を入れた状態）', () => {
    expect(hasOpenProject(st({ projectId: 'proj_20260101_001', status: 'idle' }))).toBe(true);
  });
});
