import { describe, expect, it } from 'vitest';
import { analyzeExposure, Frac, validateDraft } from './engine.js';

// 校验通过并执行复核的便捷封装
const run = (draft) => {
  const { errors, cases, lamps } = validateDraft(draft);
  expect(errors).toEqual([]);
  return analyzeExposure(cases, lamps);
};

const twoCases = (w1, l1, w2, l2) => [
  { name: '柜一', window: w1, limit: l1 },
  { name: '柜二', window: w2, limit: l2 },
];

describe('Frac 精确小数运算', () => {
  it('0.1 + 0.2 严格等于 0.3', () => {
    expect(Frac.fromDecimal('0.1').add(Frac.fromDecimal('0.2')).toDecimalString()).toBe('0.3');
  });
  it('解析与格式化', () => {
    expect(Frac.fromDecimal('.5').toDecimalString()).toBe('0.5');
    expect(Frac.fromDecimal('2.500').toDecimalString()).toBe('2.5');
    expect(Frac.fromDecimal(' 12 ').toDecimalString()).toBe('12');
    expect(Frac.fromDecimal('-3.25').toDecimalString()).toBe('-3.25');
    expect(Frac.fromDecimal('abc')).toBeNull();
    expect(Frac.fromDecimal('')).toBeNull();
    expect(Frac.fromDecimal('1e3')).toBeNull();
  });
  it('乘积保持精确', () => {
    expect(Frac.fromDecimal('0.1').mul(Frac.fromDecimal('3')).toDecimalString()).toBe('0.3');
    expect(Frac.fromDecimal('2.5').mul(Frac.fromDecimal('0.4')).toDecimalString()).toBe('1');
  });
});

describe('区间叠加为分段恒定照度', () => {
  it('重叠区间叠加，左闭右开不重复计数', () => {
    const r = run({
      cases: twoCases('5', '1000', '5', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '10', illum: ['2', '0'] },
        { id: 'b', start: '5', end: '15', illum: ['3', '0'] },
        { id: 'c', start: '15', end: '20', illum: ['1', '0'] },
      ],
    });
    expect(r.periodStart).toBe('0');
    expect(r.periodEnd).toBe('20');
    expect(r.cases[0].segs).toEqual([
      { from: '0', to: '5', illum: '2' },
      { from: '5', to: '10', illum: '5' },
      { from: '10', to: '15', illum: '3' },
      { from: '15', to: '20', illum: '1' },
    ]);
    // 2*5 + 5*5 + 3*5 + 1*5
    expect(r.cases[0].totalDose).toBe('55');
  });

  it('首尾相接的区间在端点处正确切换（停止时刻不计入）', () => {
    const r = run({
      cases: twoCases('4', '1000', '4', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '2', illum: ['5', '0'] },
        { id: 'b', start: '2', end: '4', illum: ['7', '0'] },
        { id: 'c', start: '9', end: '10', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].segs.slice(0, 2)).toEqual([
      { from: '0', to: '2', illum: '5' },
      { from: '2', to: '4', illum: '7' },
    ]);
    expect(r.cases[0].totalDose).toBe('24'); // 5*2 + 7*2，t=2 处不双计
  });
});

describe('连续时间滑动窗口最大积分剂量（非固定采样）', () => {
  it('最大窗口的起点可以落在断点之间的 b-L 处', () => {
    // 照度：[0,1)=5，[1,2)=10，窗口 1.5。
    // 起点对齐断点只能得到 10；精确解为窗口 [0.5, 2)，剂量 12.5。
    const r = run({
      cases: twoCases('1.5', '1000', '1.5', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '2', illum: ['5', '0'] },
        { id: 'b', start: '1', end: '2', illum: ['5', '0'] },
        { id: 'c', start: '5', end: '6', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].maxDose).toBe('12.5');
    expect(r.cases[0].maxStart).toBe('0.5');
    expect(r.cases[0].maxEnd).toBe('2');
    expect(r.cases[0].windowSegs).toEqual([
      { from: '0.5', to: '1', illum: '5' },
      { from: '1', to: '2', illum: '10' },
    ]);
  });

  it('小数照度下剂量精确（0.1 μW/cm² × 3 min = 0.3）', () => {
    const r = run({
      cases: twoCases('1', '1000', '1', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '3', illum: ['0.1', '0'] },
        { id: 'b', start: '5', end: '6', illum: ['0', '0'] },
        { id: 'c', start: '7', end: '8', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].totalDose).toBe('0.3');
    expect(r.cases[0].maxDose).toBe('0.1');
  });

  it('窗口长于整个展陈时段时，最大剂量等于全时段累计剂量', () => {
    const r = run({
      cases: twoCases('100', '1000', '100', '1000'),
      lamps: [
        { id: 'a', start: '10', end: '20', illum: ['4', '0'] },
        { id: 'b', start: '0', end: '5', illum: ['0', '0'] },
        { id: 'c', start: '30', end: '40', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].totalDose).toBe('40');
    expect(r.cases[0].maxDose).toBe('40');
    expect(r.cases[0].maxStart).toBe('0');
    expect(r.cases[0].maxEnd).toBe('100');
    // 窗口越出时段的部分以照度 0 补齐展示
    expect(r.cases[0].windowSegs.at(-1)).toEqual({ from: '40', to: '100', illum: '0' });
  });

  it('平台期取最早起点', () => {
    const r = run({
      cases: twoCases('2', '1000', '2', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '10', illum: ['3', '0'] },
        { id: 'b', start: '20', end: '21', illum: ['0', '0'] },
        { id: 'c', start: '22', end: '23', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].maxDose).toBe('6');
    expect(r.cases[0].maxStart).toBe('0');
    expect(r.cases[0].maxEnd).toBe('2');
  });

  it('各展柜照度相互独立', () => {
    const r = run({
      cases: twoCases('10', '1000', '10', '1000'),
      lamps: [
        { id: 'a', start: '0', end: '10', illum: ['5', '2'] },
        { id: 'b', start: '20', end: '30', illum: ['0', '9'] },
        { id: 'c', start: '40', end: '50', illum: ['0', '0'] },
      ],
    });
    expect(r.cases[0].totalDose).toBe('50');
    expect(r.cases[1].totalDose).toBe('110'); // 2*10 + 9*10
    expect(r.cases[1].maxDose).toBe('90');
    expect(r.cases[1].maxStart).toBe('20');
  });
});

describe('超限判定与首项证据', () => {
  const base = (limit1, limit2) => ({
    cases: twoCases('10', limit1, '10', limit2),
    lamps: [
      { id: 'a', start: '0', end: '10', illum: ['1', '1'] },
      { id: 'b', start: '10', end: '20', illum: ['0', '0'] },
      { id: 'c', start: '20', end: '30', illum: ['0', '0'] },
    ],
  });

  it('未超限时不产生证据', () => {
    const r = run(base('1000', '1000'));
    expect(r.violations).toEqual([]);
    expect(r.firstEvidence).toBeNull();
  });

  it('仅第二柜超限时，首项证据指向它并给出精确起止与超出量', () => {
    const r = run(base('1000', '5'));
    expect(r.violations).toEqual([1]);
    expect(r.firstEvidence).toEqual({
      caseIndex: 1,
      caseName: '柜二',
      start: '0',
      end: '10',
      dose: '10',
      limit: '5',
      excess: '5',
    });
  });

  it('多柜超限时按展柜输入顺序取首项', () => {
    const r = run(base('5', '5'));
    expect(r.violations).toEqual([0, 1]);
    expect(r.firstEvidence.caseIndex).toBe(0);
    expect(r.firstEvidence.caseName).toBe('柜一');
  });

  it('剂量等于上限不算超限', () => {
    const r = run(base('10', '10'));
    expect(r.violations).toEqual([]);
  });
});

describe('草稿校验：一次列出全部问题并阻止复核', () => {
  it('合法草稿无错误', () => {
    const { errors } = validateDraft({
      cases: twoCases('60', '3000', '30', '1200'),
      lamps: [
        { id: 'L1', start: '0', end: '60', illum: ['10', '5'] },
        { id: 'L2', start: '30', end: '90', illum: ['8', '6'] },
        { id: 'L3', start: '120', end: '180', illum: ['12', '4'] },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('数量约束：展柜 2–6、灯 3–8', () => {
    const tooFew = validateDraft({ cases: [{ name: 'x', window: '1', limit: '1' }], lamps: [] });
    expect(tooFew.errors.join('\n')).toMatch(/展柜数量须为 2–6/);
    expect(tooFew.errors.join('\n')).toMatch(/灯数量须为 3–8/);
  });

  it('非法区间、重复灯号、不合理限额等全部一次列出', () => {
    const { errors } = validateDraft({
      cases: [
        { name: '', window: '0', limit: '-1' },
        { name: '柜二', window: 'abc', limit: '10' },
      ],
      lamps: [
        { id: 'X', start: '5', end: '5', illum: ['1', '1'] }, // 区间非法（启动=停止）
        { id: 'X', start: '-2', end: '1', illum: ['-3', '0'] }, // 重复灯号 + 负启动 + 负照度
        { id: 'Y', start: '0', end: '1', illum: ['', '1'] }, // 缺照度
      ],
    });
    const all = errors.join('\n');
    expect(all).toMatch(/名称不能为空/);
    expect(all).toMatch(/滑动暴露窗口必须大于 0/);
    expect(all).toMatch(/累计剂量上限不合理/);
    expect(all).toMatch(/滑动暴露窗口「abc」不是有效数字/);
    expect(all).toMatch(/启停区间非法/);
    expect(all).toMatch(/灯号重复：「X」/);
    expect(all).toMatch(/启动时刻不能为负/);
    expect(all).toMatch(/照度不能为负/);
    expect(all).toMatch(/不是有效数字/);
    // 9 类问题一次性全部列出
    expect(errors.length).toBeGreaterThanOrEqual(9);
  });

  it('灯号去重按修剪后的文本判定', () => {
    const { errors } = validateDraft({
      cases: twoCases('1', '1', '1', '1'),
      lamps: [
        { id: ' A ', start: '0', end: '1', illum: ['0', '0'] },
        { id: 'A', start: '1', end: '2', illum: ['0', '0'] },
        { id: 'B', start: '2', end: '3', illum: ['0', '0'] },
      ],
    });
    expect(errors.join('\n')).toMatch(/灯号重复：「A」/);
  });
});
