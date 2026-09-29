// 列の名前を変える（#1250）。
//
// ⚠️ **この関数には検査が1本も無かった**（#1255 レビューで判明）＝domain の純粋関数なのに、
// 「空にしたら自動の名前へ戻す」「前後の空白を落とす」「固定した列でも変えられる」を
// 誰も確かめていなかった。
import { describe, expect, it } from "vitest";
import { EDIT_BLOCKED, renameTrack, TRACK_NAME_MAX } from "./edit";
import { TRACK_KIND } from "../enums";
import type { TimelineProject, Track } from "./types";

const docWith = (tracks: Track[]): TimelineProject => ({ tracks, clips: [] }) as unknown as TimelineProject;
const trackOf = (r: ReturnType<typeof renameTrack>, id: string): Track | undefined =>
  r.ok ? r.doc.tracks.find((t) => t.id === id) : undefined;

describe("列の名前を変える", () => {
  it("名前を付ける", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual }]), "track_001", "字幕");
    expect(trackOf(r, "track_001")?.name).toBe("字幕");
  });

  it("前後の空白は落とす", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual }]), "track_001", "  字幕  ");
    expect(trackOf(r, "track_001")?.name).toBe("字幕");
  });

  // ⚠️ **空にしたら自動の名前へ戻す**＝空文字で残すと、見出しが空になってどの列か分からなくなる。
  it("空にしたら、名前そのものを外す（自動の名前へ戻る）", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual, name: "字幕" }]), "track_001", "");
    expect(trackOf(r, "track_001")).toBeDefined();
    expect(trackOf(r, "track_001")).not.toHaveProperty("name");
  });

  it("空白だけでも、名前を外す", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual, name: "字幕" }]), "track_001", "   ");
    expect(trackOf(r, "track_001")).not.toHaveProperty("name");
  });

  // ⚠️ **保存する値は切らない**（#1255 レビュー 🟡）＝長さの上限は正典（schema）に無い。
  // 抑えるのは入力欄（`maxLength`）の仕事で、domain で切ると「正典に無い制約」を保存データへ足すことになる。
  it("入力欄の上限より長い名前でも、保存する値は切らない", () => {
    const long = "あ".repeat(TRACK_NAME_MAX + 10);
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual }]), "track_001", long);
    expect(trackOf(r, "track_001")?.name).toBe(long);
  });

  // ⚠️ **固定した列でも名前は変えられる**＝固定が守るのは帯の位置と長さで、呼び名ではない。
  it("固定した列でも名前は変えられる", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual, locked: true }]), "track_001", "字幕");
    expect(trackOf(r, "track_001")?.name).toBe("字幕");
  });

  it("ほかの列は変えない", () => {
    const r = renameTrack(docWith([
      { id: "track_001", kind: TRACK_KIND.visual, name: "元のまま" },
      { id: "track_002", kind: TRACK_KIND.visual },
    ]), "track_002", "字幕");
    expect(trackOf(r, "track_001")?.name).toBe("元のまま");
  });

  it("無い列なら断る", () => {
    const r = renameTrack(docWith([{ id: "track_001", kind: TRACK_KIND.visual }]), "track_404", "字幕");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.notFound);
  });
});
