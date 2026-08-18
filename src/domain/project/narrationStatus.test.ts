import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { statusAfterVoiceFailure } from './narrationStatus';

// #755-3：一時的な失敗を文書へ書くと、開き直しても「作れませんでした」のまま。前に作った声は
// そのまま鳴るので、「作れませんでした」と言いながら声は鳴る状態が残っていた。

describe('statusAfterVoiceFailure（声を作れなかったときの印・#755-3）', () => {
  it('作り始める前が「作成済み」なら据え置く（鳴っているのに「作れませんでした」を残さない）', () => {
    expect(statusAfterVoiceFailure(NARRATION_STATUS.generated)).toBe(NARRATION_STATUS.generated);
  });

  // ⚠️ **声のファイルの有無で決めない**（レビューで3観点が独立に指摘）＝場面形式の単独ナレーションは
  // セリフを変えても `voicePath` を落とさないので、ファイルで決めると**古い文の声が「作成済み」に復帰**し、
  // 新しい字幕に古い声が乗った動画が成功として出る。
  it('まだ作っていない／文を変えた（none）なら「作れなかった」を残す', () => {
    expect(statusAfterVoiceFailure(NARRATION_STATUS.none)).toBe(NARRATION_STATUS.failed);
  });

  it('前も失敗していた・作っている最中だったときも「作れなかった」を残す', () => {
    expect(statusAfterVoiceFailure(NARRATION_STATUS.failed)).toBe(NARRATION_STATUS.failed);
    expect(statusAfterVoiceFailure(NARRATION_STATUS.pending)).toBe(NARRATION_STATUS.failed);
  });
});
