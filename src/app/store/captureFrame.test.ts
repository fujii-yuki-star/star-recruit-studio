// 動画から静止画を切り出す（#349）。
import { readFileSync } from 'node:fs';
import { CAPTURE_FRAME_ASSET_MISSING_MESSAGE, RELINK_ASSET_LABEL } from '../uiLabels';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/assetFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/assetFs')>()),
  extractVideoFrame: vi.fn(),
  assetDisplayUrl: vi.fn(async () => 'asset://frame.png'),
}));

import { useProjectStore } from './projectStore';
import { extractVideoFrame } from '../../infrastructure/assetFs';
import { ASSET_TYPE } from '../../domain/enums';
import type { Asset } from '../../domain/project/types';

const video: Asset = {
  assetId: 'asset_001',
  assetType: ASSET_TYPE.video,
  displayName: '会社紹介',
  filePath: 'assets/asset_001.mp4',
};

function setup(over: Partial<{ assets: Asset[]; projectId: string }> = {}): void {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    assets: over.assets ?? [video],
    meta: { ...meta, projectId: over.projectId ?? 'proj_20260828_001' },
    importError: null,
    isImporting: false,
  } as never);
}

beforeEach(() => {
  setup();
  vi.mocked(extractVideoFrame).mockResolvedValue('assets/asset_002.png');
});
afterEach(() => vi.clearAllMocks());

describe('captureVideoFrame', () => {
  it('切り出した絵を普通の写真素材として足す', async () => {
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 30);
    expect(id).toBe('asset_002');
    const added = useProjectStore.getState().assets.find((a) => a.assetId === 'asset_002');
    expect(added).toMatchObject({
      assetType: ASSET_TYPE.image,
      displayName: '会社紹介（0:30）', // 一覧で見分けられる名前（#349）
      filePath: 'assets/asset_002.png',
    });
  });

  it('切り出しの結果のパスを使う（Rust が返した場所を信じる）', async () => {
    vi.mocked(extractVideoFrame).mockResolvedValue('assets/別の場所.png');
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    const list = useProjectStore.getState().assets;
    expect(list[list.length - 1].filePath).toBe('assets/別の場所.png');
  });

  it('表示用の絵を読み込む（一覧にすぐ出る）', async () => {
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    expect(useProjectStore.getState().assetSrcById.asset_002).toBe('asset://frame.png');
  });

  /**
   * ⚠️ **できてから一覧へ足す**（取り込みの楽観追加と違う）＝切り出しは失敗しうる（尺の外・壊れた動画）ので、
   * 先に足すと**中身の無い素材**が一瞬見えてから消える。
   */
  it('失敗したら素材を増やさず、理由を出す', async () => {
    vi.mocked(extractVideoFrame).mockRejectedValue('その時間には映像がありませんでした。');
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 999);
    expect(id).toBeNull();
    expect(useProjectStore.getState().assets).toHaveLength(1);
    expect(useProjectStore.getState().importError).toContain('その時間には映像がありません');
  });

  it('動画でない素材は切り出さない（次の行動を出す）', async () => {
    setup({ assets: [{ ...video, assetType: ASSET_TYPE.image }] });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(useProjectStore.getState().importError).toContain('先に動画を取り込んで');
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  /** ⚠️ 保存前のプロジェクトでは元の動画がまだフォルダに無い。 */
  it('プロジェクトが保存されていなければ切り出さない', async () => {
    setup({ projectId: '' });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  it('取り込み中は断る（二重に走らせない）', async () => {
    useProjectStore.setState({ isImporting: true });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  /** ⚠️ 書き出し中は文書を固定する（設定した意味どおりの MP4 にする・#570 P1）。 */
  it('書き出し中は断る', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });

  it('終わったら取り込み中の印を必ず下ろす（失敗しても固まらない）', async () => {
    vi.mocked(extractVideoFrame).mockRejectedValue('だめ');
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    expect(useProjectStore.getState().isImporting).toBe(false);
  });
});

// ファイルが見つからない動画は、**押す前に断る**（#1155 ⑤・ADR-0026②）。
//
// ⚠️ **以前は文書の中身しか見ていなかった**＝`convertFileSrc` は実在を見ないので素材は残り、
// ボタンも押せる＝**走らせてから Rust に断られる**形だった。タイムライン形式の「絵を止める」は
// 同じ門を持っているので、**同じ概念を形式で割らない**。
describe('ファイルが見つからない動画（#1155 ⑤）', () => {
  it('押す前に断る（切り出しを走らせない）', async () => {
    setup();
    useProjectStore.setState({ missingAssetIds: ['asset_001'] } as never);
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 30);
    expect(id, '切り出せたことにしている').toBeNull();
    expect(vi.mocked(extractVideoFrame), '走らせてから断っている').not.toHaveBeenCalled();
  });

  // ⚠️ **行き先は「取り込み直す」ではない**（#1168 レビュー由来 🔴）＝最初そう書いたのは
  // 「この画面には『ファイルを選び直す』が無い」と思い込んでいたからで、**事実と違った**
  //（この断りが出る `MaterialsScreen` の同じ右の欄に既にある）。取り込み直すと**新しい素材番号**
  // になり、**置いた場所・切り出す範囲・動き・字幕の紐づけを失う**＝#347／ADR-0024 が決めた
  // 非破壊の道と**逆**を案内していた。だから「言うこと」だけでなく**「言わないこと」も留める**。
  it('断りは、同じ画面にある非破壊の道を名指しする（取り込み直せ、とは言わない）', async () => {
    setup();
    useProjectStore.setState({ missingAssetIds: ['asset_001'] } as never);
    await useProjectStore.getState().captureVideoFrame('asset_001', 30);
    const msg = useProjectStore.getState().importError ?? '';
    expect(msg, 'この画面にある導線の名前で呼んでいない').toContain('ファイルを選び直す');
    expect(msg, '置いた場所・設定を失う道を勧めている').not.toContain('取り込み直');
    expect(msg, '次の行動を言っていない').toContain('ください');
  });

  // ⚠️ **その導線が本当に同じ画面にあることまで見る**＝上の検査は「文がこう書いてある」しか
  // 言えないので、`MaterialsScreen` 側の名前が変わると**嘘の案内のまま緑**になる。
  // ⚠️ **「寄せた」は呼び出し側の数を数えて出す**（CLAUDE.md §7）＝「定数を使っている」だけだと、
  // **3か所のうち1か所を写しに戻しても緑**になる（実際に変異チェックで生き残った）。
  it('名指しした導線は、断りを出す画面が同じ呼び名で置いている（写しが1つも残っていない）', () => {
    const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
    // 説明（コメント）は数えない＝呼び名の由来をコメントに書けなくなる
    const body = (src: string): string =>
      src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

    const materials = read('../screens/MaterialsScreen.tsx');
    // 切り出しの操作欄を置いている画面であること（別画面の話にすり替わっていない）
    expect(materials, '切り出しの操作欄がこの画面から外れている').toContain('CaptureFrameControls');
    // 画面に出る3か所＝上のバナー・右の欄のボタン・切り出し欄の案内
    expect(count(body(materials), '{RELINK_ASSET_LABEL}'), 'バナーとボタンの2か所で呼んでいない').toBe(2);
    expect(count(body(read('../components/CaptureFrameControls.tsx')), '{RELINK_ASSET_LABEL}'), '切り出し欄の案内が呼んでいない').toBe(1);
    // 写しが残っていない＝片方だけ言い換えられる形に戻っていない
    for (const rel of ['../screens/MaterialsScreen.tsx', '../components/CaptureFrameControls.tsx']) {
      expect(count(body(read(rel)), RELINK_ASSET_LABEL), `${rel} に呼び名の写しが残っている`).toBe(0);
    }
    expect(CAPTURE_FRAME_ASSET_MISSING_MESSAGE, '断りが同じ呼び名で呼んでいない').toContain(RELINK_ASSET_LABEL);
  });

  // ⚠️ **見つかっている動画は止めない**（誤検出は操作を殺す）。
  it('別の素材が見つからないだけなら、切り出せる', async () => {
    setup();
    useProjectStore.setState({ missingAssetIds: ['asset_999'] } as never);
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 30);
    expect(id).not.toBeNull();
    expect(vi.mocked(extractVideoFrame)).toHaveBeenCalled();
  });
});
