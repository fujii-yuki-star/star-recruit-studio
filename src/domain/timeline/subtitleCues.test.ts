// 描かれる字幕を時刻つきで取り出す（ADR-0055 決定4・#1351）。
import { describe, expect, it } from "vitest";
import { NARRATION_STATUS, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../enums";
import type { Project, Scene } from "../project/types";
import type { Template } from "../template/types";
import { BAKE_RANGE_KIND, bakeTimelineProject } from "./bake";
import { subtitleCuesOf } from "./subtitleCues";
import { TIMELINE_SCHEMA_VERSION } from "./types";
import type { TimelineClip, TimelineProject } from "./types";

const TEMPLATE: Template = {
  schemaVersion: "1.0",
  templateId: "tmpl_normal",
  name: "通常",
  category: "photo_intro",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: "mainVisual", type: "slot", x: 0, y: 0, w: 1920, h: 1080 },
    { id: "subtitle", type: "subtitle", textKey: "subtitle", x: 100, y: 900, w: 1720, h: 120 },
  ],
};
const templateOf = (id: string): Template | undefined => (id === TEMPLATE.templateId ? TEMPLATE : undefined);

const box = { x: 0, y: 0, w: 100, h: 50 };
const doc = (clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261006_001",
  projectName: "t",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [
    { id: "track_001", kind: TRACK_KIND.visual },
    { id: "track_002", kind: TRACK_KIND.visual },
    { id: "track_003", kind: TRACK_KIND.audio },
  ],
  clips,
  ...over,
} as TimelineProject);

describe("subtitleCuesOf", () => {
  it("字幕クリップ（自分の文・連動先の読み上げ文）と見た目パターンの字幕の層を時刻順に", () => {
    const d = doc([
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, templateId: "tmpl_normal", trackId: "track_001", startSec: 4, durationSec: 3, ...box, texts: { subtitle: "パターンの字幕" } },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 0, durationSec: 2, ...box, text: "自分の文" },
      { id: "clip_003", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_003", startSec: 2, durationSec: 1.5, voice: { text: "読み上げの文" } },
      { id: "clip_004", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 2, durationSec: 1.5, ...box, voiceClipId: "clip_003" },
    ] as TimelineClip[]);
    expect(subtitleCuesOf(d, templateOf)).toEqual([
      { startSec: 0, endSec: 2, text: "自分の文" },
      { startSec: 2, endSec: 3.5, text: "読み上げの文" },
      { startSec: 4, endSec: 7, text: "パターンの字幕" },
    ]);
  });

  it("描かれないものは出さない＝隠した列・隠した部品・隠したまとまり・空の文・字幕でない部品・見た目が見つからない部品", () => {
    const d = doc(
      [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 1, ...box, text: "隠した列" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 0, durationSec: 1, ...box, text: "隠した部品", hidden: true },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 1, durationSec: 1, ...box, text: "まとまりの中" },
        { id: "clip_004", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 2, durationSec: 1, ...box, text: "  " },
        { id: "clip_005", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 3, durationSec: 1, ...box, text: "ただの文字" },
        { id: "clip_006", kind: TIMELINE_CLIP_KIND.template, templateId: "tmpl_404", trackId: "track_002", startSec: 4, durationSec: 1, ...box, texts: { subtitle: "見つからない" } },
        { id: "clip_007", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_002", startSec: 5, durationSec: 1, ...box, text: "残る" },
      ] as TimelineClip[],
      {
        tracks: [
          { id: "track_001", kind: TRACK_KIND.visual, hidden: true },
          { id: "track_002", kind: TRACK_KIND.visual },
        ],
        groups: [{ id: "group_001", members: ["clip_003"], hidden: true }],
      } as Partial<TimelineProject>,
    );
    expect(subtitleCuesOf(d, templateOf)).toEqual([{ startSec: 5, endSec: 6, text: "残る" }]);
  });
});

describe("場面形式は焼き出しを通して同じ取り出し方へ（ADR-0055 決定4）", () => {
  const scene = (over: Partial<Scene>): Scene => ({
    sceneId: "scene_001",
    partId: "part_001",
    order: 1,
    sceneType: "photo_intro",
    templateId: "tmpl_normal",
    durationSec: 6,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: NARRATION_STATUS.none },
    warnings: [],
    ...over,
  });
  const project = (scenes: Scene[]): Project => ({
    schemaVersion: "1.24",
    projectId: "proj_20260701_001",
    projectName: "p",
    purpose: "company_intro",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
  });
  const bake = (p: Project, lineDurations: Record<string, number> = {}): TimelineProject =>
    bakeTimelineProject(p, {
      range: { kind: BAKE_RANGE_KIND.whole },
      projectId: "proj_20261006_001",
      projectName: "焼いた",
      nowIso: "2026-10-06T00:00:00.000Z",
      templateOf,
      lineDurationsFor: () => lineDurations,
    }).doc;

  it("単独の字幕は場面の時刻・掛け合いは行ごとの時刻", () => {
    const p = project([
      scene({ sceneId: "scene_001", texts: { subtitle: "最初の場面" }, durationSec: 4 }),
      scene({
        sceneId: "scene_002",
        order: 2,
        durationSec: 6,
        lines: [
          { lineId: "line_001", text: "いち", speaker: 1, status: NARRATION_STATUS.none },
          { lineId: "line_002", text: "に", speaker: 3, status: NARRATION_STATUS.none },
        ],
      }),
    ]);
    const cues = subtitleCuesOf(bake(p, { line_001: 2, line_002: 3 }), templateOf);
    expect(cues.map((c) => c.text)).toEqual(["最初の場面", "いち", "に"]);
    expect(cues[0]).toEqual({ startSec: 0, endSec: 4, text: "最初の場面" });
    expect(cues[1].startSec).toBeGreaterThanOrEqual(4);
    expect(cues[2].startSec).toBeGreaterThan(cues[1].startSec);
  });

  it("字幕を切った場面は出さない", () => {
    const p = project([scene({ texts: { subtitle: "出ない" }, subtitleEnabledDefault: false })]);
    expect(subtitleCuesOf(bake(p), templateOf)).toEqual([]);
  });
});
