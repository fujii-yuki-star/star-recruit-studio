// 操作案内が**画面を取りこぼしていない**こと（#1229）。
//
// ⚠️ **人の目で数えない**＝画面を1つ足したときに案内へ行を足し忘れても、画面は普通に動くので
// 誰も気づかない（「使い方」に載っていない画面が静かに増える）。`SCREEN_TITLES` は
// `Record<ScreenId, string>` なので**画面の全部**を持っている＝それと突き合わせる。
import { describe, expect, it } from "vitest";
import { SCREEN_TITLES } from "../screenTitles";
import { HELP_FLOW, HELP_PLACES, HELP_TIMELINE, HELP_TIPS } from "./helpGuide";

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
