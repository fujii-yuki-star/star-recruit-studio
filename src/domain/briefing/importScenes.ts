// 登録済みの動画（場面形式）から場面を取り込み、1本の新しい動画へ並べる（ADR-0061 決定5「場面の取り込み」・β）。純粋関数。
//
// ⚠️ **原本は書き換えない**＝受け取った文書は読むだけで、新しい場面・素材・動きを作って返す。
// ⚠️ **動画をまたぐ番号はすべて付け替える**＝`scene_NNN`・`asset_NNN`・`anim_NNN` は動画ごとに 001 から振られるので、
//   2本から集めると必ず重なる。場面の中だけで一意な番号（`line_NNN`・要素の `free_NNN`・`group_NNN`）は
//   場面ごとコピーするので重ならない＝そのまま持っていく（付け替えると動き・字幕の対象の参照まで直す必要が出る）。
// ⚠️ **ファイルは名前を変えてコピーする**＝素材は `assets/<素材の番号>.<拡張子>`、声は `voices/<場面>.wav`／
//   `voices/<場面>_<行>.wav` という決まった名前で置くので、番号を付け替えたら名前も変わる（どこから何へ、を返す）。
// ⚠️ **同じ動画の同じ素材は1回だけ**コピーする（2つの場面が同じ写真を使っていても1つ）。
import { createAnimationId, createAssetId, createSceneId } from '../project/persistence';
import { lineVoiceStem } from '../project/narrationLines';
import type { Asset, ElementAnimation, Project, Scene } from '../project/types';

/** 取り込む場面1つ（どの動画のどの場面か）。並べた順が新しい動画の順になる。 */
export interface ScenePick {
  project: Project;
  sceneId: string;
}

/** 取り込み先の今の状態（番号を重ねないために使う）。 */
export interface ImportTarget {
  /** 取り込んだ場面を入れるパート。 */
  partId: string;
  /** 取り込み先に既にある番号。 */
  sceneIds: readonly string[];
  assetIds: readonly string[];
  animationIds: readonly string[];
  /** 取り込んだ最初の場面の並び（`order`）。 */
  startOrder: number;
}

/** 名前を変えてコピーするファイル1つ（動画の置き場所からの相対パス）。 */
export interface ImportedFile {
  fromProjectId: string;
  fromRelPath: string;
  toRelPath: string;
}

/** 取り込んだ場面がどこから来たか（組み直し・声の作り直しで使う）。 */
export interface ImportedSceneSource {
  sceneId: string;
  sourceProjectId: string;
  sourceSceneId: string;
}

export interface SceneImportResult {
  /** 取り込んだ場面（並べた順・`order` は `startOrder` から）。 */
  scenes: Scene[];
  /** 取り込んだ場面が使う素材（付け替えた番号・名前）。 */
  assets: Asset[];
  /** 取り込んだ場面の動き（付け替えた番号）。 */
  animations: ElementAnimation[];
  /** 名前を変えてコピーするファイル。 */
  files: ImportedFile[];
  sources: ImportedSceneSource[];
  /** 動画に見つからなかった場面（取り込まなかった＝呼ぶ側が知らせる）。 */
  missingScenes: { projectId: string; sceneId: string }[];
  /**
   * 原本の時点で**素材の一覧に無い**のに場面が指していた番号（原本でも「素材が見つかりません」になっている）。
   * 取り込み先でも同じ見え方になるよう、**誰とも重ならない新しい番号**を当てて指したままにする。
   */
  missingAssets: { projectId: string; assetId: string }[];
}

/** 動画ごとの素材の番号の形（`asset_NNN`）。これに当たる番号だけを「その動画の素材」として付け替える。 */
const PROJECT_ASSET_ID = /^asset_\d+$/;

/** ファイル名の拡張子（`.png` など・無ければ空）。 */
function extOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/** 付け替えた素材のファイル名（本体）。 */
function assetFilePath(newId: string, oldPath: string): string {
  return `assets/${newId}${extOf(oldPath)}`;
}

/** 付け替えた素材の代表フレーム。`assets/<旧番号>_thumb.png` の形なら頭だけ付け替える。 */
function thumbnailFilePath(newId: string, oldId: string, oldPath: string): string {
  const base = oldPath.slice(oldPath.lastIndexOf('/') + 1);
  if (base.startsWith(oldId)) return `assets/${newId}${base.slice(oldId.length)}`;
  return `assets/${newId}_thumb${extOf(oldPath)}`;
}

/**
 * 場面を取り込む。`picks` の順に並べる。
 *
 * ⚠️ **素材は場面が実際に指しているものだけ**持っていく（`assetRefs`・立ち絵・自由配置の要素・場面の BGM）。
 * ⚠️ **動画の素材でない番号**（同梱の立ち絵・見た目パターンの既定素材など＝どの動画でも同じ物を指す）は付け替えない。
 */
export function importScenes(target: ImportTarget, picks: readonly ScenePick[]): SceneImportResult {
  const sceneIds = [...target.sceneIds];
  const assetIds = [...target.assetIds];
  const animationIds = [...target.animationIds];
  /** 動画ごとの素材の付け替え表（同じ素材は1回だけ）。 */
  const assetMap = new Map<string, string>();
  const assets: Asset[] = [];
  const files: ImportedFile[] = [];
  const copied = new Set<string>();
  const scenes: Scene[] = [];
  const animations: ElementAnimation[] = [];
  const sources: ImportedSceneSource[] = [];
  const missingScenes: SceneImportResult['missingScenes'] = [];
  const missingAssets: SceneImportResult['missingAssets'] = [];

  const copyFile = (fromProjectId: string, fromRelPath: string | null | undefined, toRelPath: string): void => {
    if (!fromRelPath) return;
    const key = `${fromProjectId}\u0000${fromRelPath}\u0000${toRelPath}`;
    if (copied.has(key)) return;
    copied.add(key);
    files.push({ fromProjectId, fromRelPath, toRelPath });
  };

  /** その動画の素材の番号を、取り込み先の番号へ。動画の素材でない番号はそのまま。 */
  const mapAsset = (project: Project, id: string | null | undefined): string | null | undefined => {
    if (id == null) return id;
    const key = `${project.projectId}\u0000${id}`;
    const known = assetMap.get(key);
    if (known) return known;
    const asset = project.assets.find((a) => a.assetId === id);
    if (!asset && !PROJECT_ASSET_ID.test(id)) return id;
    const newId = createAssetId(assetIds);
    assetIds.push(newId);
    assetMap.set(key, newId);
    if (!asset) {
      missingAssets.push({ projectId: project.projectId, assetId: id });
      return newId;
    }
    const filePath = assetFilePath(newId, asset.filePath);
    const next: Asset = { ...asset, assetId: newId, filePath };
    copyFile(project.projectId, asset.filePath, filePath);
    if (asset.thumbnailPath) {
      next.thumbnailPath = thumbnailFilePath(newId, asset.assetId, asset.thumbnailPath);
      copyFile(project.projectId, asset.thumbnailPath, next.thumbnailPath);
    }
    assets.push(next);
    return newId;
  };

  picks.forEach((pick) => {
    const { project } = pick;
    const src = project.scenes.find((s) => s.sceneId === pick.sceneId);
    if (!src) {
      missingScenes.push({ projectId: project.projectId, sceneId: pick.sceneId });
      return;
    }
    const sceneId = createSceneId(sceneIds);
    sceneIds.push(sceneId);
    const assetRefs: Scene['assetRefs'] = {};
    for (const [k, v] of Object.entries(src.assetRefs)) assetRefs[k] = mapAsset(project, v) ?? null;

    const narrationVoice = src.narration.voicePath ? `voices/${sceneId}.wav` : src.narration.voicePath;
    copyFile(project.projectId, src.narration.voicePath, narrationVoice ?? '');

    const scene: Scene = {
      ...src,
      sceneId,
      partId: target.partId,
      order: target.startOrder + scenes.length,
      assetRefs,
      character: { ...src.character, ...(src.character.poseAssetId !== undefined ? { poseAssetId: mapAsset(project, src.character.poseAssetId) ?? null } : {}) },
      narration: { ...src.narration, voicePath: narrationVoice },
      ...(src.lines
        ? {
            lines: src.lines.map((l) => {
              if (!l.voicePath) return { ...l };
              const voicePath = `voices/${lineVoiceStem(sceneId, l.lineId)}.wav`;
              copyFile(project.projectId, l.voicePath, voicePath);
              return { ...l, voicePath };
            }),
          }
        : {}),
      ...(src.freeLayout
        ? { freeLayout: src.freeLayout.map((e) => (e.assetId !== undefined ? { ...e, assetId: mapAsset(project, e.assetId) ?? null } : { ...e })) }
        : {}),
      ...(src.bgmSettings
        ? { bgmSettings: { ...src.bgmSettings, ...(src.bgmSettings.assetId !== undefined ? { assetId: mapAsset(project, src.bgmSettings.assetId) ?? null } : {}) } }
        : {}),
    };
    scenes.push(scene);
    sources.push({ sceneId, sourceProjectId: project.projectId, sourceSceneId: src.sceneId });

    for (const a of project.timelineOverlay?.animations ?? []) {
      if (a.sceneId !== src.sceneId) continue;
      const id = createAnimationId(animationIds);
      animationIds.push(id);
      animations.push({ ...a, id, sceneId, keyframes: a.keyframes.map((k) => ({ ...k })) });
    }
  });

  return { scenes, assets, animations, files, sources, missingScenes, missingAssets };
}
