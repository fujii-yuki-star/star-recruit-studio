// 素材の再リンク・差し替え（#347）。
//
// ⚠️ **`assetId` を付け替えないのが肝**（ADR-0024＝Asset は元素材の源泉）＝置いた場所・切り出す
// 範囲・キーフレーム・字幕の紐づけは**構造的に**そのまま残る（参照の書き換え漏れが起きない）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAssetIdReservations } from "./assetImport";
import { useProjectStore } from './projectStore';
import * as assetFsMod from '../../infrastructure/assetFs';
import { IMPORT_BUSY_MESSAGE } from '../uiLabels';
import type { Asset, Scene } from '../../domain/project/types';

const asset = (over: Partial<Asset> = {}): Asset => ({
  assetId: 'asset_001', assetType: 'video', displayName: '会社の外観',
  filePath: 'assets/asset_001.mp4', tags: ['本社'], ...over,
});

const scene = (over: Partial<Scene> = {}): Scene => ({
  sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
  templateId: 't1', durationSec: 8, assetRefs: { main: 'asset_001' },
  character: { enabled: false, characterId: 'yuko' }, texts: {},
  narration: { text: '', status: 'none' }, warnings: [], ...over,
} as Scene);

// ⚠️ **番号の予約は起動中ずっと残る**（#712・α-7 出口監査 🟡）＝素材の番号を使い回すと、
// 前の写真を上書きする。テストの間は毎回まっさらにする（**ファイルの直下に置く**＝
// describe の中に入れると、その describe のテストにしか効かない）。
afterEach(() => resetAssetIdReservations());

describe('relinkAssetByPath（ファイルだけ差し替える）', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [asset()], scenes: [scene()], assetSrcById: {},
      importError: null, isImporting: false, missingAssetIds: [], saveStatus: 'saved',
      meta: { ...st.meta, projectId: 'proj_20260827_0001' },
    }));
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.mov');
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://new');
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(null);
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue(null);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const relink = (p = 'D:/new/外観.mov') => useProjectStore.getState().relinkAssetByPath('asset_001', p);

  it('assetId は変わらず、名前もタグも残る（付け直させない）', async () => {
    await relink();
    const a = useProjectStore.getState().assets[0];
    expect(a.assetId).toBe('asset_001');
    expect(a).toMatchObject({ displayName: '会社の外観', tags: ['本社'] });
  });

  // ⚠️ **拡張子は新しいファイルのもの**（§2-7＝`fileExtension` に集約）＝保存名と中身が食い違わない。
  it('新しいファイルの拡張子で保存する', async () => {
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.mov');
    await relink('D:/new/外観.mov');
    expect(copy).toHaveBeenCalledWith('proj_20260827_0001', 'asset_001.mov', 'D:/new/外観.mov');
  });

  /**
   * ⚠️ **同じ名前へ上書きすると表示が古いまま**＝`asset://` の URL が変わらず webview が前の絵を
   * キャッシュする（#140）。変更時刻を付けて取り直させる（保存データには入れない）。
   */
  it('表示を取り直させる（前の絵が残らない）', async () => {
    await relink();
    const src = useProjectStore.getState().assetSrcById['asset_001'] ?? '';
    expect(src.startsWith('asset://new?t=')).toBe(true);
    expect(useProjectStore.getState().assets[0].filePath).toBe('assets/asset_001.mov'); // 保存側にクエリは入れない
  });

  // ⚠️ **見つからない印を外す**＝直したのに警告が残らない。
  it('見つからなかった素材なら印が外れる', async () => {
    useProjectStore.setState({ missingAssetIds: ['asset_001'] });
    await relink();
    expect(useProjectStore.getState().missingAssetIds).toEqual([]);
  });

  /**
   * ⚠️ **短い動画へ差し替えたら範囲を収め、黙らない**（§2-5）＝範囲は利用者が決めたものなので、
   * 勝手に変わったことを知らせる。
   */
  it('短い動画へ差し替えると範囲を収め直し、そのことを知らせる', async () => {
    useProjectStore.setState({
      assets: [asset({ clip: { startSec: 1, endSec: 25 } })],
      scenes: [scene({ slotClips: { main: { startSec: 1, endSec: 25 } } })],
    });
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 10 });
    await relink();
    const s = useProjectStore.getState();
    expect(s.assets[0].clip).toEqual({ startSec: 1, endSec: 10 });
    expect(s.scenes[0].slotClips).toEqual({ main: { startSec: 1, endSec: 10 } });
    expect(s.importError).toContain('2か所');
    expect(s.importError).toContain('場面編集'); // §2-5＝次に見るところ
  });

  it('収まっていれば何も知らせない（成功に警告を出さない）', async () => {
    useProjectStore.setState({ assets: [asset({ clip: { startSec: 1, endSec: 5 } })] });
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 30 });
    await relink();
    expect(useProjectStore.getState().importError).toBeNull();
  });

  it('未保存に戻す（差し替えたのに「保存しました」のままにしない）', async () => {
    await relink();
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });

  it('書き出し中は差し替えず、理由を出す', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await relink();
    expect(useProjectStore.getState().assets[0].filePath).toBe('assets/asset_001.mp4'); // 変わらない
    expect(useProjectStore.getState().importError).toMatch(/書き出し/);
  });

  it('取り込めなかったら元のまま＋次の行動を出す', async () => {
    vi.spyOn(assetFsMod, 'importAssetByPath').mockRejectedValue(new Error('書き込めませんでした。空き容量をご確認ください。'));
    await relink();
    const s = useProjectStore.getState();
    expect(s.assets[0].filePath).toBe('assets/asset_001.mp4');
    expect(s.importError).toContain('空き容量');
    expect(s.isImporting).toBe(false);
  });

  /**
   * ⚠️ **待っている間に消された素材へは何も書かない**。
   *
   * ⚠️ **「復活しない」だけでは弱い**（変異チェックで確認）＝一覧の書き換えは `st.assets.map` なので、
   * 消えていれば何を渡しても復活しない。**守っているのは別のところ**＝
   * ① 場面の切り出す範囲を**消えた素材の長さで**書き換えない
   * ② 利用者が自分で消したものについて**驚かせる案内を出さない**（§2-5）
   * ここではその2つを見る。
   */
  it('待っている間に消された素材へは何も書かない（場面も案内も触らない）', async () => {
    useProjectStore.setState({
      assets: [asset({ clip: { startSec: 1, endSec: 25 } })],
      scenes: [scene({ slotClips: { main: { startSec: 1, endSec: 25 } } })],
    });
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 10 });
    const before = useProjectStore.getState().scenes[0];
    let release: (v: string) => void = () => {};
    vi.spyOn(assetFsMod, 'importAssetByPath').mockReturnValue(new Promise((r) => { release = r; }));
    const p = relink();
    useProjectStore.setState({ assets: [] }); // 待っている間に削除
    release('assets/asset_001.mov');
    await p;
    const st = useProjectStore.getState();
    expect(st.assets).toEqual([]); // 復活させない
    expect(st.scenes[0]).toBe(before); // 消えた素材の長さで場面を書き換えない
    expect(st.importError).toBeNull(); // 自分で消したものについて驚かせない
  });

  /**
   * ⚠️ **種類の違うファイルへは差し替えない**（§2-5・ADR-0026④）。
   * 種類を変えれば置いた差し込み口が受け付けなくなって**黙って消え**、変えなければ
   * **写真として動画を描く**ことになり何も映らない。どちらも「黙って別の結果」。
   */
  it('動画の素材を写真で差し替えようとしたら断り、代わりの手を示す', async () => {
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath');
    await relink('D:/new/写真.png');
    expect(copy).not.toHaveBeenCalled();
    expect(useProjectStore.getState().assets[0].filePath).toBe('assets/asset_001.mp4');
    const msg = useProjectStore.getState().importError ?? '';
    expect(msg).toContain('動画のファイルをお選びください');
    expect(msg).toContain('取り込んで'); // §2-5＝代わりの手
  });

  it('写真の素材を動画で差し替えようとしても断る（逆向きも同じ）', async () => {
    useProjectStore.setState({ assets: [asset({ assetType: 'image', filePath: 'assets/asset_001.png' })] });
    await relink('D:/new/動画.mp4');
    expect(useProjectStore.getState().importError).toContain('写真のファイルをお選びください');
  });

  /**
   * ⚠️ **絵の種類は写真と同じ扱いで守る**（レビュー 3人が指摘）＝判定を `assetType` と直接くらべると
   * `logo`/`yuko`/`qr`/`decor` が素通りし、**無言で動画に差し替わる**（この画面はそれらも一覧に出す）。
   */
  it.each(['logo', 'yuko', 'qr', 'decor'] as const)('%s の素材も動画で差し替えられない', async (t) => {
    useProjectStore.setState({ assets: [asset({ assetType: t, filePath: 'assets/asset_001.png' })] });
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath');
    await relink('D:/new/動画.mp4');
    expect(copy).not.toHaveBeenCalled();
    expect(useProjectStore.getState().importError).toContain('写真のファイルをお選びください');
  });

  // ⚠️ **文書を切り替えたら印を捨てる**（§2-5）＝`asset_001` はどの文書にもあるので、
  // 持ち越すと別の文書の健全な素材に「見つかりません」が付く。
  it('別の動画を新しく作ると、見つからない印は残らない', () => {
    useProjectStore.setState({ missingAssetIds: ['asset_001'] });
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().missingAssetIds).toEqual([]);
  });

  /**
   * ⚠️ **収め直しは取り消せる**（ADR-0020）＝`scenes` は履歴 slice なので、通さずに書き換えると
   * 次の取り消しで**収め直しだけが黙って消える**（実体に無い古い範囲が復活する）。
   */
  it('範囲を収め直したときは履歴に積む（取り消しで戻せる）', async () => {
    useProjectStore.setState({
      assets: [asset({ clip: { endSec: 25 } })],
      scenes: [scene({ slotClips: { main: { startSec: 1, endSec: 25 } } })],
      past: [], future: [],
    });
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 10 });
    await relink();
    expect(useProjectStore.getState().past.length).toBe(1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().scenes[0].slotClips).toEqual({ main: { startSec: 1, endSec: 25 } });
  });

  it('収め直すところが無ければ履歴を積まない（空の取り消しを作らない）', async () => {
    useProjectStore.setState({ past: [], future: [] });
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ durationSec: 30 });
    await relink();
    expect(useProjectStore.getState().past).toEqual([]);
  });

  it('同じ種類なら別の拡張子でも差し替えられる（mp4→mov）', async () => {
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.mov');
    await relink('D:/new/外観.mov');
    expect(copy).toHaveBeenCalled();
  });

  it('無い素材を指しても何もしない', async () => {
    const copy = vi.spyOn(assetFsMod, 'importAssetByPath');
    await useProjectStore.getState().relinkAssetByPath('asset_999', 'D:/x.png');
    expect(copy).not.toHaveBeenCalled();
  });
});

describe('refreshMissingAssets（見つからない素材を調べ直す）', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [asset(), asset({ assetId: 'asset_002', filePath: 'assets/asset_002.png' })],
      missingAssetIds: [], meta: { ...st.meta, projectId: 'proj_20260827_0001' },
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('見つからないものだけを印にする', async () => {
    vi.spyOn(assetFsMod, 'missingAssetFiles').mockResolvedValue(['assets/asset_002.png']);
    await useProjectStore.getState().refreshMissingAssets();
    expect(useProjectStore.getState().missingAssetIds).toEqual(['asset_002']);
  });

  it('そろっていれば空になる（前の印を残さない）', async () => {
    useProjectStore.setState({ missingAssetIds: ['asset_001', 'asset_002'] });
    vi.spyOn(assetFsMod, 'missingAssetFiles').mockResolvedValue([]);
    await useProjectStore.getState().refreshMissingAssets();
    expect(useProjectStore.getState().missingAssetIds).toEqual([]);
  });

  /**
   * ⚠️ **一覧に出ないもの（BGM・読み上げ）は数えない**（§2-5）＝「その素材を選んで
   * 『ファイルを選び直す』から入れ直してください」と言われても、**一覧に出ないので選べない**
   *（行き止まり）。BGM は BGM の導線で直す。絞りの規則は `isListedMaterial` に1か所（§2-7）。
   */
  it('BGM・読み上げは調べない（一覧に出ないものを「見つかりません」に数えない）', async () => {
    useProjectStore.setState({
      assets: [
        asset(),
        asset({ assetId: 'asset_002', assetType: 'bgm', filePath: 'assets/asset_002.mp3' }),
        asset({ assetId: 'asset_003', assetType: 'voice', filePath: 'voices/asset_003.wav' }),
      ],
    });
    const probe = vi.spyOn(assetFsMod, 'missingAssetFiles').mockResolvedValue([]);
    await useProjectStore.getState().refreshMissingAssets();
    expect(probe).toHaveBeenCalledWith('proj_20260827_0001', ['assets/asset_001.mp4']);
  });

  /**
   * ⚠️ **調べている間に消された素材を「見つかりません」で復活させない**（`projectstore-async-clobber`）＝
   * await 前の一覧から作った結果をそのまま書くと、**一覧に無いのにバナーだけ出る**（選べない行き止まり）。
   */
  it('調べている間に消された素材は、印に復活しない', async () => {
    let release: (v: string[]) => void = () => {};
    vi.spyOn(assetFsMod, 'missingAssetFiles').mockReturnValue(new Promise((r) => { release = r; }));
    const p = useProjectStore.getState().refreshMissingAssets();
    useProjectStore.setState({ assets: [] }); // 調べている間に全部消えた
    release(['assets/asset_001.mp4']);
    await p;
    expect(useProjectStore.getState().missingAssetIds).toEqual([]);
  });

  // ⚠️ **調べられないときに「全部見つからない」と言わない**（§2-5＝実行しても直らない案内を出さない）。
  it('素材が無い／動画が未採番なら調べに行かない', async () => {
    const probe = vi.spyOn(assetFsMod, 'missingAssetFiles').mockResolvedValue([]);
    useProjectStore.setState({ assets: [] });
    await useProjectStore.getState().refreshMissingAssets();
    expect(probe).not.toHaveBeenCalled();
    expect(useProjectStore.getState().missingAssetIds).toEqual([]);
  });
});

describe('removeAssets（まとめて消す・#348）', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [
        asset({ assetId: 'asset_001', filePath: 'assets/asset_001.mp4', thumbnailPath: 'assets/thumb_001.png' }),
        asset({ assetId: 'asset_002', assetType: 'image', filePath: 'assets/asset_002.png' }),
      ],
      assetSrcById: { asset_001: 'a', asset_002: 'b' },
      missingAssetIds: [], saveStatus: 'saved',
      meta: { ...st.meta, projectId: 'proj_20260827_0001' },
    }));
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('渡したものだけを消す', () => {
    vi.spyOn(assetFsMod, 'deleteProjectFiles').mockResolvedValue(1);
    useProjectStore.getState().removeAssets(['asset_002']);
    expect(useProjectStore.getState().assets.map((a) => a.assetId)).toEqual(['asset_001']);
    expect(useProjectStore.getState().assetSrcById).toEqual({ asset_001: 'a' });
  });

  /**
   * ⚠️ **ファイルも片づける**（#348）＝一覧から消えてもプロジェクトフォルダに残ると容量だけ食い続ける
   *（整理のための機能で片づかない、を作らない）。代表フレームも一緒に消す。
   */
  it('本体と代表フレームのファイルを片づける', () => {
    const del = vi.spyOn(assetFsMod, 'deleteProjectFiles').mockResolvedValue(2);
    useProjectStore.getState().removeAssets(['asset_001']);
    expect(del).toHaveBeenCalledWith('proj_20260827_0001', ['assets/asset_001.mp4', 'assets/thumb_001.png']);
  });

  // ⚠️ **1件も複数も同じ道**（ADR-0026②）＝片方だけファイルを片づける、を作らない。
  it('1件だけ消すときも同じ道を通る（ファイルを片づける）', () => {
    const del = vi.spyOn(assetFsMod, 'deleteProjectFiles').mockResolvedValue(1);
    useProjectStore.getState().removeAsset('asset_002');
    expect(useProjectStore.getState().assets.map((a) => a.assetId)).toEqual(['asset_001']);
    expect(del).toHaveBeenCalledWith('proj_20260827_0001', ['assets/asset_002.png']);
  });

  // ⚠️ **直しようが無い警告を残さない**（§2-5）＝消したものに「見つかりません」の印は要らない。
  it('見つからない印も一緒に落とす', () => {
    vi.spyOn(assetFsMod, 'deleteProjectFiles').mockResolvedValue(0);
    useProjectStore.setState({ missingAssetIds: ['asset_001', 'asset_002'] });
    useProjectStore.getState().removeAssets(['asset_002']);
    expect(useProjectStore.getState().missingAssetIds).toEqual(['asset_001']);
  });

  it('未保存に戻す', () => {
    vi.spyOn(assetFsMod, 'deleteProjectFiles').mockResolvedValue(0);
    useProjectStore.getState().removeAssets(['asset_002']);
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });

  it('書き出し中は消さず、理由を出す', () => {
    const del = vi.spyOn(assetFsMod, 'deleteProjectFiles');
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.getState().removeAssets(['asset_002']);
    expect(useProjectStore.getState().assets).toHaveLength(2);
    expect(del).not.toHaveBeenCalled();
    expect(useProjectStore.getState().importError).toMatch(/書き出し/);
  });

  /**
   * ⚠️ **取り込み中は消さない**（レビュー 🟡）＝`asset_NNN` は**空き番号を埋める**採番なので、
   * 消した番号を取り込み中のものが拾いうる。ファイルの片づけは待たない（`void`）ので、
   * **後から着地した削除が、新しく取り込んだファイルを消す**窓ができる。
   */
  it('取り込み中は消さず、いつやり直せばよいかを出す', () => {
    const del = vi.spyOn(assetFsMod, 'deleteProjectFiles');
    useProjectStore.setState({ isImporting: true });
    useProjectStore.getState().removeAssets(['asset_002']);
    expect(useProjectStore.getState().assets).toHaveLength(2);
    expect(del).not.toHaveBeenCalled();
    expect(useProjectStore.getState().importError).toBe(IMPORT_BUSY_MESSAGE);
  });

  it('空なら何もしない（空の未保存を作らない）', () => {
    const del = vi.spyOn(assetFsMod, 'deleteProjectFiles');
    useProjectStore.getState().removeAssets([]);
    expect(useProjectStore.getState().saveStatus).toBe('saved');
    expect(del).not.toHaveBeenCalled();
  });
});

describe('写真の大きさを測る（#346・「ぼやける素材」の材料）', () => {
  beforeEach(() => {
    useProjectStore.setState((st) => ({
      assets: [], assetSrcById: {}, importError: null, isImporting: false,
      meta: { ...st.meta, projectId: 'proj_20260827_0001' },
    }));
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    vi.spyOn(assetFsMod, 'importAssetByPath').mockResolvedValue('assets/asset_001.png');
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://a');
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue(null);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /**
   * ⚠️ **これが無いと「ぼやける素材」の注意が写真では一度も出ない**（#346 の実装中に判明）＝
   * `metadata` を書いていたのは**動画の取り込みだけ**で、写真には `width`/`height` が入らず、
   * 判定の材料が無いので黙って素通りしていた。
   */
  it('写真を取り込むと大きさが入る', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ width: 640, height: 360, durationSec: null, hasAudio: null });
    await useProjectStore.getState().addAssetByPath('D:/pics/写真.png');
    expect(useProjectStore.getState().assets[0].metadata).toEqual({ width: 640, height: 360 });
  });

  // ⚠️ **長さ・音の有無は捨てる**＝静止画には意味が無く、持たせると「0秒の動画」に見える。
  it('写真に長さ・音の有無は持たせない', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue({ width: 640, height: 360, durationSec: 0, hasAudio: false });
    await useProjectStore.getState().addAssetByPath('D:/pics/写真.png');
    expect(useProjectStore.getState().assets[0].metadata).toEqual({ width: 640, height: 360 });
  });

  // ⚠️ **測れなくても取り込みは続ける**（注意が1つ出ないだけ＝§2-5）。
  it('測れなくても取り込みは成功する', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(null);
    await useProjectStore.getState().addAssetByPath('D:/pics/写真.png');
    const a = useProjectStore.getState().assets[0];
    expect(a.filePath).toBe('assets/asset_001.png');
    expect(a.metadata).toBeUndefined();
    expect(useProjectStore.getState().importError).toBeNull();
  });
});
