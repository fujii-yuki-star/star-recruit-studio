// @vitest-environment jsdom
//
// 写真・動画をまだ読んでいる間に「動画案を作る」へ進むとき（UI/UX 監査 2026-10-02）。
// 以前は裏で読んでいることがどこにも見えず、読み終わる前に作ると、説明の無いまま作られて案の質が黙って落ちていた。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Asset } from "../../domain/project/types";
import { useProjectStore } from "../store/projectStore";
import { DESCRIBING_LABEL, MAKE_WITHOUT_WAIT_LABEL, WAIT_DESCRIBE_LABEL } from "../uiLabels";
import { WizardScreen } from "./WizardScreen";

const photo = (id: string): Asset =>
  ({ assetId: id, assetType: "image", displayName: `${id}.jpg`, filePath: `assets/${id}.jpg` }) as Asset;

beforeEach(() => {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({ assets: [photo("a1"), photo("a2"), photo("a3")], describingAssetIds: [], wizardStep: 4 });
});
afterEach(() => cleanup());

describe("動画案を作る前の、読み取りの残り", () => {
  it("読み終わっていれば、これまでどおり1つのボタン", () => {
    render(<WizardScreen onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("wizard-describing")).toBeNull();
    expect(screen.getByRole("button", { name: /AIに動画案を作ってもらう/ })).toBeInTheDocument();
  });

  it("残っていれば件数を出し、待つか待たないかを選ばせる（この動画の素材だけ数える）", () => {
    useProjectStore.setState({ describingAssetIds: ["a1", "a3", "other_project_asset"] });
    render(<WizardScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId("wizard-describing")).toHaveTextContent("あと 2 件");
    expect(screen.getByRole("button", { name: WAIT_DESCRIBE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: MAKE_WITHOUT_WAIT_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AIに動画案を作ってもらう/ })).toBeNull();
  });

  it("「待たずに作る」ですぐ進む", () => {
    useProjectStore.setState({ describingAssetIds: ["a1"] });
    const onNavigate = vi.fn();
    render(<WizardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: MAKE_WITHOUT_WAIT_LABEL }));
    expect(onNavigate).toHaveBeenCalledWith("confirm");
  });

  it("「読み終わってから作る」は、読み終わった時点で自動で進む（それまでは進まない）", () => {
    useProjectStore.setState({ describingAssetIds: ["a1", "a2"] });
    const onNavigate = vi.fn();
    render(<WizardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: WAIT_DESCRIBE_LABEL }));
    expect(screen.getByTestId("wizard-describing")).toHaveTextContent("読み終わったら、そのまま進みます（あと 2 件）");
    expect(screen.queryByRole("button", { name: WAIT_DESCRIBE_LABEL })).toBeNull();
    act(() => useProjectStore.setState({ describingAssetIds: ["a2"] }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("wizard-describing")).toHaveTextContent("あと 1 件");
    act(() => useProjectStore.setState({ describingAssetIds: [] }));
    expect(onNavigate).toHaveBeenCalledWith("confirm");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("待っている間に前の段へ戻ったら待つのをやめる（読み終わっても勝手に進まない）", () => {
    useProjectStore.setState({ describingAssetIds: ["a1"] });
    const onNavigate = vi.fn();
    render(<WizardScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: WAIT_DESCRIBE_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /戻る/ }));
    act(() => useProjectStore.setState({ describingAssetIds: [] }));
    expect(onNavigate).not.toHaveBeenCalled();
    // ⚠️ **最後の段へ戻ってきても進まない**＝待つのをやめていなければ、ここで勝手に進んでしまう。
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("button", { name: /AIに動画案を作ってもらう/ })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("素材の段の「読み取り中…」", () => {
  it("読んでいる素材の名前の横にだけ出す", () => {
    useProjectStore.setState({ describingAssetIds: ["a2"], wizardStep: 2 });
    render(<WizardScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByText(DESCRIBING_LABEL)).toHaveLength(1);
    expect(screen.getByText(DESCRIBING_LABEL).parentElement).toHaveTextContent("a2.jpg");
  });
});
