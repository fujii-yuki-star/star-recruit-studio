// @vitest-environment jsdom
// 使っていないファイルを片づける（ADR-0064）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/assetFs", () => ({
  listUnusedProjectFiles: vi.fn(),
  trashUnusedProjectFiles: vi.fn(),
}));
vi.mock("../store/liveDocumentTexts", () => ({
  liveDocumentTexts: vi.fn(() => ["{\"live\":true}"]),
  cleanupBusy: vi.fn(() => false),
}));

import { UnusedFilesPanel } from "./UnusedFilesPanel";
import { listUnusedProjectFiles, trashUnusedProjectFiles } from "../../infrastructure/assetFs";
import { cleanupBusy } from "../store/liveDocumentTexts";
import { unusedFilesLabel } from "../uiLabels";

const files = [
  { path: "assets/asset_004.png", size: 45_000 },
  { path: "voices/old.wav", size: 2_000_000 },
];

afterEach(() => vi.clearAllMocks());

describe("UnusedFilesPanel", () => {
  it("一覧を見せ、既定は全部選ぶ（種類と大きさを出す）", async () => {
    vi.mocked(listUnusedProjectFiles).mockResolvedValue(files);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    expect(await screen.findByText(/写真：asset_004\.png/)).toBeInTheDocument();
    expect(screen.getByText(/音：old\.wav/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/ごみ箱から戻せます/)).toBeInTheDocument(); // 戻せることを必ず言う
    // ⚠️ 画面の内容（保存前・履歴）も渡す＝まだ保存していないファイルを「使っていない」としない。
    expect(listUnusedProjectFiles).toHaveBeenCalledWith("proj_1", ["{\"live\":true}"]);
  });

  it("チェックを外したものは移さない（選んだものだけ・画面の内容も渡す）", async () => {
    vi.mocked(listUnusedProjectFiles).mockResolvedValue(files);
    vi.mocked(trashUnusedProjectFiles).mockResolvedValue(1);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /old\.wav/ }));
    fireEvent.click(screen.getByRole("button", { name: unusedFilesLabel.trash }));
    await waitFor(() => expect(trashUnusedProjectFiles).toHaveBeenCalledWith("proj_1", ["assets/asset_004.png"], ["{\"live\":true}"]));
    expect(await screen.findByText(/1個のファイルをごみ箱へ移しました/)).toBeInTheDocument();
  });

  it("全部外すと押せない", async () => {
    vi.mocked(listUnusedProjectFiles).mockResolvedValue([files[0]!]);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole("button", { name: unusedFilesLabel.trash })).toBeDisabled();
  });

  it("無ければそう言う", async () => {
    vi.mocked(listUnusedProjectFiles).mockResolvedValue([]);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    expect(await screen.findByText(unusedFilesLabel.empty)).toBeInTheDocument();
  });

  /** ⚠️ 取り込み・書き出し・声づくりの最中は調べない（書きかけのファイルはまだどの文書にも無い）。 */
  it("走っている間は調べず、いつやり直せばよいかを出す", async () => {
    vi.mocked(cleanupBusy).mockReturnValueOnce(true);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    expect(await screen.findByText(unusedFilesLabel.busy)).toBeInTheDocument();
    expect(listUnusedProjectFiles).not.toHaveBeenCalled();
  });

  it("押した時点で走っていたら移さない", async () => {
    vi.mocked(listUnusedProjectFiles).mockResolvedValue(files);
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    await screen.findByText(/写真：asset_004\.png/);
    vi.mocked(cleanupBusy).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: unusedFilesLabel.trash }));
    expect(await screen.findByText(unusedFilesLabel.busy)).toBeInTheDocument();
    expect(trashUnusedProjectFiles).not.toHaveBeenCalled();
  });

  it("調べられなかったときは、断りの文を出す（1つも移さない）", async () => {
    vi.mocked(listUnusedProjectFiles).mockRejectedValue("使っていないファイルを調べられませんでした。動画を一度開いて保存してから、もう一度お試しください。");
    render(<UnusedFilesPanel projectId="proj_1" onClose={() => {}} />);
    expect(await screen.findByText(/調べられませんでした/)).toBeInTheDocument();
    expect(trashUnusedProjectFiles).not.toHaveBeenCalled();
  });
});
