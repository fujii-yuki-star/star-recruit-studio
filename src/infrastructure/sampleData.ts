// 結線用のサンプル「テンプレ＋素材」。AI出力の変換コンテキスト兼、素材一覧の元データ。
// 本実装ではテンプレはテンプレフォルダ読込、素材はユーザー登録に置き換える（infrastructure 層に隔離）。
import type { Asset } from "../domain/project/types";
import type { Template } from "../domain/template/types";

export const sampleTemplates: Template[] = [
  {
    schemaVersion: "1.0",
    templateId: "opening_yuko_right_v1",
    name: "オープニング・ゆうこ右",
    category: "opening",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 12, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { durationSec: 8, transitionIn: "fade", transitionOut: "fade", backgroundColor: "#ffffff" },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: "title", type: "text", textKey: "title", required: true, x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72, fontWeight: "bold" },
      { id: "subtitle", type: "subtitle", textKey: "subtitle", x: 240, y: 920, w: 1440, h: 90, zIndex: 50, fontSize: 38, background: { enabled: true, color: "#000000", opacity: 0.55, radius: 16 } },
      { id: "logo", type: "logo", required: false, x: 1640, y: 60, w: 220, h: 120, zIndex: 60 },
      { id: "yuko", type: "character", required: false, x: 1450, y: 600, w: 360, h: 420, zIndex: 40 },
    ],
  },
  {
    schemaVersion: "1.0",
    templateId: "photo_left_text_right_yuko_v1",
    name: "写真左・説明右・ゆうこ",
    category: "photo_intro",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 15, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { durationSec: 10, transitionIn: "fade", transitionOut: "fade", backgroundColor: "#f5f5f5" },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, fillColor: "#f5f5f5" },
      { id: "mainVisual", type: "slot", slotType: "image_or_video", required: true, x: 80, y: 140, w: 1040, h: 800, zIndex: 10, fit: "cover" },
      { id: "title", type: "text", textKey: "title", required: true, x: 1230, y: 250, w: 560, h: 110, zIndex: 30, fontSize: 52, fontWeight: "bold" },
      { id: "subtitle", type: "subtitle", textKey: "subtitle", x: 240, y: 960, w: 1440, h: 90, zIndex: 50, fontSize: 38, background: { enabled: true, color: "#000000", opacity: 0.55, radius: 16 } },
      { id: "yuko", type: "character", required: false, x: 1500, y: 640, w: 340, h: 400, zIndex: 40 },
    ],
  },
  {
    // FREE テンプレ（自由配置の器・ADR-0008）。内容は scene.freeLayout に乗せる。AIは選ばない（手動専用）。
    schemaVersion: "1.0",
    templateId: "free_canvas_v1",
    name: "自由配置",
    category: "free",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    defaults: { durationSec: 8, backgroundColor: "#ffffff" },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, fillColor: "#ffffff" },
    ],
  },
];

export const sampleAssets: Asset[] = [
  { assetId: "asset_entrance_001", assetType: "image", displayName: "会社外観", filePath: "assets/images/entrance_001.jpg", tags: ["外観", "建物"], isPublicChecked: true },
  { assetId: "asset_office_001", assetType: "image", displayName: "オフィス写真", filePath: "assets/images/office_001.jpg", tags: ["オフィス"], isPublicChecked: true },
  { assetId: "asset_intro_clip_001", assetType: "video", displayName: "紹介クリップ", filePath: "assets/videos/intro_001.mp4", tags: ["紹介"], isPublicChecked: true, metadata: { durationSec: 12, hasAudio: true } },
  { assetId: "asset_logo_001", assetType: "logo", displayName: "会社ロゴ", filePath: "assets/images/logo.png", tags: ["logo"], isPublicChecked: true },
  { assetId: "yuko_smile_001", assetType: "yuko", displayName: "ゆうこ_笑顔", filePath: "assets/yuko/yuko_smile.png", tags: ["smile", "opening"], isDefaultYuko: true },
  { assetId: "yuko_guide_001", assetType: "yuko", displayName: "ゆうこ_案内", filePath: "assets/yuko/yuko_guide.png", tags: ["guide", "point"] },
  { assetId: "bgm_bright_001", assetType: "bgm", displayName: "やさしいBGM", filePath: "assets/bgm/bright_001.mp3", tags: ["bright"] },
];
