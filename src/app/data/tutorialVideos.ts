// 同梱するチュートリアル映像の目録（#1229・ADR-0046 ①）。
//
// ⚠️ **外の動画サイトへ置かない**（`13`）＝このソフトは社内・オフラインで使われうるので、
// 再生に通信を要求しない。映像は `public/tutorials/` に置いて一緒に配る。
// ⚠️ **目録はここ1つ**（§2-7）＝画面は並べるだけにする。映像を足すときに触るのはこのファイルと
// `public/tutorials/` の2つで、食い違いは門番（`tutorialVideos.test.ts`）が落とす。

/** 同梱する映像1本ぶん。 */
export interface TutorialVideo {
  /** 目録の中で一意。並び替えても変わらない名札。 */
  id: string;
  /** 一覧に出す題（画面に出る文字＝技術用語を入れない・§2-3）。 */
  title: string;
  /** 何が分かる映像か（一覧の添え字）。 */
  desc: string;
  /** `public/tutorials/` の中のファイル名。 */
  file: string;
  /** 長さの目安（例「2分30秒」）。⚠️ 実際に撮れた長さを書く（見込みを書かない）。 */
  durationLabel: string;
}

/** 映像を置く場所（`public/` の下）。⚠️ **画面とテストで同じものを見る**＝綴りを2か所に書かない。 */
export const TUTORIAL_VIDEO_DIR = "tutorials";

/**
 * 同梱している映像。
 *
 * ⚠️ **撮れたものだけを並べる**＝「これから撮る予定」を先に並べない。並べると、
 * 押しても何も起きない項目ができる（§2-5＝押せるのに次の行動が無い、を作らない）。
 * 空のうちは画面が一覧ごと出さず、操作案内だけを出す。
 */
export const TUTORIAL_VIDEOS: readonly TutorialVideo[] = [];

/** 映像の置き場所（`<video>` に渡す道）。 */
export function tutorialVideoSrc(video: TutorialVideo): string {
  return `/${TUTORIAL_VIDEO_DIR}/${video.file}`;
}
