// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import * as dialog from "../../infrastructure/dialog";
import * as startupFs from "../../infrastructure/startupFs";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// 起動のときに頼まれた書き出し（ADR-0042 決定⑤・#1184）。
// ⚠️ **ここが落ちなければ、「AI だけで書き出せる」は嘘になる**＝保存先を聞く所を置き換えたつもりで
// 置き換わっていない／人が押さないと始まらない、を構造で捕まえる。
const scene = (id: string, order: number): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
  templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "", status: "none" }, warnings: [],
});

describe("起動のときに頼まれた書き出し（#1184）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      isImporting: false,
      status: "ready",
      saveStatus: "saved",
    });
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null });
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null });
  });

  // ⚠️ **人が押さなくても始まる**＝ここが無いと「保存先は渡したのに誰も押さないので終わらない」。
  it("保存先を渡されていたら、押されなくても始まり、保存先を聞かない", async () => {
    const saveDialog = vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/人が選んだ.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useStartupJobStore.getState().setPendingExport("C:/頼まれた.mp4", false);
    render(<ExportScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(begin).toHaveBeenCalled());
    expect(saveDialog, "頼まれているのに保存先を聞いている").not.toHaveBeenCalled();
  });

  // ⚠️ **1回きり**＝取り出したら消える。残すと、次に人が押した書き出しまで同じ所へ書く。
  it("頼まれた保存先は、取り出したら消える", async () => {
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useStartupJobStore.getState().setPendingExport("C:/頼まれた.mp4", false);
    render(<ExportScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(begin).toHaveBeenCalled());
    expect(useStartupJobStore.getState().pendingExportOut, "次の書き出しまで同じ所へ書く").toBeNull();
  });

  // ⚠️ **失敗しても返す**＝返さないと、頼んだ側（AI）は**終わらない仕事を待ち続ける**。
  it("できなかったときも、終わったことを返す", async () => {
    const finish = vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
    vi.spyOn(ffmpeg, "beginExport").mockRejectedValue(new Error("だめ"));
    useStartupJobStore.getState().setPendingExport("C:/頼まれた.mp4", false);
    render(<ExportScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect(finish.mock.calls[0]?.[0], "できなかったのに「できた」で返している").toBe(false);
    // ⚠️ **返すのはちょうど1回**＝2回返すと、頼んだ側は**同じ仕事の結果を二重に受け取る**
    // （`--quit-when-done` の回は、閉じた後にもう一度閉じようとする）。
    expect(finish, "同じ仕事の結果を2回返している").toHaveBeenCalledTimes(1);
  });

  // ⚠️ **手前で断られた回も返す**（PR レビュー 🔴）＝返さないと、頼んだ側は終わらない仕事を待ち続ける。
  // ⚠️ **さらに、保存先を残さない**＝残すと**次に人が押した書き出し**が、聞かれずにそこへ書く。
  it("場面が無くて断られたら、返したうえで保存先も残さない", async () => {
    const finish = vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    useProjectStore.setState({ scenes: [], parts: [] });
    useStartupJobStore.getState().setPendingExport("C:/頼まれた.mp4", false);
    render(<ExportScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect(finish.mock.calls[0]?.[0]).toBe(false);
    expect(finish, "同じ仕事の結果を2回返している").toHaveBeenCalledTimes(1);
    expect(begin, "断ったのに始めている").not.toHaveBeenCalled();
    expect(
      useStartupJobStore.getState().pendingExportOut,
      "断った回の保存先が残っている＝次に人が押した書き出しがそこへ書く",
    ).toBeNull();
  });

  // ⚠️ **人が押した回は、今までどおり保存先を聞く**（置き換えたのは頼まれた回だけ）。
  it("頼まれていなければ、これまでどおり保存先を聞く", async () => {
    const saveDialog = vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue(null);
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    render(<ExportScreen onNavigate={vi.fn()} />);
    // 何も頼まれていないので、勝手に始まらない。
    await new Promise((r) => setTimeout(r, 20));
    expect(begin, "頼まれていないのに始まっている").not.toHaveBeenCalled();
    expect(saveDialog).not.toHaveBeenCalled();
    screen.getByText("動画を保存");
  });
});
