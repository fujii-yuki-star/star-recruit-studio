// 書き出し（H.264）能力の状態と、非技術者向けの案内文言（#120・ADR-0013）。
// 実判定は Rust（ffmpeg -encoders → h264_capability）で行い、本モジュールは状態→表示の写像（純粋）。
// 関連: h264Feature.ts は OpenH264 フォールバック機能の準備状態（#115）＝別概念。こちらは
// 「実行時にどの方式で書き出せるか」の事前検知（公開前チェック）を表す。

/**
 * 書き出し能力の状態。
 * - mediaFoundation: 標準方式（OS提供の h264_mf）で書き出せる。
 * - fallback: 標準方式は使えないが予備方式で書き出しは可能（Windows N/KN でメディア機能パック未導入など）。
 * - unavailable: 書き出しに対応した機能が見つからない（書き出し不可）。
 * - toolMissing: 書き出しツール自体が見つからない。
 */
export type ExportCapability = 'mediaFoundation' | 'fallback' | 'unavailable' | 'toolMissing';

/** 公開前チェックに出す案内。severity は PrecheckItem と同じ語彙。§2-5：次の行動を示す。 */
export interface ExportCapabilityNotice {
  severity: 'ok' | 'warning' | 'action';
  label: string;
  detail: string;
}

export const EXPORT_CAPABILITY_NOTICE: Record<ExportCapability, ExportCapabilityNotice> = {
  mediaFoundation: {
    severity: 'ok',
    label: '動画の書き出し',
    detail: 'この端末は標準の方式で動画を書き出せます。',
  },
  fallback: {
    severity: 'warning',
    label: '動画の書き出し',
    detail:
      'この端末では標準の書き出し方式が使えないため、予備の方式で書き出します（このまま進められます）。お使いの Windows が N／KN 版の場合は「メディア機能パック」を追加すると、標準の方式が使えるようになります。',
  },
  unavailable: {
    severity: 'action',
    label: '動画の書き出し',
    detail:
      'この端末では動画を書き出せません。お使いの Windows が N／KN 版の場合は「メディア機能パック」を追加してから、もう一度お試しください。解決しない場合はお問い合わせください。',
  },
  toolMissing: {
    severity: 'action',
    label: '動画の書き出し',
    detail:
      '動画の書き出しに必要な準備が見つかりませんでした。アプリを入れ直すか、設定をご確認のうえ、もう一度お試しください。',
  },
};

/** 書き出しを事前に止めるべき状態か。fallback は書き出し可能なのでブロックしない（#120）。 */
export function blocksExport(cap: ExportCapability): boolean {
  return cap === 'unavailable' || cap === 'toolMissing';
}
