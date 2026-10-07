import { describe, expect, it } from 'vitest';
import { startupJobBlocked } from './useStartupJob';

// 仕事の持ち主（ADR-0042 決定③）。
// ⚠️ **渡された仕事だけ断る**＝自分で起こした回は、まだ何も開いていない。
describe('渡された頼まれごとを受けてよいか', () => {
  it('自分で起こした回は、断らない', () => {
    expect(
      startupJobBlocked({ forwarded: false, sceneProjectId: 'proj_1', timelineOpen: true }),
    ).toBe(false);
  });

  it('何も開いていなければ、渡された仕事も受ける', () => {
    expect(startupJobBlocked({ forwarded: true, sceneProjectId: '', timelineOpen: false })).toBe(
      false,
    );
  });

  // ⚠️ **開いていたら断る**＝書き出しは保存を伴う（#256）ので、受けると
  // **利用者がいま触っている動画を上書きしうる**（ADR-0026④＝黙って別の結果にしない）。
  it('どちらかの形式を開いていたら、渡された仕事は断る', () => {
    expect(startupJobBlocked({ forwarded: true, sceneProjectId: 'proj_1', timelineOpen: false })).toBe(true);
    expect(startupJobBlocked({ forwarded: true, sceneProjectId: '', timelineOpen: true })).toBe(true);
  });
});
