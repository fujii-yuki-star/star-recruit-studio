import { describe, expect, it } from 'vitest';
import { relinkAsset } from './relink';
import type { Asset, Scene } from '../project/types';
import type { Template } from '../template/types';

const asset = (over: Partial<Asset> = {}): Asset => ({
  assetId: 'asset_001', assetType: 'video', displayName: '動画', filePath: 'assets/asset_001.mp4',
  ...over,
});

/** 立ち絵の層を持つ見た目パターン（立ち絵の per-use を層 id で引くのに要る）。 */
const template = (layers: { id: string; type: string }[] = [{ id: 'character', type: 'character' }]): Template => ({
  schemaVersion: '1.0', templateId: 't1', name: 'テスト', category: 'photo_intro',
  aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: '#fff' },
  layers: layers.map((l, i) => ({ ...l, x: 0, y: 0, w: 100, h: 100, zIndex: i })),
} as unknown as Template);

const templates = [template()];

const scene = (over: Partial<Scene> = {}): Scene => ({
  sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
  templateId: 't1', durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: 'yuko' }, texts: {},
  narration: { text: '', status: 'none' }, warnings: [],
  ...over,
} as Scene);

describe('relinkAsset（素材の再リンク・差し替え・#347）', () => {
  /**
   * ⚠️ **`assetId` を付け替えない**（ADR-0024＝Asset は源泉）＝配置・尺・キーフレーム・
   * 字幕の紐づけが**構造的に**そのまま残る（参照の書き換え漏れが起きない）。
   */
  it('assetId は変わらず、ファイルだけ差し替わる', () => {
    const r = relinkAsset(asset(), [], templates, 'assets/asset_001.mov', null);
    expect(r.asset.assetId).toBe('asset_001');
    expect(r.asset.filePath).toBe('assets/asset_001.mov');
  });

  it('名前・タグ・説明は引き継ぐ（付け直させない）', () => {
    const a = asset({ displayName: '会社の外観', tags: ['本社'], description: 'ドローン撮影' });
    const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', null);
    expect(r.asset).toMatchObject({ displayName: '会社の外観', tags: ['本社'], description: 'ドローン撮影' });
  });

  /**
   * ⚠️ **前のファイルの長さ・絵を残さない**＝別のファイルの長さで範囲を判断すると、
   * 実際には無い所を切り出す（黙って何も映らない区間ができる）。
   */
  it('測れなかったら前の長さ・代表フレームを捨てる', () => {
    const a = asset({ metadata: { durationSec: 30 }, thumbnailPath: 'assets/thumb_001.png' });
    const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', null);
    expect(r.asset.metadata).toBeUndefined();
    expect(r.asset.thumbnailPath).toBeUndefined();
  });

  it('測れたら新しい長さ・代表フレームに入れ替わる', () => {
    const a = asset({ metadata: { durationSec: 30 }, thumbnailPath: 'old.png' });
    const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', { durationSec: 12, hasAudio: true }, 'new.png');
    expect(r.asset.metadata).toEqual({ durationSec: 12, hasAudio: true });
    expect(r.asset.thumbnailPath).toBe('new.png');
  });

  describe('切り出す範囲を新しい長さへ収める', () => {
    it('短い動画へ差し替えると、終わりが新しい長さへ寄る', () => {
      const a = asset({ clip: { startSec: 2, endSec: 25 } });
      const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.asset.clip).toEqual({ startSec: 2, endSec: 10 });
      expect(r.clampedUses).toBe(1);
    });

    /**
     * ⚠️ **範囲が丸ごと外に出たら、範囲そのものを外す**＝開始＝終了の**長さ0**を作らない
     *（鳴らない・映らないクリップになる）。
     */
    it('開始も新しい長さの外なら、範囲そのものを外す（長さ0を作らない）', () => {
      const a = asset({ clip: { startSec: 20, endSec: 25, speed: 2 } });
      const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.asset.clip).toEqual({ speed: 2 }); // 範囲だけ外れ、速さは残る
      expect(r.clampedUses).toBe(1);
    });

    it('収まっていれば触らない（同じものを返す）', () => {
      const a = asset({ clip: { startSec: 2, endSec: 8 } });
      const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', { durationSec: 30 });
      expect(r.asset.clip).toEqual({ startSec: 2, endSec: 8 });
      expect(r.clampedUses).toBe(0);
    });

    it('長さが測れないときは範囲を触らない（当てずっぽうで切らない）', () => {
      const a = asset({ clip: { startSec: 2, endSec: 25 } });
      const r = relinkAsset(a, [], templates, 'assets/asset_001.mov', null);
      expect(r.asset.clip).toEqual({ startSec: 2, endSec: 25 });
      expect(r.clampedUses).toBe(0);
    });
  });

  describe('場面ごとの使い方（per-use・ADR-0028）', () => {
    it('その素材を指している差し込み口だけを直す', () => {
      const s = scene({
        assetRefs: { main: 'asset_001', sub: 'asset_002' },
        slotClips: { main: { startSec: 1, endSec: 25 }, sub: { startSec: 1, endSec: 25 } },
      });
      const r = relinkAsset(asset(), [s], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.scenes[0].slotClips).toEqual({
        main: { startSec: 1, endSec: 10 }, // 差し替えたほう＝収め直す
        sub: { startSec: 1, endSec: 25 },  // 別の素材＝巻き込まない
      });
      expect(r.clampedUses).toBe(1);
    });

    // ⚠️ **立ち絵に入れた動画も per-use を持つ**（#809）＝差し込み口だけ見ると取りこぼす。
    it('立ち絵に入れた動画の範囲も収め直す', () => {
      const s = scene({
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' },
        slotClips: { character: { startSec: 1, endSec: 25 } },
      } as Partial<Scene>);
      const r = relinkAsset(asset(), [s], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.scenes[0].slotClips).toEqual({ character: { startSec: 1, endSec: 10 } });
      expect(r.clampedUses).toBe(1);
    });

    /**
     * ⚠️ **立ち絵は「その層のとき」だけ**（レビュー 🟡・3人が指摘）＝層で絞らずに `poseAssetId` だけを
     * 見ると、立ち絵がこの素材の場面では**その場面の全キー**が対象になり、**別の素材の範囲まで**
     * 黙って変わる（案内の「N か所」も過大になる）。
     */
    /**
     * ⚠️ **素材の入っていない差し込み口の使い方まで巻き込まない**。
     *
     * ⚠️ これが**層で絞る意味が出る唯一の形**（変異チェックで確認）＝差し込み口に素材が入っていれば
     * `assetRefs` で先に決まるので、絞らなくても結果は同じ。**空の差し込み口に使い方だけが
     * 残っている**とき（`prunePerUseMaps` が言う孤児エントリ）に初めて、立ち絵の素材へ
     * 誤って結び付く。そこを固定する。
     */
    it('素材の入っていない差し込み口の使い方は、立ち絵の差し替えで巻き込まない', () => {
      const s = scene({
        assetRefs: {}, // 差し込み口は空（使い方だけ残っている）
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' },
        slotClips: { main: { startSec: 1, endSec: 90 }, character: { startSec: 1, endSec: 90 } },
      } as Partial<Scene>);
      const r = relinkAsset(asset(), [s], [template([{ id: 'character', type: 'character' }, { id: 'main', type: 'slot' }])], 'assets/asset_001.mov', { durationSec: 3 });
      expect(r.scenes[0].slotClips).toEqual({
        main: { startSec: 1, endSec: 90 },      // 空の差し込み口＝そのまま
        character: { startSec: 1, endSec: 3 },  // 立ち絵だけ収める
      });
      expect(r.clampedUses).toBe(1);
    });

    it('立ち絵を差し替えても、同じ場面の別の素材の範囲は巻き込まない', () => {
      const s = scene({
        assetRefs: { main: 'asset_999' },
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' },
        slotClips: { main: { startSec: 1, endSec: 90 }, character: { startSec: 1, endSec: 90 } },
      } as Partial<Scene>);
      const r = relinkAsset(asset(), [s], [template([{ id: 'character', type: 'character' }, { id: 'main', type: 'slot' }])], 'assets/asset_001.mov', { durationSec: 3 });
      expect(r.scenes[0].slotClips).toEqual({
        main: { startSec: 1, endSec: 90 },      // 別の素材＝そのまま
        character: { startSec: 1, endSec: 3 },  // 差し替えたほうだけ収める
      });
      expect(r.clampedUses).toBe(1);
    });

    /**
     * ⚠️ **自由配置の使い方も収める**（レビュー 🔴・2人が指摘）＝場面編集が書くのは
     * `slotClips[要素id]` なので、`assetRefs` だけを見ると**常用の経路がまるごと抜ける**
     *（収め直しも通知も起きない＝実体に無い範囲を切り出したままになる）。
     */
    it('自由配置に置いた動画の範囲も収め直す', () => {
      const s = scene({
        sceneType: 'free',
        freeLayout: [
          { id: 'free_001', kind: 'slot', assetId: 'asset_001', x: 0, y: 0, w: 100, h: 100, zIndex: 0 },
          { id: 'free_002', kind: 'slot', assetId: 'asset_999', x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
        ],
        slotClips: { free_001: { startSec: 1, endSec: 90 }, free_002: { startSec: 1, endSec: 90 } },
      } as unknown as Partial<Scene>);
      const r = relinkAsset(asset(), [s], templates, 'assets/asset_001.mov', { durationSec: 5 });
      expect(r.scenes[0].slotClips).toEqual({
        free_001: { startSec: 1, endSec: 5 },   // 差し替えたほう
        free_002: { startSec: 1, endSec: 90 },  // 別の素材＝そのまま
      });
      expect(r.clampedUses).toBe(1);
    });

    // ⚠️ **見た目パターンが見つからない場面でも落ちない**（立ち絵の層が引けないだけ）。
    it('見た目パターンが分からない場面でも、差し込み口と自由配置は直せる', () => {
      const s = scene({ templateId: 'unknown', assetRefs: { main: 'asset_001' }, slotClips: { main: { endSec: 90 } } });
      const r = relinkAsset(asset(), [s], [], 'assets/asset_001.mov', { durationSec: 5 });
      expect(r.scenes[0].slotClips).toEqual({ main: { endSec: 5 } });
    });

    /**
     * ⚠️ **見た目が分からない場面では、立ち絵だけ収め直しから漏れる**（層 id を引けないため・
     * PR #874 レビュー 🟢）。`sceneActiveAssetIds` が同じ状況で「多めに数える」のと**逆向き**だが
     * 意図的＝あちらは「消させない」ために多めに、こちらは**勝手に書き換えない**ために少なめに倒す。
     * 見た目が解決できない場面はそもそも描画・書き出しの対象外（§2-5）。
     *
     * ⚠️ **この非対称をテストで固定しておく**＝将来「漏れているのはバグだ」と直されたとき、
     * それが**意図を変える判断**だと分かるようにする（黙って変わらない）。
     */
    it('見た目が分からない場面の立ち絵は、収め直しから漏れる（意図どおり）', () => {
      const s = scene({
        templateId: 'unknown',
        character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_001' },
        slotClips: { character: { endSec: 90 } },
      } as Partial<Scene>);
      const r = relinkAsset(asset(), [s], [], 'assets/asset_001.mov', { durationSec: 5 });
      expect(r.scenes[0].slotClips).toEqual({ character: { endSec: 90 } }); // そのまま
      expect(r.clampedUses).toBe(0);
    });

    it('直すところが無ければ場面はそのまま（同じ参照を返す）', () => {
      const s = scene({ assetRefs: { main: 'asset_001' }, slotClips: { main: { startSec: 1, endSec: 5 } } });
      const r = relinkAsset(asset(), [s], templates, 'assets/asset_001.mov', { durationSec: 30 });
      expect(r.scenes[0]).toBe(s);
      expect(r.clampedUses).toBe(0);
    });

    it('使い方を持たない場面はそのまま', () => {
      const s = scene({ assetRefs: { main: 'asset_001' } });
      const r = relinkAsset(asset(), [s], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.scenes[0]).toBe(s);
    });

    it('複数の場面・複数の使い方をまとめて数える', () => {
      const s1 = scene({ sceneId: 'scene_001', assetRefs: { main: 'asset_001' }, slotClips: { main: { endSec: 25 } } });
      const s2 = scene({ sceneId: 'scene_002', assetRefs: { a: 'asset_001', b: 'asset_001' }, slotClips: { a: { endSec: 25 }, b: { endSec: 25 } } });
      const r = relinkAsset(asset({ clip: { endSec: 25 } }), [s1, s2], templates, 'assets/asset_001.mov', { durationSec: 10 });
      expect(r.clampedUses).toBe(4); // 素材の既定1つ＋場面の3つ
    });
  });
});
