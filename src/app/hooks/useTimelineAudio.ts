// タイムラインの音（ADR-0032・#630 後半）。**鳴らす／止める／頭出しだけ**をここが担い、
// 「その瞬間に何がどの音量・速度で鳴るか」は domain の純粋関数（`audioCuesAt`）が決める＝時刻から一意に
// 決まるので、途中から再生してもシークしても同じ結果になる（絵の `playbackTick` と同じ考え方）。
import { useEffect, useRef } from "react";
import { audioCuesAt, audioLoops, audioSourceKeyOfClip } from "../../domain/timeline/audio";
import { attachVolume, closeAudioContext, type AudioCtxRef, type VolumeControl } from "../screens/previewAudioVolume";
import { useTimelineStore } from "../store/timelineStore";

/** 頭出しをやり直す閾値（秒）。これ未満のズレは直さない＝毎フレーム `currentTime` を触って音が途切れるのを防ぐ。 */
const RESYNC_THRESHOLD_SEC = 0.25;

/**
 * 再生中だけ音を鳴らし、再生位置に合わせる。
 *
 * - **音源は再生の前に用意しておく**（`timelineStore.audioSrcByKey`）＝鳴らす瞬間に読みに行くと頭が欠ける。
 *   キーは**音源の中身**なので、複製で増えたクリップも読み直さずに鳴る。
 * - **ズレが閾値を超えたときだけ頭出しをやり直す**。毎フレーム合わせにいくと音が途切れる。
 * - **鳴らせなかったものは覚えて再試行しない**＝毎フレーム要素を作り直さない（30個/秒 になる）。
 * - 止めたら・画面を離れたら・画面が隠れたら**全部止める**（鳴りっぱなしにしない）。
 */
export function useTimelineAudio(): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const playheadSec = useTimelineStore((s) => s.playheadSec);
  const doc = useTimelineStore((s) => s.doc);
  const audioSrcByKey = useTimelineStore((s) => s.audioSrcByKey);
  // 鳴らしている音（クリップ id → 要素）。React の描画とは独立に持つ（再描画で作り直さない）。
  const playingRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // 鳴らせなかったクリップ（端末/ブラウザの制限）。再試行しない。
  const failedRef = useRef<Set<string>>(new Set());
  /**
   * 音量の効かせ方（#724）。**100%超は要素の `.volume` では上がらない**（0〜1 が上限）ので、
   * 場面形式と同じ共有経路（`attachVolume`＝100%超で GainNode へ載せ替え）を通す。
   * ここを通さないと、**再生では 100% 止まりなのに書き出しだけ 150% で出る**＝聞いて確かめられない
   * （正典 `11 §7.6.2.2` が「書き出しを作るときに揃える」と書いていた宿題。書き出しは #631 で land 済み）。
   */
  const ctxRef = useRef<AudioContext | null>(null) as AudioCtxRef;
  const volumeRef = useRef<Map<string, VolumeControl>>(new Map());

  useEffect(() => {
    const playing = playingRef.current;
    const vols = volumeRef.current;
    const stopAll = (): void => {
      for (const el of playing.values()) el.pause();
      for (const v of vols.values()) v.dispose();
      playing.clear();
      vols.clear();
    };
    if (!isPlaying || !doc) {
      stopAll();
      return;
    }
    const cues = audioCuesAt(doc, playheadSec);
    const live = new Set(cues.map((c) => c.clipId));
    // 鳴り終わった（区間を出た）ものを止める。
    for (const [clipId, el] of playing) {
      if (!live.has(clipId)) {
        el.pause();
        vols.get(clipId)?.dispose();
        vols.delete(clipId);
        playing.delete(clipId);
      }
    }
    for (const cue of cues) {
      if (failedRef.current.has(cue.clipId)) continue;
      const clip = doc.clips.find((c) => c.id === cue.clipId);
      const key = clip ? audioSourceKeyOfClip(clip) : null;
      const src = key ? audioSrcByKey[key] : undefined;
      if (!clip || !src) continue; // 音源がまだ無い（読み上げ未作成・読み込み失敗）＝鳴らすものが無い
      let el = playing.get(cue.clipId);
      if (!el) {
        el = new Audio(src);
        el.loop = audioLoops(clip); // BGM は素材が短くても鳴り続ける（場面形式と同じ）
        playing.set(cue.clipId, el);
        el.currentTime = cue.offsetSec;
        const started = el;
        void el.play().catch(() => {
          // 端末/ブラウザの制限で鳴らせないことがある。絵は進めたいのでここでは落とさず、
          // **同じクリップを二度と試さない**（毎フレーム作り直さない）。
          started.pause();
          failedRef.current.add(cue.clipId);
          // 追跡から外すのは**この要素がまだ現役のとき**だけ（シークで作り直した新しい方を外さない）。
          if (playing.get(cue.clipId) === started) playing.delete(cue.clipId);
        });
      } else if (Math.abs(el.currentTime - cue.offsetSec) > RESYNC_THRESHOLD_SEC) {
        el.currentTime = cue.offsetSec; // シーク・コマ落ちで離れたときだけ合わせ直す
      }
      el.playbackRate = cue.speed; // 頭出しだけ合わせても、速度が違えばずれ続ける
      // **100%超も書き出しと同じだけ上げる**（#724）＝場面形式と同じ共有経路。要素の `.volume` は
      // 0〜1 が上限なので、そのまま入れると再生だけ 100% 止まりになり、書き出しと聞き比べられない。
      let vol = vols.get(cue.clipId);
      if (!vol) {
        vol = attachVolume(ctxRef, el, cue.volume, false);
        vols.set(cue.clipId, vol);
      } else {
        vol.setVolume(cue.volume);
      }
    }
  }, [isPlaying, playheadSec, doc, audioSrcByKey]);

  // 画面が隠れたら止める＝時計（rAF）が止まって位置が進まない間、音だけ実時間で進み続けるのを防ぐ。
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") useTimelineStore.getState().pause();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  // 画面を離れたら全部止める（鳴らしっぱなしにしない）。音量の経路と AudioContext も畳む
  // （開きっぱなしにすると端末の音声資源を掴んだままになる＝場面形式と同じ後始末）。
  useEffect(() => {
    const playing = playingRef.current;
    const vols = volumeRef.current;
    const ctx = ctxRef;
    return () => {
      for (const el of playing.values()) el.pause();
      for (const v of vols.values()) v.dispose();
      playing.clear();
      vols.clear();
      closeAudioContext(ctx);
    };
  }, []);
}
