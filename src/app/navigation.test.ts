import { describe, expect, it } from "vitest";
import type { ScreenId } from "./data/mockData";
import { DEFAULT_PROJECT_RETURN, isProjectScreen, PROJECT_SCREENS, stickyProjectScreen } from "./navigation";

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
