// 操作案内が**画面を取りこぼしていない**こと（#1229）。
//
// ⚠️ **人の目で数えない**＝画面を1つ足したときに案内へ行を足し忘れても、画面は普通に動くので
// 誰も気づかない（「使い方」に載っていない画面が静かに増える）。`SCREEN_TITLES` は
// `Record<ScreenId, string>` なので**画面の全部**を持っている＝それと突き合わせる。
import { describe, expect, it } from "vitest";
import { SCREEN_TITLES } from "../screenTitles";
import { HELP_FLOW, HELP_PLACES, HELP_TIMELINE, HELP_TIPS, helpFlowFor } from "./helpGuide";
import { noScenesMessage, VIDEO_KIND_LABEL } from "../uiLabels";
import { VIDEO_KIND } from "../../domain/enums";

const covered = [...HELP_FLOW, ...HELP_TIMELINE, ...HELP_PLACES].map((s) => s.screen);

describe("使い方の案内（#1229）", () => {
  it("「使い方」自身を除く全画面に、案内が1行ずつある", () => {
    // ⚠️ **「使い方」を除く**＝いま開いている画面なので、自分自身への案内は要らない。
    const expected = (Object.keys(SCREEN_TITLES) as (keyof typeof SCREEN_TITLES)[]).filter((id) => id !== "help");
    expect([...covered].sort()).toEqual([...expected].sort());
  });

  it("同じ画面を2回案内しない（節をまたいだ重複も見る）", () => {
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("どの案内も、一言の説明と具体の手順を持つ（空の行を並べない）", () => {
    for (const step of [...HELP_FLOW, ...HELP_TIMELINE, ...HELP_PLACES]) {
      expect(step.summary.length, `${step.screen} の一言`).toBeGreaterThan(0);
      expect(step.detail.length, `${step.screen} の手順`).toBeGreaterThan(0);
      for (const d of step.detail) expect(d.length, `${step.screen} の手順の中身`).toBeGreaterThan(0);
    }
  });

  it("覚えておくと楽なことも、題と中身がそろっている", () => {
    expect(HELP_TIPS.length).toBeGreaterThan(0);
    for (const t of HELP_TIPS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});

// UI/UX 監査 2026-10-02：使い方が新しい AI の手伝いに触れていなかった。
// ⚠️ **画面のボタンの名前と同じ言葉で案内する**（書き写さずに引いているかを、画面の文言そのもので確かめる）。
describe("AI の手伝いの案内", () => {
  const textOf = (steps: readonly { screen: string; detail: readonly string[] }[], screen: string): string =>
    steps.filter((s) => s.screen === screen).flatMap((s) => s.detail).join("\n");
  it("写真の読み取り・AIに頼む・名前の候補・公開前チェックからの手伝い・素材のAI解析・設定・動きの点に触れる", async () => {
    const g = await import("./helpGuide");
    const L = await import("../uiLabels");
    const all = [...g.HELP_FLOW, ...g.HELP_TIMELINE, ...g.HELP_PLACES];
    expect(textOf(all, "wizard")).toContain(L.DESCRIBING_LABEL);
    expect(textOf(all, "wizard")).toContain(L.WAIT_DESCRIBE_LABEL);
    expect(textOf(all, "scene-edit")).toContain(L.AI_ASSIST_VIDEO_TITLE_LABEL); // 名前の欄は場面編集にある
    expect(textOf(all, "draft")).not.toContain(L.AI_ASSIST_VIDEO_TITLE_LABEL);
    const sceneEdit = textOf(all, "scene-edit");
    expect(sceneEdit).toContain(`「${L.AI_ASSIST_HEADING.replace(/：$/, "")}」`);
    for (const k of L.AI_ASSIST_NARRATION_KINDS) expect(sceneEdit).toContain(`「${k.label}」`);
    expect(sceneEdit).toContain(`「${L.AI_ASSIST_USE_LABEL}」`);
    expect(textOf(all, "precheck")).toContain(L.FIX_NARRATION_ACTION_LABEL);
    expect(textOf(all, "precheck")).toContain(L.TRAIL_NEXT_LABEL);
    expect(textOf(all, "precheck")).toContain(L.SHORTEN_SUBTITLE_ACTION_LABEL);
    expect(textOf(all, "materials")).toContain(L.MATERIAL_AI_DESC_SHORT);
    expect(textOf(all, "materials")).toContain(L.MATERIAL_NOTE_SHORT);
    expect(textOf(all, "settings")).toContain("このパソコンの中で動きます");
    expect(textOf(all, "timeline-project")).toContain("点を引く");
  });
});

// ADR-0076 決定2・6：採用動画は拡張パックの鍵で出す＝鍵が無い人の案内は採用に触れない。
describe("採用動画に触れるのは鍵があるときだけ（ADR-0076）", () => {
  const all = (steps: readonly { summary: string; detail: readonly string[] }[]): string =>
    steps.flatMap((s) => [s.summary, ...s.detail]).join("\n");
  it("鍵が無い案内（既定）は、どこにも採用動画の名前も「採用」も出さない", () => {
    expect(all(HELP_FLOW)).toBe(all(helpFlowFor(false)));
    expect(all(helpFlowFor(false))).not.toContain("採用");
  });
  it("鍵がある案内は、一般→採用の順で2つの種類に触れ、ほかの段は同じ", () => {
    const text = all(helpFlowFor(true));
    const g = text.indexOf(`「${VIDEO_KIND_LABEL[VIDEO_KIND.general]}」`);
    const r = text.indexOf(`「${VIDEO_KIND_LABEL[VIDEO_KIND.recruit]}」`);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThan(g);
    // 違うのは最初の段の1行だけ（案内の段の並びは鍵で変わらない）。
    expect(helpFlowFor(true).map((s) => s.screen)).toEqual(helpFlowFor(false).map((s) => s.screen));
    expect(all(helpFlowFor(true).slice(1))).toBe(all(helpFlowFor(false).slice(1)));
  });
  it("ホームの「まだ動画案がありません」の案内は、会社情報を求めない（種類に寄せない）", () => {
    const idle = noScenesMessage("idle", false, "");
    expect(idle).not.toContain("会社");
    expect(idle).toContain("新しい動画を作る");
  });
});
