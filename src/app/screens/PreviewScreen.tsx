import { useEffect, useRef, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { BgmPicker } from "../components/BgmPicker";
import { resolveBgmVolume } from "../../domain/voice/audioMix";
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
  const [muted, setMuted] = useState(false);
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

  // 再生時に流す BGM の解決（標準BGM＝同梱／自分のBGM＝プロジェクト素材）。設定UIは下の BgmPicker。
  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);
  const bundledBgm = bgmById(bgmSettings?.bundledBgmId);

  // 再生中：現在の場面のナレーションを鳴らし、表示時間後に次の場面へ。範囲の終端で停止。
  useEffect(() => {
    const sc = scenes[safeIdx];
    if (!playing || !sc) return;
    let audio: HTMLAudioElement | undefined;
    const url = narrationAudioById[sc.sceneId];
    if (url && !mutedRef.current) {
      audio = new Audio(url);
      void audio.play().catch((e) => console.warn("[PreviewScreen] 音声再生に失敗", e));
    }
    const timer = window.setTimeout(
      () => {
        if (safeIdx < endIdx) setIdx(safeIdx + 1);
        else setPlaying(false);
      },
      Math.max(MIN_PLAY_SEC, sc.durationSec) * 1000,
    );
    return () => {
      window.clearTimeout(timer);
      audio?.pause();
    };
  }, [playing, safeIdx, endIdx, scenes, narrationAudioById]);

  // 再生中：選択した BGM をループで流す（仕上がり確認で雰囲気を確認できる）。場面送りでは止めない。
  useEffect(() => {
    if (!playing || !bgmSettings?.enabled) return;
    let audio: HTMLAudioElement | undefined;
    let cancelled = false;
    void (async () => {
      let url: string | null = null;
      if (bundledBgm) url = `/bgm/${bundledBgm.fileName}`;
      else if (bgmAsset && meta.projectId) url = await assetDisplayUrl(meta.projectId, bgmAsset.filePath);
      if (cancelled || !url) return;
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.min(1, resolveBgmVolume(undefined, bgmSettings)); // HTMLAudio の音量は上限 1.0
      a.muted = mutedRef.current;
      audio = a;
      bgmAudioRef.current = a;
      void a.play().catch((e) => console.warn("[PreviewScreen] BGM再生に失敗", e));
    })();
    return () => {
      cancelled = true;
      audio?.pause();
      if (bgmAudioRef.current === audio) bgmAudioRef.current = null;
    };
  }, [playing, bgmSettings, bundledBgm, bgmAsset, meta.projectId]);

  return (
    <div className="main-scroll">
      <PageHead
        title="仕上がり確認"
        desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 大きな確認エリア */}
        <div className="card">
          <ScenePreview scene={current} template={template} />

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
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">字幕</span>
              <span className="badge badge-teal">あり</span>
            </div>
          </div>

          <hr className="divider" />
          <h2 className="section-title">BGM（音楽）</h2>
          <p className="field-hint" style={{ marginTop: 0 }}>
            動画に流す音楽を選べます。再生ボタンで実際の雰囲気を確認できます。
          </p>
          <BgmPicker />

          <div className="col gap-sm mt-lg">
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
