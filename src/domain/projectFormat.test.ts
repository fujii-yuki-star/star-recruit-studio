// project.json の文書形式の判別（ADR-0032・11 §1・#627）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_FORMAT, PROJECT_FORMAT } from './enums';
import { isTimelineProjectDoc, resolveProjectFormat } from './projectFormat';

describe('resolveProjectFormat: format === "timeline" か否かの一点で決める', () => {
  it('format:"timeline" はタイムライン形式', () => {
    expect(resolveProjectFormat({ format: 'timeline' })).toBe(PROJECT_FORMAT.timeline);
    expect(isTimelineProjectDoc({ format: 'timeline' })).toBe(true);
  });

  it('format 未指定は場面形式（既存データ＝後方互換の既定）', () => {
    expect(resolveProjectFormat({})).toBe(PROJECT_FORMAT.scene);
    expect(isTimelineProjectDoc({})).toBe(false);
  });

  it('format:"scene" と明示されていても場面形式（保存はしないが読めてしまっても壊れない）', () => {
    expect(resolveProjectFormat({ format: 'scene' })).toBe(PROJECT_FORMAT.scene);
  });

  it('未知の値・型違いは場面形式へ倒す（判別できないものを timeline 扱いしない）', () => {
    for (const format of ['TIMELINE', 'tl', '', null, 0, 1, true, {}, []]) {
      expect(resolveProjectFormat({ format })).toBe(DEFAULT_PROJECT_FORMAT);
    }
  });
});

describe('代表データ（fixtures）で判別できる', () => {
  const load = (p: string) => JSON.parse(readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/fixtures', p), 'utf8'));

  it('timeline-project.sample は timeline', () => {
    expect(resolveProjectFormat(load('timeline-project.sample.json'))).toBe(PROJECT_FORMAT.timeline);
  });

  it('project.sample は scene（format を持たない）', () => {
    const sample = load('project.sample.json');
    expect(sample.format).toBeUndefined();
    expect(resolveProjectFormat(sample)).toBe(PROJECT_FORMAT.scene);
  });
});
