// 掛け合い：セリフ列（scene.lines）の編集操作（追加/削除/並べ替え/昇格・降格）。ADR-0015 PR-F。
// 純粋関数（副作用なし）。UI は patch/updateScene 経由でこれらを呼び、結果の Scene で差し替える（freeLayoutOps と同型）。
// ID 採番は createLineId（§2.1・scene 内一意）に委譲する。
import { NARRATION_STATUS } from '../enums';
import { lineFromNarration } from './narrationLines';
import { createLineId } from './persistence';
import type { NarrationLine, Scene } from './types';

/** 単一 narration を lines:[line_001] へ昇格（掛け合い化）。既に lines があればそのまま。 */
export function promoteToLines(scene: Scene): Scene {
  if (scene.lines && scene.lines.length > 0) return scene;
  return { ...scene, lines: [lineFromNarration(scene.narration)] };
}

/** 掛け合いを解除：lines[0] を narration に戻し lines を消す（2行目以降は破棄）。声(speaker)は文字列 voiceId に戻せないため引き継がない。 */
export function demoteFromLines(scene: Scene): Scene {
  if (!scene.lines || scene.lines.length === 0) return scene;
  const first = scene.lines[0];
  return {
    ...scene,
    narration: {
      ...scene.narration,
      text: first.text,
      status: first.status,
      voicePath: first.voicePath ?? null,
      speed: first.speed ?? null,
      pitch: first.pitch ?? null,
      intonation: first.intonation ?? null,
    },
    lines: undefined,
  };
}

/** 末尾に新しい空セリフ行を追加（lines が無ければ先に昇格する）。 */
export function addLine(scene: Scene): Scene {
  const base = promoteToLines(scene);
  const lines = base.lines ?? [];
  const lineId = createLineId(lines.map((l) => l.lineId));
  return { ...base, lines: [...lines, { lineId, text: '', status: NARRATION_STATUS.none }] };
}

/** 指定行を削除。最後の1行を消すときは掛け合いを解除（単一 narration に戻す＝0行にしない）。 */
export function removeLine(scene: Scene, lineId: string): Scene {
  if (!scene.lines) return scene;
  const remaining = scene.lines.filter((l) => l.lineId !== lineId);
  if (remaining.length === 0) return demoteFromLines(scene);
  return { ...scene, lines: remaining };
}

/** 声に影響する編集（text/speaker/speed/pitch/intonation）か。これらの変更は音声の作り直しが必要。 */
function affectsVoice(patch: Partial<NarrationLine>, line: NarrationLine): boolean {
  return (
    (patch.text !== undefined && patch.text !== line.text) ||
    (patch.speaker !== undefined && patch.speaker !== line.speaker) ||
    (patch.speed !== undefined && patch.speed !== line.speed) ||
    (patch.pitch !== undefined && patch.pitch !== line.pitch) ||
    (patch.intonation !== undefined && patch.intonation !== line.intonation)
  );
}

/** 指定行を部分更新。声に影響する変更（text/speaker 等）のときは status/voicePath をリセット（古い音声との不整合防止）。 */
export function updateLine(
  scene: Scene,
  lineId: string,
  patch: Partial<Omit<NarrationLine, 'lineId'>>,
): Scene {
  if (!scene.lines) return scene;
  return {
    ...scene,
    lines: scene.lines.map((l) => {
      if (l.lineId !== lineId) return l;
      const next: NarrationLine = { ...l, ...patch };
      if (affectsVoice(patch, l)) {
        next.status = NARRATION_STATUS.none;
        next.voicePath = null;
      }
      return next;
    }),
  };
}

/** 指定行を delta 分だけ並べ替え（-1=前へ / +1=後ろへ）。範囲外は変化なし。 */
export function moveLine(scene: Scene, lineId: string, delta: number): Scene {
  if (!scene.lines) return scene;
  const idx = scene.lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) return scene;
  const to = idx + delta;
  if (to < 0 || to >= scene.lines.length) return scene;
  const lines = [...scene.lines];
  const [moved] = lines.splice(idx, 1);
  lines.splice(to, 0, moved);
  return { ...scene, lines };
}
