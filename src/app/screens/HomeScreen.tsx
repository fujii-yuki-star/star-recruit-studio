import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { PROJECT_NAME_MAX_LENGTH } from "../../domain/constants";
import { ORIENTATION } from "../../domain/enums";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { useStartNewProject } from "../hooks/useStartNewProject";
import { hasUnsavedChanges } from "../hooks/newProjectGuard";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { YukoPanel } from "../components/YukoPanel";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { isTimelineProjectDoc } from "../../domain/projectFormat";
import { useTimelineStore } from "../store/timelineStore";
import { ProjectLoadError } from "../../domain/project/persistence";
import {
  PlusIcon,
  LayoutIcon,
  SettingsIcon,
  FilmIcon,
  ChevronRightIcon,
  FolderIcon,
  TrashIcon,
  PencilIcon,
} from "../components/icons";

interface HomeProps {
  onNavigate: (screen: ScreenId) => void;
}

function formatDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

/**
 * **理由が分からないとき**の案内（#793 レビュー）。読み込み側が理由を出せた場合はそちらを見せる。
 *
 * ⚠️ **「別のプロジェクトを選んでください」と書かない**＝以前の固定文はそう書いていたが、
 * **別のを選んでも直らない**ことが多い（版が新しい・素材が欠けている等）＝§2-5 が禁じる
 * 「実行しても直らない行動」。ここは**もう一度試す**を出す（一時的な読み取り失敗なら直る）。
 */
const OPEN_FAILED_MESSAGE = "このプロジェクトを開けませんでした。もう一度お試しください。";

export function HomeScreen({ onNavigate }: HomeProps) {
  const listProjects = useProjectStore((s) => s.listProjects);
  const loadProject = useProjectStore((s) => s.loadProject);
  const openTimelineProject = useTimelineStore((s) => s.openTimelineProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  // 書き出し中はプロジェクトの切替/削除/新規をブロック（#379）。store 側も no-op で守るが、UI でも無効化して
  // 「削除→一覧から消える（実体は残る）」等の不整合と誤操作を防ぐ。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const renameProject = useProjectStore((s) => s.renameProject);
  // 未保存の変更があるか。新規作成と同じ破棄ガードを「プロジェクトを開く」にも適用する（#547 P1-2・データ喪失防止）。
  const hasWork = useProjectStore((s) => hasUnsavedChanges(s.saveStatus, s.scenes.length, s.assets, s.meta));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // 一覧の取得に失敗したか（§2-5）。失敗を「空（保存物なし）」と区別する＝一時失敗で保存物が消えたように見せない。
  const [listError, setListError] = useState(false);
  // 一覧の再取得中（もう一度読み込む の連打防止＋フィードバック）。
  const [listRetrying, setListRetrying] = useState(false);
  // マウント中か（再取得の解決が離脱後に届いても state を触らない＝アンマウント後 setState を避ける）。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // 「新しい動画を作る」はヘッダと同じ破棄ガード付きフロー（共有フックで挙動統一）。
  const {
    confirming: confirmNew, start: startNew, startBlank, startTimeline,
    creating: creatingTimeline, createFailed: timelineCreateFailed,
    confirm: confirmStartNew, cancel: cancelNew,
  } = useStartNewProject(onNavigate);
  // プロジェクトを開けなかったときのユーザー向け表示（§2-5）。
  // タイムライン形式の新規作成で向きを選んでいる最中か（#664）。
  const [choosingTimeline, setChoosingTimeline] = useState(false);
  // ⚠️ **文言をそのまま持つ**（#793 レビュー）＝以前は真偽値で、`catch {}` が理由を捨てて
  // **常に固定文**を出していた。そのため `parseProjectDoc` が返す「アプリを更新してから開き直して
  // ください」も、**「素材が見つかりません」等も**利用者に届かず、代わりに出る固定文は
  // 「一覧から**別のプロジェクトを選んでください**」＝**§2-5 が禁じる「実行しても直らない行動」**
  // だった。タイムライン形式（`timelineStore`）は既に理由を運んでいる＝**非対称も解消する**。
  const [openError, setOpenError] = useState<string | null>(null);
  // 削除：確認中のプロジェクトID・操作中（連打防止）・失敗表示（§2-5）。
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // プロジェクトを開いている最中の id（#392）。連打・別プロジェクト並走で loadProject が後勝ちするのを防ぐ。
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  // 別プロジェクトを開く前の破棄確認（#547 P1-2）。未保存があるとき「開く先」をここに保持し、確認後に実行する。
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  async function removeProject(projectId: string) {
    if (deleteBusy || isExporting) return; // 書き出し中は削除しない（no-op 後に一覧だけ消える不整合を防ぐ・#379）
    setDeleteBusy(true);
    setDeleteError(false);
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
      setDeletingId(null);
    } catch {
      setDeleteError(true);
    } finally {
      setDeleteBusy(false);
    }
  }

  // 名前変更：編集中のプロジェクトID・入力値・操作中・失敗表示。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState(false);

  function startRename(p: ProjectSummary) {
    setRenamingId(p.projectId);
    setRenameValue(p.projectName || "");
    setRenameError(false);
  }

  async function saveRename(projectId: string) {
    const name = renameValue.trim();
    if (!name || renameBusy) return;
    setRenameBusy(true);
    setRenameError(false);
    try {
      await renameProject(projectId, name);
    } catch {
      setRenameError(true);
      return; // リネーム自体が失敗したときだけエラー表示（入力欄は残して再試行可能に）。
    } finally {
      setRenameBusy(false);
    }
    // リネーム成功。入力欄を閉じ、一覧を最新化する。一覧の再取得失敗はリネーム完了に影響しないのでサイレント。
    setRenamingId(null);
    // 先に楽観更新でディスクの結果（改名済み）を反映する。こうすると下の再取得が失敗しても行が旧名に戻らず、
    // 「改名は成功したのに失敗に見える」ズレが出ない＝再取得失敗を安全に無視できる（#547 P2-2 レビュー）。
    // ここで listError を立てないのは意図的：一覧全体が失敗表示に置き換わると既存行が隠れ、改名失敗と誤読させるため。
    setProjects((cur) => cur.map((p) => (p.projectId === projectId ? { ...p, projectName: name } : p)));
    try {
      setProjects(await listProjects());
    } catch {
      /* 再取得の失敗は無視（上の楽観更新で表示は正しい＝誤った失敗表示・二重実行を防ぐ） */
    }
  }

  // 一覧の再取得（「もう一度読み込む」＝再試行）。成功で失敗表示を消し、失敗なら §2-5 の失敗表示を残す。
  // 解決が離脱後に届く場合に備え、各 state 更新前に mountedRef を確認する（アンマウント後 setState を避ける）。
  const refreshProjects = useCallback(async () => {
    setListRetrying(true);
    try {
      const list = await listProjects();
      if (!mountedRef.current) return;
      setProjects(list);
      setListError(false);
    } catch {
      if (mountedRef.current) setListError(true); // 失敗を「空（保存物なし）」と区別＝保存物が消えたように見せない
    } finally {
      if (mountedRef.current) setListRetrying(false);
    }
  }, [listProjects]);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((list) => {
        if (alive) {
          setProjects(list);
          setListError(false);
        }
      })
      .catch(() => {
        // 取得失敗は「保存物なし」と混同させず、原因＋次の行動（再試行）を出す（§2-5・ADR-0026④）。
        if (alive) setListError(true);
      });
    return () => {
      alive = false;
    };
  }, [listProjects]);

  // 「開く」要求：未保存の変更があれば破棄確認を挟む（新規作成と同じガード＝#547 P1-2）。
  // 自動保存で保存済み（saved）なら確認せず即開く。保存済みの内容はディスクに残り一覧から開き直せる。
  function requestOpenProject(projectId: string) {
    if (isExporting) return; // 書き出し中は切替をブロック（loadProject は no-op・遷移もしない・#379）
    if (openingId) return; // 既に別プロジェクトを開いている最中は無視（連打・並走で後勝ちを防ぐ・#392）
    if (pendingOpenId) return; // 既に別の「開く」確認中は上書きしない（確認中は他カードも無効化＝多重防御・レビュー対応）
    // タイムライン形式は**別の文書**を別の画面で開くだけ＝場面形式の編集内容は閉じないので確認は出さない
    // （「保存していない素材や場面は失われます」は事実と違う・§2-5）。
    const isTimeline = isTimelineProjectDoc({ format: projects.find((p) => p.projectId === projectId)?.format });
    if (hasWork && !isTimeline) { setPendingOpenId(projectId); return; } // 未保存＝確認してから開く
    void doOpenProject(projectId);
  }
  async function doOpenProject(projectId: string) {
    if (isExporting || openingId) return; // 確認中に書き出し開始/並走した場合の多重防御（requestOpenProject と同条件）
    setOpenError(null);
    setOpeningId(projectId);
    try {
      // 形式で開く先を分ける（ADR-0032・11 §1）＝開いてから「形式が違う」と断らない。
      // タイムライン形式は別の文書なので別の store・別の画面（読み込めなかった理由は画面側が出す）。
      if (isTimelineProjectDoc({ format: projects.find((p) => p.projectId === projectId)?.format })) {
        await openTimelineProject(projectId);
        onNavigate("timeline-project");
        return;
      }
      await loadProject(projectId);
      onNavigate("draft"); // 成功で draft へ遷移＝HomeScreen アンマウント（openingId は解除不要）。
    } catch (e) {
      // 読み込み側が出した**理由**をそのまま見せる（次の行動がそこに書いてある）。
      // それ以外（想定外）は従来の固定文へ倒す＝黙って何も出さない、を作らない。
      setOpenError(e instanceof ProjectLoadError ? e.message : OPEN_FAILED_MESSAGE);
      setOpeningId(null); // 失敗時のみ解除して再度開けるように。
    }
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          {openError && (
            <div className="notice notice-warn mb" role="alert">
              <span>{openError}</span>
            </div>
          )}

          {deleteError && (
            <div className="notice notice-warn mb" role="alert">
              <span>プロジェクトを削除できませんでした。もう一度お試しください。</span>
            </div>
          )}

          {renameError && (
            <div className="notice notice-warn mb" role="alert">
              <span>名前を変更できませんでした。もう一度お試しください。</span>
            </div>
          )}

          {/* 書き出し中の案内は共通バナーに寄せる（#547 P2-1）。ここは進捗も戻る導線も無い独自 notice だった＝
              二重書き出しの引き金が最も出やすい画面なのに「止まった」ように見えていた（§2-7・ADR-0026②）。 */}
          <ExportLockBanner
            onNavigate={onNavigate}
            detail="書き出しが終わるまで、新しい動画づくり・プロジェクトの切り替え・削除はできません。"
          />

          {confirmNew && (
            <div className="notice notice-warn mb" role="alert">
              <span>
                今の編集内容を閉じて新しく作りますか？保存していない素材や場面は失われます（保存済みのプロジェクトは下の一覧からいつでも開けます）。
              </span>
              {/* 確認ダイアログは「やめる（左・ghost）／実行（右）」で全画面統一（#410 sub2・削除確認と同じ並び）。 */}
              <div className="row gap-sm">
                <button className="btn btn-ghost btn-icon" onClick={cancelNew}>
                  やめる
                </button>
                <button className="btn btn-primary btn-icon" onClick={confirmStartNew}>
                  新しく作る
                </button>
              </div>
            </div>
          )}

          {pendingOpenId && (
            <div className="notice notice-warn mb" role="alert">
              <span>
                今の編集内容を閉じて別のプロジェクトを開きますか？保存していない素材や場面は失われます（保存済みのプロジェクトは下の一覧からいつでも開けます）。
              </span>
              {/* 破棄確認は「やめる（左・ghost）／実行（右）」で全画面統一（新規作成・削除確認と同じ並び）。 */}
              <div className="row gap-sm">
                <button className="btn btn-ghost btn-icon" onClick={() => setPendingOpenId(null)}>
                  やめる
                </button>
                <button
                  className="btn btn-primary btn-icon"
                  onClick={() => { const id = pendingOpenId; setPendingOpenId(null); void doOpenProject(id); }}
                >
                  開く
                </button>
              </div>
            </div>
          )}

          {/* ヒーロー: 新しい動画を作る */}
          <div className="hero">
            <div>
              <div className="badge badge-teal mb">動画づくり支援</div>
              <h1 className="page-title text-balance">
                伝えたいことを、動画でやさしく届けましょう
              </h1>
              <p className="page-desc text-pretty">
                伝えたい内容と写真・動画を入れると、ゆうこが動画のたたき台を作ります。
                内容を確認・修正してから、動画として保存できます。
              </p>
              <div className="row gap-sm mt" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-lg" onClick={startNew} disabled={isExporting || pendingOpenId !== null} title={isExporting ? "書き出しが終わるまでお待ちください" : pendingOpenId !== null ? "確認に答えてから操作できます" : undefined}>
                  <PlusIcon size={20} />
                  新しい動画を作る
                </button>
                {/* 白紙から作る（#393）＝ウィザード/AI を通らず、空のたたき台から自分で場面を組み立てる。 */}
                <button className="btn btn-secondary btn-lg" onClick={startBlank} disabled={isExporting || pendingOpenId !== null} title={isExporting ? "書き出しが終わるまでお待ちください" : pendingOpenId !== null ? "確認に答えてから操作できます" : "AI を使わず、自分で場面を組み立てます"}>
                  白紙から作る
                </button>
                {/* タイムラインで作る（#635・ADR-0032 決定7/15）＝場面に区切らず、時間の流れの上に自分で
                    素材を並べる別の作り方。場面形式とは別の動画になる（あとから行き来はしない）。 */}
                <button
                  className="btn btn-secondary btn-lg"
                  onClick={() => setChoosingTimeline((v) => !v)}
                  disabled={isExporting || pendingOpenId !== null || creatingTimeline}
                  title={isExporting ? "書き出しが終わるまでお待ちください" : pendingOpenId !== null ? "確認に答えてから操作できます" : "場面に区切らず、時間の流れの上に自分で並べます"}
                >
                  {creatingTimeline ? "作っています…" : "タイムラインで作る"}
                </button>
              </div>
              {/* 向きは作るときにしか選べない（あとから変える導線が無い）ので、押した瞬間に作らず先に聞く（#664）。 */}
              {choosingTimeline && !creatingTimeline && (
                <div className="notice notice-info mt" role="group" aria-label="動画の向きを選ぶ">
                  <p>どちらの向きで作りますか？（あとから変えられません）</p>
                  <div className="row gap-sm">
                    <button
                      className="btn btn-primary"
                      onClick={() => { setChoosingTimeline(false); startTimeline(ORIENTATION.landscape); }}
                    >
                      横向き（パソコン・テレビ向き）
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => { setChoosingTimeline(false); startTimeline(ORIENTATION.portrait); }}
                    >
                      縦向き（スマホ向き）
                    </button>
                    <button className="btn btn-ghost" onClick={() => setChoosingTimeline(false)}>やめる</button>
                  </div>
                </div>
              )}
              {timelineCreateFailed && (
                <p className="text-warn mt">
                  新しいタイムラインの動画を作れませんでした。少し待ってからもう一度お試しください。
                </p>
              )}
            </div>
            <div
              className="thumb thumb-video"
              style={{ width: 220, flexShrink: 0 }}
              aria-hidden="true"
            >
              <FilmIcon size={40} />
            </div>
          </div>

          {/* クイック操作 */}
          <div className="card-grid cols-3 mb">
            <button className="action-card" onClick={startNew} disabled={isExporting || pendingOpenId !== null} title={isExporting ? "書き出しが終わるまでお待ちください" : pendingOpenId !== null ? "確認に答えてから操作できます" : undefined}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
              >
                <PlusIcon size={24} />
              </div>
              <span className="action-card-title">新しい動画を作る</span>
              <span className="action-card-desc">
                5つのステップで、動画のたたき台を作ります。
              </span>
            </button>

            <button className="action-card" onClick={() => onNavigate("looks")}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                <LayoutIcon size={24} />
              </div>
              <span className="action-card-title">見た目パターンを管理</span>
              <span className="action-card-desc">
                動画の見た目のパターンを確認・追加します。
              </span>
            </button>

            <button className="action-card" onClick={() => onNavigate("settings")}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-yellow)", color: "var(--color-warn)" }}
              >
                <SettingsIcon size={24} />
              </div>
              <span className="action-card-title">設定</span>
              <span className="action-card-desc">
                使用するAIや読み上げの声を設定します。
              </span>
            </button>
          </div>

          {/* 最近のプロジェクト（この画面自体が一覧なので「すべて見る」導線は置かない・#399 レビュー）。 */}
          <h2 className="section-title mb">最近のプロジェクト</h2>
          <div className="col gap-sm">
            {listError ? (
              // 取得失敗（§2-5）：空（保存物なし）と区別し、原因＋次の行動（再試行）を出す＝無言で「保存物なし」にしない。
              <div className="notice notice-warn" role="alert" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span>保存したプロジェクトの一覧を読み込めませんでした。もう一度お試しください。</span>
                <button className="btn btn-secondary mt" onClick={refreshProjects} disabled={listRetrying}>
                  {listRetrying ? "読み込み中…" : "もう一度読み込む"}
                </button>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-sm text-muted">
                保存したプロジェクトはまだありません。「新しい動画を作る」から始めましょう。
              </div>
            ) : (
              projects.map((p) =>
                renamingId === p.projectId ? (
                  <div key={p.projectId} className="list-item">
                    <input
                      className="input grow"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={PROJECT_NAME_MAX_LENGTH}
                      placeholder="プロジェクト名"
                      aria-label="プロジェクト名"
                      autoFocus
                      onKeyDown={(e) => {
                        // IME 変換確定の Enter では保存しない（日本語入力中の誤確定を防ぐ）。
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveRename(p.projectId);
                        if (e.key === "Escape") {
                          setRenamingId(null);
                          setRenameError(false);
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary btn-icon"
                      disabled={renameBusy || !renameValue.trim()}
                      onClick={() => void saveRename(p.projectId)}
                    >
                      {renameBusy ? "保存中…" : "保存"}
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      disabled={renameBusy}
                      onClick={() => {
                        setRenamingId(null);
                        setRenameError(false);
                      }}
                    >
                      やめる
                    </button>
                  </div>
                ) : deletingId === p.projectId ? (
                  <DeleteConfirm
                    key={p.projectId}
                    busy={deleteBusy}
                    message={`「${p.projectName || "無題のプロジェクト"}」を削除しますか？保存した場面・素材・音声ごと消え、元に戻せません。`}
                    onCancel={() => {
                      setDeletingId(null);
                      setDeleteError(false);
                    }}
                    onConfirm={() => void removeProject(p.projectId)}
                  />
                ) : (
                  <div key={p.projectId} className="list-item">
                    <button
                      className="row gap-sm grow"
                      onClick={() => requestOpenProject(p.projectId)}
                      disabled={isExporting || openingId !== null || pendingOpenId !== null || confirmNew}
                      title={isExporting ? "書き出しが終わるまでお待ちください" : openingId !== null ? "プロジェクトを開いています…" : (pendingOpenId !== null || confirmNew) ? "確認に答えてから操作できます" : undefined}
                      style={{ background: "transparent", border: "none", padding: 0, cursor: (isExporting || openingId !== null || pendingOpenId !== null || confirmNew) ? "not-allowed" : "pointer", textAlign: "left" }}
                    >
                      <div
                        className="thumb thumb-photo"
                        style={{ width: 96, flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <FolderIcon size={24} />
                      </div>
                      <div className="grow">
                        <div className="row gap-sm">
                          <strong>{p.projectName || "無題のプロジェクト"}</strong>
                          {/* どちらの作り方の動画か一目で分かるように（開く先が違うため・ADR-0032）。 */}
                          {isTimelineProjectDoc({ format: p.format }) && <span className="badge">タイムライン</span>}
                        </div>
                        <div className="text-sm text-muted">
                          {openingId === p.projectId ? "開いています…" : `更新日 ${formatDate(p.updatedAt)}`}
                        </div>
                      </div>
                      <ChevronRightIcon size={20} className="text-faint" />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      // 書き出し中は改名を止める（開いているプロジェクトの改名が project.json の保存と競合する・#570 レビュー）。
                      // store 側も no-op で守るが、鉛筆を無効化して「押せるのに効かない」を避ける（ADR-0026④）。
                      disabled={isExporting}
                      onClick={() => startRename(p)}
                      aria-label={`「${p.projectName || "無題のプロジェクト"}」の名前を変更`}
                      title={isExporting ? "書き出しが終わるまでお待ちください" : "名前を変更"}
                    >
                      <PencilIcon size={18} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      // 確認バナー表示中は削除も止める（確認中の「開く先」を消せてしまい、「開く」が失敗するのを防ぐ＝
                      // カード/新規作成ボタンと同じ「確認中は他操作を止める」方針に揃える・レビュー対応）。
                      disabled={isExporting || pendingOpenId !== null || confirmNew}
                      onClick={() => {
                        setDeletingId(p.projectId);
                        setDeleteError(false);
                      }}
                      aria-label={`「${p.projectName || "無題のプロジェクト"}」を削除`}
                      title={isExporting ? "書き出しが終わるまでお待ちください" : (pendingOpenId !== null || confirmNew) ? "確認に答えてから操作できます" : "削除"}
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <YukoPanel
          messages={[
            "こんにちは、ゆうこです。今日も動画づくりをお手伝いします。",
            "まずは「新しい動画を作る」から始めてみましょう。伝えたい内容と写真があれば大丈夫です。",
            "前に作ったプロジェクトは、下の一覧からいつでも開けますよ。",
          ]}
        />
      </div>
    </div>
  );
}
