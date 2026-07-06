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
import { sceneAnimationActive } from "../../domain/project/sceneAnimation";
import { findVideoSlot } from "../../renderer/export/findVideoSlot";
import { assembleProject } from "../../domain/project/persistence";
import { FPS } from "../../domain/constants";
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
  // narrationAudioById は再生 effect が getState でスナップショット読みするため購読しない（#382・参照変化で再描画/再起動しない）。
  const { status, scenes, templates, parts, assets, meta, autoGenerateIfSafe, setEditingSceneId } =
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

  // 直接landしたときの自動生成は「外部送信にならない（Mock）とき」だけ（#384・§2-6）。実プロバイダは空状態のまま。
  useEffect(() => {
    void autoGenerateIfSafe();
  }, [status, autoGenerateIfSafe]);

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
  // テロップ切替タイマーも「開始時点のスナップショット」で組む（#382）。currentTelops は scenes 参照変化で
  // 別オブジェクトに作り直されるため、内容が同じでも参照差で再起動→タイマーが再生位置基準でずれていた。
  // 最新値は ref で読み（render 中の代入は禁止＝同期は effect で）、deps は内容シグネチャ（telopSig）にする。
  const currentTelopsRef = useRef(currentTelops);
  const telopSig = useMemo(() => JSON.stringify(currentTelops), [currentTelops]);
  useEffect(() => {
    currentTelopsRef.current = currentTelops;
  }, [currentTelops]);
  useEffect(() => {
    if (!playing) return;
    const telops = currentTelopsRef.current;
    const bounds = [...new Set([0, ...telops.flatMap((iv) => [iv.startSec, iv.endSec])])];
    const timers = bounds
      .filter((b) => b >= 0)
      .map((b) => window.setTimeout(() => setPlaybackTelops(activeTelopsAt(telops, b)), b * 1000));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      setPlaybackTelops([]); // 場面送り/停止で前場面の表示を持ち越さない
    };
    // safeIdx（場面送り）と telopSig（テロップ内容の変化）でのみ再構成＝scenes の参照変化では再起動しない。
  }, [playing, safeIdx, telopSig]);
  const activeTelops = playing ? playbackTelops : activeTelopsAt(currentTelops, 0);

  // キーフレームアニメ（④・ADR-0019）：現在場面の animations（timelineOverlay 由来・AI/場面正準は不変）。
  const sceneAnimations = useMemo(
    () => (current ? (meta.timelineOverlay?.animations ?? []).filter((a) => a.sceneId === current.sceneId) : []),
    [meta.timelineOverlay, current],
  );
  const template = current ? templates.find((t) => t.templateId === current.templateId) : undefined;
  // 動画スロット有無（アニメ適用可否の判定に使う＝書き出しと同一条件でパリティ・ADR-0019）。
  const hasVideoSlot = useMemo(
    () => !!(current && template && findVideoSlot(current, template, (id) => assets.find((a) => a.assetId === id))),
    [current, template, assets],
  );
  // このアニメを実際に描くか＝書き出し（buildExportScenes）と共有の sceneAnimationActive で判定。
  // 掛け合いは行セグメントごとにアニメを焼く（③）。動画スロット併用場面のみ書き出しが静止扱いのため、
  // プレビューも静止にしてパリティを保つ（ADR-0001）。
  const animActive = !!current && sceneAnimationActive(current, sceneAnimations, hasVideoSlot);
  const previewAnimations = animActive ? sceneAnimations : [];
  // 再生中はこの場面のアニメを再生位置 timeSec で駆動（RAF＝場面頭からの経過秒を尺でクランプ）。停止中は t=0（場面頭）。
  const [sceneTimeSec, setSceneTimeSec] = useState(0);
  useEffect(() => {
    if (!playing || !animActive) return;
    // 実効表示尺は場面送りと同じく MIN_PLAY_SEC でクランプ（アニメの再生窓を実際の表示時間に合わせる）。
    const dur = Math.max(MIN_PLAY_SEC, current?.durationSec ?? 0);
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      // 正本プレビュー（仕上がり確認）は書き出しと同じ 30fps 量子化でフレーム t を描く＝export と一致（ADR-0019 決定②の per-frame パリティ）。
      setSceneTimeSec(Math.min(Math.floor(elapsed * FPS) / FPS, dur));
      if (elapsed < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, safeIdx, animActive, current?.durationSec]);
  const animTimeSec = playing ? sceneTimeSec : 0; // 停止中は場面頭。派生＝effect 内の同期 setState を避ける。

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
    // 再生開始時点のスナップショット（#382）＝store の現在値を getState で読む（subscribe しない）。
    // 以降この再生セッションはこの値で進み、途中で scenes/narrationAudioById の参照が変わっても
    // effect は再起動しない（自動保存・声のBG生成で場面を頭からやり直さない）。
    const { scenes: scenesSnap, narrationAudioById } = useProjectStore.getState();
    const sc = scenesSnap[safeIdx];
    if (!playing || !sc) return;
    const advance = (): void => {
      if (safeIdx < endIdx) setIdx(safeIdx + 1);
      else setPlaying(false);
    };
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
      let cancelled = false; // クリーンアップ後に遅延スケジュールが走らないようにする。
      // 行を順に再生する“連鎖”。次の行への送りは「この行の窓（次の開始−この開始）」ぶん後だが、
      // その計測を**この行が実際に鳴り始めてから**にする＝再生開始の遅延で末尾が切れない（#掛け合い・①）。
      // 固定タイマー（場面頭からの絶対秒）だと、音声が遅れて鳴り始めたぶん前の行を早く止めて途切れていた。
      // 編集画面の全文再生・書き出しの行連結（各行を丸ごと連結）とパリティが取れる。
      const playLine = (i: number): void => {
        if (cancelled || i >= segs.length) return;
        currentAudio?.pause(); // 前の行の音声を止めてから次へ（被り防止）。
        // segs と sc.lines のズレに依らず lineId で実体の行 index を引く（誤字幕防止・M-2）。
        const lineIdx = lines.findIndex((l) => l.lineId === segs[i].lineId);
        setActiveLine(lineIdx >= 0 ? lineIdx : 0);
        const scheduleNext = (): void => {
          if (cancelled) return;
          if (i + 1 < segs.length) {
            const windowSec = Math.max(0, segs[i + 1].startSec - segs[i].startSec);
            lineTimers.push(window.setTimeout(() => playLine(i + 1), windowSec * 1000));
          } else {
            // 最終行：この行の窓（場面末まで）ぶん後に場面送り（advance）。場面送りも実再生起点にそろえ、
            // 行が増えて遅延が積み上がっても最終行の末尾が場面遷移で切れないようにする（#370 レビュー対応）。
            const lastWindowSec = Math.max(MIN_PLAY_SEC, segs[i].endSec - segs[i].startSec);
            lineTimers.push(window.setTimeout(advance, lastWindowSec * 1000));
          }
        };
        const u = narrationAudioById[lineAudioKey(sc.sceneId, segs[i].lineId)];
        if (u && !mutedRef.current) {
          currentAudio = new Audio(u);
          lineAudios.push(currentAudio);
          // play() の解決＝再生開始。そこから窓を測って次へ。resolve/reject いずれでも一度だけ進む
          // （reject 側は再生失敗ログも残す＝今後のデバッグ用・#370 レビュー対応）。
          void currentAudio.play().then(scheduleNext, (e) => {
            console.warn("[PreviewScreen] 音声再生に失敗", e);
            scheduleNext();
          });
        } else {
          scheduleNext(); // 無音（ミュート/音声なし）は窓ぶん待ってから次へ。
        }
      };
      if (segs.length > 0) {
        // 先頭行の「間」（頭空白＝先頭行 startSec までの無言区間）を尊重する（#386・A案）。
        // 間は字幕なし（activeLine=-1）で映像＋BGMだけ流し、firstStart 経過後に先頭行の音声＋字幕を始める
        // ＝静止画/動画/正準(compileTimeline)と同じ場面尺・見え方（パリティ）。間が無い（0秒）なら即開始。
        const headGap = Math.max(0, segs[0].startSec);
        if (headGap > 0) {
          setActiveLine(-1); // 間：有効行なし＝字幕を出さない
          lineTimers.push(window.setTimeout(() => playLine(0), headGap * 1000));
        } else {
          playLine(0);
        }
      } else {
        // 有効な行が無い（全フィルタ＝音声未生成など）は場面尺で送る（従来のフォールバック）。
        lineTimers.push(window.setTimeout(advance, Math.max(MIN_PLAY_SEC, sc.durationSec) * 1000));
      }
      return () => {
        cancelled = true;
        lineTimers.forEach((t) => window.clearTimeout(t));
        lineAudios.forEach((a) => a.pause());
        setActiveLine(0);
      };
    }

    // 単一 narration（従来）。場面尺の固定タイマーで次の場面へ。
    const endTimer = window.setTimeout(advance, Math.max(MIN_PLAY_SEC, sc.durationSec) * 1000);
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
    // deps はプリミティブのみ（#382）：scenes/narrationAudioById は上の getState でスナップショット読みするため
    // deps に含めない＝自動保存・声のBG生成での参照変化で再生を頭からやり直さない。endIdx は値が変わったときだけ再構成（範囲変更）。
  }, [playing, safeIdx, endIdx]);

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
          <ScenePreview scene={current} template={template} activeLineIndex={activeLine} telops={activeTelops} timeSec={animTimeSec} animations={previewAnimations} />

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
            <button
              className="btn btn-secondary btn-block"
              onClick={() => {
                // いま表示中の場面を指定して場面編集を開く（#400）。
                if (current) setEditingSceneId(current.sceneId);
                onNavigate("scene-edit");
              }}
            >
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
