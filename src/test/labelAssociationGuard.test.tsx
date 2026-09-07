// @vitest-environment jsdom
// 見出し（`<label>`）が、実際に欄と結ばれているかを**描いてから**確かめる門番（#1075）。
//
// ⚠️ **同じ穴を3回踏んだ**＝#989（名前の欄）・#1031（見た目の向き・種類）・#1073（場面のBGM）。
// いずれも**見た目には見出しが出ている**ので、目で見ている限り気づけない。
//
// ⚠️ **静的な走査ではなく、実際の DOM を見る**（正規表現だと `{expr}` の中や入れ子で誤検出する）。
// 結ばれている形は2つある：
//   ① `htmlFor` が実在する id を指している
//   ② `<label>` が**ラベル可能な部品**を内側に持っている（`input`/`select`/`textarea` など）
// ⚠️ **`<button>` は「ラベル可能」ではない**＝`<label>` で包んでも結ばれない（HTML の仕様）。
//   これが `FontPicker`（見た目は選択欄だが中身はボタン）で実際に起きていた穴。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../app/store/projectStore";
import { sampleTemplates } from "../infrastructure/sampleData";
import type { Scene } from "../domain/project/types";
import { SceneEditScreen } from "../app/screens/SceneEditScreen";
import { SettingsScreen } from "../app/screens/SettingsScreen";
import { MaterialsScreen } from "../app/screens/MaterialsScreen";
import { LooksScreen } from "../app/screens/LooksScreen";

/** `<label>` が包めば結ばれる部品（HTML の "labelable elements"）。**`button` は入らない**。 */
const LABELABLE = "input, select, textarea, meter, output, progress";

/** 結ばれていない `<label>` の文言（空の見出しは対象外＝何も指していない飾り）。 */
function unassociatedLabels(root: HTMLElement | Document): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll("label"))) {
    const text = (el.textContent ?? "").trim();
    if (text === "") continue; // 文言の無い見出しは読み上げに出ない
    const forId = el.getAttribute("for");
    if (forId) {
      // ⚠️ **指し先が実在するかまで見る**＝綴りを間違えた `htmlFor` は「結んだつもり」で結ばれていない。
      if (document.getElementById(forId) != null) continue;
      out.push(`${text}（結び先 "${forId}" が無い）`);
      continue;
    }
    if (el.querySelector(LABELABLE) != null) continue; // 包んでいる
    out.push(text);
  }
  return out;
}

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: { title: "見出し" },
    narration: { text: "", status: "none" }, warnings: [], ...over,
  }) as unknown as Scene;

/**
 * まだ結ばれていない見出し（画面ごと・#1075）。**減らすための控え**であって、許可リストではない。
 *
 * ⚠️ **「増えたら」ではなく「ずれたら」落とす**（`jsdocAttachGuard` と同じ流儀）＝
 * 増える側だけ見ると、直しても控えが下がらないまま緑で、**次に増えたぶんを直した枠が吸収する**。
 * 直したらこの行も一緒に減らす＝その差分が「何件直したか」の記録になる。
 *
 * ⚠️ 中身の内訳（#1075 で追う）：
 * - `ColorPicker`（色・縁取りの色・背景色・背景）≡中身がボタンなので包んでも結ばれない。
 *   呼び名（`ariaLabel`）の既定は「色を選ぶ」なので、**どの色かが読み上げで分からない**。
 * - `Switch`（影を付ける・背景帯を付ける）≡部品側が `aria-label` を持つので読み上げは通るが、
 *   隣の `<label>` は**何も指していない**（`<span>` でよい）。
 * - 結び先が実在しない（`transition` / `brandLogo`）≡**結んだつもりで結ばれていない**。
 */
const BASELINE: Record<string, string[]> = {
  "場面編集": [
    "色",
    "縁取りの色",
    "影を付ける",
    "背景帯を付ける",
    "色",
    "縁取りの色",
    "影を付ける",
    "背景帯を付ける",
    "背景色",
    "背景",
    "ロゴ",
    "話す速さ",
    "声の高さ",
    "抑揚",
    "画面の切り替え（結び先 \"transition\" が無い）",
  ],
  "設定": ["いつものロゴ（結び先 \"brandLogo\" が無い）"],
  "素材を管理": [],
  "見た目パターンを管理": [],
};

describe("見出しは欄と結ばれている（#1075）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], status: "ready", saveStatus: "saved",
      editingSceneId: "scene_001",
    });
  });

  it("場面編集", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(unassociatedLabels(document), "結ばれていない見出しが増えた（直したなら控えも減らす）").toEqual(BASELINE["場面編集"]);
  });

  it("設定", () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    expect(unassociatedLabels(document), "結ばれていない見出しが増えた（直したなら控えも減らす）").toEqual(BASELINE["設定"]);
  });

  it("素材を管理", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(unassociatedLabels(document), "結ばれていない見出しが増えた（直したなら控えも減らす）").toEqual(BASELINE["素材を管理"]);
  });

  it("見た目パターンを管理", () => {
    render(<LooksScreen onNavigate={vi.fn()} />);
    expect(unassociatedLabels(document), "結ばれていない見出しが増えた（直したなら控えも減らす）").toEqual(BASELINE["見た目パターンを管理"]);
  });

  // ⚠️ **物差しが効いていることを確かめる**＝上が全部 `[]` なので、判定を壊しても緑になりうる。
  it("結ばれていない見出しを、実際に見つけられる（門番の自己検査）", () => {
    const { container } = render(
      <div>
        <label>結ばれていない見出し</label>
        <label htmlFor="nowhere">綴りを間違えた見出し</label>
        <label htmlFor="ok">結ばれた見出し</label>
        <input id="ok" />
        <label>包んでいる見出し<input /></label>
        {/* ⚠️ ボタンは包んでも結ばれない（`FontPicker` で実際に起きた穴）。 */}
        <label>ボタンを包んだ見出し<button type="button">押す</button></label>
        <label> </label>
      </div>,
    );
    expect(unassociatedLabels(container)).toEqual([
      "結ばれていない見出し",
      '綴りを間違えた見出し（結び先 "nowhere" が無い）',
      "ボタンを包んだ見出し押す",
    ]);
  });
});
