import { describe, expect, it } from "vitest";
import type { ScreenId } from "./data/mockData";
import { currentProjectLabel, DEFAULT_PROJECT_RETURN, isProjectScreen, PROJECT_SCREENS, stickyProjectScreen } from "./navigation";

describe("isProjectScreen（工程画面の線引き・#399/#547 P3-7）", () => {
  it("工程画面（ウィザード〜書き出し）は true", () => {
    for (const s of ["wizard", "confirm", "generating", "draft", "scene-edit", "preview", "timeline", "precheck", "export"] as ScreenId[]) {
      expect(isProjectScreen(s)).toBe(true);
    }
  });

  it("工程外（一覧・素材・見た目・設定・About）は false", () => {
    for (const s of ["home", "looks", "looks-edit", "materials", "settings", "about"] as ScreenId[]) {
      expect(isProjectScreen(s)).toBe(false);
    }
  });

  it("既定の戻り先は工程の入口＝たたき台で、それ自身も工程画面", () => {
    expect(DEFAULT_PROJECT_RETURN).toBe("draft");
    expect(isProjectScreen(DEFAULT_PROJECT_RETURN)).toBe(true);
    expect(PROJECT_SCREENS).toContain(DEFAULT_PROJECT_RETURN);
  });
});

describe("stickyProjectScreen（「今の動画」の戻り先の記憶・#547 P3-7）", () => {
  it("工程画面へ移ると、そこを新しい戻り先にする", () => {
    expect(stickyProjectScreen("draft", "export")).toBe("export");
    expect(stickyProjectScreen("export", "preview")).toBe("preview");
  });

  it("工程外へ出ても、直近の工程画面を保持する（居場所を失わない）", () => {
    expect(stickyProjectScreen("export", "materials")).toBe("export");
    expect(stickyProjectScreen("export", "settings")).toBe("export");
    expect(stickyProjectScreen("export", "home")).toBe("export");
  });

  it("工程外→工程外の連続でも保持し続ける（素材→設定→一覧でも書き出しのまま）", () => {
    let target: ScreenId = "export";
    for (const s of ["materials", "settings", "home", "about"] as ScreenId[]) {
      target = stickyProjectScreen(target, s);
    }
    expect(target).toBe("export");
  });

  it("工程画面にいる間はそこが戻り先＝押しても現在地のまま（no-op で先頭へ飛ばさない）", () => {
    expect(stickyProjectScreen("draft", "export")).toBe("export"); // 書き出しにいる→戻り先も書き出し
  });
});

// タイムライン形式の編集も工程画面（#987）。
// ⚠️ **入っていなかった**ので、タイムライン編集を開いている間サイドバーの「今の動画」が出ず、
// **戻る道が無かった**（場面形式も開いていると、別の動画の名前を出したまま押すと別の文書へ飛んだ）。
describe("タイムライン編集も工程画面（#987）", () => {
  it("工程画面として数える", () => {
    expect(isProjectScreen("timeline-project" as ScreenId)).toBe(true);
  });

  it("戻り先として覚える（工程外へ出ても位置を失わない）", () => {
    const kept = stickyProjectScreen(DEFAULT_PROJECT_RETURN, "timeline-project" as ScreenId);
    expect(kept).toBe("timeline-project");
    // 素材・設定などの工程外へ出ても、覚えたままにする。
    expect(stickyProjectScreen(kept, "materials" as ScreenId)).toBe("timeline-project");
  });

  it("場面形式の工程画面へ移ったら、そちらを覚える", () => {
    // ⚠️ **どちらか一方を固定しない**＝2つの形式は同時に開いたままが正規の状態なので、
    // 「いま（直近に）いる方」を指す。
    expect(stickyProjectScreen("timeline-project" as ScreenId, "scene-edit" as ScreenId)).toBe("scene-edit");
  });
});

// サイドバーの「今の動画」に出すもの（#987）。
describe("「今の動画」は、いま（直近に）いる方の動画を指す（#987）", () => {
  const base = { sceneOpen: true, sceneName: "場面のほう", timelineName: null as string | null };

  it("タイムライン編集にいる間は、そちらの名前を出す", () => {
    // ⚠️ **元の穴**＝場面形式からしか採っておらず、**別の動画の名前を出したまま
    // 押すと別の文書へ飛んだ**（2つの形式は同時に開いたままが正規の状態）。
    const r = currentProjectLabel({ ...base, returnTo: "timeline-project" as ScreenId, timelineName: "タイムラインのほう" });
    expect(r).toEqual({ show: true, name: "タイムラインのほう" });
  });

  it("タイムラインだけ開いていても、戻る道が出る", () => {
    const r = currentProjectLabel({
      returnTo: "timeline-project" as ScreenId,
      sceneOpen: false,
      sceneName: "",
      timelineName: "タイムラインのほう",
    });
    expect(r.show, "開いているのに「今の動画」が出ない＝戻る道が無い").toBe(true);
  });

  it("場面形式の工程画面にいる間は、そちらの名前を出す", () => {
    const r = currentProjectLabel({ ...base, returnTo: "scene-edit" as ScreenId, timelineName: "タイムラインのほう" });
    expect(r).toEqual({ show: true, name: "場面のほう" });
  });

  it("タイムラインを閉じていれば、戻り先が残っていても場面形式を指す", () => {
    // ⚠️ **文書の有無も見る**＝戻り先だけで決めると、閉じた後に**名前の無い動画**を指す。
    const r = currentProjectLabel({ ...base, returnTo: "timeline-project" as ScreenId, timelineName: null });
    expect(r).toEqual({ show: true, name: "場面のほう" });
  });

  it("どちらも開いていなければ出さない", () => {
    const r = currentProjectLabel({ returnTo: "draft" as ScreenId, sceneOpen: false, sceneName: "", timelineName: null });
    expect(r.show).toBe(false);
  });
});

// ⚠️ **配線が生きているか**（#987）＝純粋関数が正しくても、画面が呼んでいなければ効かない。
// #547 P3-7 の統合テストと同じ理由（両単体テストが緑のまま結線だけ崩れる、を防ぐ）。
describe("画面が、決め方を通っている（#987）", () => {
  it("App がタイムライン側の名前を渡している", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(src, "決め方を通っていない＝画面の中で書き直している").toContain("currentProjectLabel(");
    expect(src, "タイムライン側の名前を渡していない").toMatch(/timelineName/);
  });
});
