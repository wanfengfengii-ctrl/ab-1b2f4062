// 纸本文物展陈光照剂量引擎。
//
// 模型：
//  - 每盏灯有一个左闭右开的启停区间 [start, end)，以及对每个展柜的恒定紫外线照度；
//  - 所有灯的区间叠加后，每个展柜的照度是关于时间的分段恒定函数；
//  - 对每个展柜指定的窗口长度 L，在连续时间上精确求滑动窗口积分剂量的最大值，
//    不以固定采样点代替：窗口剂量 W(t)=D(t+L)-D(t) 是分段线性函数，
//    其极值只可能出现在 t=b 或 t=b-L（b 为照度断点）处，逐一精确求值即可。
//
// 精确性：全部数值以 BigInt 有理数运算；输入为有限小数时，所有结果仍为有限小数，
// 可原样精确显示（例如 0.1+0.2 严格等于 0.3）。

function gcd(a, b) {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

export class Frac {
  constructor(num, den = 1n) {
    if (den === 0n) throw new Error('分母不能为 0');
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num < 0n ? -num : num, den);
    this.n = num / g;
    this.d = den / g;
  }

  static zero() {
    return new Frac(0n, 1n);
  }

  // 解析有限小数字符串（如 "12"、"0.5"、".5"、"2."、"-3.25"），非法输入返回 null。
  static fromDecimal(text) {
    const s = String(text ?? '').trim();
    const m = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(s);
    if (!m) return null;
    const sign = m[1] === '-' ? -1n : 1n;
    const ip = m[2] ?? '';
    const fp = m[3] ?? m[4] ?? '';
    const den = 10n ** BigInt(fp.length);
    const num = sign * (BigInt(ip === '' ? '0' : ip) * den + BigInt(fp === '' ? '0' : fp));
    return new Frac(num, den);
  }

  add(o) {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o) {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o) {
    return new Frac(this.n * o.n, this.d * o.d);
  }

  cmp(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  // 精确的小数表示。输入均为有限小数，分母只含因子 2 与 5，结果必然有限。
  toDecimalString() {
    let d = this.d;
    let a = 0n;
    let b = 0n;
    while (d % 2n === 0n) {
      d /= 2n;
      a += 1n;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      b += 1n;
    }
    if (d !== 1n) return `${this.n}/${this.d}`; // 理论上不可达
    const places = a > b ? a : b;
    const scaled = this.n * 2n ** (places - a) * 5n ** (places - b);
    const neg = scaled < 0n;
    const abs = neg ? -scaled : scaled;
    const p = Number(places);
    const s = abs.toString().padStart(p + 1, '0');
    const intPart = p === 0 ? s : s.slice(0, -p);
    const fracPart = p === 0 ? '' : s.slice(-p).replace(/0+$/, '');
    return (neg ? '-' : '') + intPart + (fracPart ? `.${fracPart}` : '');
  }
}

export const CONSTRAINTS = { casesMin: 2, casesMax: 6, lampsMin: 3, lampsMax: 8 };

// 校验草稿：一次性列出全部问题。返回 { errors, cases, lamps }；
// 仅当 errors 为空时，cases/lamps 中的数值字段（Frac）才保证可用。
export function validateDraft(draft) {
  const errors = [];
  const rawCases = Array.isArray(draft?.cases) ? draft.cases : [];
  const rawLamps = Array.isArray(draft?.lamps) ? draft.lamps : [];

  if (rawCases.length < CONSTRAINTS.casesMin || rawCases.length > CONSTRAINTS.casesMax) {
    errors.push(
      `展柜数量须为 ${CONSTRAINTS.casesMin}–${CONSTRAINTS.casesMax} 个（当前 ${rawCases.length} 个）`,
    );
  }
  const cases = rawCases.map((c, i) => {
    const label = `展柜 ${i + 1}`;
    const name = String(c?.name ?? '').trim();
    if (!name) errors.push(`${label}：名称不能为空`);
    const window = Frac.fromDecimal(c?.window);
    if (!window) errors.push(`${label}：滑动暴露窗口「${c?.window ?? ''}」不是有效数字`);
    else if (window.cmp(Frac.zero()) <= 0) errors.push(`${label}：滑动暴露窗口必须大于 0 分钟`);
    const limit = Frac.fromDecimal(c?.limit);
    if (!limit) errors.push(`${label}：累计剂量上限「${c?.limit ?? ''}」不是有效数字`);
    else if (limit.cmp(Frac.zero()) < 0) {
      errors.push(`${label}：累计剂量上限不合理（须为不小于 0 的数）`);
    }
    return { name, window, limit };
  });

  if (rawLamps.length < CONSTRAINTS.lampsMin || rawLamps.length > CONSTRAINTS.lampsMax) {
    errors.push(
      `灯数量须为 ${CONSTRAINTS.lampsMin}–${CONSTRAINTS.lampsMax} 盏（当前 ${rawLamps.length} 盏）`,
    );
  }
  const seenIds = new Map();
  const lamps = rawLamps.map((l, i) => {
    const label = `灯 ${i + 1}`;
    const id = String(l?.id ?? '').trim();
    if (!id) errors.push(`${label}：灯号不能为空`);
    else if (seenIds.has(id)) {
      errors.push(`灯号重复：「${id}」（第 ${seenIds.get(id) + 1}、${i + 1} 盏）`);
    } else {
      seenIds.set(id, i);
    }
    const start = Frac.fromDecimal(l?.start);
    const end = Frac.fromDecimal(l?.end);
    if (!start) errors.push(`${label}「${id}」：启动时刻「${l?.start ?? ''}」不是有效数字`);
    else if (start.cmp(Frac.zero()) < 0) errors.push(`${label}「${id}」：启动时刻不能为负`);
    if (!end) errors.push(`${label}「${id}」：停止时刻「${l?.end ?? ''}」不是有效数字`);
    if (start && end && end.cmp(start) <= 0) {
      errors.push(`${label}「${id}」：启停区间非法（左闭右开区间须满足 启动 < 停止）`);
    }
    const illum = cases.map((_, j) => {
      const raw = Array.isArray(l?.illum) ? l.illum[j] : undefined;
      const v = Frac.fromDecimal(raw);
      if (!v) errors.push(`${label}「${id}」：对展柜 ${j + 1} 的紫外线照度「${raw ?? ''}」不是有效数字`);
      else if (v.cmp(Frac.zero()) < 0) {
        errors.push(`${label}「${id}」：对展柜 ${j + 1} 的紫外线照度不能为负`);
      }
      return v;
    });
    return { id, start, end, illum };
  });

  return { errors, cases, lamps };
}

// 复核计算。入参为 validateDraft 通过后的 cases / lamps（数值字段为 Frac）。
// 返回值全部是可 JSON 序列化的字符串/布尔值，便于本地保存与展示。
export function analyzeExposure(cases, lamps) {
  // 1) 汇总所有启停区间端点作为断点
  let bps = [];
  for (const l of lamps) bps.push(l.start, l.end);
  bps.sort((x, y) => x.cmp(y));
  bps = bps.filter((v, i) => i === 0 || v.cmp(bps[i - 1]) !== 0);

  // 2) 左闭右开叠加：每个子区间 [bps[i], bps[i+1]) 上开启的灯集合恒定
  const segs = [];
  for (let i = 0; i < bps.length - 1; i++) {
    const from = bps[i];
    const to = bps[i + 1];
    const illum = cases.map(() => Frac.zero());
    for (const l of lamps) {
      if (l.start.cmp(from) <= 0 && from.cmp(l.end) < 0) {
        for (let j = 0; j < cases.length; j++) {
          illum[j] = illum[j].add(l.illum[j]);
        }
      }
    }
    segs.push({ from, to, illum });
  }

  const caseResults = cases.map((c, j) =>
    analyzeCase(c, segs.map((s) => ({ from: s.from, to: s.to, illum: s.illum[j] })), bps),
  );

  // 首项证据：按展柜输入顺序取首个超限展柜，其违规窗口起点由“取得最大窗口剂量的
  // 最早起点”稳定确定。
  const violations = [];
  caseResults.forEach((r, idx) => {
    if (r.exceeded) violations.push(idx);
  });
  let firstEvidence = null;
  if (violations.length > 0) {
    const idx = violations[0];
    const r = caseResults[idx];
    firstEvidence = {
      caseIndex: idx,
      caseName: r.name,
      start: r.maxStart,
      end: r.maxEnd,
      dose: r.maxDose,
      limit: r.limit,
      excess: r.excess,
    };
  }

  return {
    periodStart: bps[0].toDecimalString(),
    periodEnd: bps[bps.length - 1].toDecimalString(),
    cases: caseResults,
    violations,
    firstEvidence,
  };
}

function analyzeCase(c, segs, bps) {
  const L = c.window;
  const T0 = bps[0];
  const T1 = bps[bps.length - 1];

  // 累计剂量前缀和：D(t) = ∫[T0,t] u(τ)dτ，分段线性
  const pref = [Frac.zero()];
  for (const s of segs) {
    pref.push(pref[pref.length - 1].add(s.illum.mul(s.to.sub(s.from))));
  }
  const total = pref[pref.length - 1];

  const doseAt = (t) => {
    if (t.cmp(T0) <= 0) return Frac.zero();
    for (let i = 0; i < segs.length; i++) {
      if (t.cmp(segs[i].to) < 0) {
        return pref[i].add(segs[i].illum.mul(t.sub(segs[i].from)));
      }
    }
    return total;
  };

  // 窗口起点定义域：窗口须从展陈时段内开始（起点不早于 T0、不晚于 T1-L）；
  // 若窗口长度不小于整个时段，则唯一考察窗口为 [T0, T0+L)。
  // （照度非负，该限制不改变最大剂量值，只使报告的起止时刻更直观。）
  const span = T1.sub(T0);
  const domainEnd = L.cmp(span) < 0 ? T1.sub(L) : T0;

  // W(t)=D(t+L)-D(t) 分段线性，极值只可能出现在 t=b 或 t=b-L 处
  const candidates = [];
  for (const b of bps) {
    candidates.push(b, b.sub(L));
  }
  const starts = candidates
    .filter((t) => t.cmp(T0) >= 0 && t.cmp(domainEnd) <= 0)
    .sort((x, y) => x.cmp(y));

  let bestDose = null;
  let bestStart = null;
  for (const t of starts) {
    const w = doseAt(t.add(L)).sub(doseAt(t));
    if (bestDose === null || w.cmp(bestDose) > 0) {
      bestDose = w;
      bestStart = t; // 严格大于才替换：保留取得最大剂量的最早窗口起点
    }
  }

  const maxEnd = bestStart.add(L);
  // 最大窗口内的照度变化；窗口越出展陈时段的部分照度为 0
  const windowSegs = [];
  for (const s of segs) {
    const from = s.from.cmp(bestStart) > 0 ? s.from : bestStart;
    const to = s.to.cmp(maxEnd) < 0 ? s.to : maxEnd;
    if (from.cmp(to) < 0) windowSegs.push({ from, to, illum: s.illum });
  }
  if (maxEnd.cmp(T1) > 0) {
    const from = T1.cmp(bestStart) > 0 ? T1 : bestStart;
    windowSegs.push({ from, to: maxEnd, illum: Frac.zero() });
  }

  const exceeded = bestDose.cmp(c.limit) > 0;
  return {
    name: c.name,
    window: L.toDecimalString(),
    limit: c.limit.toDecimalString(),
    totalDose: total.toDecimalString(),
    maxDose: bestDose.toDecimalString(),
    maxStart: bestStart.toDecimalString(),
    maxEnd: maxEnd.toDecimalString(),
    exceeded,
    excess: bestDose.sub(c.limit).toDecimalString(),
    windowSegs: windowSegs.map(fmtSeg),
    segs: segs.map(fmtSeg),
  };
}

const fmtSeg = (s) => ({
  from: s.from.toDecimalString(),
  to: s.to.toDecimalString(),
  illum: s.illum.toDecimalString(),
});
