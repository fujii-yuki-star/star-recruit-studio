// あなた向け会社説明の**学生の簡易場面編集**（ADR-0061 追補 2026-11-06）。
//
// 本来の場面編集と**同じ部品**を使う＝場面の並びのカード（`SceneThumb`・掴んで並べ替え `useDragReorder`）・
// 仕上がり確認の絵（`ScenePreview`・動き `useSceneMotionPreview`）・声の欄（`SpeakerSelect`）。編集するのは**一時の動画**（store に開いてある）。
//
// 学生ができること＝**並べ替え・外す・場面ごとの声**（文字や見た目パターンは変えさせない＝会社の説明の中身を変えない）。
// ⚠️ **最後の場面（締め）はいつも最後**＝並べ替え・外すの対象にしない。
// ⚠️ 学生には「場面」と言わない＝「パート」と呼ぶ（決定3＝編集ソフトの言葉を出さない）。
import { useEffect, useMemo, useRef, useState } from "react";
import { sceneLines, narrationAudioKey } from "../../domain/project/narrationLines";
import { NARRATION_STATUS, ORIENTATION } from "../../domain/enums";
import type { Scene } from "../../domain/project/types";
import { briefingMoveTarget } from "../../domain/briefing/closing";
import { SceneThumb } from "../components/SceneThumb";
import { ScenePreview } from "../components/ScenePreview";
import { SpeakerSelect } from "../components/SpeakerSelect";
import { useDragReorder } from "../hooks/useDragReorder";
import { useSceneMotionPreview } from "../hooks/useSceneMotionPreview";
import { useVoiceCatalog } from "../hooks/useVoiceCatalog";
import { useProjectStore } from "../store/projectStore";

function minutesLabel(sec: number): string {
  return `約 ${Math.max(1, Math.round(sec / 60))} 分`;
}

/** 締めのパートの名前（見出しを持たない＝そのままだと「文字のないパート」になる・実機で確かめた）。 */
const CLOSING_PART_TITLE = "最後のひとこと";

/** 学生に見せるパートの名前（見出し・無ければ話す文の頭）。 */
function partTitle(scene: Scene): string {
  const t = (scene.texts.title ?? "").trim();
  if (t) return t;
  const first = sceneLines(scene).map((l) => l.text.trim()).find((x) => x.length > 0) ?? "";
  return first.slice(0, 24) || "（文字のないパート）";
}

export function BriefingStudentEditor({
  onMake,
  onAnother,
  onRestart,
}: {
  /** 「この内容で作る」。 */
  onMake: () => void;
  /** 「別の案を作る」。 */
  onAnother: () => void;
  /** 「選び直す」。 */
  onRestart: () => void;
}) {
  const scenes = useProjectStore((s) => s.scenes);
  const templates = useProjectStore((s) => s.templates);
  const assets = useProjectStore((s) => s.assets);
  const overlayAnimations = useProjectStore((s) => s.meta.timelineOverlay?.animations);
  const narrationAudioById = useProjectStore((s) => s.narrationAudioById);
  const generating = useProjectStore((s) => s.isGeneratingNarration);
  const voices = useVoiceCatalog();
  const portrait = useProjectStore((s) => s.meta.videoSettings.aspectRatio) === ORIENTATION.portrait;
  const [selectedId, setSelectedId] = useState<string>(() => useProjectStore.getState().scenes[0]?.sceneId ?? "");
  const stripRef = useRef<HTMLDivElement>(null);

  // 締め＝いつも最後の1つ。動かせるのはその手前まで。
  const closingId = scenes.at(-1)?.sceneId ?? "";
  const movable = scenes.filter((s) => s.sceneId !== closingId);
  const selected = scenes.find((s) => s.sceneId === selectedId) ?? scenes[0];
  const template = templates.find((t) => t.templateId === selected?.templateId);
  const isClosing = selected?.sceneId === closingId;
  const totalSec = scenes.reduce((t, s) => t + s.durationSec, 0);
  const titleOf = (s: Scene): string => (s.sceneId === closingId ? CLOSING_PART_TITLE : partTitle(s));
  // 声を作り直している最中か（声を変えた直後＝1つずつ作る道は `isGeneratingNarration` を立てない）。
  const voiceBusy = (s: Scene | undefined): boolean => !!s && sceneLines(s).some((l) => l.status === NARRATION_STATUS.pending);
  const anyBusy = generating || scenes.some((s) => voiceBusy(s));

  const dnd = useDragReorder(
    (fromId, toIndex) => {
      if (fromId === closingId) return;
      useProjectStore.getState().moveSceneToIndex(fromId, briefingMoveTarget(toIndex, scenes.length));
    },
    { axis: "x", scroller: () => stripRef.current },
  );

  // 声つきの再生＝動きは `useSceneMotionPreview`、声はその場面の行を順に鳴らす（場面編集と同じ音を使う）。
  const motion = useSceneMotionPreview(selected, template, assets, overlayAnimations);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const stopAll = (): void => {
    audioRef.current?.pause();
    audioRef.current = null;
    motion.stop();
    setPlaying(false);
  };
  const play = (): void => {
    if (!selected) return;
    stopAll();
    const urls = sceneLines(selected)
      .map((l) => narrationAudioById[narrationAudioKey(selected, l.lineId)])
      .filter((u): u is string => !!u);
    setPlaying(true);
    if (motion.animActive) motion.play();
    const next = (i: number): void => {
      if (i >= urls.length) {
        audioRef.current = null;
        setPlaying(false);
        return;
      }
      const a = new Audio(urls[i]);
      audioRef.current = a;
      a.onended = () => next(i + 1);
      a.onerror = () => next(i + 1);
      void a.play().catch(() => next(i + 1));
    };
    next(0);
  };
  // 選び直したら止める。
  useEffect(() => () => { audioRef.current?.pause(); }, [selectedId]);

  const changeSpeaker = (speaker: number | null): void => {
    if (!selected) return;
    const st = useProjectStore.getState();
    if ((selected.narration.speaker ?? null) === speaker) return;
    st.updateScene(selected.sceneId, (s) => ({ ...s, narration: { ...s.narration, speaker, status: NARRATION_STATUS.none } }));
    // 声を変えたらすぐ作り直す（再生で新しい声を聞ける）。
    void st.generateNarration(selected.sceneId);
  };

  const remove = (sceneId: string): void => {
    if (sceneId === closingId || movable.length <= 1) return;
    stopAll();
    const idx = scenes.findIndex((s) => s.sceneId === sceneId);
    useProjectStore.getState().removeScene(sceneId);
    const rest = useProjectStore.getState().scenes;
    setSelectedId(rest[Math.min(idx, rest.length - 1)]?.sceneId ?? "");
  };

  const single = useMemo(() => !!selected && (selected.lines?.length ?? 0) === 0 && selected.narration.text.trim().length > 0, [selected]);

  return (
    <div className="col gap-lg">
      <div className="row gap-sm" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 className="briefing-student-q grow">この内容で作ります。順番を入れ替えたり、外したり、声を変えたりできます</h2>
        <span>長さ：{minutesLabel(totalSec)}</span>
      </div>

      <div className="briefing-editor-main">
        <div className="briefing-editor-preview">
          {/* ⚠️ 絵は「いちばん近いスクロールする枠の下端」まで広がる（`ScenePreview`）＝高さの決まった枠で包む
              （包まないと画面いっぱいに広がり、下のパートの並びが見えなくなる＝実機で確かめた）。 */}
          <div className="briefing-editor-stage">
            <ScenePreview
              scene={selected}
              template={template}
              showSafeArea={false}
              {...(motion.animActive && motion.playing ? { timeSec: motion.timeSec, animations: motion.previewAnimations } : {})}
            />
          </div>
          <div className="row gap-sm">
            {playing ? (
              <button type="button" className="btn btn-secondary" onClick={stopAll}>止める</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={play} disabled={!selected || voiceBusy(selected)}>このパートを再生</button>
            )}
            {anyBusy && <span className="text-sm" role="status">声を作っています…</span>}
          </div>
        </div>
        <aside className="card col gap-sm briefing-editor-side">
          <h3 className="section-title">{selected ? titleOf(selected) : ""}</h3>
          {isClosing ? (
            <p className="text-sm">最後のパートです（いつも最後に入ります）。</p>
          ) : (
            <>
              {single && <SpeakerSelect value={selected?.narration.speaker} voices={voices} ariaLabel="このパートの声" onChange={changeSpeaker} />}
              {!single && <p className="text-sm">このパートは何人かで話すので、声はそのままです。</p>}
              <button type="button" className="btn btn-ghost" onClick={() => selected && remove(selected.sceneId)} disabled={movable.length <= 1}>
                このパートを外す
              </button>
            </>
          )}
        </aside>
      </div>

      {/* 縦の動画はカードを細くする（同じ幅だと絵が縦に長く、並びが画面の下へはみ出した＝実機）。 */}
      <div className={`briefing-editor-strip${portrait ? " portrait" : ""}`} ref={stripRef} role="list" aria-label="パートの並び">
        {scenes.map((s, i) => {
          const t = templates.find((x) => x.templateId === s.templateId);
          const closing = s.sceneId === closingId;
          return (
            <div key={s.sceneId} role="listitem" className="briefing-editor-item">
              {dnd.draggingId && dnd.overGap === i && <span className="drop-line" aria-hidden />}
              <button
                type="button"
                className={`scene-card${selected?.sceneId === s.sceneId ? " selected" : ""}`}
                onClick={() => { stopAll(); setSelectedId(s.sceneId); }}
                {...(closing ? {} : dnd.dropProps(i))}
                style={{ opacity: dnd.draggingId === s.sceneId ? "var(--drag-source-opacity)" : undefined }}
                aria-label={`${i + 1}. ${titleOf(s)}`}
              >
                {!closing && (
                  <div style={{ textAlign: "center", lineHeight: 1, marginBottom: 4 }}>
                    <span {...dnd.handleProps(s.sceneId, i)} aria-hidden="true" title="つまんで並び替え" style={{ cursor: "grab", touchAction: "none", userSelect: "none", color: "var(--color-text-faint)" }}>⠿</span>
                  </div>
                )}
                {t && <SceneThumb scene={s} template={t} />}
                <div className="text-sm">{i + 1}. {titleOf(s)}</div>
              </button>
              {!closing && (
                <div className="row gap-xs" style={{ justifyContent: "center" }}>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`「${partTitle(s)}」を前へ`} disabled={i === 0} onClick={() => useProjectStore.getState().moveScene(s.sceneId, "up")}>←</button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`「${partTitle(s)}」を後ろへ`} disabled={i >= movable.length - 1} onClick={() => useProjectStore.getState().moveScene(s.sceneId, "down")}>→</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row gap-sm">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => { stopAll(); onMake(); }} disabled={anyBusy}>この内容で作る</button>
        <button type="button" className="btn btn-secondary" onClick={() => { stopAll(); onAnother(); }}>別の案を作る</button>
        <button type="button" className="btn btn-ghost" onClick={() => { stopAll(); onRestart(); }}>選び直す</button>
      </div>
    </div>
  );
}
