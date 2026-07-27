import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead, Switch } from "../components/ui";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { NoScenesState } from "../components/NoScenesState";
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { formatDuration } from "../../domain/format/duration";
import { BgmPicker } from "../components/BgmPicker";
import { NarrationVolumeControl } from "../components/NarrationVolumeControl";
import { hasSceneNarrationOverride, resolveBgmVolume, resolveNarrationVolume } from "../../domain/voice/audioMix";
import { attachVolume, closeAudioContext, type AudioCtxRef, type VolumeControl } from "./previewAudioVolume";
import { lineAudioKey, lineDurationsFromAudio } from "../../domain/project/narrationLines";
import { lineSegments, previewSubtitleSegment, firstFrameBoundary } from "../../domain/project/lineTimeline";
import { activeTelopsAt, compileTimeline, resolveSceneBgm, sceneLocalTelops } from "../../domain/project/compileTimeline";
import { sceneAnimationActive } from "../../domain/project/sceneAnimation";
import { findVideoSlots } from "../../renderer/export/findVideoSlot";
import type { VideoSlotPlayback } from "../components/ScenePreview";
import { buildVideoPlaybackSlots } from "./previewVideoSlots";
import { lineAdvanceWindowSec } from "./previewLineTiming";
import { assembleProject } from "../../domain/project/persistence";
import { FPS, PREVIEW_MIN_PLAY_SEC } from "../../domain/constants";
import { wavDurationSec } from "../../domain/voice/wavDuration";
import { assetDisplayUrl } from "../../infrastructure/assetFs";
import {
  PlayIcon,
  StopIcon,
  VolumeIcon,
  VolumeMuteIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
} from "../components/icons";

interface PreviewProps {
  onNavigate: (screen: ScreenId) => void;
}

type RangeMode = "scene" | "part" | "all";


// 仕上がり確認の「戻る」ラベル（来た画面ごと・#410 sub3）。入口はこの3つ。
const PREVIEW_BACK_LABEL: Partial<Record<ScreenId, string>> = {
  draft: "たたき台へ戻る",
  "scene-edit": "場面編集へ戻る",
  export: "書き出しへ戻る",
};

export function PreviewScreen({ onNavigate }: PreviewProps) {
  // narrationAudioById は再生 effect が getState でスナップショット読みするため購読しない（#382・参照変化で再描画/再起動しない）。
  const { status, scenes, templates, parts, assets, meta, autoGenerateIfSafe, setEditingSceneId, updateVoiceSettings, previewReturnTo } =
    useProjectStore();
  const bgmSettings = meta.bgmSettings;
  // 「戻る」先＝来た画面（#410 sub3）。既知の入口（たたき台/場面編集/書き出し）以外や未設定はたたき台へ。
  const previewBackTo: ScreenId = previewReturnTo && PREVIEW_BACK_LABEL[previewReturnTo] ? previewReturnTo : "draft";
  const [range, setRange] = useState<RangeMode>("all");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 選択済みBGMが再生できなかったとき通知する（自分のBGMのURL解決/再生失敗・§2-5）。
  const [bgmPlayWarning, setBgmPlayWarning] = useState(false);
  // ナレーション音声を再生できなかったとき通知する（BGM と同様に裏で失敗させない・§2-5・#452 P2）。
  const [narrationPlayWarning, setNarrationPlayWarning] = useState(false);
  const [muted, setMuted] = useState(false);
  // 掛け合い再生中の有効行 index（経過秒に応じて字幕/フレームを切り替える・ADR-0015 PR-F2）。停止時は 0（先頭）。
  const [activeLine, setActiveLine] = useState(0);
  // ミュートは再生エフェクトを再起動させずに参照したいので ref で持つ（同期は useEffect で）。
  const mutedRef = useRef(muted);
  // 再生中の BGM 要素（ループ再生・停止のため保持）。
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  // 再生中のナレーション要素（停止のため保持・#388）。掛け合いは常に「今鳴っている行」を指す。
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  // 100%超（最大150%）の音量を書き出しと一致させる Web Audio 用の共有 AudioContext と、各再生の音量/ミュート制御（#452 P1）。
  const audioCtxRef: AudioCtxRef = useRef<AudioContext | null>(null);
  const narrationCtlRef = useRef<VolumeControl | null>(null);
  // 同時開始（掛け合いの並行・ADR-0031）：いま鳴っている「同時グループ」の音量制御一覧。ライブの音量/ミュートを
  // 全員へ反映する（単一 narrationCtlRef だけだと最後の1声にしか効かない）。グループ切替・cleanup でリセット。
  const narrationGroupCtlsRef = useRef<VolumeControl[]>([]);
  const bgmCtlRef = useRef<VolumeControl | null>(null);
  // BGM 音量の最新値（100%境界の張り直し用 deps を bgmVolume>1 の真偽にするため、attach が読む実値は ref で持つ・#392/#465）。
  const bgmVolumeRef = useRef(1);
  // 場面ジャンプ（下の番号ストリップ）で「今の場面」ボタンを可視域へスクロールするための ref（#413）。
  const activeJumpRef = useRef<HTMLButtonElement | null>(null);

  // 直接landしたときの自動生成は「外部送信にならない（Mock）とき」だけ（#384・§2-6）。実プロバイダは空状態のまま。
  useEffect(() => {
    void autoGenerateIfSafe();
  }, [status, autoGenerateIfSafe]);

  // muted を ref に同期（render 中の ref 書込みを避けつつ、再生エフェクトを再起動させない）。BGM/ナレーションへ即時反映（#388）。
  // 音量制御（≤1.0=要素 .muted／>1.0=GainNode）に一本化＝100%超でもミュートが効く（#452 P1）。
  useEffect(() => {
    mutedRef.current = muted;
    bgmCtlRef.current?.setMuted(muted);
    narrationCtlRef.current?.setMuted(muted);
    narrationGroupCtlsRef.current.forEach((c) => c.setMuted(muted)); // 同時グループ（並行）は全員へ
  }, [muted]);

  // unmount で共有 AudioContext を閉じる（#452 P1）。
  useEffect(() => () => closeAudioContext(audioCtxRef), []);

  const safeIdx = Math.min(idx, Math.max(0, scenes.length - 1));
  const current = scenes[safeIdx];
  // 字幕（ADR-0029・#386）は停止中/再生中とも書き出しと同じ sceneSegmentSpecs 由来にする（P1・パリティ）。
  // - FREE 字幕＝previewSubtitleSegment（停止中は先頭 t=0、再生中は有効行/間）。
  // - 通常テンプレの字幕レイヤー＝停止中は firstFrameBoundary（先頭正準フレーム・頭空白は subtitleText:null で非表示）、
  //   再生中は undefined＝activeLineIndex 駆動。どちらも「先頭正準セグメント」から導く（SceneEditScreen と同流儀）。
  // narrationAudioById は #382 に従い getState スナップショット読み（購読しない）＝activeLine/再生状態/場面が変わるたび再計算で追従。
  const previewSubtitleState = useMemo(() => {
    if (!current) return { segment: undefined, boundaryFrame: undefined };
    const durations = lineDurationsFromAudio(current, useProjectStore.getState().narrationAudioById);
    return {
      segment: previewSubtitleSegment(current, durations, activeLine, playing),
      boundaryFrame: !playing ? firstFrameBoundary(current, durations) : undefined,
    };
  }, [current, activeLine, playing]);
  // 現在の場面が変わったら、場面ジャンプの番号ストリップで今の場面を可視域へ寄せる（再生の進行にも追従・#413）。
  useEffect(() => {
    // scrollIntoView は一部環境（jsdom）に無いため任意呼び出し。
    activeJumpRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [safeIdx]);
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
  // 現在場面の動画スロット（アニメ適用可否＝書き出しと同一条件・ADR-0019／再生中の実映像描画＝#432 に使う）。
  const videoSlots = useMemo(
    () => (current && template ? findVideoSlots(current, template, (id) => assets.find((a) => a.assetId === id)) : []),
    [current, template, assets],
  );
  const hasVideoSlot = videoSlots.length > 0;
  // 再生用のクリップURL（asset://＝本体。サムネではない）を解決（#432）。非Tauri は null＝実映像なしでサムネのまま。
  // 解決結果は **URL と relPath を対で**保持し、照合は現在スロットの clipRelPath 一致時のみ（#432 P2）。
  // ＝場面送りで clipSig が変わり新URL解決が終わるまでの間、同じ slotLayerId（例 mainVisual）に前場面の旧URLがヒットして
  //  一瞬前の動画を流す事故を防ぐ（relPath 不一致なら旧URLを使わない＝新解決までサムネのまま）。
  const [clipUrlByLayer, setClipUrlByLayer] = useState<Record<string, { url: string; relPath: string }>>({});
  const clipSig = useMemo(
    () => JSON.stringify(videoSlots.map((s) => [s.slotLayerId, s.clipRelPath])),
    [videoSlots],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pid = meta.projectId;
      if (!pid || videoSlots.length === 0) {
        if (!cancelled) setClipUrlByLayer({});
        return;
      }
      const entries = await Promise.all(
        videoSlots.map(async (s) => [s.slotLayerId, s.clipRelPath, await assetDisplayUrl(pid, s.clipRelPath)] as const),
      );
      if (cancelled) return;
      const map: Record<string, { url: string; relPath: string }> = {};
      for (const [id, relPath, url] of entries) if (url) map[id] = { url, relPath };
      setClipUrlByLayer(map); // 全置換＝当場面のスロットぶんだけ残す（前場面の残骸を消す）
    })();
    return () => { cancelled = true; };
    // clipSig（スロットとクリップパスの実質変化）で解決＝場面送り/素材差し替えでのみ再解決。videoSlots は本文で参照するが、
    // 依存は clipSig（実質シグネチャ）に限定＝オブジェクト参照の毎レンダー変化で無駄に再解決/ちらつきを起こさないため（意図的）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSig, meta.projectId]);
  // ScenePreview へ渡す実映像再生情報（URL 解決済み **かつ 現在の clipRelPath と一致** するスロットのみ・#432 P2）。
  const videoPlaybackSlots: VideoSlotPlayback[] = useMemo(
    () => buildVideoPlaybackSlots(videoSlots, clipUrlByLayer),
    [videoSlots, clipUrlByLayer],
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
    // 実効表示尺は場面送りと同じく PREVIEW_MIN_PLAY_SEC でクランプ（アニメの再生窓を実際の表示時間に合わせる）。
    const dur = Math.max(PREVIEW_MIN_PLAY_SEC, current?.durationSec ?? 0);
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
  // 再生中に音量スライダーを動かしたときの現在値（subscribe 済み meta 由来）＝下の effect で即時反映する
  // （#465/#392）。current 未定義（0場面）でも resolveNarrationVolume が既定へ倒す。
  const liveNarrationVolume = resolveNarrationVolume(current?.audioMix, meta.voiceSettings);
  // いまの場面が「個別の声量/BGM」を持つか（§6＝個別設定が全体既定より優先）。持つ場面では全体スライダーを動かしても
  // その場面の音は変わらないため、下の音UIをその場面だけ無効化し理由＋「場面を直す」導線を出す（設定できるのに効かない
  // 誤認を防ぐ・#465 レビュー P1）。声・BGM は別個に判定する（声だけ個別なら BGM は操作可・その逆も）。
  const sceneNarrationOverride = hasSceneNarrationOverride(current?.audioMix); // 判定は書き出し画面と共有（§6・ADR-0026②）
  const sceneBgmOverride = current?.bgmSettings !== undefined;
  // 書き出し中は BGM 設定を変えられない（store も #570 P1 でガード＝ここは無言化を避ける proactive な無効化・ADR-0026④）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  // 「字幕を入れる」は書き出しと**同じ設定**（exportForm.withSubtitle）＝仕上がり確認と書き出しの字幕有無が必ず一致する
  // （ADR-0026③・#547 P2-7）。従来は確認が常に字幕ありで、字幕なし書き出しの見た目を確認できなかった。
  const withSubtitle = useProjectStore((s) => s.exportForm.withSubtitle);
  const setExportForm = useProjectStore((s) => s.setExportForm);
  // 音量を再生中の音声へその場で反映する（頭出ししない＝掛け合いも先頭行へ戻さない・#465/#392）。100% 境界
  // （要素 .volume ↔ GainNode）を跨ぐ変更も attachVolume が内部で経路を載せ替えて吸収するため、再生 effect は
  // 張り直さない＝音声だけ場面頭へ戻り映像/アニメ/テロップの時計と乖離する不整合を作らない（#465 レビュー P1）。
  useEffect(() => {
    narrationCtlRef.current?.setVolume(liveNarrationVolume);
    narrationGroupCtlsRef.current.forEach((c) => c.setVolume(liveNarrationVolume)); // 同時グループも全員
  }, [liveNarrationVolume]);
  useEffect(() => {
    bgmVolumeRef.current = bgmVolume;
    bgmCtlRef.current?.setVolume(bgmVolume);
  }, [bgmVolume]);

  // 再生中：現在の場面のナレーションを鳴らし、表示時間後に次の場面へ。範囲の終端で停止。
  // 掛け合い（明示 lines）は行ごとに音声を順に鳴らし、経過秒で有効行（字幕/フレーム）を切り替える（ADR-0015 PR-F2）。
  useEffect(() => {
    // 再生開始時点のスナップショット（#382）＝store の現在値を getState で読む（subscribe しない）。
    // 以降この再生セッションはこの値で進み、途中で scenes/narrationAudioById の参照が変わっても
    // effect は再起動しない（自動保存・声のBG生成で場面を頭からやり直さない）。
    // scenes/narrationAudioById はセッション開始時のスナップショット（#382）。音量（voiceSettings）だけは
    // readNarrationVolume で毎アタッチ時に最新値を読む＝再生中の変更を反映しつつ effect は再起動させない（#465/#392）。
    const { scenes: scenesSnap, narrationAudioById } = useProjectStore.getState();
    const sc = scenesSnap[safeIdx];
    if (!playing || !sc) return;
    // ナレーション音量を書き出しと同じ解決で適用（§6・#388/#452）。0〜1.5 の全域を attachVolume が反映する
    //（≤1.0=要素 .volume／>1.0=Web Audio GainNode で増幅）＝書き出し（FFmpeg volume=…）と一致（ADR-0026）。
    // 音量は各音声のアタッチ時に最新値を読む（getState＝effect は再起動しない＝#382 の非張り直し設計を保つ／
    // 再生中の音量変更は下の setVolume 即時反映＋100%境界跨ぎの張り直しで反映・#465/#392）。掛け合いの後続行にも効く。
    const readNarrationVolume = () => resolveNarrationVolume(sc.audioMix, useProjectStore.getState().meta.voiceSettings);
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
      const lineControls: VolumeControl[] = []; // 各行の音量制御。cleanup で GainNode グラフを切る（#465 P2）。
      let groupAudios: HTMLAudioElement[] = []; // いま鳴っている同時グループ（新グループ開始でまとめて止める・ADR-0031）
      narrationGroupCtlsRef.current = [];
      let cancelled = false; // クリーンアップ後に遅延スケジュールが走らないようにする。
      // 行を順に再生する“連鎖”。次の行への送りは「この行の窓（次の開始−この開始）」ぶん後だが、
      // その計測を**この行が実際に鳴り始めてから**にする＝再生開始の遅延で末尾が切れない（#掛け合い・①）。
      // 固定タイマー（場面頭からの絶対秒）だと、音声が遅れて鳴り始めたぶん前の行を早く止めて途切れていた。
      // 編集画面の全文再生・書き出しの行連結（各行を丸ごと連結）とパリティが取れる。
      // 同時開始（ADR-0031）：開始秒が直前と同じ segs は「同時グループ」＝前を止めず重ねて流す（窓0で連鎖）。
      const playLine = (i: number): void => {
        if (cancelled || i >= segs.length) return;
        // フィルタ済み segs では開始秒一致⟺同一グループ（各グループ開始＝前グループ末で厳密に増加）。
        const simulWithPrev = i > 0 && segs[i].startSec === segs[i - 1].startSec;
        if (!simulWithPrev) {
          groupAudios.forEach((a) => a.pause()); // 前グループを止めてから次へ（被り防止）。同時グループ内では止めない。
          groupAudios = [];
          narrationGroupCtlsRef.current = [];
          // 有効行＝グループの primary（アンカー）。同時メンバーでは変えない＝字幕はグループ spec で解決（並行の段積み）。
          // segs と sc.lines のズレに依らず lineId で実体の行 index を引く（誤字幕防止・M-2）。
          const lineIdx = lines.findIndex((l) => l.lineId === segs[i].lineId);
          setActiveLine(lineIdx >= 0 ? lineIdx : 0);
        }
        const scheduleNext = (): void => {
          if (cancelled) return;
          // 中間行（次の行へ）も最終行（場面送り）も**同じ送りタイマー＝同じ窓の決め方**（#608・`lineAdvanceWindowSec`）。
          // 最終行は「この行の窓＝場面末まで」ぶん後に送る。場面送りも実再生起点にそろえ、行が増えて遅延が
          // 積み上がっても最終行の末尾が場面遷移で切れない（#370 レビュー対応）。
          const windowSec = lineAdvanceWindowSec(segs, i);
          const next = i + 1 < segs.length ? () => playLine(i + 1) : advance;
          lineTimers.push(window.setTimeout(next, windowSec * 1000));
        };
        const u = narrationAudioById[lineAudioKey(sc.sceneId, segs[i].lineId)];
        if (u) {
          // 常に生成し attachVolume（≤1.0=.volume／>1.0=GainNode）で音量/ミュートを制御＝書き出しと一致＋即時ミュート（#452 P1）。
          const audio = new Audio(u);
          narrationAudioRef.current = audio;
          const ctl = attachVolume(audioCtxRef, audio, readNarrationVolume(), mutedRef.current);
          narrationCtlRef.current = ctl;
          lineAudios.push(audio);
          lineControls.push(ctl);
          groupAudios.push(audio); // 同時グループの一員＝次グループ開始時にまとめて止める
          narrationGroupCtlsRef.current.push(ctl); // ライブ音量/ミュートを全員へ
          // play() の解決＝再生開始。そこから窓を測って次へ。resolve/reject いずれでも一度だけ進む。
          void audio.play().then(scheduleNext, (e) => {
            // 停止・場面送り・行切替で中断された AbortError は正常系＝偽の失敗通知/ログ汚染にしない
            // （単一ナレーション/BGM と同挙動・#392 レビュー）。進行は既存の scheduleNext（cancelled guard）に委ねる。
            if (!(e instanceof DOMException && e.name === "AbortError")) {
              console.warn("[PreviewScreen] 音声再生に失敗", e);
              setNarrationPlayWarning(true); // 裏で失敗させず利用者に通知（§2-5・#452 P2）
            }
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
        lineTimers.push(window.setTimeout(advance, Math.max(PREVIEW_MIN_PLAY_SEC, sc.durationSec) * 1000));
      }
      return () => {
        cancelled = true;
        lineTimers.forEach((t) => window.clearTimeout(t));
        lineAudios.forEach((a) => a.pause());
        lineControls.forEach((c) => c.dispose()); // 共有 ctx に古い source/gain を残さない（#465 P2）
        narrationAudioRef.current = null;
        narrationCtlRef.current = null;
        narrationGroupCtlsRef.current = []; // 同時グループ参照も掃除（disposeは lineControls 側で実施済み）
        setActiveLine(0);
      };
    }

    // 単一 narration（従来）。場面尺の固定タイマーで次の場面へ。
    const endTimer = window.setTimeout(advance, Math.max(PREVIEW_MIN_PLAY_SEC, sc.durationSec) * 1000);
    let audio: HTMLAudioElement | undefined;
    const url = narrationAudioById[sc.sceneId];
    if (url) {
      // 常に生成し attachVolume（≤1.0=.volume／>1.0=GainNode）で音量/ミュートを制御＝書き出しと一致＋即時ミュート（#452 P1）。
      audio = new Audio(url);
      narrationAudioRef.current = audio;
      narrationCtlRef.current = attachVolume(audioCtxRef, audio, readNarrationVolume(), mutedRef.current);
      void audio.play().catch((e) => {
        // 停止・場面送りで再生が中断された AbortError は正常系＝偽の失敗通知/ログ汚染にしない（#392）。
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.warn("[PreviewScreen] 音声再生に失敗", e);
        setNarrationPlayWarning(true); // 裏で失敗させず利用者に通知（§2-5・#452 P2）
      });
    }
    return () => {
      window.clearTimeout(endTimer);
      audio?.pause();
      narrationCtlRef.current?.dispose(); // 共有 ctx に古い source/gain を残さない（#465 P2）
      narrationAudioRef.current = null;
      narrationCtlRef.current = null;
    };
    // deps はプリミティブのみ（#382）：scenes/narrationAudioById は上の getState でスナップショット読みするため
    // deps に含めない＝自動保存・声のBG生成での参照変化で再生を頭からやり直さない。endIdx は値が変わったときだけ再構成（範囲変更）。
    // 音量変更では再起動しない＝上の setVolume が経路の載せ替え（100%境界）も含めその場で反映する（映像/アニメ/テロップの
    // 時計と乖離させない・掛け合いも頭出ししない・#382 を保つ・#465 レビュー P1）。
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
      bgmAudioRef.current = a;
      // 100%超（最大150%）も書き出しと一致させる（≤1.0=.volume／>1.0=GainNode・#452 P1）。
      bgmCtlRef.current = attachVolume(audioCtxRef, a, bgmVolumeRef.current, mutedRef.current);
      void a.play().catch((e) => {
        // 停止・曲切替で中断された AbortError は正常系＝偽の失敗通知/ログ汚染にしない（#392）。
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.warn("[PreviewScreen] BGM再生に失敗", e);
        if (!cancelled) setBgmPlayWarning(true);
      });
    })();
    return () => {
      cancelled = true;
      bgmAudioRef.current?.pause();
      bgmCtlRef.current?.dispose(); // 共有 ctx に古い source/gain を残さない（#465 P2）
      bgmAudioRef.current = null;
      bgmCtlRef.current = null;
    };
    // deps は源（bundledBgm/bgmAsset）と有効のプリミティブ＝同じ曲が続く場面送りでは再起動せず鳴らし続ける。
    // 音量変更では再起動しない＝上の setVolume が経路の載せ替え（100%境界）も含めその場で反映する（曲を頭出ししない・#465/#392）。
  }, [playing, bgmEnabled, bundledBgm, bgmAsset, meta.projectId]);

  // 場面ゼロ（たたき台を作る前に入った等）は、壊れて見える空プレビューではなく作成導線を出す（#392）。
  if (scenes.length === 0) {
    return (
      <div className="main-scroll">
        <PageHead title="仕上がり確認" desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。" />
        <div className="row gap-sm" style={{ margin: "0 0 var(--gap)", alignItems: "center" }}>
          <button className="btn btn-ghost btn-icon" onClick={() => onNavigate(previewBackTo)}>
            <ArrowLeftIcon size={16} />
            {PREVIEW_BACK_LABEL[previewBackTo]}
          </button>
        </div>
        <NoScenesState purpose="ここで仕上がりを確認できます" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="仕上がり確認"
        desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。"
      />
      <ExportLockBanner onNavigate={onNavigate} />

      {/* 多入口（たたき台/場面編集/書き出し）のため、開いた側が記録した「来た画面」へ戻る（#410 sub3・タイムライン編集と同じ上左パターン）。 */}
      <div className="row gap-sm" style={{ margin: "0 0 var(--gap)", alignItems: "center" }}>
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate(previewBackTo)}>
          <ArrowLeftIcon size={16} />
          {PREVIEW_BACK_LABEL[previewBackTo]}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 大きな確認エリア */}
        <div className="card">
          <ScenePreview
            scene={current}
            template={template}
            activeLineIndex={activeLine}
            subtitleSegment={previewSubtitleState.segment}
            boundaryFrame={previewSubtitleState.boundaryFrame}
            telops={activeTelops}
            timeSec={animTimeSec}
            animations={previewAnimations}
            videoPlayback={{ playing, muted, slots: videoPlaybackSlots }}
            hideSubtitles={!withSubtitle}
          />

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

          {/* 場面ジャンプ（#413）＝番号を押すとその場面へ跳ぶ。20場面で「次の場面」を連打しなくてよい。
              再生中は他の送り（前へ/次へ）と同様に無効（停止してから跳ぶ）。今の場面を強調＋可視域へスクロール。 */}
          {scenes.length > 1 && (
            <div className="row" style={{ gap: 4, overflowX: "auto", marginTop: 8, paddingBottom: 4 }}>
              {scenes.map((s, i) => (
                <button
                  key={s.sceneId}
                  ref={i === safeIdx ? activeJumpRef : undefined}
                  className={`btn btn-icon text-sm ${i === safeIdx ? "btn-secondary" : "btn-ghost"}`}
                  onClick={() => setIdx(i)}
                  disabled={playing}
                  aria-label={`場面${i + 1}へ移動`}
                  aria-current={i === safeIdx ? "true" : undefined}
                  title={`場面 ${i + 1}`}
                  style={{ flexShrink: 0, minWidth: 34 }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          <div className="preview-controls">
            <button
              className="btn btn-icon btn-secondary"
              aria-label="再生"
              onClick={() => {
                setBgmPlayWarning(false); // 再生のたびに前回の警告をクリア（effect 内同期 setState を避ける）
                setNarrationPlayWarning(false); // ナレーション再生失敗の警告も同様にクリア（#452 P2）
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
              {muted ? <VolumeMuteIcon size={20} /> : <VolumeIcon size={20} />}
            </button>
          </div>

          {/* 字幕を入れるか（#547 P2-7）。書き出しの「字幕を入れる」と同じ設定なので、ここで消せば書き出しも字幕なしになる
              ＝確認した見た目のまま書き出せる（ADR-0026③）。再生中も即反映（同じ layoutScene 由来）。 */}
          <div className="row gap-sm mt" style={{ alignItems: "center" }}>
            <Switch on={withSubtitle} onChange={(v) => setExportForm({ withSubtitle: v })} label="字幕を入れる" disabled={isExporting} />
            <span className="text-sm text-muted">オフにすると字幕なしの仕上がりを確認できます（書き出しにも反映）。</span>
          </div>

          {bgmPlayWarning && (
            <div className="notice notice-warn mt" role="alert">
              <span>BGMを再生できませんでした。別のBGMを選ぶか、もう一度お試しください。</span>
            </div>
          )}
          {narrationPlayWarning && (
            <div className="notice notice-warn mt" role="alert">
              <span>声を再生できませんでした。声を作り直すか、もう一度お試しください。</span>
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
          <h2 className="section-title">音</h2>
          <p className="field-hint" style={{ marginTop: 0 }}>
            音楽と読み上げの声の大きさを整えて、バランスを確かめられます。
          </p>
          <BgmPicker
            disabled={sceneBgmOverride || isExporting}
            note={
              isExporting
                ? "書き出し中はBGMを変えられません。書き出しが終わってからお試しください。"
                : sceneBgmOverride
                  ? "いまの場面は個別のBGMが設定されています。下の「場面を直す」で変えられます。"
                  : undefined
            }
          />
          {/* ナレーション音量をここに併置（#407）＝BGM とのバランスを調整できる。声・BGM とも再生中はその場で反映する
              （#465/#392）。ただし「いまの場面が個別の声量/BGM」のときは全体スライダーでは変わらない（§6＝個別が優先）ため、
              その場面だけ無効化し理由＋下の「場面を直す」導線を出す（設定できるのに効かない誤認を防ぐ・#465 レビュー P1）。 */}
          <div style={{ marginTop: "var(--gap)" }}>
            <NarrationVolumeControl
              volume={liveNarrationVolume}
              onChange={(v) => updateVoiceSettings({ volume: v })}
              disabled={sceneNarrationOverride || isExporting}
              hint={
                isExporting
                  ? "書き出し中は声の大きさを変えられません。書き出しが終わってからお試しください。"
                  : sceneNarrationOverride
                    ? "いまの場面は個別の声量が設定されています。下の「場面を直す」で変えられます。"
                    : "読み上げの声の大きさです。再生しながらでもその場で変わります。"
              }
            />
          </div>

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
