// 「採用動画」を扱う検査の手助け（ADR-0076＝採用動画は拡張パックの鍵 `recruit-video` で出す）。
//
// ⚠️ **新しい動画の土台は一般動画**になった（ADR-0076 決定4）＝`newProject()` のあとに会社情報の欄を
// 触る検査は、採用動画を**どちらの道で**用意したかを明示する：
// - `openAsRecruitVideo`＝以前に作った採用動画を開いている（鍵が無くても見直せる＝決定3）
// - `setRecruitVideoKey`＝拡張パックの鍵が入っている（ウィザードに「採用動画」のカードが出る＝決定2）
import type { ExtensionPackManifest } from "../domain/pack/extensionPack";
import { PACK_FEATURE } from "../domain/pack/extensionPack";
import { VIDEO_KIND } from "../domain/enums";
import { useProjectStore } from "../app/store/projectStore";

/** いま開いている動画を、保存済みの採用動画（会社情報は空）にする。⚠️ ウィザードを描く**前**に呼ぶ（開いたときの種類を見る）。 */
export function openAsRecruitVideo(companyName = ""): void {
  useProjectStore.setState((st) => ({
    meta: {
      ...st.meta,
      videoKind: VIDEO_KIND.recruit,
      purpose: "new_graduate",
      generalBrief: undefined,
      companyInfo: { companyName },
    },
  }));
}

/** 鍵 `recruit-video` だけを持つ拡張パック（検査用）。 */
export function recruitVideoPack(): ExtensionPackManifest {
  return {
    schemaVersion: "1.0",
    packId: "recruit_trial",
    name: "採用向け（検査用）",
    version: "1.0.0",
    publisher: "検査",
    minAppVersion: "0.7.0",
    contents: { features: [PACK_FEATURE.recruitVideo] },
    files: [],
    licenses: [{ target: "features", license: "社内利用" }],
  };
}

/** 拡張パックの鍵 `recruit-video` を入れる／外す。 */
export function setRecruitVideoKey(on: boolean): void {
  useProjectStore.setState({ packs: on ? [recruitVideoPack()] : [] });
}
