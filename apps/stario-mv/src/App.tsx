import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { previewApi, type PreviewStatus, type ProjectSummary } from "./preview/api";
import { formatFps, formatTimecode } from "./preview/timecode";
import "./styles.css";

/** アプリの名前（窓の題・画面の見出しで同じものを使う）。 */
export const APP_TITLE = "すたりおMV";

/**
 * プレビュー画面（γ0.1 の段階⑦・MV-0007）。
 * ⚠️ プレビューの欄は**透明に抜く**＝その下に Rust の描画の核が窓へ直接描いている（MV-0002）。
 */
export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [compId, setCompId] = useState<string>("");
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const comp = project?.compositions.find((c) => c.id === compId) ?? null;
  const frame = status?.compositionId === compId ? status.frame : 0;
  const playing = status?.playing ?? false;

  const open = useCallback(async (dir: string) => {
    try {
      const s = await previewApi.openProject(dir);
      setProject(s);
      setCompId(s.mainCompositionId);
      setStatus(null);
      setOpenError(null);
    } catch (e) {
      setOpenError(String(e));
    }
  }, []);

  useEffect(() => {
    const offs = [
      previewApi.onStatus(setStatus),
      previewApi.onError(setError),
      previewApi.onNotice(setNotice),
      previewApi.onProjectChanged((s) => {
        setProject(s);
        setCompId((id) => (s.compositions.some((c) => c.id === id) ? id : s.mainCompositionId));
      }),
    ];
    void previewApi.initialProject().then((dir) => {
      if (dir) void open(dir);
    });
    return () => {
      for (const o of offs) void o.then((f) => f());
    };
  }, [open]);

  // 欄の位置と大きさを Rust へ（物理の画素）。欄の大きさと窓の大きさが変わるたびに送る
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const send = (): void => {
      const r = el.getBoundingClientRect();
      const k = window.devicePixelRatio || 1;
      void previewApi.setRect({ x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k });
    };
    send();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(send);
    ro?.observe(el);
    window.addEventListener("resize", send);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", send);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (!comp) return;
    void (playing ? previewApi.pause() : previewApi.play());
  }, [comp, playing]);

  // 操作（AE・Premiere の型）：Space＝再生／止める・←→ と PageUp/PageDown＝1コマ・Home/End＝最初／最後
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!comp) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT") && e.key !== " ") return;
      const keys: Record<string, () => void> = {
        " ": togglePlay,
        ArrowRight: () => void previewApi.step(1),
        PageDown: () => void previewApi.step(1),
        ArrowLeft: () => void previewApi.step(-1),
        PageUp: () => void previewApi.step(-1),
        Home: () => void previewApi.seek(0),
        End: () => void previewApi.seek(comp.durationFrames - 1),
      };
      const f = keys[e.key];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comp, togglePlay]);

  const pick = async (): Promise<void> => {
    const dir = await previewApi.pickProjectFolder();
    if (dir) await open(dir);
  };

  return (
    <div className="app">
      <header className="bar top">
        <h1>{APP_TITLE}</h1>
        <button type="button" onClick={() => void pick()}>
          動画を開く…
        </button>
        {project && (
          <>
            <span className="name" title={project.dir}>
              {project.name}
            </span>
            <label className="field">
              コンポジション
              <select
                value={compId}
                onChange={(e) => {
                  setCompId(e.target.value);
                  void previewApi.setComposition(e.target.value);
                }}
              >
                {project.compositions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.width}×{c.height}・{formatFps(c.fps)}fps）
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </header>

      <main className="stage">
        <div className="preview" ref={panel} data-testid="preview-panel">
          {!project && !openError && (
            <p className="hint">「動画を開く…」で、project.json のあるフォルダを選んでください。</p>
          )}
          {openError && (
            <p className="notice" role="alert">
              開けませんでした：{openError}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
        </div>
        {project && project.issues.length > 0 && (
          <aside className="issues" aria-label="検査の問題">
            <h2>検査の問題（{project.issues.length} 件）</h2>
            <ul>
              {project.issues.slice(0, 20).map((i) => (
                <li key={`${i.path}|${i.message}`}>
                  <code>{i.path}</code> {i.message}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>

      <footer className="bar transport">
        <button type="button" disabled={!comp} onClick={() => void previewApi.seek(0)} title="最初へ（Home）">
          ⏮
        </button>
        <button type="button" disabled={!comp} onClick={() => void previewApi.step(-1)} title="1コマ戻る（←）">
          ◀
        </button>
        <button
          type="button"
          className="play"
          disabled={!comp}
          onClick={togglePlay}
          title={playing ? "止める（Space）" : "再生（Space）"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" disabled={!comp} onClick={() => void previewApi.step(1)} title="1コマ進む（→）">
          ▶|
        </button>
        <input
          type="range"
          aria-label="再生位置"
          min={0}
          max={comp ? comp.durationFrames - 1 : 0}
          value={frame}
          disabled={!comp}
          onChange={(e) => void previewApi.seek(Number(e.target.value))}
        />
        <button
          type="button"
          aria-pressed={muted}
          disabled={!comp}
          onClick={() => {
            setMuted(!muted);
            void previewApi.setMuted(!muted);
          }}
          title={muted ? "音を鳴らす" : "音を消す"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <span className="time" data-testid="timecode">
          {comp ? formatTimecode(frame, comp.fps) : "--:--:--:--"}
        </span>
        <span className="meta">
          {comp
            ? `コマ ${frame} ／ ${comp.durationFrames - 1}・${formatFps(comp.fps)}fps`
            : ""}
        </span>
        {status && comp && (
          <span className="meta" data-testid="speed">
            {status.playing || status.dropped > 0
              ? `描画 ${status.fps.toFixed(1)}fps・落としたコマ ${status.dropped}${status.audio ? "・音の時計" : ""}`
              : ""}
          </span>
        )}
        {notice && (
          <span className="meta notice-inline" role="status">
            {notice}
          </span>
        )}
      </footer>
    </div>
  );
}
