import { describe, it, expect } from 'vitest';
import { createProject, createAsset, createLayer, evalLayer, worldMatrix, instancesOf } from '../../src/core/project.js';
import { apply } from '../../src/core/math.js';
import { History } from '../../src/core/history.js';

describe('نموذج المشروع', () => {
  it('ينشئ مشروعًا بالمقاس المختار', () => {
    const p = createProject({ preset: '9:16' });
    expect([p.width, p.height]).toEqual([1080, 1920]);
  });
  it('النسخ المرتبطة تشترك في عنصر واحد', () => {
    const p = createProject();
    const a = createAsset('image', { width: 100, height: 100 });
    p.assets.push(a);
    p.layers.push(createLayer(p, a), createLayer(p, a));
    expect(instancesOf(p, a.id).length).toBe(2);
    expect(p.assets.length).toBe(1);
  });
  it('مصفوفة الطبقة: المركز في الموضع', () => {
    const p = createProject();
    const a = createAsset('image', { width: 200, height: 100 });
    p.assets.push(a);
    const l = createLayer(p, a);
    l.props.scale = 1; l.props.x = 300; l.props.y = 400; l.props.rotation = 90;
    p.layers.push(l);
    const m = worldMatrix(p, l, 0);
    const [cx, cy] = apply(m, 100, 50);
    expect(cx).toBeCloseTo(300); expect(cy).toBeCloseTo(400);
    // الزاوية اليمنى بعد الدوران 90° تنزل للأسفل
    const [rx, ry] = apply(m, 200, 50);
    expect(rx).toBeCloseTo(300); expect(ry).toBeCloseTo(500);
  });
  it('الربط: الابن يتبع الأم', () => {
    const p = createProject();
    const a = createAsset('image', { width: 100, height: 100 });
    p.assets.push(a);
    const body = createLayer(p, a), arm = createLayer(p, a);
    body.props.scale = 1; arm.props.scale = 1;
    body.props.x = 500; body.props.y = 500;
    arm.parentId = body.id; arm.props.x = 100; arm.props.y = 0; // نسبة إلى مركز الأم
    p.layers.push(body, arm);
    let [x, y] = apply(worldMatrix(p, arm, 0), 50, 50);
    expect(x).toBeCloseTo(600); expect(y).toBeCloseTo(500);
    body.tracks.rotation = [{ t: 0, v: 90, ease: 'linear' }];
    [x, y] = apply(worldMatrix(p, arm, 0), 50, 50);
    expect(x).toBeCloseTo(500); expect(y).toBeCloseTo(600);
  });
  it('evalLayer يقرأ المفاتيح', () => {
    const p = createProject();
    const a = createAsset('image');
    const l = createLayer(p, a);
    l.tracks.opacity = [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 1, ease: 'linear' }];
    expect(evalLayer(l, 0.25).opacity).toBeCloseTo(0.25);
  });
});

describe('التراجع بلا حد', () => {
  it('يتراجع ويعيد عبر مئات الخطوات', () => {
    const h = new History();
    const s = { v: 0 };
    h.reset(s);
    for (let i = 1; i <= 500; i++) { s.v = i; h.push(s); }
    let st;
    for (let i = 0; i < 500; i++) st = h.undo();
    expect(st.v).toBe(0);
    expect(h.undo()).toBe(null);
    expect(h.redo().v).toBe(1);
  });
  it('لا يسجل حالة لم تتغير', () => {
    const h = new History();
    h.reset({ a: 1 });
    expect(h.push({ a: 1 })).toBe(false);
  });
});
