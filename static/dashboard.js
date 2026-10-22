"use strict";
/* 대시보드: 외부 라이브러리 없이 SVG로 그리는 차트. app.js의 유틸(api, fmt, esc, CATS ...)을 쓴다.
   미리 만들어 둔 미래 달은 서버(/api/stats)에서 이미 빠져서 온다. */

let dash = null;                    // /api/stats 응답
let blockById = new Map();
let dashRange = { preset: "12", from: null, to: null };
const dashTables = new Set();       // '표로 보기' 중인 카드 id

const PRESETS = [["6", "최근 6개월"], ["12", "최근 12개월"], ["year", "올해"], ["all", "전체"], ["custom", "직접 선택"]];
const SAVING = "저축·투자";

const catVar = (c) => `var(--${catClass(c)})`;
const pct = (v) => (Math.round(v * 1000) / 10).toLocaleString("ko-KR") + "%";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const fmt1 = (n) => fmt(Math.round(n * 10) / 10);   // 평균값은 소수 첫째 자리까지

function addMonths(ym, k) {
  let [y, m] = ym.split("-").map(Number);
  m += k;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ------------------------------------------------------------ data

function enrich(m) {
  const cat = Object.fromEntries(CATS.map((c) => [c, 0]));
  let total = 0;
  for (const [id, amt] of Object.entries(m.items)) {
    const c = blockById.get(+id)?.category;
    cat[c in cat ? c : "기타"] += amt;   // 목록에 없는 분류(다른 탭에서 방금 바뀜 등)는 기타로
    total += amt;
  }
  const income = m.salary + m.extra_income;
  return { ...m, income, total, cat, free: income - total, saving: cat[SAVING], rate: income ? cat[SAVING] / income : 0 };
}

function rangeMonths() {
  const all = dash.months;
  if (!all.length) return [];
  const first = all[0].ym, last = all.at(-1).ym;
  let from = first, to = last;
  if (dashRange.preset === "6") from = addMonths(last, -5);
  else if (dashRange.preset === "12") from = addMonths(last, -11);
  else if (dashRange.preset === "year") from = last.slice(0, 4) + "-01";
  else if (dashRange.preset === "custom") {
    from = dashRange.from || first;
    to = dashRange.to || last;
    if (from > to) [from, to] = [to, from];
  }
  return all.filter((m) => m.ym >= from && m.ym <= to).map(enrich);
}

function prevOf(ym) {
  const i = dash.months.findIndex((m) => m.ym === ym);
  return i > 0 ? enrich(dash.months[i - 1]) : null;
}

// ------------------------------------------------------------ tooltip

function tipEl() {
  let el = $("#dashTip");
  if (!el) {
    el = document.createElement("div");
    el.id = "dashTip";
    el.className = "chart-tip";
    document.body.appendChild(el);
  }
  return el;
}

function showTip(html, x, y) {
  const el = tipEl();
  el.innerHTML = html;
  el.style.display = "block";
  const r = el.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top + r.height > innerHeight - 8) top = y - r.height - 16;
  el.style.left = Math.max(8, left) + "px";
  el.style.top = Math.max(8, top) + "px";
}

function hideTip() {
  const el = $("#dashTip");
  if (el) el.style.display = "none";
}

/** 툴팁 한 줄: 값이 먼저(굵게), 이름은 뒤에. */
const tipRow = (color, value, name, key = "line") =>
  `<div class="tip-row"><i class="${key === "rect" ? "rk" : "lk"}" ${color ? `style="--k:${color}"` : ""}></i><b>${value}</b><span>${esc(name)}</span></div>`;
const tipTitle = (t) => `<div class="tip-title">${esc(t)}</div>`;
const tipNote = (t) => `<div class="tip-note">${esc(t)}</div>`;

// ------------------------------------------------------------ svg helpers

function niceScale(max, count = 4) {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}

/** 월 x축 + 값 y축이 있는 차트 틀. 축 SVG는 F.axes에 담긴다. */
function frame(el, ms, { yMax, yFmt = fmt, height = 220, left = 48, right = 24 }) {
  const W = Math.max(300, el.clientWidth);
  const top = 18, bottom = 42;
  const pw = W - left - right, ph = height;
  const { max, step } = niceScale(yMax);
  const n = ms.length;
  const band = pw / n;
  const xc = (i) => left + band * (i + 0.5);
  const y = (v) => top + ph - (v / max) * ph;

  let axes = "";
  for (let t = step; t <= max + 1e-9; t += step) {
    axes += `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/>`;
    axes += `<text class="tick" x="${left - 10}" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`;
  }
  axes += `<line class="axis" x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}"/>`;
  axes += `<text class="tick" x="${left - 10}" y="${y(0) + 4}" text-anchor="end">0</text>`;
  const every = band < 22 ? 3 : band < 36 ? 2 : 1;
  ms.forEach((m, i) => {
    if ((n - 1 - i) % every) return;            // 마지막 달은 항상 표시
    const mo = +m.ym.slice(5);
    axes += `<text class="tick" x="${xc(i)}" y="${top + ph + 19}" text-anchor="middle">${mo}월</text>`;
    if (i < every || mo <= every) axes += `<text class="tick yr" x="${xc(i)}" y="${top + ph + 34}" text-anchor="middle">${m.ym.slice(0, 4)}</text>`;
  });
  return { W, H: top + ph + bottom, left, right, top, ph, pw, band, n, xc, y, axes };
}

const svgWrap = (F, body, label) =>
  `<svg class="chart" width="${F.W}" height="${F.H}" viewBox="0 0 ${F.W} ${F.H}" role="img" aria-label="${esc(label)}" tabindex="0">${body}</svg>`;

const pathOf = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");

/** 세로 막대: 데이터 끝(위)만 4px 둥글게, 바닥은 각지게. */
function colPath(x, yBot, yTop, w, round) {
  const r = round ? Math.min(4, w / 2, yBot - yTop) : 0;
  if (r <= 0) return `M${x} ${yBot}V${yTop}H${x + w}V${yBot}Z`;
  return `M${x} ${yBot}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + w - r}Q${x + w} ${yTop} ${x + w} ${yTop + r}V${yBot}Z`;
}

/** 가로 막대: 오른쪽 끝만 둥글게. */
function barPath(x, y, len, h) {
  if (len <= 0) return "";
  const r = Math.min(4, h / 2, len);
  return `M${x} ${y}H${x + len - r}Q${x + len} ${y} ${x + len} ${y + r}V${y + h - r}Q${x + len} ${y + h} ${x + len - r} ${y + h}H${x}Z`;
}

/** 달(x) 단위 hover와 키보드(←/→) 선택. activate(i | null)로 강조, tip(i)는 툴팁 html. */
function wireIndex(el, F, activate, tip) {
  const svg = $("svg", el);
  const hit = $(".hit-area", svg);
  let cur = F.n - 1;
  const pointAt = (i) => {
    const r = svg.getBoundingClientRect();
    return [r.left + F.xc(i) * (r.width / F.W), r.top + F.top + 10];
  };
  const show = (i, x, y) => { cur = i; activate(i); showTip(tip(i), x, y); };
  const hide = () => { activate(null); hideTip(); };
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (F.W / r.width);
    show(clamp(Math.floor((x - F.left) / F.band), 0, F.n - 1), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", hide);
  svg.addEventListener("focus", () => show(cur, ...pointAt(cur)));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = clamp(cur + (e.key === "ArrowRight" ? 1 : -1), 0, F.n - 1);
    show(i, ...pointAt(i));
  });
}

// ------------------------------------------------------------ chart: line

/**
 * series: [{ label, color, values }]
 * gap: [a, b]  두 시리즈 사이를 옅게 채움
 * wash: i      해당 시리즈 아래를 10% 색으로 채움
 * ref: { value }  기준선 (설명은 카드 부제목에)
 * gapLabel: (차이) => 문자열   마지막 달의 두 시리즈 사이에 표기 (공간이 될 때만)
 * markers: [{ s, i }]  특정 점에 링 표시
 */
function lineChart(el, ms, { series, yFmt = fmt, endFmt = yFmt, height = 220, right = 110, gap, gapLabel, wash, ref, markers = [], tip, label }) {
  const vmax = Math.max(0, ...series.flatMap((s) => s.values), ref?.value ?? 0);
  const F = frame(el, ms, { yMax: vmax, yFmt, height, right });
  const pts = (s) => s.values.map((v, i) => [F.xc(i), F.y(v)]);
  const base = F.y(0);
  let body = F.axes;

  if (gap) {
    const a = pts(series[gap[0]]), b = pts(series[gap[1]]).reverse();
    body += `<path class="gap-fill" d="${pathOf(a)}${b.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")}Z"/>`;
  }
  if (wash != null) {
    const a = pts(series[wash]);
    body += `<path d="${pathOf(a)}L${a.at(-1)[0]} ${base}L${a[0][0]} ${base}Z" fill="${series[wash].color}" opacity=".1"/>`;
  }
  if (ref) {
    body += `<line class="ref" x1="${F.left}" x2="${F.W - F.right}" y1="${F.y(ref.value)}" y2="${F.y(ref.value)}"/>`;
  }
  series.forEach((s) => {
    body += `<path d="${pathOf(pts(s))}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  markers.forEach(({ s, i }) => {
    body += `<circle cx="${F.xc(i)}" cy="${F.y(series[s].values[i])}" r="5" fill="var(--surface)" stroke="${series[s].color}" stroke-width="2"/>`;
  });

  // 끝점 + 직접 라벨 (가까우면 최소 간격만 확보)
  const ends = series.map((s) => ({ s, y: F.y(s.values.at(-1)) })).sort((a, b) => a.y - b.y);
  ends.forEach((e, k) => { e.ly = k ? Math.max(e.y, ends[k - 1].ly + 17) : e.y; });
  const xEnd = F.xc(F.n - 1);
  ends.forEach((e) => {
    body += `<circle cx="${xEnd}" cy="${e.y}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    body += `<text class="end-label" x="${xEnd + 11}" y="${e.ly + 4}">${e.s.label ? `<tspan class="end-name">${esc(e.s.label)} </tspan>` : ""}<tspan class="end-val">${endFmt(e.s.values.at(-1))}</tspan></text>`;
  });
  if (gap && gapLabel) {
    const va = series[gap[0]].values.at(-1), vb = series[gap[1]].values.at(-1);
    const ya = F.y(va), yb = F.y(vb);
    if (Math.abs(yb - ya) >= 44) body += `<text class="end-label gap-label" x="${xEnd + 11}" y="${(ya + yb) / 2 + 4}">${esc(gapLabel(va - vb))}</text>`;
  }

  body += `<g class="hover" visibility="hidden"><line class="xhair" y1="${F.top}" y2="${base}"/>${series.map((s) => `<circle r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join("")}</g>`;
  body += `<rect class="hit-area" x="${F.left}" y="${F.top}" width="${F.pw}" height="${F.ph}" fill="transparent"/>`;
  el.innerHTML = svgWrap(F, body, label);

  const g = $(".hover", el), line = $("line", g), dots = $$("circle", g);
  wireIndex(el, F, (i) => {
    if (i == null) return g.setAttribute("visibility", "hidden");
    g.setAttribute("visibility", "visible");
    line.setAttribute("x1", F.xc(i));
    line.setAttribute("x2", F.xc(i));
    dots.forEach((d, k) => { d.setAttribute("cx", F.xc(i)); d.setAttribute("cy", F.y(series[k].values[i])); });
  }, tip);
}

// ------------------------------------------------------------ charts

function drawIncome(el, ms) {
  const markers = ms.flatMap((m, i) => (m.extra_income ? [{ s: 0, i }] : []));
  lineChart(el, ms, {
    label: "월별 수입과 고정지출",
    series: [
      { label: "수입", color: "var(--ink-3)", values: ms.map((m) => m.income) },
      { label: "고정지출", color: "var(--ink-1)", values: ms.map((m) => m.total) },
    ],
    gap: [0, 1],
    gapLabel: (v) => `여유금 ${fmt(v)}`,
    markers,
    height: 240,
    right: 120,
    tip: (i) => {
      const m = ms[i];
      return tipTitle(ymLabel(m.ym))
        + tipRow("var(--ink-3)", fmt(m.income), "수입")
        + tipRow("var(--ink-1)", fmt(m.total), "고정지출")
        + tipRow("", fmt(m.free), "여유금")
        + (m.extra_income ? tipNote(`월급 ${fmt(m.salary)} + 기타 ${fmt(m.extra_income)}${m.extra_memo ? ` (${m.extra_memo})` : ""}`) : "");
    },
  });
}

function drawCats(el, ms) {
  const F = frame(el, ms, { yMax: Math.max(...ms.map((m) => m.total)), height: 240, right: 16 });
  const w = Math.min(24, F.band * 0.56);
  let cols = "";
  ms.forEach((m, i) => {
    const x = F.xc(i) - w / 2;
    const segs = CATS.filter((c) => m.cat[c] > 0);
    let acc = 0, s = "";
    segs.forEach((c, k) => {
      const yBot = F.y(acc) - (k ? 2 : 0);   // 세그먼트 사이 2px 틈
      acc += m.cat[c];
      const yTop = F.y(acc);
      if (yBot - yTop >= 0.5) s += `<path d="${colPath(x, yBot, yTop, w, k === segs.length - 1)}" fill="${catVar(c)}"/>`;
    });
    if (F.band >= 38) s += `<text class="cap" x="${F.xc(i)}" y="${F.y(m.total) - 8}" text-anchor="middle">${fmt(m.total)}</text>`;
    cols += `<g class="col">${s}</g>`;
  });
  const body = F.axes + `<g class="cols">${cols}</g><rect class="hit-area" x="${F.left}" y="${F.top}" width="${F.pw}" height="${F.ph}" fill="transparent"/>`;
  el.innerHTML = svgWrap(F, body, "분류별 고정지출");
  const g = $(".cols", el), colEls = $$(".col", el);
  wireIndex(el, F, (i) => {
    g.classList.toggle("dim", i != null);
    colEls.forEach((c, k) => c.classList.toggle("hi", k === i));
  }, (i) => {
    const m = ms[i];
    return tipTitle(ymLabel(m.ym))
      + [...CATS].reverse().filter((c) => m.cat[c] > 0).map((c) => tipRow(catVar(c), fmt(m.cat[c]), c, "rect")).join("")
      + `<div class="tip-total"><b>${fmt(m.total)}</b><span>합계</span></div>`;
  });
}

function drawRate(el, ms) {
  const avg = sum(ms.map((m) => m.saving)) / (sum(ms.map((m) => m.income)) || 1);
  lineChart(el, ms, {
    label: "저축률 추이",
    series: [{ color: catVar(SAVING), values: ms.map((m) => m.rate) }],
    wash: 0,
    ref: ms.length > 1 ? { value: avg } : null,
    yFmt: (v) => Math.round(v * 100) + "%",
    endFmt: pct,
    right: 64,
    tip: (i) => {
      const m = ms[i];
      return tipTitle(ymLabel(m.ym)) + tipRow(catVar(SAVING), pct(m.rate), "저축률")
        + tipNote(`저축·투자 ${fmt(m.saving)} / 수입 ${fmt(m.income)}`);
    },
  });
}

function drawLiving(el, ms) {
  lineChart(el, ms, {
    label: "생활비와 구독·회비 추이",
    series: [
      { label: "생활", color: catVar("생활"), values: ms.map((m) => m.cat["생활"]) },
      { label: "구독·회비", color: catVar("구독·회비"), values: ms.map((m) => m.cat["구독·회비"]) },
    ],
    right: 112,
    tip: (i) => {
      const m = ms[i];
      return tipTitle(ymLabel(m.ym))
        + tipRow(catVar("생활"), fmt(m.cat["생활"]), "생활")
        + tipRow(catVar("구독·회비"), fmt(m.cat["구독·회비"]), "구독·회비")
        + `<div class="tip-total"><b>${fmt(m.cat["생활"] + m.cat["구독·회비"])}</b><span>합계</span></div>`;
    },
  });
}

function cumulative(ms) {
  let acc = 0;
  return ms.map((m) => (acc += m.saving));
}

function drawCum(el, ms) {
  const cum = cumulative(ms);
  lineChart(el, ms, {
    label: "누적 저축·투자",
    series: [{ color: catVar(SAVING), values: cum }],
    wash: 0,
    right: 64,
    tip: (i) => tipTitle(ymLabel(ms[i].ym))
      + tipRow(catVar(SAVING), fmt(cum[i]), "누적")
      + tipNote(`이번 달 +${fmt(ms[i].saving)}`),
  });
}

function savingBlocks(ms) {
  const totals = new Map();
  ms.forEach((m) => {
    for (const [id, amt] of Object.entries(m.items)) {
      const b = blockById.get(+id);
      if (b?.category !== SAVING) continue;
      const t = totals.get(b.id) ?? { name: b.name, total: 0, months: 0 };
      t.total += amt;
      t.months += 1;
      totals.set(b.id, t);
    }
  });
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

function drawSaveBlocks(el, ms) {
  const rows = savingBlocks(ms);
  if (!rows.length) { el.innerHTML = '<div class="empty">이 기간에 저축·투자 항목이 없어요</div>'; return; }
  const W = Math.max(300, el.clientWidth);
  const labelW = 92, right = 60, rowH = 34, barH = 16, top = 6;
  const max = rows[0].total;
  const len = (v) => (v / max) * (W - labelW - right);
  let body = `<line class="axis" x1="${labelW}" x2="${labelW}" y1="${top}" y2="${top + rows.length * rowH}"/>`;
  rows.forEach((r, k) => {
    const y = top + k * rowH;
    body += `<g class="hbar" data-k="${k}">
      <rect class="row-hit" x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
      <text class="tick name" x="${labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(r.name)}</text>
      <path d="${barPath(labelW, y + (rowH - barH) / 2, len(r.total), barH)}" fill="${catVar(SAVING)}"/>
      <text class="cap" x="${labelW + len(r.total) + 8}" y="${y + rowH / 2 + 4}">${fmt(r.total)}</text>
    </g>`;
  });
  const H = top * 2 + rows.length * rowH;
  el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="저축·투자 항목별 합계">${body}</svg>`;
  $$(".hbar", el).forEach((g) => {
    const r = rows[+g.dataset.k];
    g.addEventListener("pointermove", (e) => showTip(
      tipTitle(r.name) + tipRow(catVar(SAVING), fmt(r.total), "기간 합계", "rect") + tipNote(`${r.months}개월 · 월평균 ${fmt1(r.total / r.months)}`),
      e.clientX, e.clientY));
    g.addEventListener("pointerleave", hideTip);
  });
}

function drawHeat(el, ms) {
  const inRange = new Set(ms.flatMap((m) => Object.keys(m.items).map(Number)));
  const blocks = dash.blocks.filter((b) => inRange.has(b.id));
  if (!blocks.length) { el.innerHTML = '<div class="empty">표시할 블럭이 없어요</div>'; return; }
  const max = Math.max(...ms.flatMap((m) => Object.values(m.items)));
  const prevItems = ms.map((m) => prevOf(m.ym)?.items ?? null);

  const head = `<tr><th class="hm-name">블럭</th>${ms.map((m, i) => `<th>${+m.ym.slice(5)}월${i === 0 || m.ym.endsWith("-01") ? `<small>${m.ym.slice(2, 4)}년</small>` : ""}</th>`).join("")}<th class="hm-sum">합계</th></tr>`;
  const cols = ms.length + 2;
  const groups = CATS.map((cat) => [cat, blocks.filter((b) => b.category === cat)]).filter(([, list]) => list.length);
  const row = (b) => {
    let total = 0;
    const cells = ms.map((m, i) => {
      const v = m.items[b.id];
      if (v == null) return `<td class="hm-empty" data-tip="${esc(`${b.name}|${ymLabel(m.ym)}|없음`)}">·</td>`;
      total += v;
      const t = Math.sqrt(v / max);
      const mix = Math.round(10 + 80 * t);
      const prev = prevItems[i]?.[b.id];
      const arrow = prev != null && prev !== v ? `<i class="hm-chg">${v > prev ? "▲" : "▼"}</i>` : "";
      const tip = `${b.name}|${ymLabel(m.ym)}|${fmt(v)}${prev != null && prev !== v ? `|전달 ${fmt(prev)} → ${fmt(v)}` : ""}`;
      return `<td class="hm-cell ${mix > 52 ? "on-dark" : ""}" style="--mix:${mix}%" data-tip="${esc(tip)}" tabindex="0">${fmt(v)}${arrow}</td>`;
    }).join("");
    return `<tr class="hm-row ${catClass(b.category)}"><th class="hm-name">${esc(b.name)}</th>${cells}<td class="hm-sum">${fmt(total)}</td></tr>`;
  };
  // 분류마다: 구분선 → 분류 머리줄(달별 소계) → 블럭 줄
  const body = groups.map(([cat, list], gi) => {
    const subs = ms.map((m) => sum(list.map((b) => m.items[b.id] ?? 0)));
    return `
      ${gi ? `<tr class="hm-sep" aria-hidden="true"><td colspan="${cols}"></td></tr>` : ""}
      <tr class="hm-cat ${catClass(cat)}">
        <th class="hm-name"><span class="cat-dot"></span>${esc(cat)}<small>${list.length}개</small></th>
        ${subs.map((v) => `<td>${v ? fmt(v) : ""}</td>`).join("")}
        <td class="hm-sum">${fmt(sum(subs))}</td>
      </tr>
      ${list.map(row).join("")}`;
  }).join("");
  el.innerHTML = `<div class="hm-wrap"><table class="heat"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;

  const showCell = (td, x, y) => {
    const [name, when, val, chg] = td.dataset.tip.split("|");
    showTip(tipTitle(`${name} · ${when}`) + `<div class="tip-row"><b>${esc(val)}</b>${val !== "없음" ? "<span>만원</span>" : ""}</div>` + (chg ? tipNote(chg) : ""), x, y);
  };
  el.addEventListener("pointerover", (e) => { const td = e.target.closest("[data-tip]"); if (td) showCell(td, e.clientX, e.clientY); });
  el.addEventListener("pointermove", (e) => { const td = e.target.closest("[data-tip]"); if (td) showCell(td, e.clientX, e.clientY); else hideTip(); });
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("focusin", (e) => { const td = e.target.closest("[data-tip]"); if (!td) return; const r = td.getBoundingClientRect(); showCell(td, r.right, r.bottom); });
  el.addEventListener("focusout", hideTip);
}

// ------------------------------------------------------------ table views

function tableHtml(head, rows) {
  const cell = (v) => (typeof v === "number" ? `<td class="num">${fmt(v)}</td>` : `<td>${esc(v)}</td>`);
  return `<div class="tv-wrap"><table class="tv"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const CHARTS = {
  income: {
    title: "수입과 고정지출", sub: "두 선 사이 음영이 여유금이에요 · 링 표시는 기타 수입이 있던 달 · 단위 만원",
    legend: () => legendItem("var(--ink-3)", "수입") + legendItem("var(--ink-1)", "고정지출") + `<span><i class="rk gap-key"></i>여유금</span>`,
    draw: drawIncome,
    table: (ms) => tableHtml(["월", "월급", "기타 수입", "수입", "고정지출", "여유금"],
      ms.map((m) => [ymLabel(m.ym), m.salary, m.extra_income, m.income, m.total, m.free])),
  },
  cats: {
    title: "분류별 고정지출", sub: "막대 위 숫자는 그달 고정지출 합계 · 단위 만원",
    legend: (ms) => usedCats(ms).map((c) => legendItem(catVar(c), c, "rect")).join(""),
    draw: drawCats,
    table: (ms) => tableHtml(["월", ...usedCats(ms), "합계"], ms.map((m) => [ymLabel(m.ym), ...usedCats(ms).map((c) => m.cat[c]), m.total])),
  },
  rate: {
    title: "저축률",
    sub: (ms) => `수입 중 저축·투자에 넣은 비율${ms.length > 1 ? ` · 가로선은 기간 평균 ${pct(sum(ms.map((m) => m.saving)) / (sum(ms.map((m) => m.income)) || 1))}` : ""}`,
    draw: drawRate,
    table: (ms) => tableHtml(["월", "저축·투자", "수입", "저축률"], ms.map((m) => [ymLabel(m.ym), m.saving, m.income, pct(m.rate)])),
  },
  living: {
    title: "생활비 · 구독 고정비", sub: "저축을 뺀 순수 고정 소비 · 단위 만원",
    legend: () => legendItem(catVar("생활"), "생활") + legendItem(catVar("구독·회비"), "구독·회비"),
    draw: drawLiving,
    table: (ms) => tableHtml(["월", "생활", "구독·회비", "합계"], ms.map((m) => [ymLabel(m.ym), m.cat["생활"], m.cat["구독·회비"], m.cat["생활"] + m.cat["구독·회비"]])),
  },
  cum: {
    title: "누적 저축·투자", sub: "기간 첫 달부터 쌓인 금액 · 단위 만원",
    draw: drawCum,
    table: (ms) => { const c = cumulative(ms); return tableHtml(["월", "이번 달", "누적"], ms.map((m, i) => [ymLabel(m.ym), m.saving, c[i]])); },
  },
  saveBlocks: {
    title: "저축·투자 항목별 합계", sub: "기간 합계 · 단위 만원",
    draw: drawSaveBlocks,
    table: (ms) => tableHtml(["항목", "기간 합계", "개월", "월평균"], savingBlocks(ms).map((r) => [r.name, r.total, `${r.months}개월`, Math.round(r.total / r.months * 10) / 10])),
  },
  heat: {
    title: "블럭별 월 금액", sub: "색이 진할수록 큰 금액 · ▲▼는 전달 대비 금액이 바뀐 칸 · 분류 줄의 숫자는 그달 분류 소계",
    draw: drawHeat,
    noTable: true,
  },
};

/** 기간 안에 금액이 있는 분류만 (빈 분류는 범례/표에서 뺀다) */
const usedCats = (ms) => CATS.filter((c) => ms.some((m) => m.cat[c]));

function legendItem(color, name, key = "line") {
  return `<span><i class="${key === "rect" ? "rk" : "lk"}" style="--k:${color}"></i>${esc(name)}</span>`;
}

// ------------------------------------------------------------ page

function kpiTiles(ms) {
  const last = ms.at(-1);
  const prev = prevOf(last.ym);
  const totalSaving = sum(ms.map((m) => m.saving));
  const totalIncome = sum(ms.map((m) => m.income));
  const best = ms.reduce((a, b) => (b.rate > a.rate ? b : a));
  const maxTotal = ms.reduce((a, b) => (b.total > a.total ? b : a));
  const delta = prev ? last.free - prev.free : null;
  const deltaHtml = delta == null ? "비교할 지난달이 없어요"
    : Math.abs(delta) < 0.005 ? "지난달과 같아요"
    : `<span class="delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))}</span> 지난달 대비`;
  const tile = (label, value, unit, sub) => `
    <div class="kpi card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}${unit ? `<small>${unit}</small>` : ""}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  return tile(`${+last.ym.slice(5)}월 여유금`, fmt(last.free), "만원", deltaHtml)
    + tile("평균 저축률", pct(totalIncome ? totalSaving / totalIncome : 0), "", `최고 ${ymLabel(best.ym)} ${pct(best.rate)}`)
    + tile("저축·투자 합계", fmt(totalSaving), "만원", `월평균 ${fmt1(totalSaving / ms.length)}만원`)
    + tile("월평균 고정지출", fmt1(sum(ms.map((m) => m.total)) / ms.length), "만원", `최대 ${ymLabel(maxTotal.ym)} ${fmt(maxTotal.total)}만원`);
}

function chartCard(id, ms) {
  const c = CHARTS[id];
  const asTable = dashTables.has(id);
  return `
    <section class="card chart-card">
      <div class="cc-head">
        <div><h3>${c.title}</h3><p>${typeof c.sub === "function" ? c.sub(ms) : c.sub}</p></div>
        ${c.noTable ? "" : `<button class="tbl-btn" data-act="dash-table" data-key="${id}">${asTable ? "차트로 보기" : "표로 보기"}</button>`}
      </div>
      ${c.legend && !asTable ? `<div class="cc-legend">${c.legend(ms)}</div>` : ""}
      <div class="cc-body" id="cc-${id}"></div>
    </section>`;
}

async function renderDashboard() {
  if (!dash) main.innerHTML = '<div class="loading">불러오는 중…</div>';
  else $(".dash")?.classList.add("refreshing");
  try {
    dash = await api("GET", "/stats");
  } catch (err) {
    main.innerHTML = `<div class="loading">통계를 불러올 수 없어요: ${esc(err.message)}</div>`;
    return;
  }
  blockById = new Map(dash.blocks.map((b) => [b.id, b]));
  drawDashboard();
}

function drawDashboard() {
  const ms = rangeMonths();
  const opts = (sel) => dash.months.map((m) => `<option value="${m.ym}" ${m.ym === sel ? "selected" : ""}>${ymLabel(m.ym)}</option>`).join("");
  const custom = dashRange.preset === "custom";
  main.innerHTML = `
    <div class="dash">
      <header class="page-head">
        <h1>대시보드</h1>
        <span class="range-label">${ms.length ? `${ymLabel(ms[0].ym)} – ${ymLabel(ms.at(-1).ym)} · ${ms.length}개월` : ""}</span>
      </header>

      <div class="filter-row">
        <div class="tabs" role="group" aria-label="기간">
          ${PRESETS.map(([k, l]) => `<button class="tab ${dashRange.preset === k ? "on" : ""}" data-act="dash-range" data-key="${k}" aria-pressed="${dashRange.preset === k}">${l}</button>`).join("")}
        </div>
        ${custom ? `
          <div class="custom-range">
            <select class="input" id="dFrom" aria-label="시작 달">${opts(dashRange.from || dash.months[0]?.ym)}</select>
            <span>~</span>
            <select class="input" id="dTo" aria-label="끝 달">${opts(dashRange.to || dash.months.at(-1)?.ym)}</select>
          </div>` : ""}
        <span class="filter-note">아직 오지 않은 ${esc(ymLabel(addMonths(dash.until, 1)))}부터는 미리 만들어 둬도 제외돼요</span>
      </div>

      ${ms.length ? `
        <div class="kpis">${kpiTiles(ms)}</div>
        ${chartCard("income", ms)}
        ${chartCard("cats", ms)}
        <div class="two">${chartCard("rate", ms)}${chartCard("living", ms)}</div>
        <div class="two">${chartCard("cum", ms)}${chartCard("saveBlocks", ms)}</div>
        ${chartCard("heat", ms)}`
      : '<div class="empty">이 기간에는 데이터가 없어요</div>'}
    </div>`;
  drawCharts(ms);
}

function drawCharts(ms = rangeMonths()) {
  hideTip();
  if (!ms.length) return;
  for (const [id, c] of Object.entries(CHARTS)) {
    const el = $("#cc-" + id);
    if (!el) continue;
    if (dashTables.has(id) && c.table) el.innerHTML = c.table(ms);
    else c.draw(el, ms);
  }
}

const dashActions = {
  "dash-range"(key) {
    dashRange.preset = key;
    if (key === "custom" && !dashRange.from && dash.months.length) {
      const first = dash.months[0].ym, last = dash.months.at(-1).ym;
      const from = addMonths(last, -11);
      dashRange.from = from < first ? first : from;
      dashRange.to = last;
    }
    drawDashboard();
  },
  "dash-table"(id) {
    dashTables.has(id) ? dashTables.delete(id) : dashTables.add(id);
    drawDashboard();
  },
};

function dashChange(t) {
  if (t.id === "dFrom") dashRange.from = t.value;
  else if (t.id === "dTo") dashRange.to = t.value;
  else return false;
  drawDashboard();
  return true;
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (location.hash === "#/dashboard" && dash) drawCharts(); }, 150);
});
