# データスキーマ設計書

> ⚠️ **本書は理解のための「例示」です。** 型・必須・enum・制約・ID規則・バインディング・解決順序の**正典は [`11_SCHEMA_REFERENCE.md`](11_SCHEMA_REFERENCE.md) と [`schemas/*.schema.json`](schemas/)**。矛盾時は正典を優先します。
> 本書作成後に確定した差分: `purpose` を project に追加 / `scene.audioMix`（音量上書き）を新設 / `assetRefs`⇄レイヤーのバインディング契約（`11 §5`）/ enum・定数の一元化（`11 §3,§4`）。

## 1. 目的

本資料は、「すたりお（stario）」で利用する主要JSONデータの構造を定義する。

本ソフトは、AIが返す動画構成JSON、ユーザーが登録する素材情報、テンプレート情報、プロジェクト情報を組み合わせて動画を生成するため、データスキーマを明確にしておくことが重要である。

---

## 2. 基本方針

- すべての主要データはJSONで保存する。
- プロジェクト単位でフォルダを作成する。
- 素材ファイルはプロジェクトフォルダ内にコピーして管理する。
- AI出力は直接信用せず、必ず検証してから内部データに変換する。
- ユーザー向け画面ではIDやJSONを原則表示しない。

---

## 3. プロジェクトフォルダ構成

```text
project-name/
  project.json
  assets/
    images/
    videos/
    bgm/
    yuko/
    decor/
  voices/
    scene_001.wav
    scene_002.wav
  thumbnails/
  ai/
    latest_result.json
    history/
  renders/
    preview/
    export/
  templates/
    imported/
```

---

## 4. project.json

プロジェクト全体を管理するファイル。

```json
{
  "schemaVersion": "1.0",
  "projectId": "proj_20260610_001",
  "projectName": "会社紹介動画",
  "createdAt": "2026-06-10T10:00:00+09:00",
  "updatedAt": "2026-06-10T10:30:00+09:00",
  "videoSettings": {
    "aspectRatio": "16:9",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "targetDurationSec": 300,
    "maxDurationSec": 600
  },
  "companyInfo": {
    "companyName": "株式会社サンプル",
    "industry": "IT",
    "businessDescription": "業務システム開発を中心に行う会社です。",
    "recruitTarget": "新卒採用",
    "jobType": "エンジニア",
    "strengths": ["相談しやすい環境", "若手が成長しやすい"],
    "desiredPerson": "学ぶ姿勢がある方",
    "recruitUrl": "https://example.com/recruit"
  },
  "toneSettings": {
    "tone": "親しみやすい",
    "yukoPersonality": "丁寧で明るい",
    "formality": "standard"
  },
  "voiceSettings": {
    "defaultVoiceId": "voicevox_zundamon",
    "speed": 1.0,
    "pitch": 0.0,
    "intonation": 1.0,
    "volume": 1.0
  },
  "bgmSettings": {
    "enabled": true,
    "assetId": "bgm_bright_001",
    "volume": 0.25,
    "loop": true,
    "fadeInSec": 1.5,
    "fadeOutSec": 2.0
  },
  "assets": [],
  "parts": [],
  "scenes": []
}
```

---

## 5. Assetスキーマ

画像、動画、BGM、ゆうこ素材、装飾アセットを統一的に管理する。

```json
{
  "assetId": "asset_office_001",
  "assetType": "image",
  "displayName": "オフィス写真",
  "filePath": "assets/images/office_001.jpg",
  "thumbnailPath": "thumbnails/asset_office_001.jpg",
  "mimeType": "image/jpeg",
  "tags": ["office", "workplace"],
  "description": "若手社員が作業しているオフィス写真",
  "aiDescription": "明るいオフィスで複数人が作業している写真",
  "isPublicChecked": false,
  "metadata": {
    "width": 1920,
    "height": 1080,
    "durationSec": null,
    "hasAudio": false
  }
}
```

### assetType一覧

| 値 | 内容 |
|---|---|
| image | 画像素材 |
| video | 動画素材 |
| bgm | BGM素材 |
| voice | ナレーション音声 |
| yuko | ゆうこ素材 |
| decor | 装飾アセット |
| logo | 会社ロゴ |
| qr | QRコード |

---

## 6. 動画素材設定

動画素材をシーンで使う場合の設定。

```json
{
  "assetId": "asset_meeting_video_001",
  "clip": {
    "startSec": 3.5,
    "endSec": 12.0,
    "useOriginalAudio": false,
    "originalAudioVolume": 0.2
  }
}
```

---

## 7. Partスキーマ

長尺動画の章・パートを表す。

```json
{
  "partId": "part_001",
  "title": "会社紹介",
  "description": "会社概要と事業内容を紹介するパート",
  "order": 1,
  "sceneIds": ["scene_001", "scene_002"],
  "targetDurationSec": 60
}
```

---

## 8. Sceneスキーマ

シーンカードの内部データ。

```json
{
  "sceneId": "scene_001",
  "partId": "part_001",
  "order": 1,
  "sceneType": "opening",
  "templateId": "opening_yuko_right_v1",
  "durationSec": 8,
  "assetRefs": {
    "background": "asset_entrance_001",
    "mainVisual": null,
    "logo": "asset_logo_001"
  },
  "character": {
    "enabled": true,
    "characterId": "yuko",
    "poseAssetId": "yuko_smile_001"
  },
  "texts": {
    "title": "株式会社サンプルへようこそ",
    "main": "若手が活躍できる職場です",
    "subtitle": "今日は株式会社サンプルの魅力を紹介します。"
  },
  "narration": {
    "text": "こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。",
    "voiceId": "voicevox_zundamon",
    "speed": 1.0,
    "pitch": 0.0,
    "intonation": 1.0,
    "voicePath": "voices/scene_001.wav",
    "status": "generated"
  },
  "transition": {
    "in": "fade",
    "out": "fade",
    "durationSec": 0.5
  },
  "warnings": []
}
```

---

## 9. Templateスキーマ概要

詳細は `04_TEMPLATE_SPEC.md` で定義する。

```json
{
  "templateId": "photo_text_panel_yuko_v1",
  "name": "写真＋説明パネル＋ゆうこ",
  "category": "photo_intro",
  "aspectRatio": "16:9",
  "canvas": {
    "width": 1920,
    "height": 1080
  },
  "layers": []
}
```

---

## 10. AI出力JSON

AIから返ってくる動画構成案。内部Sceneとは分ける。

```json
{
  "schemaVersion": "1.0",
  "videoPlan": {
    "title": "会社紹介動画",
    "purpose": "new_graduate_recruit",
    "targetDurationSec": 300
  },
  "parts": [
    {
      "title": "オープニング",
      "summary": "動画の導入",
      "scenes": [
        {
          "sceneType": "opening",
          "templateId": "opening_yuko_right_v1",
          "assetRefs": {
            "background": "asset_entrance_001"
          },
          "yukoPoseTag": "smile",
          "texts": {
            "title": "株式会社サンプルへようこそ",
            "main": "若手が活躍できる職場です",
            "subtitle": "今日は会社の魅力を紹介します。"
          },
          "narrationText": "こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。",
          "durationSec": 8
        }
      ]
    }
  ]
}
```

---

## 11. ステータス定義

### 音声生成ステータス

| 値 | 内容 |
|---|---|
| none | 未生成 |
| pending | 生成待ち |
| generated | 生成済み |
| failed | 生成失敗 |

### レンダリングステータス

| 値 | 内容 |
|---|---|
| idle | 未実行 |
| running | 実行中 |
| completed | 完了 |
| failed | 失敗 |

---

## 12. バージョン管理

各JSONには `schemaVersion` を持たせる。
将来の仕様変更時はマイグレーション処理を用意する。

```json
{
  "schemaVersion": "1.0"
}
```
