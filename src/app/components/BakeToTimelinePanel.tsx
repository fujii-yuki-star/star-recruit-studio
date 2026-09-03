import { useState } from "react";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { useNavigationGuard } from "../hooks/navigationGuard";
import type { ScreenId } from "../data/mockData";
import { BakeError } from "../../domain/timeline/bake";
import { BAKE_RANGE_KIND, sceneIdsBetween } from "../../domain/timeline/bake";
import type { BakeNote, BakeRange } from "../../domain/timeline/bake";
import { bakeNoteText, formatDiskSize, BAKE_LEAVE_BLOCKED_MESSAGE } from "../uiLabels";

/** 焼き出す範囲の選び方（ADR-0032 決定17）。UI 内部の分類なので永続データの enum ではない。 */
type RangeChoice = "whole" | "part" | "between";

/**
 * 「タイムラインで編集する形にする」導線（ADR-0032 決定16/17・#628）。
 *
 * 片道の変換なので、押す前に**何が起きるか**を出しきる：作られるのは**別の新しい動画**で元はそのまま残ること、
 * **増えるディスク容量**（決定13＝素材をコピーするため）、**持っていけないもの**（`BakeNote`）。
 * 確認は2段階（[作る内容を確かめる] → 内容を見てから [この内容で作る]）＝押した瞬間に作らない。
 */
export function BakeToTimelinePanel({ onNavigate }: { onNavigate?: (screen: ScreenId) => void }) {
  const { parts, scenes, meta, estimateBake, bakeToTimeline } = useProjectStore();
  const [choice, setChoice] = useState<RangeChoice>("whole");
  const [partId, setPartId] = useState<string>(parts[0]?.partId ?? "");
  const [fromSceneId, setFromSceneId] = useState<string>(scenes[0]?.sceneId ?? "");
  const [toSceneId, setToSceneId] = useState<string>(scenes[scenes.length - 1]?.sceneId ?? "");
  const [name, setName] = useState<string>(`${meta.projectName}（タイムライン）`);
  const [preview, setPreview] = useState<{ bytes: number; notes: BakeNote[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // ⚠️ **作った動画の番号も覚える**（#992 ⑤）＝一覧まで自力で辿らせない。
  // 複製は「作っただけで見えないと、できたかどうか分からない」から**作ったら開く**としており、
  // 同じ理屈がここに効いていなかった。⚠️ タイムラインを開いても場面形式は閉じないので、
  // 開く導線を足しても「元はそのまま残る」（決定16）は壊れない。
  const [done, setDone] = useState<{ name: string; projectId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openTimelineProject = useTimelineStore((s) => s.openTimelineProject);

  /**
   * 作っている間は画面を離れない（#992 ②）。
   *
   * ⚠️ **成否の受け皿が部品のローカル**なので、離れた瞬間に**消える**＝
   * 「できたのか、失敗したのか、二度と分からない」。素材を丸ごとコピーする＝分単位に
   * なりうる操作なので、その間に離れられてしまう（サイドバー・同じ画面の戻る導線）。
   * ⚠️ **黙って止めない**（§2-5）＝`navigationGuard` は「`false` を返した側が理由を出す責任を持つ」
   * 決まりなので、止めると同時にその場へ理由を出す（サイドバーは押せない見た目にできないので、
   * 何も出さないと**押しても何も起きない画面**になる）。
   */
  useNavigationGuard(
    busy
      ? () => {
          setError(BAKE_LEAVE_BLOCKED_MESSAGE);
          return false;
        }
      : null,
  );

  /**
   * 作った動画をその場で開く（#992 ⑤）。
   *
   * ⚠️ **開けなかったら、そう言う**＝黙って何も起きない、を作らない（§2-5）。
   * ⚠️ **行き先が無いときは押させない**（下でボタンごと出さない）＝この部品は
   * 画面に埋め込まれるので、行き先を渡さない使い方もありうる。
   */
  const openBaked = async (projectId: string): Promise<void> => {
    setError(null);
    await openTimelineProject(projectId);
    const failed = useTimelineStore.getState();
    if (failed.loadError) {
      setError(failed.loadError);
      return;
    }
    onNavigate?.("timeline-project");
  };

  const range = ((): BakeRange => {
    if (choice === "part") return { kind: BAKE_RANGE_KIND.part, partId };
    if (choice === "between") return { kind: BAKE_RANGE_KIND.scenes, sceneIds: sceneIdsBetween(scenes, fromSceneId, toSceneId) };
    return { kind: BAKE_RANGE_KIND.whole };
  })();

  // 場面が1つも入らない範囲（空パート・端が見つからない）は作らせない＝中身の無い動画を作らない（§2-5）。
  const sceneCount =
    choice === "whole" ? scenes.length
      : choice === "part" ? scenes.filter((s) => s.partId === partId).length
        : sceneIdsBetween(scenes, fromSceneId, toSceneId).length;

  // 範囲や名前を変えたら、前に出した確認内容は捨てる（古い容量・注意書きのまま作らせない）。
  const resetPreview = (): void => {
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const check = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await estimateBake(range));
    } catch {
      setError("作る内容を確かめられませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { projectId } = await bakeToTimeline(range, name.trim() || meta.projectName);
      // 作った後に注意書きを出し直さない：**確認で見せた `notes` と同じもの**が返る
      // （見積りも作成も store の同じ変換を通る）ので、上書きしても画面は変わらない。
      // 出し分けが要るとしたら「確認と作成の間に中身が変わりうる」設計にしたときで、そのときは
      // ここで結果の `notes` を出す（いまは同じものを2度見せない＝完了だけを伝える）。
      setDone({ name: name.trim() || meta.projectName, projectId });
    } catch (e) {
      // 作れない理由を持っている例外（`BakeError`）はその文言を出す＝**中身の問題を「空き容量」と
      // 案内しない**（言われたとおりにしても直らない・§2-5／ADR-0026④）。読込の `TimelineLoadError`
      // と同じ流儀。ファイルのコピー・保存の失敗はここに理由が無いので、置き場所の話に倒す。
      setError(e instanceof BakeError ? e.message : "作れませんでした。空き容量を確かめて、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>タイムラインで編集する形にする</h3>
      <p className="text-muted">
        時間の流れを自由に組み替えられる形に作り直します。
        <strong>新しい動画として作られ、いまの動画はそのまま残ります</strong>。
        作り直したあとの変更は、こちらの動画には反映されません。
      </p>

      <label className="field">
        <span>どこまでを作り直しますか</span>
        <select
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value as RangeChoice);
            resetPreview();
          }}
        >
          <option value="whole">動画ぜんぶ</option>
          <option value="part">パートを選ぶ</option>
          <option value="between">場面の範囲を選ぶ</option>
        </select>
      </label>

      {choice === "part" && (
        <label className="field">
          <span>パート</span>
          <select value={partId} onChange={(e) => { setPartId(e.target.value); resetPreview(); }}>
            {parts.map((p) => (
              <option key={p.partId} value={p.partId}>{p.title}</option>
            ))}
          </select>
        </label>
      )}

      {choice === "between" && (
        <div className="row gap-sm">
          <label className="field">
            <span>ここから</span>
            <select value={fromSceneId} onChange={(e) => { setFromSceneId(e.target.value); resetPreview(); }}>
              {scenes.map((s, i) => (
                <option key={s.sceneId} value={s.sceneId}>{`場面${i + 1}`}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>ここまで</span>
            <select value={toSceneId} onChange={(e) => { setToSceneId(e.target.value); resetPreview(); }}>
              {scenes.map((s, i) => (
                <option key={s.sceneId} value={s.sceneId}>{`場面${i + 1}`}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="field">
        <span>新しい動画の名前</span>
        <input value={name} onChange={(e) => { setName(e.target.value); resetPreview(); }} maxLength={80} />
      </label>

      {sceneCount === 0 && (
        <p className="notice notice-warn" role="alert">
          選んだ範囲に場面がありません。範囲を選び直してください。
        </p>
      )}

      {error && <p className="notice notice-warn" role="alert">{error}</p>}

      {done ? (
        <div className="notice" role="status">
          <p>「{done.name}」を作りました。いまの動画はそのままです。</p>
          {/* ⚠️ **作った先で何ができなくなるかを言う**（#992 ⑥）＝戻れないことは伝わるが、
              「そこでは AI（ゆうこ）も場面編集も使えない」はどこにも書かれていなかった。 */}
          <p className="text-sm text-muted">
            作った先では、ゆうこにたたき台を作ってもらうことと、場面ごとの編集はできません。
          </p>
          <div className="row gap-sm">
            {onNavigate && (
              <button className="btn btn-primary" onClick={() => void openBaked(done.projectId)}>
                作った動画を開く
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setDone(null)}>閉じる</button>
          </div>
        </div>
      ) : preview ? (
        <div className="notice">
          <p>
            場面{sceneCount}件を作り直します。写真・動画・作成済みの声をコピーするので、
            <strong>ディスクの使用量が{formatDiskSize(preview.bytes)}増えます</strong>。
          </p>
          {preview.notes.length > 0 && (
            <>
              <p>持っていけないものがあります：</p>
              <ul>
                {preview.notes.map((n) => (
                  <li key={n.code}>{bakeNoteText(n)}</li>
                ))}
              </ul>
            </>
          )}
          <div className="row gap-sm">
            <button className="btn btn-ghost" onClick={resetPreview} disabled={busy}>やめる</button>
            <button className="btn btn-primary" onClick={run} disabled={busy}>
              {busy ? "作成中…" : "この内容で作る"}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={check} disabled={busy || sceneCount === 0}>
          {busy ? "確認中…" : "作る内容を確かめる"}
        </button>
      )}
    </div>
  );
}
