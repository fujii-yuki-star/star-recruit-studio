// タイムライン形式で**動画の実映像を出す**（#512 段1）。
//
// 場面形式の `SlotVideo`（`ScenePreview`）とは**時間の持ち主が違う**：あちらは「場面の先頭から d 秒後に
// 流し始める」で、こちらは**再生位置（グローバルな時刻）が正**＝つまみで飛ばせる。だから
// 「いまの再生位置なら素材のどこか」を毎回もらい、止まっているときはそのコマで静止する。
//
// ⚠️ **段1 は絵だけ**＝元の音はまだ流れないので**常に消音**（画面がその場で断る＝§2-5）。音は段2。
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Fit } from "../../domain/enums";

/** 再生中に「ずれた」とみなす幅（秒）。これ以内なら**掛け直さない**＝毎フレーム seek してカクつかせない。 */
const DRIFT_TOLERANCE_SEC = 0.25;

export function TimelineSlotVideo({
  src, rectPct, rotation, opacity, fit, sourceSec, speed, playing,
}: {
  src: string;
  rectPct: { left: string; top: string; width: string; height: string };
  rotation?: number;
  opacity?: number;
  fit: Fit;
  /** いまの再生位置に対応する**素材の中の秒**（トリム・速さ込み＝書き出しと同じ式から採る）。 */
  sourceSec: number;
  speed: number;
  playing: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // 自動再生不可（ポリシー）や非実装（jsdom）でも throw させない＝静止画で見える（§2-5）。
    const seek = (): void => {
      // ⚠️ **再生中は大きくずれたときだけ掛け直す**＝毎回入れると映像が跳ねる。
      const drift = Math.abs(v.currentTime - sourceSec);
      if (!playing || drift > DRIFT_TOLERANCE_SEC) {
        try { v.currentTime = sourceSec; } catch { /* seek 不可なら loadedmetadata で再設定 */ }
      }
      v.playbackRate = speed > 0 ? speed : 1;
      if (playing) {
        try {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch { /* noop */ }
      } else {
        try { v.pause(); } catch { /* noop */ }
      }
    };
    v.addEventListener("loadedmetadata", seek);
    if (v.readyState >= 1) seek();
    return () => {
      v.removeEventListener("loadedmetadata", seek);
      try { v.pause(); } catch { /* 非実装(jsdom)/停止不可でも無害 */ }
    };
  }, [src, sourceSec, speed, playing]);

  const style: CSSProperties = {
    position: "absolute",
    ...rectPct,
    // 収め方は SVG の `preserveAspectRatio` と同じ意味に写す（`cover`＝切って埋める／`contain`＝収める）。
    objectFit: fit === "cover" ? "cover" : fit === "contain" ? "contain" : "fill",
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...(opacity != null && opacity < 1 ? { opacity } : {}),
    pointerEvents: "none",
  };
  // ⚠️ **常に消音**（段1）＝元の音はまだ流れない。`muted` を外すのは段2（`useOriginalAudio`）。
  return <video ref={ref} src={src} style={style} muted playsInline preload="auto" />;
}
