import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { BgmPicker } from "../components/BgmPicker";
import { resolveBgmVolume } from "../../domain/voice/audioMix";
import { lineAudioKey } from "../../domain/project/narrationLines";
import { lineSegments } from "../../domain/project/lineTimeline";
import { activeTelopsAt, compileTimeline, resolveSceneBgm, sceneLocalTelops } from "../../domain/project/compileTimeline";
import { assembleProject } from "../../domain/project/persistence";
import { wavDurationSec } from "../../domain/voice/wavDuration";
import { assetDisplayUrl } from "../../infrastructure/assetFs";
import {
  PlayIcon,
  StopIcon,
  VolumeIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
} from "../components/icons";

interface PreviewProps {
  onNavigate: (screen: ScreenId) => void;
}

type RangeMode = "scene" | "part" | "all";

// 場面送りの最小秒（表示時間は SceneEdit で 0/負値にも編集され得るため、即時送り/不正値を防ぐ下限）。
const MIN_PLAY_SEC = 0.3;

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export function PreviewScreen({ onNavigate }: PreviewProps) {
  const { status, scenes, templates, parts, assets, meta, generate, narrationAudioById } =
    useProjectStore();
  const bgmSettings = meta.bgmSettings;
  const [range, setRange] = useState<RangeMode>("all");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 選択済みBGMが再生できなかったとき通知する（自分のBGMのURL解決/再生失敗・§2-5）。
  const [bgmPlayWarning, setBgmPlayWarning] = useState(false);
  const [muted, setMuted] = useState(false);
  // 掛け合い再生中の有効行 index（経過秒に応じて字幕/フレームを切り替える・ADR-0015 PR-F2）。停止時は 0（先頭）。
  const [activeLine, setActiveLine] = useState(0);
  // ミュートは再生エフェクトを再起動させずに参照したいので ref で持つ（同期は useEffect で）。
  const mutedRef = useRef(muted);
  // 再生中の BGM 要素（ループ再生・ミュート/音量を即時反映するため保持）。
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  // muted を ref に同期（render 中の ref 書込みを避けつつ、再生エフェクトを再起動させない）。BGM へは即時反映。
  useEffect(() => {
    mutedRef.current = muted;
    if (bgmAudioRef.current) bgmAudioRef.current.muted = muted;
  }, [muted]);

  const safeIdx = Math.min(idx, Math.max(0, scenes.length - 1));
  const current = scenes[safeIdx];
  // タイムラインのテロップ（ADR-0018 テロップ実描画）。現在場面のローカル区間へ切り出し、再生位置で表示を切り替える。
  const timeline = useMemo(
    () => compileTimeline(assembleProject(meta, assets, parts, scenes)),
    [meta, assets, parts, scenes],
  );
  const currentTelops = useMemo(
    () => (current ? sceneLocalTelops(timeline, current.sceneId) : []),
    [timeline, current],
  );
  // 再生中のテロップは区間境界のタイマーで切替（t=0 も 0ms タイマー経由＝effect 内の同期 setState を避ける）。
  // 停止中は場面頭(t=0)の表示を描画時に導出する。区間は書き出しの enable='between' と同一（パリティ）。
  // 並行テロップ（③(8)）＝時刻ごとに有効な全テロップ（段付き）を表示する。
  const [playbackTelops, setPlaybackTelops] = useState<{ text: string; row: number }[]>([]);
  useEffect(() => {
    if (!playing) return;
    const bounds = [...new Set([0, ...currentTelops.flatMap((iv) => [iv.startSec, iv.endSec])])];
    const timers = bounds
      .filter((b) => b >= 0)
      .map((b) => window.setTimeout(() => setPlaybackTelops(activeTelopsAt(currentTelops, b)), b * 1000));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      setPlaybackTelops([]); // 場面送り/停止で前場面の表示を持ち越さない
    };
  }, [playing, safeIdx, currentTelops]);
  const activeTelops = playing ? playbackTelops : activeTelopsAt(currentTelops, 0);
  const template = current ? templates.find((t) => t.templateId === current.templateId) : undefined;
  const totalSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);

  // 再生範囲の終端 index（この場面=現在地 / このパート=所属パートの最後 / 全体=最後）。
  const partOfCurrent = current
    ? parts.find((p) => p.sceneIds.includes(current.sceneId))
    : undefined;
  const inRange = (i: number): boolean => {
    if (range === "scene") return i === safeIdx;
    if (range === "all") return true;
    return partOfCurrent ? partOfCurrent.sceneIds.includes(scenes[i]?.sceneId ?? "") : i === safeIdx;
  };
  let endIdx = safeIdx;
  for (let i = 0; i < scenes.length; i += 1) if (inRange(i)) endIdx = Math.max(endIdx, i);
  let startIdx = safeIdx;
  for (let i = 0; i < scenes.length; i += 1)
    if (inRange(i)) {
      startIdx = i;
      break;
    }

  // 再生時に流す BGM の解決＝現在場面の実効BGM（場面ごと ?? プロジェクト＝null=継承・ADR-0018 ③(7)）。
  // 同じソースが続く場面では再起動しない（連続する同じ曲は途切れない）＝下の effect の deps を bundledBgm/bgmAsset にする。
  const currentBgm = current ? resolveSceneBgm(current, bgmSettings) : bgmSettings;
  const bgmAsset = assets.find((a) => a.assetId === currentBgm?.assetId);
  const bundledBgm = bgmById(currentBgm?.bundledBgmId);
  // effect の deps に使うプリミティブ（オブジェクト参照でなく値で比較＝同じ源では再起動しない）。
  const bgmEnabled = !!currentBgm?.enabled;
  const bgmVolume = resolveBgmVolume(undefined, currentBgm);

  // 再生中：現在の場面のナレーションを鳴らし、表示時間後に次の場面へ。範囲の終端で停止。
  // 掛け合い（明示 lines）は行ごとに音声を順に鳴らし、経過秒で有効行（字幕/フレーム）を切り替える（ADR-0015 PR-F2）。
  useEffect(() => {
    const sc = scenes[safeIdx];
    if (!playing || !sc) return;
    const advance = (): void => {
      if (safeIdx < endIdx) setIdx(safeIdx + 1);
      else setPlaying(false);
    };
    const endTimer = window.setTimeout(advance, Math.max(MIN_PLAY_SEC, sc.durationSec) * 1000);

    if (sc.lines && sc.lines.length > 0) {
      // 掛け合い：行音声の長さを測ってタイムラインを作り、各行の開始秒で音声＋フレームを切り替える。
      const lines = sc.lines;
      const durations: Record<string, number> = {};
      for (const l of lines) {
        const a = narrationAudioById[lineAudioKey(sc.sceneId, l.lineId)];
        durations[l.lineId] = a ? wavDurationSec(a) : 0;
      }
      // 0秒（音声未測定で開始が重なる）行は無視＝書き出し（sceneSegmentSpecs）と同じ扱い（M-1）。
      const segs = lineSegments(sc, durations).filter((s) => s.endSec > s.startSec);
      const lineTimers: number[] = [];
      const lineAudios: HTMLAudioElement[] = [];
      let currentAudio: HTMLAudioElement | undefined;
      const playLine = (i: number): void => {
        currentAudio?.pause(); // 前の行の音声を止めてから次へ（被り防止）。
        // segs と sc.lines のズレに依らず lineId で実体の行 index を引く（誤字幕防止・M-2）。
        const lineIdx = lines.findIndex((l) => l.lineId === segs[i].lineId);
        setActiveLine(lineIdx >= 0 ? lineIdx : 0);
        const u = narrationAudioById[lineAudioKey(sc.sceneId, segs[i].lineId)];
        if (u && !mutedRef.current) {
          currentAudio = new Audio(u);
          lineAudios.push(currentAudio);
          void currentAudio.play().catch((e) => console.warn("[PreviewScreen] 音声再生に失敗", e));
        }
      };
      if (segs.length > 0) {
        playLine(0);
        for (let i = 1; i < segs.length; i += 1) {
          lineTimers.push(window.setTimeout(() => playLine(i), Math.max(0, segs[i].startSec) * 1000));
        }
      }
      return () => {
        window.clearTimeout(endTimer);
        lineTimers.forEach((t) => window.clearTimeout(t));
        lineAudios.forEach((a) => a.pause());
        setActiveLine(0);
      };
    }

    // 単一 narration（従来）。
    let audio: HTMLAudioElement | undefined;
    const url = narrationAudioById[sc.sceneId];
    if (url && !mutedRef.current) {
      audio = new Audio(url);
      void audio.play().catch((e) => console.warn("[PreviewScreen] 音声再生に失敗", e));
    }
    return () => {
      window.clearTimeout(endTimer);
      audio?.pause();
    };
  }, [playing, safeIdx, endIdx, scenes, narrationAudioById]);

  // 再生中：選択した BGM をループで流す（仕上がり確認で雰囲気を確認できる）。場面送りでは止めない。
  // BGM 要素は ref を単一の真実とし、cleanup は ref を直接停止する（自分のBGMは URL 解決が非同期なので
  // closure ローカルに依存しない＝再実行が解決の前後どちらで起きても確実に止める）。
  useEffect(() => {
    if (!playing || !bgmEnabled) return;
    let cancelled = false;
    void (async () => {
      let url: string | null = null;
      if (bundledBgm) url = `/bgm/${bundledBgm.fileName}`;
      else if (bgmAsset && meta.projectId) url = await assetDisplayUrl(meta.projectId, bgmAsset.filePath);
      if (cancelled) return;
      if (!url) { setBgmPlayWarning(true); return; } // 選択済みなのに再生元が解決できない（自分のBGM）→ 無音にせず通知
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.min(1, bgmVolume); // HTMLAudio の音量は上限 1.0
      a.muted = mutedRef.current;
      bgmAudioRef.current = a;
      void a.play().catch((e) => {
        console.warn("[PreviewScreen] BGM再生に失敗", e);
        if (!cancelled) setBgmPlayWarning(true);
      });
    })();
    return () => {
      cancelled = true;
      bgmAudioRef.current?.pause();
      bgmAudioRef.current = null;
    };
    // deps は源（bundledBgm/bgmAsset）と有効/音量のプリミティブ＝同じ曲が続く場面送りでは再起動せず鳴らし続ける。曲が変わる場面で切替。
  }, [playing, bgmEnabled, bgmVolume, bundledBgm, bgmAsset, meta.projectId]);

  return (
    <div className="main-scroll">
      <PageHead
        title="仕上がり確認"
        desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 大きな確認エリア */}
        <div className="card">
          <ScenePreview scene={current} template={template} activeLineIndex={activeLine} telops={activeTelops} />

          {/* 場面送り */}
          <div className="row-between mt">
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={playing || safeIdx <= 0}
            >
              <ArrowLeftIcon size={16} />
              前の場面
            </button>
            <span className="text-sm text-muted">
              場面 {scenes.length === 0 ? 0 : safeIdx + 1} / {scenes.length}
            </span>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setIdx((i) => Math.min(scenes.length - 1, i + 1))}
              disabled={playing || safeIdx >= scenes.length - 1}
            >
              次の場面
              <ChevronRightIcon size={16} />
            </button>
          </div>

          <div className="preview-controls">
            <button
              className="btn btn-icon btn-secondary"
              aria-label="再生"
              onClick={() => {
                setBgmPlayWarning(false); // 再生のたびに前回の警告をクリア（effect 内同期 setState を避ける）
                if (safeIdx >= endIdx) setIdx(startIdx); // 範囲の終端にいたら先頭から再生
                setPlaying(true);
              }}
              disabled={playing || scenes.length === 0}
            >
              <PlayIcon size={20} />
            </button>
            <button
              className="btn btn-icon btn-secondary"
              aria-label="停止"
              onClick={() => setPlaying(false)}
              disabled={!playing}
            >
              <StopIcon size={20} />
            </button>
            <button
              className={`btn btn-icon ${muted ? "btn-secondary" : "btn-ghost"}`}
              aria-label={muted ? "ミュート中（音を出す）" : "音を消す"}
              aria-pressed={muted}
              onClick={() => setMuted((m) => !m)}
            >
              <VolumeIcon size={20} />
            </button>
          </div>

          {bgmPlayWarning && (
            <div className="notice notice-warn mt" role="alert">
              <span>BGMを再生できませんでした。別のBGMを選ぶか、もう一度お試しください。</span>
            </div>
          )}

          {/* 確認する範囲を選ぶ */}
          <div className="mt-lg">
            <label className="field-label">確認する範囲を選ぶ</label>
            <div className="segment">
              {([
                ["scene", "この場面だけ"],
                ["part", "このパートだけ"],
                ["all", "全体"],
              ] as [RangeMode, string][]).map(([id, label]) => (
                <button
                  key={id}
                  className={range === id ? "active" : ""}
                  onClick={() => {
                    setRange(id);
                    setPlaying(false); // 範囲を変えたら再生を止める
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右: 動画の概要 */}
        <div className="card">
          <h2 className="section-title">動画の概要</h2>
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">合計時間</span>
              <strong>{formatDuration(totalSec)}</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">場面数</span>
              <strong>{scenes.length}個</strong>
            </div>
          </div>

          <hr className="divider" />
          <h2 className="section-title">BGM（音楽）</h2>
          <p className="field-hint" style={{ marginTop: 0 }}>
            動画に流す音楽を選べます。再生ボタンで実際の雰囲気を確認できます。
          </p>
          <BgmPicker />

          <div className="col gap-sm mt-lg">
            <button className="btn btn-ghost btn-block" onClick={() => onNavigate("timeline")}>
              タイムラインで見る
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => onNavigate("scene-edit")}>
              場面を直す
            </button>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => onNavigate("precheck")}>
              公開前チェックへ進む
              <ChevronRightIcon size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
