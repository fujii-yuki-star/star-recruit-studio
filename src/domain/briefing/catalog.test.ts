// あなた向け会社説明の登録（β・ADR-0061 決定2・`11 §7.8`）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addInterest, addSource, BRIEFING_INTEREST_MAX, briefingCatalogProblems, createInterestId, DEFAULT_BRIEFING_INTERESTS,
  defaultBriefingCatalog, isBriefingCatalog, moveInterest, pruneMissingScenes, removeInterest, removeSource, renameInterest, sceneRuleOf,
  setClosingText, setExitCode, setSourceEnabled, toggleSceneInterest, updateSceneRule, type BriefingCatalog,
} from './catalog';

const P1 = 'proj_20261101_001';
const P2 = 'proj_20261102_001';

/** 例の項目つき・動画1本を足した登録。 */
function withSource(): BriefingCatalog {
  return addSource(defaultBriefingCatalog(), P1);
}

describe('はじめての登録', () => {
  it('例の興味の項目が入っていて、正典の形を満たす（番号はまだ決めていない）', () => {
    const c = defaultBriefingCatalog();
    expect(c.interests.map((i) => i.label)).toEqual([...DEFAULT_BRIEFING_INTERESTS]);
    expect(c.interests.map((i) => i.interestId)).toEqual(['interest_001', 'interest_002', 'interest_003', 'interest_004', 'interest_005', 'interest_006']);
    expect(c.exitCode).toBeNull();
    expect(isBriefingCatalog(c)).toBe(true);
  });

  it('見本（fixtures）も正典の形を満たし、形の違うものは断る', () => {
    const sample = JSON.parse(readFileSync('docs/yuko_recruit_docs/fixtures/briefing-catalog.sample.json', 'utf8'));
    expect(isBriefingCatalog(sample)).toBe(true);
    expect(isBriefingCatalog({ ...sample, exitCode: '12345' })).toBe(false);
    expect(isBriefingCatalog({ ...sample, extra: 1 })).toBe(false);
  });
});

describe('興味の項目', () => {
  it('足す（前後の空白を落とす・空は足さない・番号は空いている最小）', () => {
    let c = removeInterest(defaultBriefingCatalog(), 'interest_002');
    c = addInterest(c, '  キャリア  ');
    expect(c.interests.at(-1)).toEqual({ interestId: 'interest_002', label: 'キャリア' });
    expect(addInterest(c, '   ')).toBe(c);
  });

  it('上限を超えては足さない', () => {
    let c = defaultBriefingCatalog();
    for (let i = 0; i < BRIEFING_INTEREST_MAX + 5; i += 1) c = addInterest(c, `項目${i}`);
    expect(c.interests).toHaveLength(BRIEFING_INTEREST_MAX);
    expect(isBriefingCatalog(c)).toBe(true);
  });

  it('名前を変える（空は変えない）', () => {
    const c = renameInterest(defaultBriefingCatalog(), 'interest_001', '仕事の中身');
    expect(c.interests[0].label).toBe('仕事の中身');
    expect(renameInterest(c, 'interest_001', ' ')).toBe(c);
  });

  it('消すと、場面に付いていたその項目も外す', () => {
    let c = withSource();
    c = toggleSceneInterest(c, P1, 'scene_001', 'interest_001');
    c = toggleSceneInterest(c, P1, 'scene_001', 'interest_002');
    c = removeInterest(c, 'interest_001');
    expect(sceneRuleOf(c, P1, 'scene_001').interestIds).toEqual(['interest_002']);
    expect(c.interests.some((i) => i.interestId === 'interest_001')).toBe(false);
  });

  it('上下へ動かす（端では動かない）', () => {
    const c = moveInterest(defaultBriefingCatalog(), 'interest_002', -1);
    expect(c.interests.slice(0, 2).map((i) => i.interestId)).toEqual(['interest_002', 'interest_001']);
    const top = moveInterest(c, 'interest_002', -1);
    expect(top).toBe(c);
  });

  it('番号は既存と重ならない', () => {
    expect(createInterestId(['interest_001', 'interest_003'])).toBe('interest_002');
  });
});

describe('使う動画と場面', () => {
  it('動画は二重に足さない・外すと場面の登録も消える・無効にできる', () => {
    let c = withSource();
    expect(addSource(c, P1)).toBe(c);
    c = setSourceEnabled(c, P1, false);
    expect(c.sources[0].enabled).toBe(false);
    c = toggleSceneInterest(c, P1, 'scene_001', 'interest_001');
    c = removeSource(c, P1);
    expect(c.sources).toEqual([]);
  });

  it('場面に興味の項目を付け外しでき、既定に戻った場面は持たない', () => {
    let c = withSource();
    c = toggleSceneInterest(c, P1, 'scene_002', 'interest_003');
    expect(c.sources[0].scenes).toEqual([{ sceneId: 'scene_002', interestIds: ['interest_003'], priority: 'normal', required: false, excluded: false }]);
    c = toggleSceneInterest(c, P1, 'scene_002', 'interest_003');
    expect(c.sources[0].scenes).toEqual([]);
  });

  it('優先度・必須・除外を変えられ、知らない興味の項目は付けない', () => {
    let c = withSource();
    c = updateSceneRule(c, P1, 'scene_001', { priority: 'high', required: true, interestIds: ['interest_001', 'interest_999', 'interest_001'] });
    expect(sceneRuleOf(c, P1, 'scene_001')).toEqual({ sceneId: 'scene_001', interestIds: ['interest_001'], priority: 'high', required: true, excluded: false });
    c = updateSceneRule(c, P1, 'scene_001', { excluded: true });
    expect(sceneRuleOf(c, P1, 'scene_001').excluded).toBe(true);
    expect(sceneRuleOf(c, P1, 'scene_001').required).toBe(true);
    expect(isBriefingCatalog(c)).toBe(true);
  });

  it('使う動画に無い動画の場面は登録しない', () => {
    const c = withSource();
    expect(updateSceneRule(c, P2, 'scene_001', { required: true })).toBe(c);
  });
});

describe('最後の場面・抜ける番号', () => {
  it('最後の場面の文（空は変えない）', () => {
    const c = setClosingText(defaultBriefingCatalog(), '  この動画は すたりお で作りました。 ');
    expect(c.closing.text).toBe('この動画は すたりお で作りました。');
    expect(setClosingText(c, '')).toBe(c);
  });

  it('番号は4桁の数字だけ', () => {
    const c = defaultBriefingCatalog();
    expect(setExitCode(c, '0427').exitCode).toBe('0427');
    expect(setExitCode(c, '123')).toBe(c);
    expect(setExitCode(c, '12a4')).toBe(c);
    expect(setExitCode(c, '12345')).toBe(c);
  });
});

describe('指す先の確かめ（黙って飛ばさない）', () => {
  it('動画が無い・場面形式でない・場面が無い、を知らせる（まだ読んでいない動画の場面は確かめない）', () => {
    let c = addSource(addSource(addSource(defaultBriefingCatalog(), P1), P2), 'proj_20261103_001');
    c = addSource(c, 'proj_20261104_001');
    c = updateSceneRule(c, P1, 'scene_001', { required: true });
    c = updateSceneRule(c, P1, 'scene_009', { required: true });
    c = updateSceneRule(c, 'proj_20261104_001', 'scene_005', { required: true });
    const problems = briefingCatalogProblems(c, [
      { projectId: P1, isSceneFormat: true, sceneIds: ['scene_001', 'scene_002'] },
      { projectId: P2, isSceneFormat: false, sceneIds: null },
      { projectId: 'proj_20261104_001', isSceneFormat: true, sceneIds: null },
    ]);
    expect(problems).toEqual([
      { kind: 'sceneMissing', projectId: P1, sceneId: 'scene_009' },
      { kind: 'projectNotScene', projectId: P2 },
      { kind: 'projectMissing', projectId: 'proj_20261103_001' },
    ]);
  });
});

describe('消えた場面の登録を外す', () => {
  it('今ある場面に無い登録だけを外し、ほかの動画には触らない', () => {
    let c = addSource(addSource(defaultBriefingCatalog(), P1), P2);
    c = updateSceneRule(c, P1, 'scene_001', { required: true });
    c = updateSceneRule(c, P1, 'scene_009', { required: true });
    c = updateSceneRule(c, P2, 'scene_009', { required: true });
    c = pruneMissingScenes(c, P1, ['scene_001', 'scene_002']);
    expect(c.sources[0].scenes.map((r) => r.sceneId)).toEqual(['scene_001']);
    expect(c.sources[1].scenes.map((r) => r.sceneId)).toEqual(['scene_009']);
  });
});
