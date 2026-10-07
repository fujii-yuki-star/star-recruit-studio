// 完全新規のタイムラインプロジェクトを作る（ADR-0032 決定7/15・#635）。純粋関数（§4・§7）。
//
// 焼き出し（`bake.ts`）が「場面形式から作る」経路なのに対し、こちらは**何も無いところから作る**経路。
// どちらも出来上がりは同じ形（`TimelineProject`）で、**id の発行と時計は呼び出し側**が渡す（この関数に
// 時計を持ち込まない＝`bake.ts` と同じ流儀）。
import { PROJECT_FORMAT, TRACK_KIND } from '../enums';
import type { Orientation } from '../enums';
import { defaultVideoSettings, defaultVoiceSettings } from '../project/persistence';
import { addTrack } from './edit';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineProject } from './types';

export interface CreateTimelineProjectInput {
  /** 新しいプロジェクトの id（呼び出し側が `createProjectId` で発行）。 */
  projectId: string;
  /** 表示名（空なら呼び出し側が既定を入れる＝ここでは受け取ったものをそのまま使う）。 */
  projectName: string;
  /** 作成時刻（ISO 文字列・`createdAt`/`updatedAt` に入る）。 */
  now: string;
  /** 画面の向き（#664）。未指定は既定（横向き）＝場面形式の新規作成と同じ既定。 */
  aspectRatio?: Orientation;
}

/**
 * 空のタイムラインプロジェクト。**最初から列を1本ずつ持たせる**（映像と音）＝置く前に「列を足す」から
 * 始めさせない。中身（クリップ）は無いので、開いた直後の書き出しは `timelineExportBlockers` が止める。
 * 向き（#664）は画面で選ばせる＝未指定は既定（横向き）。
 */
export function createEmptyTimelineProject(input: CreateTimelineProjectInput): TimelineProject {
  const videoSettings = defaultVideoSettings();
  const base: TimelineProject = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: input.projectId,
    projectName: input.projectName,
    createdAt: input.now,
    updatedAt: input.now,
    videoSettings: input.aspectRatio ? { ...videoSettings, aspectRatio: input.aspectRatio } : videoSettings,
    voiceSettings: defaultVoiceSettings(),
    assets: [],
    tracks: [],
    clips: [],
  };
  // 列の採番・並び（手前が末尾）は編集操作と同じ規則で作る＝新規だけ別の付け方にしない（§2-7）。
  return addTrack(addTrack(base, TRACK_KIND.visual), TRACK_KIND.audio);
}
