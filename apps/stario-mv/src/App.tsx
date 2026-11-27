import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { previewApi, type PreviewStatus, type ProjectSummary } from "./preview/api";
import { formatFps, formatTimecode } from "./preview/timecode";
import { Timeline } from "./edit/Timeline";
import { Splitter } from "./edit/Splitter";
import { usePaneSizes } from "./edit/layout";
import { useEditor } from "./edit/useEditor";
import { editKey, editOps } from "./edit/editKeys";
import { compBlurOp, precomposeOp, sequenceOps, toggleTimeRemapOps } from "./edit/layerOps";
import { keyId, liveKeys, removeKeysOps, revealAnimated, toggleReveal, type Reveal } from "./edit/keyframes";
import { PropsPanel } from "./edit/PropsPanel";
import { PreviewOverlay } from "./edit/PreviewOverlay";
import { AssetsPanel } from "./edit/AssetsPanel";
import { editApi } from "./edit/api";
import type { Asset } from "./edit/types";
import type { Op } from "./edit/types";
import "./styles.css";

/** アプリの名前（窓の題・画面の見出しで同じものを使う）。 */
export const APP_TITLE = "すたりおMV";

/**
 * 編集画面（γ0.1 の段階⑦ プレビュー＝MV-0007・段階⑧ 編集＝MV-0008）。
 * 上段＝左に素材の一覧・真ん中にプレビュー・右に値の欄、下段＝タイムライン（AE の型＝MV-0008 決定3）。
 * ⚠️ プレビューの欄は**透明に抜く**＝その下に Rust の描画の核が窓へ直接描いている（MV-0002）。
 * ⚠️ 画面の編集は全部、外部 AI と同じ取引で反映する（MV-0008 決定1）。
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
  const editor = useEditor(project?.dir ?? null);
  const [sizes, setSize] = usePaneSizes();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  // レイヤー＋キーフレームの画面（MV-0014）＝開いているレイヤー・選んだキー（画面の好み＝保存しない）
  const [revealed, setRevealed] = useState<ReadonlyMap<string, Reveal>>(new Map());
  const [keyIds, setKeyIds] = useState<string[]>([]);
  // 吸着は既定で入（Premiere の型・MV-0008 決定4）
  const [snapping, setSnapping] = useState(true);
  // 素材の一覧から運んでいる素材（タイムラインへ落とすと置く＝MV-0008 決定4・7）
  const [dragAsset, setDragAsset] = useState<Asset | null>(null);
  useEffect(() => {
    if (!dragAsset) return;
    // ⚠️ 落とす先がタイムラインでなくても、離したら運ぶのをやめる（タイムラインの受け取りのあとに来る）
    const stop = (): void => setDragAsset(null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, [dragAsset]);

  const comp = project?.compositions.find((c) => c.id === compId) ?? null;
  const frame = status?.compositionId === compId ? status.frame : 0;
  const playing = status?.playing ?? false;
  const editComp = editor.doc?.project.compositions.find((c) => c.id === compId) ?? null;
  // 消えたレイヤーを選んだままにしない
  const selected = useMemo(
    () => new Set(selectedIds.filter((id) => editComp?.layers.some((l) => l.id === id))),
    [selectedIds, editComp],
  );
  // 消えた・動いたキーを選んだままにしない
  const selectedKeys = useMemo(
    () => (editComp ? liveKeys(editComp, keyIds) : []),
    [keyIds, editComp],
  );
  const selectedKeyIds = useMemo(() => new Set(selectedKeys.map(keyId)), [selectedKeys]);
  const selectedLayer = selected.size === 1 ? (editComp?.layers.find((l) => selected.has(l.id)) ?? null) : null;
  const { commit: editCommit, refresh: editRefresh } = editor;
  const commit = useCallback(
    (ops: Op[]): Promise<boolean> => (ops.length > 0 ? editCommit(ops) : Promise.resolve(false)),
    [editCommit],
  );

  // 開こうとした動画のフォルダ（開けなかったとき、履歴から開き直すため）
  const [triedDir, setTriedDir] = useState<string | null>(null);
  const open = useCallback(async (dir: string) => {
    setTriedDir(dir);
    try {
      const s = await previewApi.openProject(dir);
      setProject(s);
      setCompId(s.mainCompositionId);
      setStatus(null);
      setOpenError(null);
      setSelectedIds([]);
    } catch (e) {
      setOpenError(String(e));
    }
  }, []);

  // 外（AI）か自分の保存で中身が変わった＝編集に使う全体も読み直す（最新の手続きを見る）
  const refreshRef = useRef(editRefresh);
  useEffect(() => {
    refreshRef.current = editRefresh;
  }, [editRefresh]);

  useEffect(() => {
    const offs = [
      previewApi.onStatus(setStatus),
      previewApi.onError(setError),
      previewApi.onNotice(setNotice),
      previewApi.onProjectChanged((s) => {
        setProject(s);
        setCompId((id) => (s.compositions.some((c) => c.id === id) ? id : s.mainCompositionId));
        void refreshRef.current();
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
  // 編集（MV-0008 決定4）：[ ]＝始まり／終わりを今の時刻へ・Alt+[ ]＝今の時刻で切る・Ctrl+Shift+D＝分割・
  // Delete＝消す・Shift+Delete＝消して詰める・Ctrl+] [＝重なりの順・Ctrl+A＝全部選ぶ・S＝吸着の切り替え
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!comp) return;
      const t = e.target as HTMLElement | null;
      // ⚠️ 文字を打っている欄では、欄の取り消し（Ctrl+Z）などを奪わない
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") && e.key !== " ") return;
      const edit = editKey(e);
      if (edit) {
        if (!editComp) return;
        e.preventDefault();
        if (edit === "selectAll") setSelectedIds(editComp.layers.map((l) => l.id));
        else if (edit === "snap") setSnapping((v) => !v);
        else if (edit === "undo") void editor.undo();
        else if (edit === "precompose") {
          const op = precomposeOp(editComp, selected, "入れ子");
          if (op) void commit([op]);
        }
        else if (edit === "timeRemap") {
          const ops = toggleTimeRemapOps(editComp, selected);
          if (ops.length > 0) void commit(ops);
        }
        else if (edit === "reveal") setRevealed((r) => revealAnimated(r, editComp, selected));
        else if (edit === "remove" && selectedKeys.length > 0) {
          // キーが選ばれていれば、レイヤーより先にキーを消す（MV-0014 決定2）
          void commit(removeKeysOps(editComp, selectedKeys));
          setKeyIds([]);
        }
        else if (edit === "redo") void editor.redo();
        else commit(editOps(edit, editComp, selected, frame));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  }, [comp, togglePlay, editComp, selected, selectedKeys, frame, commit, editor]);

  // 入れ子の中を開く（MV-0011 決定5）＝上のコンポジションの選択を切り替える
  const openComposition = (id: string): void => {
    setCompId(id);
    setSelectedIds([]);
    void previewApi.setComposition(id);
  };

  const pick = async (): Promise<void> => {
    const dir = await previewApi.pickProjectFolder();
    if (dir) await open(dir);
  };

  return (
    <div className="app" style={{ gridTemplateRows: `40px 1fr 5px ${sizes.bottom}px 48px` }}>
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
                onChange={(e) => openComposition(e.target.value)}
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

      <main className="stage" style={{ gridTemplateColumns: `${sizes.left}px 5px 1fr 5px ${sizes.right}px` }}>
        <aside className="pane" aria-label="素材の一覧">
          <AssetsPanel
            assets={editor.doc?.project.assets ?? []}
            disabled={!editComp}
            onImport={() => {
              void editApi.pickAssets().then((paths) => {
                // ⚠️ commit も空の取引は送らない（二重の守り＝ここを外しても同じ結果・変異チェックで確かめた）
                if (paths.length > 0) void commit(paths.map((path) => ({ op: "importAsset", path, mode: "copy" })));
              });
            }}
            onDragStart={setDragAsset}
            onPlace={(a) => void commit([placeAssetOp(a, frame, compId)])}
          />
        </aside>
        <Splitter
          orientation="vertical"
          label="素材の一覧の幅"
          value={sizes.left}
          sign={1}
          onChange={(v) => setSize("left", v)}
        />
        <div className="preview" ref={panel} data-testid="preview-panel">
          {editComp && (
            <PreviewOverlay
              panel={panel}
              layers={editComp.layers}
              selectedId={selectedLayer?.id ?? null}
              frame={frame}
              playing={playing}
              docKey={editComp}
              onSelect={(id) => {
                setSelectedIds(id ? [id] : []);
                setAnchor(id);
              }}
              onTrial={editor.trial}
              onCommit={commit}
            />
          )}
          {!project && !openError && (
            <p className="hint">「動画を開く…」で、project.json のあるフォルダを選んでください。</p>
          )}
          {openError && (
            <div className="notice" role="alert">
              <p>開けませんでした：{openError}</p>
              {/* 落ちて壊れたとき（MV-0009 決定5）＝押すまで何も書かない */}
              {triedDir && (
                <button
                  type="button"
                  onClick={() => {
                    void editApi.recover(triedDir).then(
                      () => open(triedDir),
                      (e: unknown) => setOpenError(String(e)),
                    );
                  }}
                >
                  履歴の最後の状態から開く
                </button>
              )}
            </div>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
        </div>
        <Splitter
          orientation="vertical"
          label="値の欄の幅"
          value={sizes.right}
          sign={-1}
          onChange={(v) => setSize("right", v)}
        />
        <aside className="pane" aria-label="値の欄">
          <h2>選んだレイヤー</h2>
          {selectedLayer && comp ? (
            <dl className="props" data-testid="layer-props">
              <dt>名前</dt>
              <dd>{selectedLayer.name}</dd>
              <dt>種類</dt>
              <dd>{selectedLayer.type}</dd>
              <dt>見える範囲</dt>
              <dd>
                {formatTimecode(selectedLayer.inFrame, comp.fps)} 〜{" "}
                {formatTimecode(selectedLayer.outFrame - 1, comp.fps)}
              </dd>
              <dt>長さ</dt>
              <dd>{selectedLayer.outFrame - selectedLayer.inFrame} コマ</dd>
            </dl>
          ) : null}
          {selectedLayer && comp ? (
            <PropsPanel
              layer={selectedLayer}
              frame={frame}
              fps={editComp ? editComp.fps.num / editComp.fps.den : 30}
              onTrial={editor.trial}
              onCommit={commit}
              onSeek={(f) => void previewApi.seek(f)}
            />
          ) : (
            <p className="muted">
              {selected.size > 1
                ? `${selected.size} 個のレイヤーを選んでいます。`
                : "タイムラインでレイヤーを選んでください。"}
            </p>
          )}
          {project && project.issues.length > 0 && (
            <section className="issues" aria-label="検査の問題">
              <h2>検査の問題（{project.issues.length} 件）</h2>
              <ul>
                {project.issues.slice(0, 20).map((i) => (
                  <li key={`${i.path}|${i.message}`}>
                    <code>{i.path}</code> {i.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </main>

      <Splitter
        orientation="horizontal"
        label="タイムラインの高さ"
        value={sizes.bottom}
        sign={-1}
        onChange={(v) => setSize("bottom", v)}
      />
      <section className="tl-pane" aria-label="タイムライン">
        <div className="bar tl-tools">
          <button
            type="button"
            disabled={!editor.history.undo}
            onClick={() => void editor.undo()}
            title={editor.history.undo ? `元に戻す（Ctrl+Z）：${editor.history.undo}` : "元に戻せる操作はありません"}
          >
            元に戻す
          </button>
          <button
            type="button"
            disabled={!editor.history.redo}
            onClick={() => void editor.redo()}
            title={editor.history.redo ? `やり直す（Ctrl+Shift+Z）：${editor.history.redo}` : "やり直せる操作はありません"}
          >
            やり直す
          </button>
          <button
            type="button"
            aria-pressed={snapping}
            onClick={() => setSnapping((v) => !v)}
            title="吸着（S）＝今の時刻・始まりと終わり・ほかのレイヤーの端・マーカーに吸い付く"
          >
            吸着
          </button>
          <button
            type="button"
            disabled={!editComp}
            aria-label="コンポジションのモーションブラー"
            aria-pressed={editComp?.motionBlur?.enabled === true}
            onClick={() => editComp && commit([compBlurOp(editComp)])}
            title="このコンポジションのモーションブラー（行の「M」が入ったレイヤーだけにかかる）"
          >
            モーションブラー
          </button>
          <button
            type="button"
            disabled={!editComp}
            onClick={() =>
              editComp &&
              commit([{ op: "addLayer", compositionId: editComp.id, index: 0, layer: { name: "ヌル", type: "null" } }])
            }
            title="ヌル（描かれない入れ物）を、いちばん手前に足す＝親にして、まとめて動かすため"
          >
            ヌルを足す
          </button>
          <button
            type="button"
            disabled={!editComp || selected.size === 0}
            onClick={() => {
              const op = editComp && precomposeOp(editComp, selected, "入れ子");
              if (op) void commit([op]);
            }}
            title="選んだレイヤーを新しいコンポジションへ移し、入れ子1つに置き換える（Ctrl+Shift+C）"
          >
            プリコンポーズ
          </button>
          <button
            type="button"
            disabled={!editComp || selected.size < 2}
            onClick={() => editComp && commit(sequenceOps(editComp, selected))}
            title="選んだレイヤーを、時間の順に隙間なく並べ直す"
          >
            詰める
          </button>
          {editor.error && (
            <span className="tl-msg warn" role="alert">
              {editor.error}
            </span>
          )}
          {editor.notice && (
            <span className="tl-msg" role="status">
              {editor.notice}
            </span>
          )}
        </div>
        {editComp ? (
          <Timeline
            comp={editComp}
            playhead={frame}
            selected={selected}
            anchor={anchor}
            snapping={snapping}
            onSelect={(ids, a) => {
              setSelectedIds(ids);
              setAnchor(a);
            }}
            onSeek={(f) => void previewApi.seek(f)}
            onTrial={editor.trial}
            onCommit={commit}
            assetDragging={dragAsset != null}
            onOpenNested={openComposition}
            revealed={revealed}
            onToggleReveal={(id) => setRevealed((r) => toggleReveal(r, id))}
            selectedKeys={selectedKeyIds}
            onSelectKeys={setKeyIds}
            onDropAsset={(f) => {
              if (dragAsset) void commit([placeAssetOp(dragAsset, f, compId)]);
            }}
          />
        ) : (
          <p className="muted tl-empty">{project ? "読み込んでいます…" : ""}</p>
        )}
      </section>

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
          {comp ? `コマ ${frame} ／ ${comp.durationFrames - 1}・${formatFps(comp.fps)}fps` : ""}
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

/** 素材をタイムラインへ置く取引（`frame` から始まり、いちばん手前に＝AE の型・MV-0008 決定4・7）。 */
export function placeAssetOp(a: Asset, frame: number, compositionId: string): Op {
  return {
    op: "addLayer",
    compositionId,
    index: 0,
    layer: { name: a.name, assetId: a.id, inFrame: Math.max(0, frame) },
  };
}

