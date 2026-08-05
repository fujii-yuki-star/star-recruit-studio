// @vitest-environment jsdom
// 欄の中の節（アコーディオン）。**画面ごとに開閉を覚える**ことと、既定を将来変えられることを固定する（#687）。
// 開閉は `details.open` で見る（jsdom は閉じた `<details>` の中身も DOM に残す）。`toggle` は**非同期**に
// 発火する（HTML 仕様）＝保存もその後なので、画面を消す前に待つ（場面編集の既存テストと同じ流儀）。
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CollapsibleSection } from "./CollapsibleSection";
import { SECTION_SCOPE } from "./sectionOpen";

const section = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest("details") as HTMLDetailsElement;

beforeEach(() => localStorage.clear());

describe("CollapsibleSection（#687）", () => {
  it("畳んだ状態で出せる（縦に長くしない）", () => {
    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    expect(section("動き").open).toBe(false);
  });

  it("開閉を覚える（画面を往復しても開き直さなくてよい）", async () => {
    const view = render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("動き"));
    await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
    view.unmount();

    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="動き" defaultOpen={false}>
        <p>ずれ</p>
      </CollapsibleSection>,
    );
    expect(section("動き").open).toBe(true);
  });

  it("記憶は画面ごとに分かれる（同じ見出しでも混ざらない）", async () => {
    const view = render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="文字" defaultOpen={false}>
        <p>中身</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("文字")); // タイムライン側だけ開く
    await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
    view.unmount();

    render(
      <CollapsibleSection scope={SECTION_SCOPE.sceneEdit} title="文字" defaultOpen={false}>
        <p>中身</p>
      </CollapsibleSection>,
    );
    expect(section("文字").open).toBe(false); // 別画面の記憶を引かない
    expect(localStorage.getItem("sceneEdit.sectionOpen")).toBeNull();
  });

  it("触っていない節は覚えない（あとで既定を良くしたときに届く）", async () => {
    render(
      <CollapsibleSection scope={SECTION_SCOPE.timeline} title="音" defaultOpen>
        <p>音量</p>
      </CollapsibleSection>,
    );
    // `<details open>` は描画しただけで（非同期に）toggle を発火する。それを素通しで保存していないこと。
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("timeline.sectionOpen")).toBeNull();
  });
});
