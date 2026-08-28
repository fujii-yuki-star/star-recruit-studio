// プロジェクトの複製（#395）。純粋関数（§7 テスト対象）。
//
// ⚠️ **中身は作り替えず、身元だけ付け替える**＝場面・素材・声・設定はそのまま持っていく
//（`asset_NNN` も振り直さない＝場面が指している先が壊れない）。付け替えるのは
// **`projectId`／`projectName`／作成・更新の時刻**だけ。
//
// ⚠️ **焼き出し（ADR-0032）とは別物**＝あちらは**形式を変える片道変換**で、持っていけないものがある。
// こちらは**同じ形式のまま丸ごと**なので、変換の段が要らない（開いてすぐ同じ動画が出る）。
import type { Project } from './types';

/** 複製した動画の名前（「◯◯ のコピー」）。 */
export const COPY_NAME_SUFFIX = ' のコピー';

/** プロジェクト名の上限（`project.schema` の `projectName` maxLength と合わせる）。 */
const PROJECT_NAME_MAX = 80;

/**
 * 複製した動画の名前を作る。
 *
 * ⚠️ **上限を超えたら元の名前を削る**（接尾辞は残す）＝「のコピー」が落ちると、
 * どちらが複製か分からなくなる。
 * ⚠️ **「のコピー」を重ねない**＝複製の複製が「◯◯ のコピー のコピー」になると読みづらいので、
 * 既に付いていれば足さない（同じ名前が並ぶが、作った順で見分けられる）。
 */
export function duplicatedProjectName(name: string): string {
  const base = name.trim() || '無題のプロジェクト';
  if (base.endsWith(COPY_NAME_SUFFIX)) return base.slice(0, PROJECT_NAME_MAX);
  const room = PROJECT_NAME_MAX - COPY_NAME_SUFFIX.length;
  return `${base.slice(0, Math.max(0, room))}${COPY_NAME_SUFFIX}`;
}

/**
 * 複製した文書。**身元だけ付け替える**（中身は同じ）。
 *
 * ⚠️ **`updatedAt` も新しくする**＝一覧の並び（更新順）で複製がすぐ見つかる。
 * ⚠️ **元の文書は返さない**（新しいオブジェクトを返す）＝呼ぶ側が元を書き換えない。
 */
export function duplicateProjectDoc(project: Project, newProjectId: string, nowIso: string): Project {
  return {
    ...project,
    projectId: newProjectId,
    projectName: duplicatedProjectName(project.projectName),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * 複製で運ぶファイルの相対パス（素材の本体・動画の代表フレーム・作成済みの読み上げ音声）。
 *
 * ⚠️ **声も運ぶ**（#395 の受け入れ条件）＝運ばないと開いた先で作り直しになる（時間もかかる）。
 * ⚠️ **キャッシュ（`cache/`）は運ばない**＝作り直せるもの（帯に敷く絵・#332）。
 * 重複は畳み、並びは決定的にする（`bakedFilePaths` と同じ流儀）。
 */
export function duplicatedFilePaths(project: Project): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null | undefined): void => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  for (const a of project.assets) {
    add(a.filePath);
    add(a.thumbnailPath);
  }
  // 読み上げ音声は `voices/<sceneId>.wav`／掛け合いは `voices/<sceneId>__<lineId>.wav`（`11 §7.2`）。
  // ⚠️ **保存されている場所を推測しない**＝場面が持っている `voicePath` をそのまま運ぶ。
  for (const s of project.scenes) {
    add(s.narration?.voicePath);
    for (const l of s.lines ?? []) add(l.voicePath);
  }
  return out;
}
