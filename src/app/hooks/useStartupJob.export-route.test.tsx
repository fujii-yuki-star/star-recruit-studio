// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as startupFs from "../../infrastructure/startupFs";
import * as projectFs from "../../infrastructure/projectFs";
import * as voiceFs from "../../infrastructure/voiceFs";
import * as engineWait from "../../domain/startup/engineWait";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useStartupJob } from "./useStartupJob";

/**
 * 起動のときに頼まれた書き出しの**行き先**（ADR-0042・#1184）。
 *
 * ⚠️ **実機で見つかった穴**（2026-09-17）＝場面形式の道しか無く、
 * `--export <タイムライン形式>` は **3秒で何もせず終了コード 0**（＝成功に見える）だった。
 * ⚠️ **ここが塞がっていると ADR-0041 の枠②が成立しない**＝外の AI にタイムラインを書かせると決めたのに、
 * 書いたものを書き出す口が無い。
 */
describe("頼まれた書き出しの行き先は、動画の形式で決まる（#1184）", () => {
  beforeEach(() => {
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null, requestKnown: "unknown" });
    vi.spyOn(startupFs, "onStartupRequestForwarded").mockResolvedValue(() => undefined);
    vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const askFor = (projectId: string): void => {
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "export", projectId, out: "C:/頼まれた.mp4", forwarded: false, argError: null,
    } as never);
  };

  it("タイムライン形式なら、タイムラインの画面で開いて保存先を渡す", async () => {
    askFor("proj_20260917_001");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260917_001", projectName: "長尺", updatedAt: "", format: "timeline" },
    ]);
    const open = vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockResolvedValue(undefined);
    const scene = vi.spyOn(useProjectStore.getState(), "loadProject").mockResolvedValue(undefined as never);
    const navigate = vi.fn();
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("timeline-project"));
    expect(open).toHaveBeenCalledWith("proj_20260917_001");
    expect(scene, "場面形式の道へ行っている").not.toHaveBeenCalled();
    expect(useStartupJobStore.getState().pendingExportOut).toBe("C:/頼まれた.mp4");
  });

  it("場面形式なら、いままでどおり書き出しの画面へ行く", async () => {
    askFor("proj_20260624_003");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260624_003", projectName: "会社紹介", updatedAt: "" },
    ]);
    const open = vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockResolvedValue(undefined);
    const scene = vi.spyOn(useProjectStore.getState(), "loadProject").mockResolvedValue(undefined as never);
    const navigate = vi.fn();
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("export"));
    expect(scene).toHaveBeenCalledWith("proj_20260624_003");
    expect(open, "タイムラインの道へ行っている").not.toHaveBeenCalled();
  });

  // ⚠️ **声が作られていなければ断る**（#1204）＝止めないと、そのぶんが**無音のまま焼き込まれて**
  // 「成功」で返る（実機で確認＝−91dB・終了コード 0）。
  it('声がまだ作られていなければ、書き出さずに断る', async () => {
    askFor('proj_20260917_001');
    vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
      { projectId: 'proj_20260917_001', projectName: '声つき', updatedAt: '', format: 'timeline' },
    ]);
    vi.spyOn(useTimelineStore.getState(), 'openTimelineProject').mockImplementation(async () => {
      useTimelineStore.setState({
        doc: { clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_002', startSec: 0, durationSec: 2,
          voice: { text: 'これは読み上げです。', status: 'none' } }] } as never,
      });
    });
    const navigate = vi.fn();
    const finish = vi.spyOn(startupFs, 'finishStartupJob').mockResolvedValue(undefined);
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(finish).toHaveBeenCalledWith(false, false));
    expect(navigate, '書き出しの画面へ進んでしまっている').not.toHaveBeenCalled();
    expect(useStartupJobStore.getState().pendingExportOut, '保存先が残っている').toBeNull();
    expect(useStartupJobStore.getState().notice).toContain('声を作って');
  });

  // ⚠️ **場面形式でも同じように断る**（形式で挙動を割らない＝ADR-0026②）。
  it('場面形式でも、声がまだなら断る', async () => {
    askFor('proj_20260624_003');
    vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
      { projectId: 'proj_20260624_003', projectName: '会社紹介', updatedAt: '' },
    ]);
    vi.spyOn(useProjectStore.getState(), 'loadProject').mockImplementation(async () => {
      useProjectStore.setState({
        scenes: [{ sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
          templateId: 't', durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
          texts: {}, narration: { text: 'あいさつ', status: 'none' }, warnings: [] }] as never,
      });
    });
    const navigate = vi.fn();
    const finish = vi.spyOn(startupFs, 'finishStartupJob').mockResolvedValue(undefined);
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(finish).toHaveBeenCalledWith(false, false));
    expect(navigate, '書き出しの画面へ進んでしまっている').not.toHaveBeenCalled();
  });

  it('声ができていれば、いままでどおり進む', async () => {
    askFor('proj_20260917_001');
    vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
      { projectId: 'proj_20260917_001', projectName: '声つき', updatedAt: '', format: 'timeline' },
    ]);
    vi.spyOn(useTimelineStore.getState(), 'openTimelineProject').mockImplementation(async () => {
      useTimelineStore.setState({
        doc: { clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_002', startSec: 0, durationSec: 2,
          voice: { text: 'これは読み上げです。', status: 'generated', voicePath: 'voices/a.wav' } }] } as never,
      });
    });
    const navigate = vi.fn();
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('timeline-project'));
  });

  // 声を作る口（#1204・ADR-0042 追補2）＝これが無いと、外の AI は「作る→声→書き出す」の**真ん中を通れない**。
  describe('声を作る（--make-voices）', () => {
    // ⚠️ **声を作る用意は「できている」ことにする**＝ここで見たいのは**通る道**であって、
    // エンジンの立ち上がりではない（待ち方そのものは `engineWait.test.ts` が見る）。
    beforeEach(() => {
      vi.spyOn(voiceFs, 'voicevoxReady').mockResolvedValue(true);
    });

    const askVoices = (projectId: string): void => {
      vi.spyOn(startupFs, 'startupRequest').mockResolvedValue({
        kind: 'makeVoices', projectId, out: null, forwarded: false, argError: null,
      } as never);
    };

    it('人が押したときと同じ「まとめて作る」を通し、できたら成功で返す', async () => {
      askVoices('proj_20260917_001');
      vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
        { projectId: 'proj_20260917_001', projectName: '声つき', updatedAt: '', format: 'timeline' },
      ]);
      vi.spyOn(useTimelineStore.getState(), 'openTimelineProject').mockImplementation(async () => {
        useTimelineStore.setState({ doc: { clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_002',
          startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } }] } as never });
      });
      const gen = vi.spyOn(useTimelineStore.getState(), 'generateAllVoices').mockImplementation(async () => {
        useTimelineStore.setState({ doc: { clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_002',
          startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'generated', voicePath: 'v.wav' } }] } as never });
      });
      const finish = vi.spyOn(startupFs, 'finishStartupJob').mockResolvedValue(undefined);
      renderHook(() => useStartupJob(vi.fn()));
      await waitFor(() => expect(finish).toHaveBeenCalledWith(true, false));
      expect(gen, 'まとめて作るを通っていない').toHaveBeenCalled();
      // ⚠️ **その回の仕事を走り切らせる**＝知らせが出るまで待たないと、**次のテストへ漏れる**
      //（実際に漏れて、次のテストの『作ろうとしていない』が false になった）。
      await waitFor(() => expect(useStartupJobStore.getState().notice).not.toBeNull());
    });

    // ⚠️ **残ったら「できた」と言わない**＝途中で失敗した回を成功に見せない。
    // ⚠️ **用意が整わなければ、作らずに断る**＝待ち続けると**頼んだ側が永久に待つ**。
    it('声を作る用意が整わなければ、作らずに断る', async () => {
      vi.spyOn(voiceFs, 'voicevoxReady').mockResolvedValue(false);
      // ⚠️ **待ち時間そのものは検査しない**（`engineWait.test.ts` が見る）＝
      // ここでは「あきらめたあとどうするか」だけを見たいので、1回目であきらめさせる。
      vi.spyOn(engineWait, 'engineWaitPlan').mockReturnValue({ waitMs: 0, giveUp: true });
      askVoices('proj_20260917_001');
      vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
        { projectId: 'proj_20260917_001', projectName: '声つき', updatedAt: '', format: 'timeline' },
      ]);
      vi.spyOn(useTimelineStore.getState(), 'openTimelineProject').mockResolvedValue(undefined);
      vi.spyOn(useTimelineStore.getState(), 'generateAllVoices').mockResolvedValue(undefined);
      const finish = vi.spyOn(startupFs, 'finishStartupJob').mockResolvedValue(undefined);
      renderHook(() => useStartupJob(vi.fn()));
      await waitFor(() => expect(finish).toHaveBeenCalledWith(false, false));
      expect(useStartupJobStore.getState().notice).toContain('用意が整いませんでした');
      // ⚠️ **「作ろうとしていない」は、ここでは確かめない**＝`useTimelineStore` は
      // **どのテストからも同じもの**なので、前のテストの後始末しきれない呼び出しが**ここへ届く**
      //（実際に届いて、この主張だけが落ちた）。**この回のものだと言い切れない主張は書かない**。
      // ⚠️ **断りが出たこと自体が「作っていない」の証拠**＝作っていれば別の知らせになる
      //（変異チェックで、用意の確認を外すと落ちることを確かめてある）。
    });

    it('作れなかったものが残っていれば、できなかったと返す', async () => {
      askVoices('proj_20260917_001');
      vi.spyOn(projectFs, 'listProjectSummaries').mockResolvedValue([
        { projectId: 'proj_20260917_001', projectName: '声つき', updatedAt: '', format: 'timeline' },
      ]);
      vi.spyOn(useTimelineStore.getState(), 'openTimelineProject').mockImplementation(async () => {
        useTimelineStore.setState({ doc: { clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_002',
          startSec: 0, durationSec: 2, voice: { text: 'あ', status: 'none' } }] } as never });
      });
      vi.spyOn(useTimelineStore.getState(), 'generateAllVoices').mockResolvedValue(undefined);
      const finish = vi.spyOn(startupFs, 'finishStartupJob').mockResolvedValue(undefined);
      renderHook(() => useStartupJob(vi.fn()));
      await waitFor(() => expect(finish).toHaveBeenCalledWith(false, false));
      expect(useStartupJobStore.getState().notice).toContain('1件');
    });
  });

  // ⚠️ **開けなかったら保存先も捨てる**＝残すと、次に人が押した書き出しが黙ってそこへ書く。
  it("開けなかったときは、頼まれた保存先を残さない", async () => {
    askFor("proj_20260917_001");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260917_001", projectName: "長尺", updatedAt: "", format: "timeline" },
    ]);
    vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockRejectedValue(new Error("読めない"));
    renderHook(() => useStartupJob(vi.fn()));
    await waitFor(() => expect(useStartupJobStore.getState().notice).not.toBeNull());
    expect(useStartupJobStore.getState().pendingExportOut).toBeNull();
  });
});
