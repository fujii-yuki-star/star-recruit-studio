import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../components/ui";
import { SCREEN_TITLES } from "../screenTitles";
import {
  addInterest, addSource, BRIEFING_CLOSING_TEXT_MAX, BRIEFING_INTEREST_LABEL_MAX, BRIEFING_INTEREST_MAX, BRIEFING_PRIORITIES,
  briefingCatalogProblems, isBriefingExitCode, moveInterest, pruneMissingScenes, removeInterest, removeSource, renameInterest,
  sceneRuleOf, setClosingText, setClosingUseBrandLogo, setExitCode, setSourceEnabled, toggleSceneInterest, updateSceneRule,
  type BriefingCatalog, type BriefingPriority,
} from "../../domain/briefing/catalog";
import { resolveProjectFormat } from "../../domain/projectFormat";
import { PROJECT_FORMAT } from "../../domain/enums";
import { parseProjectDoc } from "../../domain/project/persistence";
import { listProjectSummaries, loadProjectDoc, type ProjectSummary } from "../../infrastructure/projectFs";
import { loadBriefingCatalog, saveBriefingCatalog } from "../../infrastructure/briefingFs";
import {
  BRIEFING_CATALOG_SAVE_FAILED_MESSAGE, BRIEFING_CATALOG_UNREADABLE_MESSAGE, BRIEFING_EXIT_CODE_INVALID_MESSAGE,
  BRIEFING_FEATURE_DISABLED_MESSAGE, BRIEFING_PRIORITY_LABEL, BRIEFING_PROJECT_MISSING_MESSAGE, BRIEFING_PROJECT_NOT_SCENE_MESSAGE,
  BRIEFING_PROJECT_UNREADABLE_MESSAGE, briefingScenesMissingMessage,
} from "../uiLabels";

/** 登録の画面に並べる場面1つ（動画を開かずに読んだもの）。 */
interface SceneRow {
  sceneId: string;
  label: string;
}

/** 場面の見分け（並び＋見出し、無ければセリフの頭）。 */
function sceneLabel(order: number, title: string | undefined, speech: string): string {
  const head = (title ?? "").trim() || speech.trim().slice(0, 30) || "（文字のない場面）";
  return `${order}. ${head}`;
}

/**
 * あなた向け会社説明の**登録**（管理者の画面・β・ADR-0061 決定2）。
 *
 * ⚠️ **原本の動画は書き換えない**＝ここは「どの動画のどの場面を、どの興味に使うか」を覚えるだけ（`catalog.json`）。
 * ⚠️ **読めなかった登録を例の登録で上書きしない**＝読めなかったら知らせて、触らせない。
 * ⚠️ 変えたらすぐ保存する（設定の画面と同じ＝保存の押し忘れを作らない）。
 */
export function BriefingAdminScreen({ enabled }: { enabled: boolean }) {
  const [catalog, setCatalog] = useState<BriefingCatalog | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [scenesOf, setScenesOf] = useState<Record<string, SceneRow[] | "error">>({});
  const [open, setOpen] = useState<string | null>(null);
  const [newInterest, setNewInterest] = useState("");
  const [pick, setPick] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadBriefingCatalog().then((c) => {
      if (alive) setCatalog(c);
    });
    void listProjectSummaries()
      .then((s) => {
        if (alive) setSummaries(s);
      })
      .catch(() => {
        if (alive) setSummaries([]);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  /** 変えたらすぐ保存（失敗したら知らせる＝画面の登録は変えたまま・次の変更でまた保存を試す）。 */
  const apply = useCallback((next: BriefingCatalog) => {
    setCatalog(next);
    setSaveError(null);
    void saveBriefingCatalog(next).catch(() => setSaveError(BRIEFING_CATALOG_SAVE_FAILED_MESSAGE));
  }, []);

  /** 動画の場面を読む（開くときに1回）。 */
  const loadScenes = useCallback(async (projectId: string) => {
    try {
      const p = parseProjectDoc(await loadProjectDoc(projectId));
      const rows = [...p.scenes]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ sceneId: s.sceneId, label: sceneLabel(s.order, s.texts.title, s.narration.text || s.lines?.[0]?.text || "") }));
      setScenesOf((m) => ({ ...m, [projectId]: rows }));
    } catch {
      setScenesOf((m) => ({ ...m, [projectId]: "error" }));
    }
  }, []);

  const sceneProjects = useMemo(
    () => (summaries ?? []).filter((s) => resolveProjectFormat({ format: s.format }) === PROJECT_FORMAT.scene),
    [summaries],
  );
  const problems = useMemo(() => {
    if (!catalog || !summaries) return [];
    return briefingCatalogProblems(
      catalog,
      summaries.map((s) => {
        const rows = scenesOf[s.projectId];
        return {
          projectId: s.projectId,
          isSceneFormat: resolveProjectFormat({ format: s.format }) === PROJECT_FORMAT.scene,
          sceneIds: Array.isArray(rows) ? rows.map((r) => r.sceneId) : null,
        };
      }),
    );
  }, [catalog, summaries, scenesOf]);

  const head = <PageHead title={SCREEN_TITLES.briefing} desc="学生が選んだ興味に合わせて、登録した動画の場面から説明動画を組みます。ここでは、どの場面をどの興味に使うかを登録します。" />;

  if (!enabled) {
    return (
      <div className="main-scroll">
        {head}
        <div className="notice notice-info" role="status">{BRIEFING_FEATURE_DISABLED_MESSAGE}</div>
      </div>
    );
  }
  if (catalog === undefined) return <div className="main-scroll">{head}</div>;
  if (catalog === null) {
    return (
      <div className="main-scroll">
        {head}
        <div className="notice notice-warn" role="alert">{BRIEFING_CATALOG_UNREADABLE_MESSAGE}</div>
      </div>
    );
  }

  const nameOf = (projectId: string): string => summaries?.find((s) => s.projectId === projectId)?.projectName ?? "（見つからない動画）";
  const addable = sceneProjects.filter((p) => !catalog.sources.some((s) => s.projectId === p.projectId));

  return (
    <div className="main-scroll">
      {head}
      <div style={{ maxWidth: 860 }} className="col gap-lg">
        {saveError && <div className="notice notice-warn" role="alert">{saveError}</div>}

        {/* 興味の項目（会社が決める・学生にはこの順で見せる）。 */}
        <div className="card">
          <h2 className="section-title">興味の項目</h2>
          <p className="page-desc text-pretty">学生が選ぶ項目です。この順に並べて見せます。</p>
          <div className="col gap-sm">
            {catalog.interests.map((it, i) => (
              <div key={it.interestId} className="row gap-sm">
                <input
                  className="input grow"
                  aria-label={`興味の項目 ${i + 1}`}
                  defaultValue={it.label}
                  maxLength={BRIEFING_INTEREST_LABEL_MAX}
                  onBlur={(e) => {
                    if (e.currentTarget.value.trim() !== it.label) apply(renameInterest(catalog, it.interestId, e.currentTarget.value));
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => apply(moveInterest(catalog, it.interestId, -1))} aria-label={`「${it.label}」を上へ`}>↑</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === catalog.interests.length - 1} onClick={() => apply(moveInterest(catalog, it.interestId, 1))} aria-label={`「${it.label}」を下へ`}>↓</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(removeInterest(catalog, it.interestId))} aria-label={`「${it.label}」を消す`}>消す</button>
              </div>
            ))}
            <form
              className="row gap-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const next = addInterest(catalog, newInterest);
                if (next !== catalog) {
                  apply(next);
                  setNewInterest("");
                }
              }}
            >
              <input
                className="input grow"
                aria-label="足す興味の項目"
                placeholder="例：キャリア"
                value={newInterest}
                maxLength={BRIEFING_INTEREST_LABEL_MAX}
                onChange={(e) => setNewInterest(e.target.value)}
                disabled={catalog.interests.length >= BRIEFING_INTEREST_MAX}
              />
              <button type="submit" className="btn btn-sm" disabled={!newInterest.trim() || catalog.interests.length >= BRIEFING_INTEREST_MAX}>足す</button>
            </form>
          </div>
        </div>

        {/* 使う動画と場面（場面形式の動画だけ）。 */}
        <div className="card">
          <h2 className="section-title">使う動画と場面</h2>
          <p className="page-desc text-pretty">
            説明に使う動画を選び、場面ごとに「どの興味のときに見せるか」を付けます。興味を付けていない場面は使いません（タイムラインで作った動画は使えません）。
          </p>
          <div className="col gap-lg">
            {catalog.sources.map((src) => {
              const rows = scenesOf[src.projectId];
              const srcProblems = problems.filter((p) => p.projectId === src.projectId);
              const missingScenes = srcProblems.filter((p) => p.kind === "sceneMissing").length;
              const isOpen = open === src.projectId;
              return (
                <div key={src.projectId} className="col gap-sm" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
                  <div className="row gap-sm" style={{ alignItems: "center" }}>
                    <strong className="grow">{nameOf(src.projectId)}</strong>
                    <label className="row gap-xs" style={{ alignItems: "center" }}>
                      <input type="checkbox" checked={src.enabled} onChange={(e) => apply(setSourceEnabled(catalog, src.projectId, e.target.checked))} />
                      使う
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-expanded={isOpen}
                      onClick={() => {
                        const next = isOpen ? null : src.projectId;
                        setOpen(next);
                        if (next && !scenesOf[next]) void loadScenes(next);
                      }}
                    >
                      {isOpen ? "場面を閉じる" : "場面を設定"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(removeSource(catalog, src.projectId))}>外す</button>
                  </div>
                  {srcProblems.some((p) => p.kind === "projectMissing") && <div className="notice notice-warn" role="alert">{BRIEFING_PROJECT_MISSING_MESSAGE}</div>}
                  {srcProblems.some((p) => p.kind === "projectNotScene") && <div className="notice notice-warn" role="alert">{BRIEFING_PROJECT_NOT_SCENE_MESSAGE}</div>}
                  {missingScenes > 0 && Array.isArray(rows) && (
                    <div className="notice notice-warn row gap-sm" role="alert" style={{ alignItems: "center" }}>
                      <span className="grow">{briefingScenesMissingMessage(missingScenes)}</span>
                      <button type="button" className="btn btn-sm" onClick={() => apply(pruneMissingScenes(catalog, src.projectId, rows.map((r) => r.sceneId)))}>
                        消えた場面の登録を外す
                      </button>
                    </div>
                  )}
                  {isOpen && rows === "error" && <div className="notice notice-warn" role="alert">{BRIEFING_PROJECT_UNREADABLE_MESSAGE}</div>}
                  {isOpen && Array.isArray(rows) && (
                    <div className="col gap-sm">
                      {rows.map((row) => {
                        const rule = sceneRuleOf(catalog, src.projectId, row.sceneId);
                        return (
                          <div key={row.sceneId} className="col gap-xs" style={{ padding: "6px 0" }}>
                            <div className="text-sm"><strong>{row.label}</strong></div>
                            <div className="row gap-sm" style={{ flexWrap: "wrap" }} role="group" aria-label={`${row.label} を見せる興味`}>
                              {catalog.interests.map((it) => (
                                <label key={it.interestId} className="row gap-xs text-sm" style={{ alignItems: "center" }}>
                                  <input
                                    type="checkbox"
                                    checked={rule.interestIds.includes(it.interestId)}
                                    onChange={() => apply(toggleSceneInterest(catalog, src.projectId, row.sceneId, it.interestId))}
                                  />
                                  {it.label}
                                </label>
                              ))}
                            </div>
                            <div className="row gap-lg text-sm" style={{ flexWrap: "wrap", alignItems: "center" }}>
                              <label className="row gap-xs" style={{ alignItems: "center", whiteSpace: "nowrap" }}>
                                優先度
                                <select
                                  className="input"
                                  value={rule.priority}
                                  onChange={(e) => apply(updateSceneRule(catalog, src.projectId, row.sceneId, { priority: e.target.value as BriefingPriority }))}
                                >
                                  {BRIEFING_PRIORITIES.map((p) => (
                                    <option key={p} value={p}>{BRIEFING_PRIORITY_LABEL[p]}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="row gap-xs" style={{ alignItems: "center" }}>
                                <input type="checkbox" checked={rule.required} onChange={(e) => apply(updateSceneRule(catalog, src.projectId, row.sceneId, { required: e.target.checked }))} />
                                必ず入れる
                              </label>
                              <label className="row gap-xs" style={{ alignItems: "center" }}>
                                <input type="checkbox" checked={rule.excluded} onChange={(e) => apply(updateSceneRule(catalog, src.projectId, row.sceneId, { excluded: e.target.checked }))} />
                                使わない
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="row gap-sm">
              <select className="input grow" aria-label="足す動画" value={pick} onChange={(e) => setPick(e.target.value)} disabled={addable.length === 0}>
                <option value="">{addable.length === 0 ? "足せる動画がありません" : "動画を選ぶ"}</option>
                {addable.map((p) => (
                  <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!pick}
                onClick={() => {
                  apply(addSource(catalog, pick));
                  setPick("");
                }}
              >
                足す
              </button>
            </div>
          </div>
        </div>

        {/* 最後に必ず入れる場面（学生は外せない・ADR-0061 判断3）。 */}
        <div className="card">
          <h2 className="section-title">最後の場面</h2>
          <p className="page-desc text-pretty">組んだ説明の最後に必ず入る場面です（学生は外せません）。</p>
          <textarea
            className="input"
            aria-label="最後の場面の文"
            rows={2}
            maxLength={BRIEFING_CLOSING_TEXT_MAX}
            defaultValue={catalog.closing.text}
            onBlur={(e) => {
              if (e.currentTarget.value.trim() !== catalog.closing.text) apply(setClosingText(catalog, e.currentTarget.value));
            }}
          />
          <label className="row gap-xs" style={{ alignItems: "center", marginTop: 8 }}>
            <input type="checkbox" checked={catalog.closing.useBrandLogo} onChange={(e) => apply(setClosingUseBrandLogo(catalog, e.target.checked))} />
            会社のロゴを置く（「設定」のブランドキットのロゴ）
          </label>
        </div>

        {/* 学生の画面から抜ける番号。 */}
        <div className="card">
          <h2 className="section-title">学生の画面から抜ける番号</h2>
          <p className="page-desc text-pretty">
            学生の画面は全画面で開き、この 4 桁の番号で抜けます。番号を忘れたときは、アプリを閉じて開き直すと元の画面に戻ります。
            {catalog.exitCode ? "（番号は決めてあります）" : "（まだ決めていません）"}
          </p>
          <form
            className="row gap-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isBriefingExitCode(code)) {
                setCodeError(BRIEFING_EXIT_CODE_INVALID_MESSAGE);
                return;
              }
              setCodeError(null);
              apply(setExitCode(catalog, code));
              setCode("");
            }}
          >
            <input
              className="input"
              aria-label="抜ける番号（4 桁）"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              style={{ width: 120 }}
            />
            <button type="submit" className="btn btn-sm" disabled={code.length === 0}>
              {catalog.exitCode ? "番号を変える" : "番号を決める"}
            </button>
          </form>
          {codeError && <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>{codeError}</div>}
        </div>
      </div>
    </div>
  );
}
