// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。開けないときの案内と、並び・選択の見せ方を固定する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { VOLUME_POINTS_MAX } from "../../domain/constants";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260728_001",
    projectName: "焼いた動画",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },
    ],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "よろしく", status: "none" } },
    ],
    ...over,
  };
}

const open = (over: Partial<TimelineProject> = {}) =>
  useTimelineStore.setState({ doc: doc(over), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  useProjectStore.setState({ templates: [] });
});

describe("TimelineProjectScreen", () => {
  it("開いていないときは理由と、一覧へ戻る導線を出す（§2-5）", () => {
    useTimelineStore.setState({ loadError: "この動画を開けませんでした。一覧から選び直してください。" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("一覧から選び直してください");
    expect(screen.getByText("動画の一覧へ")).toBeInTheDocument();
  });

  it("開いている動画の名前と、置いてあるものを見せる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("焼いた動画")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "こんにちは" })).toBeInTheDocument(); // 文字クリップは中身を見せる
    expect(screen.getByRole("button", { name: "よろしく" })).toBeInTheDocument(); // 読み上げは読み上げ文
  });

  it("列は手前が上（配列の後ろほど手前）＝重なりの見え方と一致させる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const names = screen.getAllByText(/^(映像|音)\d$/).map((el) => el.textContent);
    // 連番は**種別ごと**（並び全体の通し番号にすると「音1」が存在しない動画ができる）。
    expect(names).toEqual(["音1", "映像1"]);
  });

  it("クリップを選べる（Shift で追加選択）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
  });

  it("再生位置を動かすと、その時刻が表示に反映される", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2.5" } });
    expect(useTimelineStore.getState().playheadSec).toBe(2.5);
    expect(screen.getByText(/2\.5 秒 \/ 全体 5\.0 秒/)).toBeInTheDocument();
  });

  it("何も置いていない動画でも壊れず、その旨を出す", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("まだ何も置かれていません。")).toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: レビュー指摘の修正（/canon-check）", () => {
  it("見た目パターンが見つからない部品があることを知らせる（黙って絵だけ消さない）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("見た目パターンが見つからない部品が1個あります"))).toBe(true);
    // 描かれないものが混ざったまま書き出させない（ADR-0026④）。
    expect(screen.getByRole("button", { name: "動画を書き出す" })).toBeDisabled();
  });

  it("置き場所の取り違え（11 §8）も知らせる＝描画から外れるものを黙らせない", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_999", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("どの列に置くか決まっていない"))).toBe(true);
  });

  it("見た目パターンが持つ既定素材も表示できる（場面形式と同じ絵になる・ADR-0021）", () => {
    const withTemplateAsset: Template = {
      schemaVersion: "1.0", templateId: "tmpl_with_asset", name: "既定素材つき", category: "photo_intro",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, assetId: "tmpl_asset_001" }],
    };
    useProjectStore.setState({ templates: [withTemplateAsset], templateAssetSrcById: { tmpl_asset_001: "asset://tmpl.png" } });
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_with_asset" }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(document.querySelector(".preview-stage")?.innerHTML ?? "").toContain("asset://tmpl.png");
  });

  it("再生位置を末尾へ送っても絵が消えない（半開区間の端を1フレーム手前へ寄せる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "5" } });
    // 末尾ちょうどでも、その瞬間のクリップが描かれている（下地だけの空フレームにならない）。
    // 文言そのものは枠幅で折返し/省略されるので、文字が1つでも描かれていることを見る。
    expect(document.querySelector(".preview-stage svg text")).not.toBeNull();
  });
});

describe("TimelineProjectScreen: 編集操作（#629 後半）", () => {
  const twoClips = () =>
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "まえ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });

  it("選ぶまでは、何をすればよいか案内する", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/下の並びから部品を選ぶと/)).toBeInTheDocument();
  });

  it("選んだ部品を動かせて、取り消せる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.click(screen.getByText("後ろへ"));
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0.5);
    fireEvent.click(screen.getByText("取り消す"));
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
  });

  it("置けないときは「次にどうすれば置けるか」を出す（§2-5）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("再生位置へ")); // clip_002（6秒〜）と重なる
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toBe(true);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 文書は変わらない
  });

  it("列を消すときは、一緒に消える部品の数を伝える（黙って消さない）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle("この列を消す")[1]); // 映像1（クリップ2個）
    expect(screen.getByRole("alert").textContent).toContain("2個の部品も一緒に消えます");
    fireEvent.click(screen.getByText("削除する"));
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_002"]);
  });

  it("複数選んだときは、まとめて消せるが位置は変えられない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "まえ" }));
    fireEvent.click(screen.getByRole("button", { name: "あと" }), { shiftKey: true });
    expect(screen.queryByText("後ろへ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("選んだ2個を消す"));
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
  });

  it("列を足せる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("音の列を足す"));
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.kind)).toEqual(["visual", "visual", "audio"]);
  });
});

describe("TimelineProjectScreen: 再生（#630）", () => {
  it("再生と停止を切り替えられる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    fireEvent.click(screen.getByText("停止"));
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("何も置いていない動画では再生を押せない", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("再生")).toBeDisabled();
  });

  it("先頭へ戻せる（先頭にいるときは押せない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("先頭へ")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("先頭へ"));
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("編集すると再生が止まる（動いている的を狙わせない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    fireEvent.click(screen.getByText("音の列を足す"));
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    expect(screen.getByText("再生")).toBeInTheDocument(); // ラベルも戻る
  });
});

describe("TimelineProjectScreen: 再生まわりのレビュー指摘（/canon-check）", () => {
  it("再生中に位置を動かしても戻らない（時計を測り直す）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("再生"));
    const before = useTimelineStore.getState().seekNonce;
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    // 世代番号が**このシークで**上がる＝時計が測り直す（上がらないと次のフレームで元の位置へ戻る）。
    expect(useTimelineStore.getState().playheadSec).toBe(3);
    expect(useTimelineStore.getState().seekNonce).toBe(before + 1);
  });

  it("再生中は「再生位置を使う操作」を押せない（走っている位置を掴ませない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.getByText("再生位置へ")).not.toBeDisabled();
    fireEvent.click(screen.getByText("再生"));
    expect(screen.getByText("再生位置へ")).toBeDisabled();
    expect(screen.getByText("再生位置へ").getAttribute("title")).toBe("再生を止めてから使えます");
  });

  it("何も置いていないときは、再生を押せない理由を出す（無言にしない）", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("再生").getAttribute("title")).toContain("まだ部品を置いていない");
  });
});

describe("TimelineProjectScreen: 音（#630 後半）", () => {
  it("音が見つからない部品があることを知らせる（黙って無音にしない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("音が見つからない部品が1個"))).toBe(true);
  });

  it("音源が用意できている部品では知らせない", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_101", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "generated", voicePath: "voices/a.wav" } },
      ],
    });
    useTimelineStore.setState({ audioSrcByKey: { "voice:voices/a.wav": "data:audio/wav;base64,QQ==" } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/音が見つからない部品/)).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 書き出し（#631）", () => {
  it("書き出しの導線を出し、押すと書き出しが走る", () => {
    open();
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    const exportTimelineVideo = vi.fn().mockResolvedValue(undefined);
    useTimelineStore.setState({ exportTimelineVideo });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    expect(exportTimelineVideo).toHaveBeenCalledWith({ templates: [], templateAssetSrcById: {} });
  });

  it("書き出せない理由があるときは、押す前に理由を見せて押せなくする（§2-5）", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "動画を書き出す" });
    expect(btn).toBeDisabled();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("まだ何も置かれていない"))).toBe(true);
  });

  it("書き出し中は進み具合と中止を出す（書き出すボタンは出さない）", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を書き出しています（42%）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "書き出しを中止" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "動画を書き出す" })).not.toBeInTheDocument();
  });

  it("保存先を選んでいる間は進み具合を出さない（まだ何も描いていない）", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "preparing", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/動画を書き出しています/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "動画を書き出す" })).not.toBeInTheDocument();
  });

  it("終わったら結果を出し、閉じられる", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "done", percent: 100, message: "動画を保存しました。", cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を保存しました/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(useTimelineStore.getState().exportRun.phase).toBe("idle");
  });

  it("クレジットをプレビューにも出す（書き出しでは焼き込まれる＝見えていたものと同じ）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".preview-stage")?.innerHTML).toContain("VOICEVOX:");
  });
});

describe("TimelineProjectScreen: 見た目パターンの中身（#632）", () => {
  const template: Template = {
    schemaVersion: "1.0",
    templateId: "tmpl_001",
    name: "シンプル",
    category: "opening",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "mainVisual", type: "slot", x: 100, y: 100, w: 800, h: 600 },
      { id: "titleText", type: "text", textKey: "title", x: 100, y: 800, w: 800, h: 100 },
    ],
  };

  const openWithTemplateClip = () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "assets/a.png" },
        { assetId: "asset_002", assetType: "video", displayName: "動画B", filePath: "assets/b.mp4" },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("差し込み口と文字の欄を出す（置いたあとも中身を差し替えられる）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("背景")).toBeInTheDocument();
    expect(screen.getByText("メイン素材")).toBeInTheDocument();
    expect(screen.getByText("見出し")).toBeInTheDocument();
  });

  it("差し込み口に素材を入れられる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "asset_001" } });
    expect(useTimelineStore.getState().doc?.clips[0].assetRefs).toEqual({ mainVisual: "asset_001" });
  });

  it("動画は選べない（動かず音も鳴らないので、選べるのに使えない選択肢を出さない）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("写真A");
    expect(select?.textContent).not.toContain("動画B");
  });

  it("文字を書き換えられる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByText("見出し").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "会社紹介" } });
    expect(useTimelineStore.getState().doc?.clips[0].texts).toEqual({ title: "会社紹介" });
  });

  it("見た目パターンが見つからない部品では、中身の欄でなく次の行動を出す", () => {
    useProjectStore.setState({ templates: [], templateAssetSrcById: {} });
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_missing" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("この部品を置き直してください"))).toBe(true);
  });

  it("固定した列の部品は中身も変えられない（押せない理由を出す）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "assets/a.png" }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 1920, h: 1080, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select).toBeDisabled();
    expect(select?.getAttribute("title")).toContain("固定を外してください");
  });

  it("入っている動画は名前を出す（「なし」と見分けが付く）", () => {
    openWithTemplateClip();
    useTimelineStore.setState({
      doc: { ...useTimelineStore.getState().doc!, clips: [{ ...useTimelineStore.getState().doc!.clips[0], assetRefs: { mainVisual: "asset_002" } }] },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("メイン素材").parentElement?.querySelector("select");
    expect(select?.textContent).toContain("動画B");
    expect(select?.querySelector('option[value="asset_002"]')).toBeDisabled();
  });

  it("素材が入っていない差し込み口を知らせる（灰色の枠が動画に出る）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("素材が入っていない差し込み口が2個"))).toBe(true);
  });

  it("向きが違う見た目パターンは一覧に出さない（押せるのに置けないものを並べない）", () => {
    const portrait: Template = { ...template, templateId: "tmpl_p", name: "たて型", aspectRatio: "9:16" };
    useProjectStore.setState({ templates: [template, portrait], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "シンプル" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "たて型" })).not.toBeInTheDocument();
  });

  it("動画しか入れられない差し込み口には、どうすればよいかを出す（永久に埋まらない枠を黙らせない）", () => {
    const videoOnly: Template = {
      ...template,
      layers: [{ id: "mainVisual", type: "slot", slotType: "video", x: 0, y: 0, w: 100, h: 100 }],
    };
    useProjectStore.setState({ templates: [videoOnly], templateAssetSrcById: {} });
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_001" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/この形式ではまだ動画を使えません/)).toBeInTheDocument();
  });

  it("バラす前に断る（戻せないことを知らせる）", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    expect(screen.getByText(/写真や文字を入れる場所は無くなります/)).toBeInTheDocument();
    // 確認しただけでは何も起きない。
    expect(useTimelineStore.getState().doc?.clips).toHaveLength(1);
  });

  it("バラすと中身ぶんの部品になり、まとめて選ばれる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    const s = useTimelineStore.getState();
    expect(s.doc?.clips.length).toBeGreaterThan(1);
    expect(s.doc?.clips.some((c) => c.kind === TIMELINE_CLIP_KIND.template)).toBe(false);
    expect(s.selectedClipIds).toEqual(s.doc?.clips.map((c) => c.id));
  });

  it("バラしたあとは取り消しで戻せる", () => {
    openWithTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc?.clips).toHaveLength(1);
    expect(useTimelineStore.getState().doc?.clips[0].kind).toBe(TIMELINE_CLIP_KIND.template);
  });

  it("見た目パターンを再生位置から置ける", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({ clips: [] });
    useTimelineStore.setState({ playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip).toMatchObject({ kind: TIMELINE_CLIP_KIND.template, templateId: "tmpl_001", startSec: 2 });
  });

  it("置いた部品はそのまま選ばれる（続けて中身を入れられる）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual([useTimelineStore.getState().doc?.clips[0].id]);
  });

  it("置けないときは理由を出す（黙って別の場所に置かない）", () => {
    useProjectStore.setState({ templates: [template], templateAssetSrcById: {} });
    open();
    useTimelineStore.setState({ playheadSec: 1 }); // 既にある部品と重なる位置
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("先に置いてある部品があります"))).toBe(true);
  });
});

describe("TimelineProjectScreen: 字幕と読み上げの連動（#633）", () => {
  const withVoiceAndSubtitle = () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_sub", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 1, x: 0, y: 900, w: 1920, h: 120 },
        { id: "clip_voice", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 2, durationSec: 3, voice: { text: "よろしく", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_sub"] });
  };

  it("連動先を選べる（選ぶと時間も合う）", () => {
    withVoiceAndSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("連動先").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "clip_voice" } });
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.id === "clip_sub");
    expect(sub).toMatchObject({ voiceClipId: "clip_voice", startSec: 2, durationSec: 3 });
  });

  it("連動をやめられる（部品はその場に残る）", () => {
    withVoiceAndSubtitle();
    useTimelineStore.setState({
      doc: {
        ...useTimelineStore.getState().doc!,
        clips: useTimelineStore.getState().doc!.clips.map((c) =>
          c.id === "clip_sub" ? { ...c, voiceClipId: "clip_voice", startSec: 2, durationSec: 3 } : c,
        ),
      },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("連動先").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "" } });
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.id === "clip_sub");
    expect(sub?.voiceClipId).toBeUndefined();
    expect(sub).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it("いま出る文を見せる（連動先の読み上げ文）", () => {
    withVoiceAndSubtitle();
    useTimelineStore.setState({
      doc: {
        ...useTimelineStore.getState().doc!,
        clips: useTimelineStore.getState().doc!.clips.map((c) =>
          c.id === "clip_sub" ? { ...c, voiceClipId: "clip_voice", startSec: 2, durationSec: 3 } : c,
        ),
      },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/いま出る文：「よろしく」/)).toBeInTheDocument();
  });

  it("連動先が見つからない字幕を知らせる（黙って連動が切れない）", () => {
    open({
      clips: [
        { id: "clip_sub", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 1, x: 0, y: 900, w: 1920, h: 120, voiceClipId: "clip_999" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("連動する読み上げが見つからない字幕が1個"))).toBe(true);
  });
});

describe("TimelineProjectScreen: 読み上げを置く・声を作る（#633）", () => {
  const withVoice = (voiceOver: Record<string, unknown> = {}) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_voice", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 2, durationSec: 3, voice: { text: "ひとこと", status: "none", ...voiceOver } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_voice"] });
  };

  it("再生位置から読み上げを置ける（置いた部品が選ばれる）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [],
    });
    useTimelineStore.setState({ playheadSec: 4 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "読み上げを置く" }));
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip).toMatchObject({ kind: TIMELINE_CLIP_KIND.voice, startSec: 4, trackId: "track_002" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([clip?.id]);
  });

  it("文を書き換えられる", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByText("読み上げる文").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "べつの文" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("べつの文");
  });

  it("声（話者）を選べる／動画全体に合わせるへ戻せる", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("声").parentElement?.querySelector("select");
    fireEvent.change(select!, { target: { value: "2" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.speaker).toBe(2);
    fireEvent.change(select!, { target: { value: "" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.speaker).toBeUndefined();
  });

  it("文が空のときは声を作れない（押せない理由を出す）", () => {
    withVoice({ text: "" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "声を作る" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("読み上げる文を入れてください");
  });

  it("この読み上げの字幕を置ける（連動つき・同じ時間）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "この読み上げの字幕を置く" }));
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(sub).toMatchObject({ voiceClipId: "clip_voice", startSec: 2, durationSec: 3 });
  });
});

describe("TimelineProjectScreen: 動き（キーフレーム・#634）", () => {
  const withClip = (over: Record<string, unknown> = {}) => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4, x: 100, y: 50, w: 300, h: 80, text: "うごく" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 3 });
  };

  const typeAndPlace = (label: string, value: string) => {
    const input = screen.getByText(label).parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
  };

  it("入れた「ずれ」を再生位置に置く（時刻は部品の先頭からの秒・値は絶対値でない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    // 再生位置 3 秒 − 部品の開始 2 秒＝1 秒。値は入れた 200（部品の x=100 を足したりしない）。
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, x: 200 }]);
  });

  it("空欄の項目は動かさない", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("濃さ（0〜1）", "0.5");
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, opacity: 0.5 }]);
  });

  it("置いた動きを一覧に出し、外せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("濃さ（0〜1）", "0.5");
    expect(screen.getByText(/3.00秒：濃さ（0〜1） 0.5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });

  it("置いた値を読み込んで直せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("横のずれ（px）", "200");
    fireEvent.click(screen.getByRole("button", { name: "この位置の値を読み込む" }));
    const input = screen.getByText("横のずれ（px）").parentElement?.querySelector("input");
    expect((input as HTMLInputElement).value).toBe("200");
    fireEvent.change(input!, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "この位置に置く" }));
    expect(useTimelineStore.getState().doc?.animations?.[0].keyframes).toEqual([{ timeSec: 1, x: 300 }]);
  });

  it("まとめて外せる", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    typeAndPlace("大きさ（倍）", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "動きをすべて外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });

  it("再生位置が部品の外なら置かせない（黙って端へ寄せない）", () => {
    withClip();
    useTimelineStore.setState({ playheadSec: 10 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "この位置に置く" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("再生位置がこの部品の外にあります"))).toBe(true);
  });

  it("固定した列の部品には置けない（欄を押せなくする）", () => {
    withClip({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("横のずれ（px）").parentElement?.querySelector("input")).toBeDisabled();
  });

  it("音の部品には動きの欄を出さない（絵が無いので効かない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 4, bundledBgmId: "found-new-hope" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("横のずれ（px）")).not.toBeInTheDocument();
  });

  it("まとまりに付いた動きも知らせる（画面では動いているのに「無い」と言わない）", () => {
    withClip({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/「まとまり」にも動きが付いています（2か所）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "まとまりの動きを外す" }));
    expect(useTimelineStore.getState().doc?.animations).toBeUndefined();
  });
});

describe("TimelineProjectScreen: 音の部品（速さ・使い始め・音量・フェード／音を置く・#634）", () => {
  const withBgm = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const setField = (label: string, value: string) => {
    const input = screen.getByText(label).parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value } });
  };

  it("速さを変えられる（部品の長さは変わらない）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("速さ（倍）", "2");
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({ speed: 2, durationSec: 10 });
  });

  it("素材の使い始めを変えられる", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("素材の使い始め（秒）", "12");
    expect(useTimelineStore.getState().doc?.clips[0].sourceStartSec).toBe(12);
  });

  it("音量を変えられ、空にすると動画全体に合わせる（継承へ戻る）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("音量", "0.8");
    expect(useTimelineStore.getState().doc?.clips[0].volume).toBe(0.8);
    setField("音量", "");
    expect(useTimelineStore.getState().doc?.clips[0].volume).toBeUndefined();
  });

  it("前後のフェードを付けられる", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    setField("だんだん大きく（秒）", "2");
    setField("だんだん小さく（秒）", "3");
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 3 });
  });

  it("固定した列では変えられない（欄を押せなくする）", () => {
    withBgm({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("速さ（倍）").parentElement?.querySelector("input")).toBeDisabled();
  });

  it("同梱BGMを再生位置から置ける", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [],
    });
    useTimelineStore.setState({ playheadSec: 5 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "前向きなポップ" }));
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: "found-new-hope", startSec: 5,
    });
  });

  it("持っている音の素材も置ける", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "自前の曲", filePath: "assets/a.mp3" }],
      clips: [],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "自前の曲" }));
    expect(useTimelineStore.getState().doc?.clips[0].assetId).toBe("asset_001");
  });

  it("絵の部品には音の欄を出さない", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("速さ（倍）")).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 切り抜き（#634）", () => {
  const withShape = (over: Record<string, unknown> = {}) => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 400, h: 300, fillColor: "#ff0000" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("%で隠せる（保存は割合）", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByText("下を隠す（%）").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "25" } });
    expect(useTimelineStore.getState().doc?.clips[0].crop).toEqual({ bottom: 0.25 });
  });

  it("固定した列では変えられない", () => {
    withShape({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("上を隠す（%）").parentElement?.querySelector("input")).toBeDisabled();
  });

  it("音の部品には出さない（絵が無いので効かない）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 4, bundledBgmId: "found-new-hope" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("上を隠す（%）")).not.toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 音量の変化（#512 段4）", () => {
  const withAudio = (over: Partial<TimelineProject> = {}) => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 8, bundledBgmId: "found-new-hope" }],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("再生位置に点を置ける（保存するのは部品の先頭からの秒＝動画の時刻ではない）", () => {
    withAudio({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 1, durationSec: 8, bundledBgmId: "found-new-hope" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 動画の 3 秒＝部品（1 秒から）の 2 秒目。
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    const input = screen.getByText("この位置の音量").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "0.4" } });
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toEqual([{ timeSec: 2, volume: 0.4 }]);
  });

  it("置いた点は一覧に出て、外せる", () => {
    withAudio({
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 1, durationSec: 8,
        bundledBgmId: "found-new-hope", volumePoints: [{ timeSec: 2, volume: 0.4 }],
      }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 表示は動画の時刻（部品の開始 1 秒 ＋ 点の 2 秒）＝画面の目盛りと同じ物差し。
    expect(screen.getByText(/3\.00秒：音量 0\.4/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("外す"));
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toBeUndefined();
  });

  it("上限に達したら置かずに「次の行動」を出す（§2-5）", () => {
    const full = Array.from({ length: VOLUME_POINTS_MAX }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));
    withAudio({
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 8,
        bundledBgmId: "found-new-hope", volumePoints: full,
      }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } });
    const input = screen.getByText("この位置の音量").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "0.9" } });
    fireEvent.click(screen.getByText("この位置に置く"));
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("ほかの点を外してから置いてください"))).toBe(true);
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toHaveLength(VOLUME_POINTS_MAX);
  });

  it("再生位置が部品の外なら、置く前に動かし方を案内する（§2-5）", () => {
    withAudio({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 5, durationSec: 3, bundledBgmId: "found-new-hope" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("部品が鳴っている時間"))).toBe(true);
    expect(screen.queryByText("この位置に置く")).not.toBeInTheDocument();
  });

  it("絵の部品には出さない（鳴る音が無いので効かない）", () => {
    open();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 文字クリップ
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("音量の変化")).not.toBeInTheDocument();
  });
});
