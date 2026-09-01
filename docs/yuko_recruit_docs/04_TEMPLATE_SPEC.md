# テンプレート仕様書

## 1. 目的

本資料は、「すたりお（stario）」におけるテンプレート、すなわちユーザー向け表現でいう「見た目パターン」の仕様を定義する。

テンプレートは、AIが生成した動画構成JSONを実際の画面レイアウトに変換するためのルールである。

---

## 2. 基本方針

- テンプレートはJSONで定義する。
- ユーザー向けには「見た目パターン」と呼ぶ。
- 採用担当者にはJSONを直接見せない。
- 初期はテンプレートパック取り込み方式を採用する。
- テンプレート作成エディタを提供する（ADR-0017・EPIC #214 で実装済み＝ゼロから作成も可。同梱は読み取り専用で複製して編集／自作はグローバル保存）。
- ゆうこの表示有無・位置・サイズはテンプレートごとに決める。
- 半透明パネル、字幕背景、タイトル帯などの装飾アセットを扱える。

---

## 3. テンプレートパック構成

```text
template_pack_name/
  template.json
  thumbnail.png
  sample.png
  README.md
  assets/
    decor_panel.png
    background.png
```

### 必須ファイル

| ファイル | 内容 |
|---|---|
| template.json | テンプレート定義 |
| thumbnail.png | 一覧表示用サムネイル |

### 任意ファイル

| ファイル | 内容 |
|---|---|
| sample.png | サンプル表示画像 |
| README.md | テンプレート説明 |
| assets/ | テンプレート固有装飾素材 |

---

## 4. template.json 基本構造

```json
{
  "schemaVersion": "1.0",
  "templateId": "photo_text_panel_yuko_v1",
  "name": "写真＋説明パネル＋ゆうこ",
  "description": "オフィス紹介や社員紹介に向いた見た目パターン",
  "category": "photo_intro",
  "aspectRatio": "16:9",
  "canvas": {
    "width": 1920,
    "height": 1080
  },
  "aiHint": {
    "useCase": "オフィス紹介、社員紹介、仕事風景紹介",
    "recommendedSceneTypes": ["office", "member", "work_intro"],
    "maxNarrationLength": 120,
    "maxSubtitleLength": 60
  },
  "defaults": {
    "durationSec": 8,
    "transitionIn": "fade",
    "transitionOut": "fade",
    "backgroundColor": "#ffffff"
  },
  "layers": []
}
```

---

## 5. category一覧

| category | 用途 |
|---|---|
| opening | オープニング |
| closing | クロージング |
| photo_intro | 写真紹介 |
| video_intro | 動画紹介 |
| point_list | ポイント紹介 |
| message | メッセージ表示 |
| full_visual | 全画面素材表示 |
| chapter | パート切り替え |
| no_yuko | ゆうこなし |

---

## 6. レイヤー構造

テンプレートは複数のレイヤーで構成する。
上から順に描画するか、`zIndex` で描画順を決める。

```json
{
  "id": "mainVisual",
  "type": "slot",
  "slotType": "image_or_video",
  "x": 80,
  "y": 140,
  "w": 1100,
  "h": 760,
  "zIndex": 10,
  "fit": "cover"
}
```

---

## 7. layer.type一覧

| type | 内容 |
|---|---|
| slot | シーン素材を流し込む領域 |
| text | テキスト表示領域 |
| character | ゆうこ素材表示領域 |
| decor | 装飾アセット |
| shape | 図形・パネル |
| background | 背景 |
| logo | ロゴ表示領域 |
| subtitle | 字幕表示領域 |

---

## 8. slotレイヤー

画像・動画素材を流し込む領域。

```json
{
  "id": "mainVisual",
  "type": "slot",
  "slotType": "image_or_video",
  "required": true,
  "x": 80,
  "y": 140,
  "w": 1100,
  "h": 760,
  "fit": "cover",
  "zIndex": 10
}
```

### fit一覧

この表は fit 値の**挙動**（実装向け）。**利用者に見せるラベル**は `06_UI_SPEC §9`（シーン編集→右パネル・枠いっぱい／全体／伸縮）で、実体は共有 `src/app/uiLabels.ts` の `fitLabel`（FitSelect・テンプレ編集が共用＝#547 P2-10）。UI 文言はそちらを単一の参照元にし、この挙動説明をそのままボタン文言に流用しない。

| 値 | 内容（挙動） |
|---|---|
| cover | 領域を埋める。はみ出し部分は切る |
| contain | 全体を収める。余白が出る場合あり |
| stretch | 領域に引き伸ばす |

---

## 9. textレイヤー

タイトル、本文、補足文など。

```json
{
  "id": "title",
  "type": "text",
  "textKey": "title",
  "required": true,
  "x": 1180,
  "y": 250,
  "w": 540,
  "h": 80,
  "fontSize": 48,
  "fontWeight": "bold",
  "color": "#222222",
  "maxLines": 1,
  "autoResize": true,
  "zIndex": 30
}
```

### 文字あふれ時の処理

1. 自動改行
2. フォントサイズ縮小
3. 最大行数超過時は警告
4. 「AIで短くする」ボタンを表示

---

## 10. subtitleレイヤー

字幕専用領域。

```json
{
  "id": "subtitle",
  "type": "subtitle",
  "textKey": "subtitle",
  "x": 240,
  "y": 900,
  "w": 1440,
  "h": 90,
  "fontSize": 38,
  "maxLines": 2,
  "background": {
    "enabled": true,
    "color": "#000000",
    "opacity": 0.55,
    "radius": 16
  },
  "strokeColor": "#ffffff",
  "strokeWidth": 2,
  "zIndex": 50
}
```

---

## 11. characterレイヤー

ゆうこ素材の表示領域。

```json
{
  "id": "yuko",
  "type": "character",
  "required": false,
  "x": 1450,
  "y": 600,
  "w": 360,
  "h": 420,
  "fit": "contain",
  "defaultPoseTag": "smile",
  "allowHidden": true,
  "zIndex": 40
}
```

### 方針

- ゆうこは常時表示ではない。
- 表示有無・位置・サイズはテンプレートが決める。
- シーン側でゆうこ素材を差し替えることは可能。

---

## 12. decor / shapeレイヤー

半透明パネル、タイトル帯、装飾ラインなど。

```json
{
  "id": "textPanel",
  "type": "shape",
  "shapeType": "rect",
  "x": 1120,
  "y": 200,
  "w": 660,
  "h": 420,
  "fillColor": "#ffffff",
  "opacity": 0.85,
  "radius": 24,
  "zIndex": 20
}
```

---

## 13. 標準アセット

### パネル系

- 半透明白パネル
- 半透明黒パネル
- 角丸パネル
- 字幕背景
- タイトル帯
- 吹き出し

### 装飾系

- ライン
- フレーム
- チェックマーク
- 矢印
- 見出しラベル

### ブランド系

- ロゴ枠
- QRコード枠
- 採用URL枠

---

## 14. AIに渡すテンプレート概要

AIにはtemplate.json全体ではなく、要約情報を渡す。

```json
{
  "templateId": "photo_text_panel_yuko_v1",
  "name": "写真＋説明パネル＋ゆうこ",
  "category": "photo_intro",
  "useCase": "オフィス紹介、社員紹介、仕事風景紹介",
  "requiredSlots": ["mainVisual", "title", "subtitle"],
  "hasYuko": true,
  "maxNarrationLength": 120,
  "maxSubtitleLength": 60
}
```

---

## 15. テンプレート検証

テンプレート追加時に以下をチェックする。

- templateIdが存在する
- templateIdが重複していない
- canvasが存在する
- layersが配列である
- 各layerのx/y/w/hがcanvas内に収まる
- requiredなslotが最低1つある
- textKeyが想定値である
- thumbnail.pngが存在する
- categoryが定義済みである

---

## 16. v0.1標準テンプレート案

| ID | 名前 | 用途 |
|---|---|---|
| opening_yuko_right_v1 | オープニング・ゆうこ右 | 冒頭挨拶 |
| photo_left_text_right_yuko_v1 | 写真左・説明右・ゆうこ | 写真紹介 |
| video_full_subtitle_yuko_v1 | 動画全面・字幕・ゆうこ | 動画紹介 |
| point_three_panel_v1 | 3つのポイント | 強み・制度紹介 |
| chapter_simple_v1 | パート切り替え | 長尺動画の章区切り |
| closing_message_yuko_bow_v1 | 応募メッセージ・お辞儀 | 締め |
| full_photo_no_yuko_v1 | 写真全面・ゆうこなし | 写真を大きく見せる |
