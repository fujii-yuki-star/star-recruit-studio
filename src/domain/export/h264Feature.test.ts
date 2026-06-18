import { describe, expect, it } from 'vitest';
import {
  H264_STATUS_LABEL, OPENH264_CREDIT_TEXT, OPENH264_FEATURE_ENABLED,
  type H264FeatureStatus,
} from './h264Feature';

describe('H264_STATUS_LABEL', () => {
  it('5つの抽象状態すべてに一般ユーザー向け文言がある', () => {
    expect(H264_STATUS_LABEL).toEqual({
      unavailable: '未準備',
      ready: '準備済み',
      disabled: '無効',
      error: '準備に失敗',
      verificationRequired: '確認が必要',
    });
  });
  it('状態キーは5つ（具体値=URL/版等は含まない）', () => {
    const keys: H264FeatureStatus[] = ['unavailable', 'ready', 'disabled', 'error', 'verificationRequired'];
    expect(Object.keys(H264_STATUS_LABEL).sort()).toEqual([...keys].sort());
  });
});

describe('OpenH264 表示の前提', () => {
  it('開発中（libx264 スパイク）は機能フラグが既定 false＝OpenH264 関連 UI は非表示', () => {
    expect(OPENH264_FEATURE_ENABLED).toBe(false);
  });
  it('必須クレジット文言は Cisco 指定の固定文', () => {
    expect(OPENH264_CREDIT_TEXT).toBe('OpenH264 Video Codec provided by Cisco Systems, Inc.');
  });
});
