// あなた向け会社説明の学生の画面（β・ADR-0061 決定3）＝全画面の専用モード。左の帯・ほかの画面は出さない。
//
// 1. 興味を選ぶ（カード・複数）と長さ → 2. 組む → 3. 確かめる（ON/OFF だけ・おおよその長さ・別の案）→
// 4. 作る（一時の動画・声・仕上げ）→ 5. 見る（仕上げた動画をその場で再生）→ 6. 終わる（この回のデータを消す）。
//
// ⚠️ **学生に向けた言葉**＝「場面」「書き出し」「見た目パターン」を出さない（§2-3・決定3）。
// ⚠️ **仕上げは書き出しの画面と同じ道**（ADR-0007）＝書き出しの画面を裏で動かす（保存先だけ渡す・`internal`）。
// ⚠️ **抜けるのは担当者の 4 桁の番号**・番号を忘れたらアプリを閉じれば抜けられる（利用者判断 2026-11-05）。
// ⚠️ **学生の名前・属性は入力させない**（決定6）。
import { useEffect, useMemo, useRef, useState } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BRIEFING_LENGTH, BRIEFING_LENGTHS, briefingVoiceChoices, type BriefingCandidate, type BriefingLength } from "../../domain/briefing/compose";
import { isCompanyOkVoiceCharacter, VOICE_CATALOG } from "../../domain/voice/voiceCatalog";
import type { BriefingCatalog } from "../../domain/briefing/catalog";
import { BRIEFING_CLOSING_DURATION_SEC, EXPORT_SIZE } from "../../domain/constants";
import { EXPORT_RUN_PHASE, exportOverallPercent } from "../../domain/export/exportProgress";
import { sceneUngeneratedVoices } from "../../domain/startup/startupReadiness";
import type { Project } from "../../domain/project/types";
import { TEMPORARY_SESSIONS_DIR_NAME } from "../../infrastructure/projectLocation";
import { deleteBriefingSession } from "../../infrastructure/briefingSessionFs";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useBriefingStudentStore } from "../store/briefingStudentStore";
import {
  BriefingPrepareError,
  cleanupStaleBriefingSessions,
  composeForStudent,
  loadBriefingSources,
  prepareBriefingVideo,
  withLastProjectKept,
} from "../briefing/briefingRun";
import { ExportScreen } from "./ExportScreen";
import {
  BRIEFING_EXIT_CODE_WRONG_MESSAGE,
  BRIEFING_EXPORT_FAILED_MESSAGE,
  BRIEFING_LENGTH_LABEL,
  BRIEFING_NO_SCENES_MESSAGE,
  BRIEFING_SESSION_PREPARE_FAILED_MESSAGE,
} from "../uiLabels";

type Step = "choose" | "composing" | "review" | "making" | "watch" | "error";

/** 片づけを回す間隔（1 時間ごと・ADR-0061 決定5）。 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 仕上げた動画の名前（一時の動画のフォルダの直下に置く＝消すとき一緒に消える）。 */
const OUTPUT_FILE_NAME = "briefing.mp4";

function minutesLabel(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  return `約 ${min} 分`;
}

export function BriefingStudentScreen({ catalog }: { catalog: BriefingCatalog }) {
  const templates = useProjectStore((s) => s.templates);
  const exportRun = useProjectStore((s) => s.exportRun);
  const [step, setStep] = useState<Step>("choose");
  const [chosen, setChosen] = useState<string[]>([]);
  const [length, setLength] = useState<BriefingLength>(BRIEFING_LENGTH.normal);
  // 話す声（null＝元の動画の声のまま・ADR-0073＝単独の語りだけその声で作り直す）。
  const [speaker, setSpeaker] = useState<number | null>(null);
  const voiceChoices = useMemo(() => briefingVoiceChoices(VOICE_CATALOG, isCompanyOkVoiceCharacter), []);
  const [docs, setDocs] = useState<Project[] | null>(null);
  const [picks, setPicks] = useState<BriefingCandidate[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [errorText, setErrorText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitCode, setExitCode] = useState("");
  const [exitError, setExitError] = useState("");
  // 画面を離れるときに消すため（番号で抜けた）。⚠️ 描画中には書かない（作った・消したときに書く）。
  const sessionRef = useRef<string | null>(null);

  // 開いた時・1 時間ごとに、24 時間を過ぎた一時の動画を片づける（決定5）。
  useEffect(() => {
    void cleanupStaleBriefingSessions();
    const t = window.setInterval(() => void cleanupStaleBriefingSessions(), CLEANUP_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);
  // 画面を離れるとき（番号で抜けた）、この回の一時の動画を消す。
  useEffect(() => () => {
    const id = sessionRef.current;
    if (id) void deleteBriefingSession(id).catch(() => {});
  }, []);

  const kept = picks.filter((c) => !off.has(c.key));
  const totalSec = kept.reduce((t, c) => t + c.durationSec, 0) + BRIEFING_CLOSING_DURATION_SEC;
  const interestLabel = useMemo(() => new Map(catalog.interests.map((i) => [i.interestId, i.label])), [catalog]);

  const toggleInterest = (id: string): void =>
    setChosen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function compose(): Promise<void> {
    setStep("composing");
    try {
      const sources = docs ?? (await loadBriefingSources(catalog));
      setDocs(sources);
      // 並びは登録の興味の順（学生が押した順に左右されない）。
      const ordered = catalog.interests.map((i) => i.interestId).filter((id) => chosen.includes(id));
      const result = await composeForStudent(catalog, sources, ordered, length);
      if (result.picks.length === 0) {
        setErrorText(BRIEFING_NO_SCENES_MESSAGE);
        setStep("error");
        return;
      }
      setPicks(result.picks);
      setOff(new Set());
      setStep("review");
    } catch (e) {
      console.error("[briefing] 組めませんでした:", e);
      setErrorText(BRIEFING_SESSION_PREPARE_FAILED_MESSAGE);
      setStep("error");
    }
  }

  async function make(): Promise<void> {
    setStep("making");
    try {
      const id = await prepareBriefingVideo({ catalog, docs: docs ?? [], picks: kept, templates, speaker, now: new Date() });
      setSessionId(id);
      sessionRef.current = id;
      await withLastProjectKept(() => useProjectStore.getState().loadProject(id));
      // 声がまだの行（原本で作っていなかった）があれば作る。⚠️ 原本の声はそのまま使う（作り直さない）。
      const st = useProjectStore.getState();
      if (sceneUngeneratedVoices(st.scenes, (key) => st.narrationAudioById[key] != null) > 0) {
        await st.generateAllNarrations();
        await st.saveProject();
      }
      const out = await join(await appDataDir(), TEMPORARY_SESSIONS_DIR_NAME, id, OUTPUT_FILE_NAME);
      useProjectStore.getState().setExportForm({ fileName: "briefing", size: EXPORT_SIZE.full, withSubtitle: true });
      useStartupJobStore.getState().setPendingExport(out, false, true);
      setExporting(true);
    } catch (e) {
      setErrorText(e instanceof BriefingPrepareError ? e.message : BRIEFING_SESSION_PREPARE_FAILED_MESSAGE);
      if (!(e instanceof BriefingPrepareError)) console.error("[briefing] 作れませんでした:", e);
      setStep("error");
    }
  }

  // 裏で動かした書き出しの画面の終わりを受ける（store の変化を購読＝描画のたびに見ない）。
  useEffect(() => {
    if (!exporting) return;
    return useProjectStore.subscribe((st) => {
      const run = st.exportRun;
      if (run.phase === EXPORT_RUN_PHASE.done && run.resultPath) {
        setExporting(false);
        setVideoUrl(`${convertFileSrc(run.resultPath)}?t=${Date.now()}`);
        setStep("watch");
      } else if (run.phase === EXPORT_RUN_PHASE.error || run.phase === EXPORT_RUN_PHASE.cancelled || run.phase === EXPORT_RUN_PHASE.unsupported) {
        setExporting(false);
        console.error("[briefing] 仕上げられませんでした:", run.message);
        setErrorText(BRIEFING_EXPORT_FAILED_MESSAGE);
        setStep("error");
      }
    });
  }, [exporting]);

  /** この回を終える＝一時の動画を消して最初へ（学生が「終わる」を押した・やり直す）。 */
  async function finish(): Promise<void> {
    const id = sessionId;
    setSessionId(null);
    sessionRef.current = null;
    setVideoUrl(null);
    setPicks([]);
    setOff(new Set());
    setChosen([]);
    setSpeaker(null);
    setErrorText("");
    setStep("choose");
    // 開いていた一時の動画を閉じる（消した動画を編集画面に残さない）。⚠️ 書き出しの結果も一緒に落ちる（`newProject` が戻す）＝
    //   抜けたあと編集の画面に「書き出しました」の知らせが残らない。
    useProjectStore.getState().newProject();
    if (id) await deleteBriefingSession(id).catch((e) => console.warn("[briefing] 消せませんでした（24 時間で消えます）:", e));
  }

  function tryExit(): void {
    if (catalog.exitCode != null && exitCode === catalog.exitCode) {
      void finish().then(() => useBriefingStudentStore.getState().exit());
      return;
    }
    setExitError(BRIEFING_EXIT_CODE_WRONG_MESSAGE);
    setExitCode("");
  }

  const busy = step === "composing" || step === "making";
  const percent = exporting ? exportOverallPercent(exportRun) : null;

  return (
    <div className="briefing-student">
      <header className="briefing-student-head">
        <h1 className="briefing-student-title">あなた向けの会社説明</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setExitOpen(true); setExitError(""); setExitCode(""); }} disabled={busy}>
          担当の人へ
        </button>
      </header>

      {exitOpen && (
        <form className="card col gap-sm briefing-student-exit" role="dialog" aria-label="担当の人の番号" onSubmit={(e) => { e.preventDefault(); tryExit(); }}>
          <label className="col gap-xs">
            <span>担当の人の番号（4 桁）</span>
            <input
              className="input"
              inputMode="numeric"
              type="password"
              maxLength={4}
              value={exitCode}
              autoFocus
              aria-label="担当の人の番号（4 桁）"
              onChange={(e) => setExitCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          {exitError && <div className="notice notice-warn" role="alert">{exitError}</div>}
          <div className="row gap-sm">
            <button type="button" className="btn btn-ghost" onClick={() => setExitOpen(false)}>やめる</button>
            <button type="submit" className="btn btn-primary" disabled={exitCode.length !== 4}>抜ける</button>
          </div>
        </form>
      )}

      <main className="briefing-student-body">
        {step === "choose" && (
          <div className="col gap-lg">
            <section className="col gap-sm">
              <h2 className="briefing-student-q">知りたいことを選んでください（いくつでも）</h2>
              <div className="briefing-student-cards" role="group" aria-label="知りたいこと">
                {catalog.interests.map((i) => (
                  <button
                    key={i.interestId}
                    type="button"
                    className="briefing-student-card"
                    aria-pressed={chosen.includes(i.interestId)}
                    onClick={() => toggleInterest(i.interestId)}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </section>
            <section className="col gap-sm">
              <h2 className="briefing-student-q">長さ</h2>
              <div className="row gap-sm" role="radiogroup" aria-label="長さ">
                {BRIEFING_LENGTHS.map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={length === l} className="briefing-student-card" onClick={() => setLength(l)}>
                    {BRIEFING_LENGTH_LABEL[l]}
                  </button>
                ))}
              </div>
            </section>
            <section className="col gap-sm">
              <h2 className="briefing-student-q">話す声</h2>
              <div className="briefing-student-cards" role="radiogroup" aria-label="話す声">
                <button type="button" role="radio" aria-checked={speaker == null} className="briefing-student-card" onClick={() => setSpeaker(null)}>
                  いつもの声
                </button>
                {voiceChoices.map((v) => (
                  <button key={v.speaker} type="button" role="radio" aria-checked={speaker === v.speaker} className="briefing-student-card" onClick={() => setSpeaker(v.speaker)}>
                    {v.character}
                  </button>
                ))}
              </div>
            </section>
            <div>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void compose()} disabled={chosen.length === 0}>
                説明動画を組む
              </button>
            </div>
          </div>
        )}

        {step === "composing" && <p className="briefing-student-wait" role="status">あなたに合わせて組み立てています…</p>}

        {step === "review" && (
          <div className="col gap-lg">
            <h2 className="briefing-student-q">この内容で作ります（見たくないものは外せます）</h2>
            <ul className="col gap-xs briefing-student-list">
              {picks.map((c) => (
                <li key={c.key}>
                  <label className="row gap-sm">
                    <input type="checkbox" checked={!off.has(c.key)} onChange={() => setOff((cur) => { const n = new Set(cur); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
                    <span className="grow">{c.title}</span>
                    <span className="text-sm">{c.matched.map((id) => interestLabel.get(id)).filter(Boolean).join("・")}</span>
                  </label>
                </li>
              ))}
              <li className="text-sm">最後に、この動画をどう作ったかのひとこと（外せません）</li>
            </ul>
            <p>長さ：{minutesLabel(totalSec)}</p>
            <div className="row gap-sm">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void make()} disabled={kept.length === 0}>この内容で作る</button>
              <button type="button" className="btn btn-secondary" onClick={() => void compose()}>別の案を作る</button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep("choose")}>選び直す</button>
            </div>
          </div>
        )}

        {step === "making" && (
          <div className="col gap-sm" role="status">
            <p className="briefing-student-wait">説明動画を作っています。少しお待ちください…</p>
            {percent != null && (
              <div className="briefing-student-bar" aria-label={`${percent}%`}>
                <div style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        )}

        {step === "watch" && videoUrl && (
          <div className="col gap-sm">
            <video className="briefing-student-video" src={videoUrl} controls autoPlay />
            <div className="row gap-sm">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void finish()}>終わる</button>
            </div>
            <p className="text-sm">「終わる」を押すと、この動画は消えます。</p>
          </div>
        )}

        {step === "error" && (
          <div className="col gap-sm">
            <div className="notice notice-warn" role="alert">{errorText}</div>
            <div>
              <button type="button" className="btn btn-primary" onClick={() => void finish()}>最初から選び直す</button>
            </div>
          </div>
        )}
      </main>

      {/* 仕上げは書き出しの画面と同じ道（ADR-0007）＝見せずに動かす。保存先は `internal` の仕事で渡してある。 */}
      {exporting && (
        <div hidden aria-hidden="true">
          <ExportScreen onNavigate={() => {}} />
        </div>
      )}
    </div>
  );
}
