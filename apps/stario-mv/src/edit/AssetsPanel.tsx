import type { Asset } from "./types";

/** 素材の種類の呼び名（schema の `Asset.kind`）。 */
export const ASSET_KIND_LABEL: Record<Asset["kind"], string> = {
  video: "映像",
  image: "画像",
  imageSequence: "連番",
  svg: "SVG",
  audio: "音",
};

/** 素材の一覧の1行に添える情報（大きさ・長さ・指紋）。 */
export function assetSummary(a: Asset): string {
  const m = a.meta ?? {};
  const parts: string[] = [];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  if (m.durationSec != null) parts.push(`${m.durationSec.toFixed(1)} 秒`);
  else if (m.frameCount != null) parts.push(`${m.frameCount} コマ`);
  if (m.hasAlpha) parts.push("透過");
  parts.push(a.sha256 ? "指紋あり" : "指紋なし");
  return parts.join("・");
}

/**
 * 素材の一覧（MV-0008 決定7）＝種類・大きさ・長さ・指紋の有無を並べ、「取り込む…」で取り込む（コピーが標準）。
 * タイムラインへ運ぶと、落とした時刻から置ける（決定4）。「置く」は今の時刻に置く。
 * ⚠️ 運ぶのは Pointer Events（WebView の HTML5 の運び方は部品によって起きない）。
 */
export function AssetsPanel(props: {
  assets: readonly Asset[];
  disabled: boolean;
  onImport: () => void;
  onDragStart: (a: Asset) => void;
  onPlace: (a: Asset) => void;
}): React.JSX.Element {
  return (
    <div className="assets-panel">
      <div className="assets-head">
        <h2>素材</h2>
        <button type="button" disabled={props.disabled} onClick={props.onImport} title="素材のファイルを選んで取り込む（動画のフォルダへ写す）">
          取り込む…
        </button>
      </div>
      {props.assets.length === 0 && <p className="muted">まだ素材がありません。</p>}
      <ul className="assets">
        {props.assets.map((a) => (
          <li
            key={a.id}
            data-testid={`asset-${a.id}`}
            title={`${a.name}（${a.id}）＝タイムラインへ運ぶと、落とした時刻から置けます`}
            onPointerDown={(e) => {
              if (e.button !== 0 || props.disabled || (e.target as HTMLElement).closest("button")) return;
              e.preventDefault();
              props.onDragStart(a);
            }}
          >
            <span className="asset-name">
              <span className="kind">{ASSET_KIND_LABEL[a.kind] ?? a.kind}</span> {a.name}
            </span>
            <span className="asset-meta">{assetSummary(a)}</span>
            <button
              type="button"
              className="asset-place"
              disabled={props.disabled}
              onClick={() => props.onPlace(a)}
              title="今の時刻から置く（いちばん手前に）"
            >
              置く
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
