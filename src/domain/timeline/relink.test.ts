// タイムライン形式の素材の差し替え（#1019 ⑤）。
//
// ⚠️ **場面形式には前からある**のに、こちらには同等の操作が無く、案内は「取り込み直すか置き直して」
// ＝**新しい番号になる**ので**切り抜き・動き・連動する字幕まで作り直し**になっていた。
import { describe, expect, it } from 'vitest';
import { relinkTimelineAsset } from './relink';
import { TIMELINE_CLIP_KIND } from '../enums';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import type { TimelineClip } from './types';

const asset = (over: Partial<Asset> = {}): Asset =>
  ({ assetId: 'asset_001', assetType: 'video', displayName: '紹介', filePath: 'assets/asset_001.mp4', ...over }) as Asset;

const template = {
  templateId: 'tmpl_a',
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
    { id: 'sub', type: 'slot', x: 960, y: 0, w: 960, h: 1080 },
    { id: 'yuko', type: 'character', x: 0, y: 0, w: 480, h: 1080 },
  ],
} as unknown as Template;
const templateOf = (id: string) => (id === 'tmpl_a' ? template : undefined);

const slotClip = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 't1', startSec: 0, durationSec: 5, assetId: 'asset_001', ...over }) as TimelineClip;

const tmplClip = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 't1', startSec: 0, durationSec: 5, templateId: 'tmpl_a', ...over }) as TimelineClip;

const meta = (durationSec: number) => ({ durationSec }) as never;

describe('relinkTimelineAsset（#1019 ⑤）', () => {
  // ⚠️ **番号を付け替えない**＝配置・尺・キーフレーム・字幕の紐づけは構造的に全部そのまま残る。
  it('ファイルだけ差し替える（番号は変えない）', () => {
    const r = relinkTimelineAsset(asset(), [], templateOf, 'assets/asset_001.mov', meta(10));
    expect(r.asset.assetId).toBe('asset_001');
    expect(r.asset.filePath).toBe('assets/asset_001.mov');
    expect(r.asset.metadata).toEqual({ durationSec: 10 });
  });

  // ⚠️ **前の長さを残さない**＝別のファイルの長さで範囲を判断すると、実際には無い所を切り出す。
  it('測れなかったら前の長さ・代表フレームを捨てる', () => {
    const before = asset({ metadata: meta(30), thumbnailPath: 'thumbs/a.png' });
    const r = relinkTimelineAsset(before, [], templateOf, 'assets/asset_001.mov', null);
    expect(r.asset.metadata).toBeUndefined();
    expect(r.asset.thumbnailPath).toBeUndefined();
  });

  it('素材そのものの既定の範囲を収め直す', () => {
    const r = relinkTimelineAsset(asset({ clip: { startSec: 1, endSec: 20 } }), [], templateOf, 'p.mp4', meta(10));
    expect(r.asset.clip).toEqual({ startSec: 1, endSec: 10 });
    expect(r.clampedUses).toBe(1);
  });

  // ② 直接置いた部品の使い始め。
  it('直接置いた部品の使い始めが新しい長さの外なら、先頭へ戻す', () => {
    const r = relinkTimelineAsset(asset(), [slotClip({ sourceStartSec: 25 })], templateOf, 'p.mp4', meta(10));
    expect(r.clips[0].sourceStartSec).toBeUndefined();
    expect(r.clampedUses).toBe(1);
  });

  it('中に収まっている使い始めは触らない', () => {
    const clips = [slotClip({ sourceStartSec: 3 })];
    const r = relinkTimelineAsset(asset(), clips, templateOf, 'p.mp4', meta(10));
    expect(r.clips[0].sourceStartSec).toBe(3);
    expect(r.clampedUses).toBe(0);
  });

  // ⚠️ **別の素材の部品は触らない**。
  it('別の素材を指す部品は触らない', () => {
    const clips = [slotClip({ assetId: 'asset_999', sourceStartSec: 25 })];
    const r = relinkTimelineAsset(asset(), clips, templateOf, 'p.mp4', meta(10));
    expect(r.clips[0].sourceStartSec).toBe(25);
    expect(r.clampedUses).toBe(0);
  });

  // ③ 差し込み口ごとの使い方。
  it('差し込み口の使い方も収め直す（その口がこの素材を指しているときだけ）', () => {
    const clips = [
      tmplClip({
        assetRefs: { mainVisual: 'asset_001', sub: 'asset_999' },
        slotClips: { mainVisual: { startSec: 2, endSec: 30 }, sub: { startSec: 2, endSec: 30 } },
      }),
    ];
    const r = relinkTimelineAsset(asset(), clips, templateOf, 'p.mp4', meta(10));
    expect(r.clips[0].slotClips).toEqual({ mainVisual: { startSec: 2, endSec: 10 }, sub: { startSec: 2, endSec: 30 } });
    expect(r.clampedUses, '別の素材の口まで数えた').toBe(1);
  });

  // ⚠️ **テンプレ既定素材（ADR-0021）も見る**＝解決順は描画と同じ。
  // ⚠️ **立ち絵も置き場所**（#809）＝per-use の値は差し込み口と**同じ入れ物**（`slotClips[層 id]`）に入る。
  //    自前で層を絞ると**ここだけ漏れる**（分割・トリムが `slotClips[立ち絵の層 id].startSec` を書く）。
  it('立ち絵に入れた動画の使い方も収め直す', () => {
    const clips = [tmplClip({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' }, slotClips: { yuko: { endSec: 30 } } })];
    const r = relinkTimelineAsset(asset(), clips, templateOf, 'p.mp4', meta(10));
    expect(r.clips[0].slotClips, '立ち絵の使い方が新しい長さの外に残った').toEqual({ yuko: { endSec: 10 } });
    expect(r.clampedUses).toBe(1);
  });

  // ⚠️ **テンプレ既定素材（`tmpl_asset_*`）は別の持ち物**（ADR-0021＝全プロジェクト共通の置き場）＝
  //    この操作では差し替えられないので、その口の使い方も触らない。
  it('テンプレ既定素材で埋まっている口は触らない', () => {
    const withDefault = {
      ...template,
      layers: template.layers.map((l) => (l.id === 'sub' ? { ...l, assetId: 'tmpl_asset_001' } : l)),
    } as unknown as Template;
    const clips = [tmplClip({ slotClips: { sub: { endSec: 30 } } })];
    const r = relinkTimelineAsset(asset(), clips, () => withDefault, 'p.mp4', meta(10));
    expect(r.clips[0].slotClips).toEqual({ sub: { endSec: 30 } });
    expect(r.clampedUses).toBe(0);
  });

  // ⚠️ **差し込み口は見た目が引けなくても分かる**＝どの素材が入っているかは**部品自身**（`assetRefs`）に
  //    書いてある。ここで触らずにおくと、見た目が一時的に引けないだけで**新しい長さの外の範囲が残る**。
  it('見た目パターンが引けなくても、その素材を指す差し込み口は収め直す', () => {
    const clips = [tmplClip({ assetRefs: { mainVisual: 'asset_001' }, slotClips: { mainVisual: { endSec: 30 } } })];
    const r = relinkTimelineAsset(asset(), clips, () => undefined, 'p.mp4', meta(10));
    expect(r.clips[0].slotClips).toEqual({ mainVisual: { endSec: 10 } });
    expect(r.clampedUses).toBe(1);
  });

  // ⚠️ **立ち絵だけは見た目が要る**＝層 id は見た目から引くしかないので、引けないときは触らない
  //    （どの入れ物の話か決まらないまま書き換えると、関係ない使い方まで変わる）。
  it('見た目パターンが引けないときは、立ち絵の使い方は触らない', () => {
    const clips = [tmplClip({ character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' }, slotClips: { yuko: { endSec: 30 } } })];
    const r = relinkTimelineAsset(asset(), clips, () => undefined, 'p.mp4', meta(10));
    expect(r.clips[0].slotClips).toEqual({ yuko: { endSec: 30 } });
    expect(r.clampedUses).toBe(0);
  });

  it('触っていない部品は同じものを返す（無駄な書き換えを起こさない）', () => {
    const clips = [slotClip({ sourceStartSec: 3 }), tmplClip()];
    const r = relinkTimelineAsset(asset(), clips, templateOf, 'p.mp4', meta(10));
    expect(r.clips[0]).toBe(clips[0]);
    expect(r.clips[1]).toBe(clips[1]);
  });

  it('長さが測れないときは何も収め直さない', () => {
    const clips = [slotClip({ sourceStartSec: 25 })];
    const r = relinkTimelineAsset(asset({ clip: { endSec: 30 } }), clips, templateOf, 'p.mp4', null);
    expect(r.clips[0].sourceStartSec).toBe(25);
    expect(r.asset.clip).toEqual({ endSec: 30 });
    expect(r.clampedUses).toBe(0);
  });
});
