// @vitest-environment jsdom
// 動画の「その瞬間」を写真にする欄（#349）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaptureFrameControls } from "./CaptureFrameControls";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE } from "../../domain/enums";
import { readFileSync } from "node:fs";
import { CAPTURE_FRAME_LABEL, IMPORT_BUSY_MESSAGE } from "../uiLabels";
import * as assetFs from "../../infrastructure/assetFs";
import type { Asset } from "../../domain/project/types";

const video: Asset = {
  assetId: "asset_001",
  assetType: ASSET_TYPE.video,
  displayName: "会社紹介",
  filePath: "assets/asset_001.mp4",
};

const capture = vi.fn(async () => "asset_002");

/** 動画の本体の URL（`assetDisplayUrl` が返すもの）。 */
const BODY_URL = "asset://assets/asset_001.mp4";
/**
 * 代表フレームの URL。⚠️ **`assetSrcById` に入るのはこちら**（#1154）。
 *
 * 以前この検査は `assetSrcById` に**本体の URL**を置いていた＝**実物と違う形の作り物**なので、
 * 「PNG を `<video>` に入れている」という本物の不具合を**構造的に見つけられなかった**
 *（`test-fixtures-must-match-real-shape` の型）。
 */
const THUMB_URL = "asset://assets/asset_001.thumb.png";

beforeEach(() => {
  capture.mockClear();
  vi.spyOn(assetFs, "assetDisplayUrl").mockResolvedValue(BODY_URL);
  useProjectStore.setState({
    meta: { ...useProjectStore.getState().meta, projectId: "proj_20260916_001" },
    assetSrcById: { asset_001: THUMB_URL },
    isImporting: false,
    // ⚠️ **兄弟の後始末に頼らない**（#1168 レビュー ℹ️）＝ここで戻しておかないと、
    //   検査の順番が変わったとき前の回の状態を引きずる。
    missingAssetIds: [],
    captureVideoFrame: capture,
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  useProjectStore.setState({ assetSrcById: {}, isImporting: false } as never);
});

describe("CaptureFrameControls", () => {
  // ⚠️ **押す前に断る**（#1168 レビュー 🟡）＝`store` 側にも同じ判定があるが、あちらは**押したあと**
  // なので `06 §12` の言う「押す前」ではなかった（タイムライン形式の「絵を止める」は押せなくしている）。
  describe("ファイルが見つからない動画", () => {
    beforeEach(() => useProjectStore.setState({ missingAssetIds: ["asset_001"] } as never));
    afterEach(() => useProjectStore.setState({ missingAssetIds: [] } as never));

    it("ボタンを押せなくする（走らせてから断らない）", () => {
      render(<CaptureFrameControls asset={video} />);
      expect(screen.getByRole("button", { name: /この瞬間を写真にする/ })).toBeDisabled();
    });

    // ⚠️ **押す前の状態では知らせを増やさない**（#1168 レビュー 🟡）＝この画面は「状況はバナー、どれかは一覧の印、
    // 直し方はボタン」と役割を分けている。ここにも同じ説明を出すと `alert` が2つになる。
    it("押せない理由は `title` に出す（知らせを2つにしない）", () => {
      render(<CaptureFrameControls asset={video} />);
      const btn = screen.getByRole("button", { name: /この瞬間を写真にする/ });
      expect(btn.getAttribute("title")).toContain("ファイルを選び直す");
      expect(screen.queryByRole("alert"), "この欄でも同じことを言っている").toBeNull();
    });

    it("見つかっている動画は止めない（誤検出で操作を殺さない）", async () => {
      useProjectStore.setState({ missingAssetIds: ["asset_009"] } as never);
      render(<CaptureFrameControls asset={video} />);
      const btn = screen.getByRole("button", { name: /この瞬間を写真にする/ });
      await waitFor(() => expect(btn).toBeEnabled());
      expect(btn).not.toHaveAttribute("title");
    });
  });

  // ⚠️ **「寄せた」は数えて出す**（§7）＝「定数を使っている」だけだと、2か所のうち1か所を
  // 写しに戻しても緑になる（`RELINK_ASSET_LABEL` のときに実際に変異チェックで生き残った）。
  it("呼び名は1か所から取る（見出しとボタンで写さない）", () => {
    const src = readFileSync("src/app/components/CaptureFrameControls.tsx", "utf8");
    const body = src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(body.split("{CAPTURE_FRAME_LABEL}").length - 1, "見出しとボタンの2か所で呼んでいない").toBe(2);
    expect(body.split(CAPTURE_FRAME_LABEL).length - 1, "呼び名の写しが残っている").toBe(0);
  });

  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「フレーム」「抽出」を画面に出さない", () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    expect(container.textContent).not.toMatch(/フレーム|抽出|キャプチャ/);
  });

  // ⚠️ **足した枝は必ず検査する**（#1168 レビュー 🟡）＝`disabled` だけ見ていたので、
  // 理由（`title`）を `undefined` に潰しても緑だった。
  describe("取り込み中", () => {
    beforeEach(() => useProjectStore.setState({ isImporting: true } as never));
    // ⚠️ **後始末は `afterEach` に置く**＝検査の最後に書くと、途中で落ちた回に**次の検査へ漏れる**。
    afterEach(() => useProjectStore.setState({ isImporting: false, missingAssetIds: [] } as never));

    it("押せなくして、理由を添える", () => {
      render(<CaptureFrameControls asset={video} />);
      const btn = screen.getByRole("button", { name: /この瞬間を写真にする/ });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", IMPORT_BUSY_MESSAGE);
    });

    // ⚠️ **押していないのに進行中と名乗らない**（#1170）＝`isImporting` はアプリ全体で立つので、
    // 写真を落としただけでここが「切り出しています…」に変わり、`title` の「終わってから
    // もう一度お試しください」と**逆のことを同時に言って**いた（ADR-0026②）。
    // ⚠️ **両方成り立つときに出る文を留める**（#1168 レビュー 🟡）＝タイムライン形式の
    // `freezeExtra` は取り込み中が先なので、こちらも先にする（同じ状況で出る文が形式で割れない）。
    it("ファイルも見つからないときは、取り込み中のほうを言う（タイムライン形式と同じ順）", () => {
      useProjectStore.setState({ missingAssetIds: ["asset_001"] } as never);
      render(<CaptureFrameControls asset={video} />);
      expect(screen.getByRole("button", { name: /この瞬間を写真にする/ })).toHaveAttribute("title", IMPORT_BUSY_MESSAGE);
    });

    it("名前は変わらない（押していないのに進行中と名乗らない）", () => {
      render(<CaptureFrameControls asset={video} />);
      expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeInTheDocument();
      expect(screen.queryByText(/切り出しています/), "押していないのに進行中と名乗っている").toBeNull();
    });
  });

  // ⚠️ **本体を入れる**（#1154）＝`assetSrcById` は動画に**代表フレームの PNG** を入れる地図なので、
  //    そちらを `<video>` に入れると**再生できず `currentTime` が 0 のまま**＝
  //    「止めたところ」を選んでも常に先頭のコマが切り出される。
  it("動画を見ながら選べる（代表フレームではなく本体を再生できる形で出す）", async () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const v = container.querySelector("video");
    expect(v).toHaveAttribute("controls");
    // ⚠️ **取り直させる印（`?t=`）が付く**（#140）ので、前方一致で見る。
    expect(v?.getAttribute("src") ?? "", "本体を再生していない").toContain(BODY_URL);
    expect(v?.getAttribute("src"), "代表フレーム（静止画）を再生させようとしている").not.toBe(THUMB_URL);
  });

  // ⚠️ **選び直しても `filePath` は変わらない**（PR #1175 レビュー 🔴）＝`assetId` を保ったまま
  //    同じ名前へ上書きするので、`filePath` だけを見ていると**解き直しが走らない**。
  //    そのまま**古い動画を見ながら止めた時刻**で、**新しい動画から**切り出すことになる。
  it("ファイルを選び直したら、見ている動画も取り直す", async () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const before = container.querySelector("video")!.getAttribute("src");
    // 選び直し＝代表フレームの URL だけが新しくなる（`filePath` は同じまま）。
    await act(async () => {
      useProjectStore.setState({ assetSrcById: { asset_001: `${THUMB_URL}?t=999` } } as never);
    });
    await waitFor(() => expect(container.querySelector("video")!.getAttribute("src"), "古い動画を見せたまま").not.toBe(before));
  });

  // ⚠️ **解いている間は断らない**（PR #1175 レビュー ℹ️）＝開いた瞬間は必ず未解決なので、
  //    そのまま「再生できません」を出すと**毎回一瞬エラーが見える**（§2-5）。
  it("読み込んでいる間は「再生できません」と言わない", () => {
    render(<CaptureFrameControls asset={video} />);
    expect(screen.queryByText(/ここでは再生できません/), "解く前から断っている").toBeNull();
    expect(screen.getByText(/読み込んでいます/)).toBeInTheDocument();
  });

  // ⚠️ **素材そのものから引く**＝地図を増やさないので、差し替え・選び直しで古い URL が残らない。
  it("本体の URL は、その素材のファイルから解く", async () => {
    render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(assetFs.assetDisplayUrl).toHaveBeenCalledWith("proj_20260916_001", "assets/asset_001.mp4"));
  });

  /** ⚠️ **いま見えている時間を切る**＝見たものと違う絵が出てこない。 */
  it("押すと、いま止めている時間で切り出す", async () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const v = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(v, "currentTime", { value: 12.5, writable: true });
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith("asset_001", 12.5));
  });

  it("できたら知らせる（どこに増えたかまで書く）", async () => {
    render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    expect(await screen.findByText(/素材の一覧に増えています/)).toBeInTheDocument();
  });

  /** ⚠️ 失敗の文言は取り込みと同じ場所（`importError`）に出るので、ここでは成功だけ知らせる。 */
  it("できなかったときは「できた」と言わない", async () => {
    capture.mockResolvedValueOnce(null as never);
    render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(screen.queryByText(/素材の一覧に増えています/)).not.toBeInTheDocument();
  });

  /** ⚠️ 見られないときも行き止まりにしない（§2-5）。 */
  it("再生できないときは理由と次の行動を出し、押せなくする", async () => {
    vi.mocked(assetFs.assetDisplayUrl).mockResolvedValue(null);
    render(<CaptureFrameControls asset={video} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeDisabled());
    // ⚠️ **同じ操作は同じ名前で呼ぶ**（🟡25）＝素材画面の導線は「ファイルを選び直す」。
    expect(screen.getByText(/「ファイルを選び直す」から入れ直すと、表示できる場合があります/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeDisabled();
  });

  /** ⚠️ 書き出し中は**欄ごと出さない**（親の素材画面が持つ）＝ここに口を作らない（§9-2）。 */
});
