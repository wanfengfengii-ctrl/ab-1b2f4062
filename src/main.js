import { analyzeExposure, CONSTRAINTS, validateDraft } from './engine.js';
import './styles.css';

const LS_DRAFT = 'paperExposure.draft.v1';
const LS_REVIEW = 'paperExposure.review.v1';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

function defaultDraft() {
  return {
    cases: [
      { name: '展柜 1', window: '60', limit: '3000' },
      { name: '展柜 2', window: '30', limit: '1200' },
    ],
    lamps: [
      { id: 'L1', start: '0', end: '60', illum: ['10', '5'] },
      { id: 'L2', start: '30', end: '90', illum: ['8', '6'] },
      { id: 'L3', start: '120', end: '180', illum: ['12', '4'] },
    ],
  };
}

function sampleDraft() {
  return {
    cases: [
      { name: '善本库 A', window: '60', limit: '3000' },
      { name: '书画厅 B', window: '30', limit: '900' },
      { name: '档案柜 C', window: '45', limit: '1500' },
    ],
    lamps: [
      { id: 'L1', start: '0', end: '120', illum: ['20', '8', '5'] },
      { id: 'L2', start: '30', end: '90', illum: ['15', '25', '10'] },
      { id: 'L3', start: '60', end: '180', illum: ['10', '5', '30'] },
      { id: 'L4', start: '200', end: '260', illum: ['40', '0', '10'] },
    ],
  };
}

const keyOf = (d) => JSON.stringify(d);

function loadDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DRAFT));
    if (
      raw &&
      Array.isArray(raw.cases) &&
      Array.isArray(raw.lamps) &&
      raw.cases.every((c) => c && typeof c === 'object') &&
      raw.lamps.every((l) => l && typeof l === 'object' && Array.isArray(l.illum))
    ) {
      for (const l of raw.lamps) {
        while (l.illum.length < raw.cases.length) l.illum.push('0');
        l.illum.length = Math.min(l.illum.length, raw.cases.length);
      }
      return raw;
    }
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return defaultDraft();
}

function loadReview() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_REVIEW));
    if (raw && typeof raw.draftKey === 'string' && raw.result) return raw;
  } catch {
    /* 忽略 */
  }
  return null;
}

let draft = loadDraft();
let review = loadReview();
// 只有“最近一次有效复核”的草稿与当前草稿完全一致时才展示旧结论
let showResult = !!(review && review.draftKey === keyOf(draft));
let errors = [];

/* ---------------- 骨架 ---------------- */

document.querySelector('#app').innerHTML = `
  <header class="site-head">
    <h1>纸本文物外借展陈 · 紫外光照剂量复核</h1>
    <p>
      录入 2–6 个展柜的滑动暴露窗口与累计剂量上限，以及 3–8 盏灯在各柜的紫外线照度与启停区间（左闭右开）。
      系统将全部灯的启停区间叠加为分段恒定照度，并在连续时间上精确求解每个滑动窗口长度的最大积分剂量，
      以确认灯光联动不会在任意连续窗口内伤害纸张。
    </p>
  </header>
  <main>
    <section class="panel" aria-label="展柜设置">
      <div class="panel-head">
        <h2>展柜（2–6 个）</h2>
        <button id="add-case" type="button">+ 添加展柜</button>
      </div>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr><th>#</th><th>名称</th><th>滑动暴露窗口（分钟）</th><th>累计剂量上限（μW·min/cm²）</th><th></th></tr>
          </thead>
          <tbody id="cases-tbody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel" aria-label="灯设置">
      <div class="panel-head">
        <h2>灯（3–8 盏）</h2>
        <button id="add-lamp" type="button">+ 添加灯</button>
      </div>
      <div class="table-wrap">
        <table class="grid" id="lamps-table">
          <thead id="lamps-thead"></thead>
          <tbody id="lamps-tbody"></tbody>
        </table>
      </div>
      <p class="hint">
        启停区间为左闭右开 [启动, 停止)：启动时刻计入、停止时刻不计入。时间单位：分钟；照度单位：μW/cm²。
        草稿会自动保存在本机；任何修改都会使已展示的复核结论立即失效。
      </p>
    </section>

    <div class="actions">
      <button id="review" class="primary" type="button">发起复核</button>
      <button id="load-sample" type="button">载入示例</button>
      <button id="reset-default" type="button">恢复默认</button>
      <button id="clear-storage" type="button">清除本机保存</button>
    </div>

    <div id="errors" role="alert"></div>
    <div id="status" aria-live="polite"></div>
    <div id="results"></div>
  </main>
`;

/* ---------------- 表单渲染 ---------------- */

function renderLampHead() {
  document.querySelector('#lamps-thead').innerHTML = `
    <tr>
      <th>#</th><th>灯号</th><th>启动（分）</th><th>停止（分）</th>
      ${draft.cases.map((c, j) => `<th>照度@ ${esc(c.name.trim()) || `展柜 ${j + 1}`}<br />(μW/cm²)</th>`).join('')}
      <th></th>
    </tr>`;
}

function renderForm() {
  document.querySelector('#cases-tbody').innerHTML = draft.cases
    .map(
      (c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><input data-k="case-name" data-i="${i}" value="${esc(c.name)}" aria-label="展柜 ${i + 1} 名称" /></td>
      <td><input data-k="case-window" data-i="${i}" value="${esc(c.window)}" inputmode="decimal" aria-label="展柜 ${i + 1} 滑动窗口（分钟）" /></td>
      <td><input data-k="case-limit" data-i="${i}" value="${esc(c.limit)}" inputmode="decimal" aria-label="展柜 ${i + 1} 剂量上限" /></td>
      <td><button type="button" data-act="del-case" data-i="${i}" ${draft.cases.length <= CONSTRAINTS.casesMin ? 'disabled' : ''}>删除</button></td>
    </tr>`,
    )
    .join('');

  renderLampHead();

  document.querySelector('#lamps-tbody').innerHTML = draft.lamps
    .map(
      (l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><input data-k="lamp-id" data-i="${i}" value="${esc(l.id)}" aria-label="灯 ${i + 1} 灯号" /></td>
      <td><input data-k="lamp-start" data-i="${i}" value="${esc(l.start)}" inputmode="decimal" aria-label="灯 ${i + 1} 启动时刻" /></td>
      <td><input data-k="lamp-end" data-i="${i}" value="${esc(l.end)}" inputmode="decimal" aria-label="灯 ${i + 1} 停止时刻" /></td>
      ${draft.cases
        .map(
          (_, j) =>
            `<td><input data-k="lamp-illum" data-i="${i}" data-j="${j}" value="${esc(l.illum[j] ?? '')}" inputmode="decimal" aria-label="灯 ${i + 1} 对展柜 ${j + 1} 照度" /></td>`,
        )
        .join('')}
      <td><button type="button" data-act="del-lamp" data-i="${i}" ${draft.lamps.length <= CONSTRAINTS.lampsMin ? 'disabled' : ''}>删除</button></td>
    </tr>`,
    )
    .join('');

  document.querySelector('#add-case').disabled = draft.cases.length >= CONSTRAINTS.casesMax;
  document.querySelector('#add-lamp').disabled = draft.lamps.length >= CONSTRAINTS.lampsMax;
}

/* ---------------- 结论渲染 ---------------- */

function chartSvg(c, periodStart, periodEnd) {
  const T0 = parseFloat(periodStart);
  const T1 = parseFloat(periodEnd);
  const W = 660;
  const H = 150;
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const maxI = Math.max(0, ...c.segs.map((s) => parseFloat(s.illum)));
  const yMax = maxI === 0 ? 1 : maxI * 1.15;
  const x = (t) => padL + ((t - T0) / (T1 - T0)) * iw;
  const y = (v) => padT + ih - (v / yMax) * ih;

  let d = '';
  c.segs.forEach((s, i) => {
    const f = parseFloat(s.from);
    const t = parseFloat(s.to);
    const v = parseFloat(s.illum);
    d += `${i === 0 ? 'M' : 'L'}${x(f).toFixed(2)},${y(v).toFixed(2)} L${x(t).toFixed(2)},${y(v).toFixed(2)} `;
  });

  const ws = Math.min(Math.max(parseFloat(c.maxStart), T0), T1);
  const we = Math.min(Math.max(parseFloat(c.maxEnd), T0), T1);
  const yMaxLabel = maxI === 0 ? '0' : String(parseFloat((yMax).toFixed(4)));

  return `
  <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="展柜 ${esc(c.name)} 照度曲线与最大窗口">
    <rect x="${x(ws).toFixed(2)}" y="${padT}" width="${Math.max(1, x(we) - x(ws)).toFixed(2)}" height="${ih}" class="win" />
    <line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" class="axis" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${y(0)}" class="axis" />
    <path d="${d}" class="curve" />
    <text x="${padL - 6}" y="${y(0) + 4}" class="tick" text-anchor="end">0</text>
    <text x="${padL - 6}" y="${padT + 8}" class="tick" text-anchor="end">${esc(yMaxLabel)}</text>
    <text x="${x(T0).toFixed(2)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(periodStart)}</text>
    <text x="${x(T1).toFixed(2)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(periodEnd)}</text>
    <text x="${((x(ws) + x(we)) / 2).toFixed(2)}" y="${padT + 12}" class="tick win-label" text-anchor="middle">最大窗口</text>
  </svg>`;
}

function renderResult(r) {
  const ev = r.firstEvidence;
  const head = ev
    ? `
    <div class="evidence" role="alert">
      <h3>⚠ 复核未通过：${r.violations.length} 个展柜超限</h3>
      <p class="first-ev">
        <strong>首项证据</strong>（按展柜输入顺序、违规窗口起点稳定确定）：展柜「${esc(ev.caseName)}」
        在第 ${esc(ev.start)} 分 至 第 ${esc(ev.end)} 分 的连续窗口内取得最大窗口剂量
        <strong>${esc(ev.dose)}</strong> μW·min/cm²，超过上限 ${esc(ev.limit)}（超出 ${esc(ev.excess)}）。
      </p>
      <ol>
        ${r.violations
          .map((idx) => {
            const c = r.cases[idx];
            return `<li>展柜「${esc(c.name)}」：窗口 [${esc(c.maxStart)}, ${esc(c.maxEnd)}) 分，最大窗口剂量 ${esc(c.maxDose)} / 上限 ${esc(c.limit)} μW·min/cm²</li>`;
          })
          .join('')}
      </ol>
    </div>`
    : `<div class="pass"><h3>✔ 复核通过：全部展柜在任意连续窗口内均未超过剂量上限</h3></div>`;

  const cards = r.cases
    .map(
      (c) => `
    <article class="card ${c.exceeded ? 'bad' : 'good'}">
      <h4>
        展柜「${esc(c.name)}」
        ${c.exceeded ? '<span class="badge bad">超限</span>' : '<span class="badge ok">达标</span>'}
      </h4>
      <dl class="facts">
        <div><dt>完整时段</dt><dd>第 ${esc(r.periodStart)} 分 至 第 ${esc(r.periodEnd)} 分</dd></div>
        <div><dt>全时段累计剂量</dt><dd>${esc(c.totalDose)} μW·min/cm²</dd></div>
        <div><dt>滑动窗口 / 上限</dt><dd>${esc(c.window)} 分 / ${esc(c.limit)} μW·min/cm²</dd></div>
        <div>
          <dt>最大窗口剂量</dt>
          <dd>
            ${esc(c.maxDose)} μW·min/cm²
            （第 ${esc(c.maxStart)} 分 至 第 ${esc(c.maxEnd)} 分）
            ${c.exceeded ? `<span class="over">超出 ${esc(c.excess)}</span>` : ''}
          </dd>
        </div>
      </dl>
      <p class="sub">最大窗口内照度变化：</p>
      <table class="mini">
        <thead><tr><th>起（分）</th><th>止（分）</th><th>照度（μW/cm²）</th></tr></thead>
        <tbody>
          ${c.windowSegs.map((s) => `<tr><td>${esc(s.from)}</td><td>${esc(s.to)}</td><td>${esc(s.illum)}</td></tr>`).join('')}
        </tbody>
      </table>
      ${chartSvg(c, r.periodStart, r.periodEnd)}
      <details>
        <summary>完整时段照度分段（叠加后）</summary>
        <table class="mini">
          <thead><tr><th>起（分）</th><th>止（分）</th><th>照度（μW/cm²）</th></tr></thead>
          <tbody>
            ${c.segs.map((s) => `<tr><td>${esc(s.from)}</td><td>${esc(s.to)}</td><td>${esc(s.illum)}</td></tr>`).join('')}
          </tbody>
        </table>
      </details>
    </article>`,
    )
    .join('');

  return `${head}<div class="cards">${cards}</div>`;
}

function renderOutcome() {
  const errBox = document.querySelector('#errors');
  errBox.innerHTML = errors.length
    ? `<div class="errors"><strong>发现 ${errors.length} 处问题，已阻止复核：</strong><ul>${errors
        .map((e) => `<li>${esc(e)}</li>`)
        .join('')}</ul></div>`
    : '';

  const status = document.querySelector('#status');
  const res = document.querySelector('#results');
  if (showResult && review?.result) {
    status.innerHTML = '<p class="ok-line">以下结论与当前草稿一致（最近一次有效复核，已保存于本机）。</p>';
    res.innerHTML = renderResult(review.result);
  } else {
    status.innerHTML = `<p class="stale-line">${
      review ? '草稿已修改，旧结论已失效并不再显示。' : '当前草稿尚未复核。'
    }请核对输入后点击「发起复核」。</p>`;
    res.innerHTML = '';
  }
}

/* ---------------- 状态变更 ---------------- */

function persistDraft() {
  localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
}

// 草稿变更：旧结论立即失效、不再显示；草稿持久化到本机
function onDraftChanged() {
  errors = [];
  showResult = false;
  persistDraft();
  renderOutcome();
}

function doReview() {
  const { errors: errs, cases, lamps } = validateDraft(draft);
  if (errs.length > 0) {
    errors = errs;
    showResult = false;
  } else {
    errors = [];
    review = { draftKey: keyOf(draft), result: analyzeExposure(cases, lamps) };
    localStorage.setItem(LS_REVIEW, JSON.stringify(review));
    showResult = true;
  }
  renderOutcome();
  document
    .querySelector(errors.length ? '#errors' : '#results')
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const app = document.querySelector('#app');

app.addEventListener('input', (e) => {
  const el = e.target;
  const k = el.dataset?.k;
  if (!k) return;
  const i = Number(el.dataset.i);
  const v = el.value;
  if (k === 'case-name') {
    draft.cases[i].name = v;
    renderLampHead();
  } else if (k === 'case-window') draft.cases[i].window = v;
  else if (k === 'case-limit') draft.cases[i].limit = v;
  else if (k === 'lamp-id') draft.lamps[i].id = v;
  else if (k === 'lamp-start') draft.lamps[i].start = v;
  else if (k === 'lamp-end') draft.lamps[i].end = v;
  else if (k === 'lamp-illum') draft.lamps[i].illum[Number(el.dataset.j)] = v;
  onDraftChanged();
});

app.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act || btn.id;
  const i = Number(btn.dataset.i);
  switch (act) {
    case 'add-case':
      if (draft.cases.length < CONSTRAINTS.casesMax) {
        draft.cases.push({ name: `展柜 ${draft.cases.length + 1}`, window: '60', limit: '1000' });
        draft.lamps.forEach((l) => l.illum.push('0'));
      }
      break;
    case 'del-case':
      if (draft.cases.length > CONSTRAINTS.casesMin) {
        draft.cases.splice(i, 1);
        draft.lamps.forEach((l) => l.illum.splice(i, 1));
      }
      break;
    case 'add-lamp':
      if (draft.lamps.length < CONSTRAINTS.lampsMax) {
        draft.lamps.push({
          id: `L${draft.lamps.length + 1}`,
          start: '0',
          end: '60',
          illum: draft.cases.map(() => '0'),
        });
      }
      break;
    case 'del-lamp':
      if (draft.lamps.length > CONSTRAINTS.lampsMin) draft.lamps.splice(i, 1);
      break;
    case 'load-sample':
      draft = sampleDraft();
      break;
    case 'reset-default':
      draft = defaultDraft();
      break;
    case 'clear-storage':
      localStorage.removeItem(LS_DRAFT);
      localStorage.removeItem(LS_REVIEW);
      draft = defaultDraft();
      review = null;
      break;
    case 'review':
      doReview();
      return;
    default:
      return;
  }
  onDraftChanged();
  renderForm();
});

renderForm();
renderOutcome();
