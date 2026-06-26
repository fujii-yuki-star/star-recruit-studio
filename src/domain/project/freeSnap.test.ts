import { describe, expect, it } from 'vitest';
import { edgesOf, snapToTargets, type SnapEdges } from './freeSnap';

// ドラッグ中の吸着（#205 後半）の純粋ロジック。threshold は canvas px。
const target = (rect: { x: number; y: number; w: number; h: number }): SnapEdges => edgesOf(rect);

describe('edgesOf', () => {
  it('辺・中心を取り出す', () => {
    expect(edgesOf({ x: 100, y: 50, w: 200, h: 100 })).toEqual({
      left: 100, right: 300, centerX: 200, top: 50, bottom: 150, centerY: 100,
    });
  });
});

describe('snapToTargets', () => {
  // 他要素 A: x=100,w=200 → left=100,right=300,centerX=200／y=50,h=100 → top=50,bottom=150,centerY=100。
  const others = [target({ x: 100, y: 50, w: 200, h: 100 })];

  it('左辺が他要素の左辺に近いとき左辺へ吸着し、縦ガイドをそこに引く', () => {
    // rect.left=104 は A.left=100 に距離4（threshold 6 以内）→ x=100 に吸着。
    const r = snapToTargets({ x: 104, y: 500, w: 80, h: 40 }, others, 6);
    expect(r.x).toBe(100);
    expect(r.guideX).toBe(100);
  });

  it('中心が他要素の中心に近いとき中心で吸着（x = centerX - w/2）', () => {
    // rect 中心 = x+40。A.centerX=200 に合わせるには中心=200 → x=160。入力 x=163（中心203, 距離3）。
    const r = snapToTargets({ x: 163, y: 500, w: 80, h: 40 }, others, 6);
    expect(r.x).toBe(160);
    expect(r.guideX).toBe(200);
  });

  it('右辺が他要素の右辺へ吸着（x = right - w）', () => {
    // A.right=300。rect.right=x+80。x=223 → right=303（距離3）→ 吸着 right=300 → x=220。
    const r = snapToTargets({ x: 223, y: 500, w: 80, h: 40 }, others, 6);
    expect(r.x).toBe(220);
    expect(r.guideX).toBe(300);
  });

  it('Y も独立に吸着（上辺→A.top）・縦横ガイドが同時に出る', () => {
    const r = snapToTargets({ x: 104, y: 53, w: 80, h: 40 }, others, 6);
    expect(r.x).toBe(100); // 左辺吸着
    expect(r.y).toBe(50); // 上辺→A.top=50（距離3）
    expect(r.guideX).toBe(100);
    expect(r.guideY).toBe(50);
  });

  it('threshold を超えると吸着しない（位置そのまま・ガイドなし）', () => {
    // x=150 → left150/right230/centerX190。A の left100/right300/centerX200 のどれにも 6px 以内で当たらない。
    const r = snapToTargets({ x: 150, y: 500, w: 80, h: 40 }, others, 6);
    expect(r).toEqual({ x: 150, y: 500, guideX: null, guideY: null });
  });

  it('他要素が無ければ吸着しない', () => {
    const r = snapToTargets({ x: 104, y: 53, w: 80, h: 40 }, [], 6);
    expect(r).toEqual({ x: 104, y: 53, guideX: null, guideY: null });
  });

  it('同距離のタイブレークは先着（left 優先）＝吸着先がちらつかない', () => {
    // 左端=100 と右端=500 の2つの吸着先。rect.left=96→100(距離4)・rect.right=504→500(距離4)の同距離。
    const tie = [edgesOf({ x: 100, y: 0, w: 10, h: 10 }), edgesOf({ x: 480, y: 0, w: 20, h: 10 })];
    const r = snapToTargets({ x: 96, y: 900, w: 408, h: 40 }, tie, 6);
    expect(r.x).toBe(100); // left を採用（right なら x=92 になる）
    expect(r.guideX).toBe(100);
  });
});
