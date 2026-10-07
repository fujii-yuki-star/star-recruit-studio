// 「場面形式の動画を開いているか」の判定（差分再監査 6巡目 🟡）。
//
// ⚠️ **同じ問いを画面ごとに書き直さない**＝棚からの取り込み・「素材を追加」・会社の見た目の反映・
// サイドバーの「今の動画」が同じ式を見る。どれか1つの条件だけで見ると取りこぼす：
// 番号だけだと**白紙から作った直後**を、状態と場面だけだと**番号だけ採った文書**を落とす。
import { describe, expect, it } from 'vitest';
import { hasOpenProject } from './projectStore';

import type { GenerateStatus } from './projectStore';

const st = (over: { projectId?: string; status?: GenerateStatus; scenes?: unknown[]; companyName?: string } = {}) => ({
  meta: {
    projectId: over.projectId ?? '',
    ...(over.companyName ? { companyInfo: { companyName: over.companyName } } : {}),
  },
  status: over.status ?? ('idle' as GenerateStatus),
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

  // ⚠️ AI で作る主経路（`newProject`）は `status` を `idle` のままにする（自動生成を発火させるため）＝
  // 会社名だけ入れた状態を落とすと、その動画は一覧にも無いので**案内どおりに開き直せない**。
  it('たたき台の入力（会社名）があれば true（ウィザードの途中）', () => {
    expect(hasOpenProject(st({ companyName: 'すたりお商事' }))).toBe(true);
  });

  it('会社名が空白だけなら false（入力したことにしない）', () => {
    expect(hasOpenProject(st({ companyName: '   ' }))).toBe(false);
  });
});
