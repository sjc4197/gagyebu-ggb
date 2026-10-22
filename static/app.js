"use strict";

// 분류 목록은 서버(/api/categories)에서 받는다. 색 번호 1~8은 style.css의 --c1~--c8
let CATS = [];
let CAT_LIST = [];          // [{ id, name, builtin, color, blocks }]
let CAT_COLOR = {};
const MAX_CATS = 8;

const ICON = {
  check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dots: '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>',
  left: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 20 20"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pencil: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 13L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 16 16"><path d="M5 5H10a3.5 3.5 0 010 7H6M5 5l2.5-2.5M5 5l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // 블럭 체크: pathLength=1이라 CSS로 그려지는 애니메이션을 줄 수 있다
  checkDraw: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-6.5" pathLength="1" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ok: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="currentColor"/><path d="M6.5 10.2l2.4 2.4 4.6-5" fill="none" stroke="var(--toast-bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14" r="1.2" fill="currentColor"/></svg>',
};

// ------------------------------------------------------------ utils

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $("#main");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round2 = (n) => Math.round((n || 0) * 100) / 100;
const fmt = (n) => round2(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const ymLabel = (ym) => { const [y, m] = ym.split("-"); return `${y}년 ${+m}월`; };
const thisYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const catClass = (c) => "c" + (CAT_COLOR[c] || 5);

function setCategories(list) {
  CAT_LIST = list;
  CATS = list.map((c) => c.name);
  CAT_COLOR = Object.fromEntries(list.map((c) => [c.name, c.color]));
}

async function loadCategories() {
  setCategories(await api("GET", "/categories"));
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : "입력값을 확인하세요";
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 알림. undo를 주면 '되돌리기' 버튼이 붙고 조금 더 오래 떠 있는다. */
let toastTimer;
function toast(msg, kind = "", undo = null) {
  const el = $("#toast");
  el.innerHTML = `<span class="t-icon">${kind === "err" ? ICON.alert : ICON.ok}</span><span>${esc(msg)}</span>
    ${undo ? '<button type="button" class="t-undo">되돌리기</button>' : ""}`;
  el.className = `show ${kind} ${undo ? "has-undo" : ""}`;
  if (undo) {
    $(".t-undo", el).addEventListener("click", async () => {
      el.classList.remove("show");
      try { await undo(); } catch (err) { toast(err.message, "err"); }
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), undo ? 5000 : 2200);
}

// ------------------------------------------------------------ theme

// 라이트 / 다크 / 시스템(Windows 설정을 따름). index.html 머리의 스크립트와 같은 규칙
const THEME_KEY = "ggb.theme";
const THEME_MODES = ["light", "dark", "system"];
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let themePref = "system";
try { themePref = localStorage.getItem(THEME_KEY) || "system"; } catch {}

let themeTimer;
function applyTheme(animate) {
  const root = document.documentElement;
  const dark = themePref === "dark" || (themePref === "system" && darkQuery.matches);
  if (animate && !reduceMotion()) {
    root.classList.add("theming");
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove("theming"), 450);
  }
  root.dataset.theme = dark ? "dark" : "light";
  $(".theme-ind").style.transform = `translateX(${THEME_MODES.indexOf(themePref) * 100}%)`;
  $$(".theme-seg [data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === themePref));
}

$(".theme-seg").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mode]");
  if (!btn || btn.dataset.mode === themePref) return;
  themePref = btn.dataset.mode;
  try { localStorage.setItem(THEME_KEY, themePref); } catch {}
  applyTheme(true);
});
darkQuery.addEventListener("change", () => themePref === "system" && applyTheme(true));
applyTheme(false);

function catSeg(name, selected) {
  return `<div class="seg" data-seg="${name}">${CATS.map((c) => `
    <label class="${catClass(c)}"><input type="radio" name="${name}" value="${esc(c)}" ${c === selected ? "checked" : ""}><span>${esc(c)}</span></label>`).join("")}
    ${CATS.length < MAX_CATS ? `<button type="button" class="seg-add" data-seg-add>${ICON.plus} 새 분류</button>` : ""}
  </div>`;
}

/** 모달 안 분류 선택 칸에서 새 분류를 바로 만든다. */
async function addCategoryInline(seg) {
  const input = $(".seg-new input", seg);
  const name = input.value.trim();
  if (!name) return input.focus();
  try {
    setCategories(await api("POST", "/categories", { name }));
  } catch (err) {
    toast(err.message, "err");
    return input.focus();
  }
  seg.outerHTML = catSeg(seg.dataset.seg, name);
  toast(`'${name}' 분류를 만들었어요`);
}

$("#modal").addEventListener("click", (e) => {
  const seg = e.target.closest(".seg");
  if (!seg) return;
  if (e.target.closest("[data-seg-add]")) {
    e.target.closest("[data-seg-add]").outerHTML = `
      <span class="seg-new">
        <input class="input" maxlength="12" placeholder="새 분류 이름" aria-label="새 분류 이름">
        <button type="button" class="btn btn-sm btn-primary" data-seg-ok>추가</button>
        <button type="button" class="btn btn-sm btn-ghost" data-seg-cancel>취소</button>
      </span>`;
    $(".seg-new input", seg).focus();
  } else if (e.target.closest("[data-seg-ok]")) {
    addCategoryInline(seg);
  } else if (e.target.closest("[data-seg-cancel]")) {
    const checked = $("input[type=radio]:checked", seg)?.value;
    seg.outerHTML = catSeg(seg.dataset.seg, checked);
  }
});

$("#modal").addEventListener("keydown", (e) => {
  const seg = e.target.closest(".seg-new") && e.target.closest(".seg");
  if (!seg) return;
  if (e.key === "Enter") { e.preventDefault(); addCategoryInline(seg); }
  if (e.key === "Escape") { e.preventDefault(); $("[data-seg-cancel]", seg).click(); }
});

/** 폼 모달. 제출 버튼의 value가 action으로 전달된다 ("cancel"은 그냥 닫힘).
    onSubmit이 false를 돌려주면 닫지 않는다 (다른 모달로 바꿔 띄울 때). */
function openModal({ title, desc = "", body = "", actions, onSubmit }) {
  const dlg = $("#modal");
  dlg.innerHTML = `
    <form class="modal" method="dialog" novalidate>
      <h3>${title}</h3>
      ${desc ? `<p class="desc">${desc}</p>` : ""}
      ${body ? `<div class="modal-body">${body}</div>` : ""}
      <div class="modal-actions">${actions}</div>
    </form>`;
  const form = $("form", dlg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const action = e.submitter?.value || "save";
    if (action === "cancel") return dlg.close();
    try {
      const keep = await onSubmit(Object.fromEntries(new FormData(form)), action);
      if (keep !== false) dlg.close();
    } catch (err) {
      toast(err.message, "err");
    }
  });
  if (!dlg.open) dlg.showModal();
  const first = $("input:not([type=radio])", dlg);
  if (first) { first.focus(); first.select?.(); }
}

// ------------------------------------------------------------ sidebar

let months = [];

// 사이드바 연도 접힘 상태. 저장된 값이 없으면 올해와 지금 보는 달의 연도만 펼친다.
const NAV_KEY = "ggb.navYears";
let navYears = {};
try { navYears = JSON.parse(localStorage.getItem(NAV_KEY)) || {}; } catch {}

function yearOpen(year, hash) {
  if (year in navYears) return navYears[year];
  return year === thisYm().slice(0, 4) || hash.startsWith(`#/m/${year}-`);
}

$("#monthNav").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-year]");
  if (!btn) return;
  const year = btn.dataset.year;
  navYears[year] = !yearOpen(year, location.hash);
  try { localStorage.setItem(NAV_KEY, JSON.stringify(navYears)); } catch {}
  renderNav();
});

async function refreshNav() {
  months = await api("GET", "/months");
  renderNav();
}

function renderNav() {
  const hash = location.hash;
  const byYear = {};
  [...months].reverse().forEach((m) => (byYear[m.ym.slice(0, 4)] ??= []).push(m));
  $("#monthNav").innerHTML = Object.entries(byYear)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, list]) => {
      const open = yearOpen(year, hash);
      const pending = list.filter((m) => m.remaining_count).length;
      return `
      <button class="nav-year" data-year="${year}" aria-expanded="${open}">
        <span class="nav-chev">${ICON.right}</span>${year}
        ${open ? "" : `<span class="nav-year-sum">${list.length}개월${pending ? ` · 남은 달 ${pending}` : ""}</span>`}
      </button>
      ${open ? list.map(navItem).join("") : ""}`;
    })
    .join("");
  $(".new-month-btn").classList.toggle("active", hash.startsWith("#/new"));
  $('[data-nav="home"]').classList.toggle("active", hash.startsWith("#/m/"));
  $('[data-nav="dash"]').classList.toggle("active", hash === "#/dashboard");
  $('[data-nav="blocks"]').classList.toggle("active", hash === "#/blocks");
  moveNavIndicator();
}

function navItem(m) {
  const now = thisYm();
  const done = m.count > 0 && !m.remaining_count;
  const pct = m.total ? ((m.total - m.remaining) / m.total) * 100 : 0;
  return `
    <a class="nav-item ${location.hash === "#/m/" + m.ym ? "active" : ""} ${done ? "done" : ""}" href="#/m/${m.ym}">
      <span class="nav-row">
        <span class="nav-m">${+m.ym.slice(5)}월</span>
        ${m.ym === now ? '<span class="nav-tag now">이번 달</span>' : m.ym > now ? '<span class="nav-tag">미리</span>' : ""}
        ${m.remaining_count
          ? `<span class="nav-rem ${m.remaining_count < m.count ? "pending" : ""}" title="아직 나갈 돈">${fmt(m.remaining)}</span>`
          : done ? `<span class="nav-done" title="모두 나감">${ICON.check}완료</span>` : ""}
      </span>
      <span class="nav-bar"><i style="width:${pct}%"></i></span>
    </a>`;
}

/** 위쪽 메뉴의 선택 표시를 지금 메뉴로 미끄러지듯 옮긴다. 처음 나타날 때는 바로 그 자리에. */
function moveNavIndicator() {
  const ind = $(".nav-ind");
  const active = $(".main-nav a.active");
  if (!active) return ind.classList.remove("on");
  if (!ind.classList.contains("on")) {
    ind.style.transition = "none";
    ind.style.transform = `translateY(${active.offsetTop}px)`;
    ind.offsetHeight;   // 위치를 먼저 확정해야 다음 이동부터 애니메이션이 걸린다
    ind.style.transition = "";
  }
  ind.style.transform = `translateY(${active.offsetTop}px)`;
  ind.classList.add("on");
}

// ------------------------------------------------------------ month view

let month = null;
let showOldPool = false;
let lastToggled = null;
let catFilter = null;        // 분류로 거르기 (null = 전체)
let stagger = false;         // 다음 그리기에서 카드를 차례로 들어오게
let shown = null;            // 화면에 그려 둔 { ym, remaining, pct }: 바뀐 만큼만 애니메이션
const FOLD_KEY = "ggb.paidFolded";
let paidFolded = false;
try { paidFolded = localStorage.getItem(FOLD_KEY) === "1"; } catch {}

async function loadMonth(ym) {
  try {
    month = await api("GET", "/months/" + ym);
  } catch (err) {
    toast(err.message, "err");
    return location.replace("#/");
  }
  shown = null;
  catFilter = null;
  stagger = true;
  renderMonth();
}

async function applyMonth(promise) {
  month = await promise;
  renderMonth();
  refreshNav();
}

function blockCard(i, idx) {
  return `
    <div class="block ${catClass(i.category)} ${i.paid ? "paid" : ""} ${lastToggled === i.block_id ? "pop" : ""}"
         style="--i:${Math.min(idx, 14)}" data-act="toggle" data-id="${i.block_id}" role="button" tabindex="0"
         aria-pressed="${i.paid}" title="${i.paid ? "눌러서 '안 나감'으로 되돌리기" : "눌러서 '나감'으로 표시"}">
      <span class="b-top">
        <span class="b-cat"><i></i>${esc(i.category)}</span>
        <span class="check">${ICON.checkDraw}</span>
      </span>
      <span class="b-name">${esc(i.name)}</span>
      ${i.memo ? `<span class="b-memo">${esc(i.memo)}</span>` : ""}
      <span class="b-foot">
        <span class="b-amt">${fmt(i.amount)}<small>만원</small></span>
        <button class="b-more" data-act="edit-item" data-id="${i.block_id}" title="수정" aria-label="${esc(i.name)} 수정">${ICON.dots}</button>
      </span>
    </div>`;
}

function poolChip(b) {
  return `
    <span class="chip ${catClass(b.category)} ${b.hidden ? "old" : ""} ${lastToggled === b.id ? "pop" : ""}">
      <button class="chip-main" data-act="include" data-id="${b.id}" title="이번 달에 추가">
        <span class="chip-dot"></span>${esc(b.name)}
        <span class="chip-amt">${fmt(b.last_amount)}</span>
        <span class="chip-plus">${ICON.plus}</span>
      </button>
      <button class="chip-x" data-act="${b.hidden ? "unhide" : "hide"}" data-id="${b.id}"
              title="${b.hidden ? "블럭 풀에 다시 보이기" : "숨기기 (예전 블럭으로)"}">${b.hidden ? ICON.undo : ICON.x}</button>
    </span>`;
}

/** 숫자를 from에서 to까지 부드럽게 바꾼다 (아직 나갈 돈). */
let countRaf;
function countUp(el, from, to) {
  cancelAnimationFrame(countRaf);
  if (from === to || reduceMotion()) return (el.textContent = fmt(to));
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 650);
    const e = 1 - (1 - t) ** 3;
    el.textContent = t < 1 ? fmt(Math.round((from + (to - from) * e) * 10) / 10) : fmt(to);
    if (t < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

function heroSub(m, done) {
  const s = m.summary;
  if (done) return "이번 달 고정지출이 모두 나갔어요";
  if (!s.count) return "아래 블럭 풀에서 이번 달 고정지출을 추가하세요";
  const biggest = m.items.filter((i) => !i.paid).reduce((a, b) => (b.amount > a.amount ? b : a));
  return `<b>${s.remaining_count}건</b> 남았어요 · 가장 큰 항목은 ${esc(biggest.name)} ${fmt(biggest.amount)}만원`;
}

function renderMonth() {
  const m = month;
  const s = m.summary;
  if (catFilter && !s.by_category.some((c) => c.category === catFilter)) catFilter = null;
  const inFilter = (i) => !catFilter || i.category === catFilter;
  const unpaid = m.items.filter((i) => !i.paid && inFilter(i));
  const paid = m.items.filter((i) => i.paid && inFilter(i));
  const pct = s.total ? (s.paid / s.total) * 100 : 0;
  const pool = m.pool.filter((b) => !b.hidden);
  const oldPool = m.pool.filter((b) => b.hidden);
  const done = s.count > 0 && s.remaining_count === 0;
  const paidCount = s.count - s.remaining_count;
  // 같은 달을 다시 그릴 때는 직전 값에서, 달을 새로 열면 링은 0에서 시작한다
  const from = shown?.ym === m.ym ? shown : { remaining: s.remaining, pct: 0 };
  const grid = stagger ? "grid stagger" : "grid";

  main.innerHTML = `
    <header class="page-head">
      <div class="month-switch">
        <a class="icon-btn prev ${m.prev ? "" : "disabled"}" href="#/m/${m.prev || ""}" title="이전 달 (←)">${ICON.left}</a>
        <h1>${ymLabel(m.ym)}</h1>
        <a class="icon-btn next ${m.next ? "" : "disabled"}" href="#/m/${m.next || ""}" title="다음 달 (→)">${ICON.right}</a>
        ${m.ym === thisYm() ? '<span class="tag">이번 달</span>' : m.ym > thisYm() ? '<span class="tag soft">미리 만든 달</span>' : ""}
      </div>
      <button class="btn btn-danger btn-sm" data-act="delete-month">이 달 삭제</button>
    </header>

    <section class="card hero">
      <div class="hero-main">
        <div>
          <div class="hero-label">아직 나갈 돈</div>
          <div class="hero-num ${done ? "done" : ""}"><span class="hero-val">${fmt(from.remaining)}</span><span class="unit">만원</span></div>
          <div class="hero-sub">${heroSub(m, done)}</div>
        </div>
        <div class="stats">
          <button class="stat stat-btn" data-act="edit-income" title="수입 수정">
            <span class="stat-label">수입 ${ICON.pencil}</span>
            <span class="stat-num">${fmt(s.income)}<small>만원</small></span>
            <span class="stat-sub">${m.extra_income
              ? `월급 ${fmt(m.salary)} + 기타 ${fmt(m.extra_income)}${m.extra_memo ? ` (${esc(m.extra_memo)})` : ""}`
              : "월급"}</span>
          </button>
          <div class="stat">
            <span class="stat-label">고정지출</span>
            <span class="stat-num">${fmt(s.total)}<small>만원</small></span>
            <span class="stat-sub">블럭 ${s.count}개</span>
          </div>
          <div class="stat">
            <span class="stat-label">여유금</span>
            <span class="stat-num ${s.free < 0 ? "neg" : "pos"}">${fmt(s.free)}<small>만원</small></span>
            <span class="stat-sub">수입 − 고정지출</span>
          </div>
        </div>
      </div>
      <div class="hero-ring">
        <div class="ring ${done ? "done" : ""} ${pct ? "" : "zero"}" role="img"
             aria-label="고정지출 ${s.count}건 중 ${paidCount}건, ${Math.round(pct)}퍼센트 나감">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle class="ring-track" cx="100" cy="100" r="84"/>
            <circle class="ring-val" cx="100" cy="100" r="84" pathLength="100" style="stroke-dasharray:${from.pct} 100"/>
          </svg>
          <div class="ring-center">
            <span class="ring-pct">${Math.round(pct)}%</span>
            <span class="ring-cnt">${paidCount}/${s.count}건 나감</span>
          </div>
        </div>
      </div>
    </section>

    ${s.by_category.length ? `
    <section class="card breakdown">
      <div class="bar ${catFilter ? "filtered" : ""}">${s.by_category.map((c) => `
        <i class="${catClass(c.category)} ${c.category === catFilter ? "on" : ""}" style="flex:${c.total}" title="${esc(c.category)} ${fmt(c.total)}"></i>`).join("")}
      </div>
      <div class="fchips" role="group" aria-label="분류로 거르기">
        <button class="fchip" data-act="filter" data-key="" aria-pressed="${!catFilter}">전체</button>
        ${s.by_category.map((c) => `
        <button class="fchip ${catClass(c.category)}" data-act="filter" data-key="${esc(c.category)}" aria-pressed="${c.category === catFilter}">
          <i></i>${esc(c.category)} <b>${fmt(c.total)}</b></button>`).join("")}
      </div>
    </section>` : ""}

    <section class="section">
      <div class="section-head">
        <h2>나갈 항목 <span class="count todo">${unpaid.length}</span></h2>
        <span class="hint">블럭을 누르면 나감으로 표시돼요</span>
      </div>
      ${unpaid.length
        ? `<div class="${grid}">${unpaid.map(blockCard).join("")}</div>`
        : `<div class="empty ${done || catFilter ? "done" : ""}">${
            catFilter ? `${esc(catFilter)} 분류는 모두 나갔어요` : done ? "남은 항목이 없어요. 이번 달 끝!" : "이번 달 고정지출이 없어요"}</div>`}
    </section>

    ${paid.length ? `
    <section class="section">
      <div class="section-head">
        <h2>나간 항목 <span class="count pos">${paid.length}</span></h2>
        <button class="fold right" data-act="fold" aria-expanded="${!paidFolded}">${paidFolded ? "펼치기" : "접기"}${ICON.down}</button>
      </div>
      ${paidFolded ? "" : `<div class="${grid}">${paid.map(blockCard).join("")}</div>`}
    </section>` : ""}

    <section class="section">
      <div class="section-head">
        <h2>블럭 풀</h2>
        <span class="hint">누르면 이번 달 고정지출에 추가돼요</span>
      </div>
      <div class="chips">
        ${pool.map(poolChip).join("")}
        ${showOldPool ? oldPool.map(poolChip).join("") : ""}
        <span class="chip chip-add"><button class="chip-main" data-act="new-block">${ICON.plus} 새 블럭</button></span>
      </div>
      ${oldPool.length ? `<button class="link-btn" data-act="toggle-old">${showOldPool ? "예전 블럭 접기" : `예전 블럭 ${oldPool.length}개 보기`}</button>` : ""}
    </section>

    <section class="section">
      <div class="section-head"><h2>메모</h2></div>
      <textarea class="memo" id="monthMemo" placeholder="이번 달 특이사항 (예: 헬스장 1달 휴식)">${esc(m.memo)}</textarea>
    </section>`;

  // 직전 값으로 그려 둔 링과 숫자를 새 값으로 옮긴다
  const ring = $(".ring-val");
  ring.getBoundingClientRect();
  ring.style.strokeDasharray = `${pct} 100`;
  countUp($(".hero-val"), from.remaining, s.remaining);
  shown = { ym: m.ym, remaining: s.remaining, pct };
  lastToggled = null;
  stagger = false;
}

const monthActions = {
  async toggle(id) {
    const item = month.items.find((i) => i.block_id === id);
    lastToggled = id;
    await applyMonth(api("PUT", `/months/${month.ym}/items/${id}`, { paid: !item.paid }));
  },

  async include(id) {
    lastToggled = id;
    await applyMonth(api("PUT", `/months/${month.ym}/items/${id}`, {}));
  },

  async hide(id) {
    await api("PATCH", `/blocks/${id}`, { hidden: true });
    await applyMonth(api("GET", `/months/${month.ym}`));
    toast("예전 블럭으로 옮겼어요", "", () =>
      month ? monthActions.unhide(id) : api("PATCH", `/blocks/${id}`, { hidden: false }));
  },

  async unhide(id) {
    await api("PATCH", `/blocks/${id}`, { hidden: false });
    lastToggled = id;
    await applyMonth(api("GET", `/months/${month.ym}`));
  },

  "toggle-old"() {
    showOldPool = !showOldPool;
    renderMonth();
  },

  filter(cat) {
    catFilter = cat || null;
    stagger = true;
    renderMonth();
  },

  fold() {
    paidFolded = !paidFolded;
    try { localStorage.setItem(FOLD_KEY, paidFolded ? "1" : "0"); } catch {}
    stagger = !paidFolded;
    renderMonth();
  },

  "edit-item"(id) {
    const item = month.items.find((i) => i.block_id === id);
    openModal({
      title: esc(item.name),
      body: `
        <div class="row2">
          <label class="field"><span>이번 달 금액</span>
            <div class="input-unit"><input class="input num" name="amount" type="number" step="any" value="${item.amount}"></div></label>
          <label class="field"><span>상태</span>
            <select class="input" name="paid"><option value="0" ${item.paid ? "" : "selected"}>안 나감</option><option value="1" ${item.paid ? "selected" : ""}>나감</option></select></label>
        </div>
        <label class="field"><span>이번 달 메모</span><input class="input" name="memo" value="${esc(item.memo)}" placeholder="예: 이월, 첫달 패스"></label>
        <div class="divider">블럭 설정 · 모든 달에 적용</div>
        <label class="field"><span>이름</span><input class="input" name="name" value="${esc(item.name)}"></label>
        <div class="field"><span>분류</span>${catSeg("category", item.category)}</div>`,
      actions: `
        <button class="btn btn-danger" value="remove" formnovalidate>이번 달에서 빼기</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">저장</button>`,
      async onSubmit(d, action) {
        if (action === "remove") {
          const ym = month.ym;
          await applyMonth(api("DELETE", `/months/${ym}/items/${id}`));
          return toast(`'${item.name}' 블럭을 이번 달에서 뺐어요`, "", async () => {
            const back = api("PUT", `/months/${ym}/items/${id}`, { amount: item.amount, memo: item.memo, paid: item.paid });
            if (month?.ym !== ym) return back.then(refreshNav);   // 그 사이 다른 화면으로 옮겼으면 화면은 그대로
            lastToggled = id;
            await applyMonth(back);
          });
        }
        const name = d.name.trim();
        if (name !== item.name || d.category !== item.category) {
          await api("PATCH", `/blocks/${id}`, { name, category: d.category });
        }
        await applyMonth(api("PUT", `/months/${month.ym}/items/${id}`, {
          amount: num(d.amount), memo: d.memo.trim(), paid: d.paid === "1",
        }));
      },
    });
  },

  "edit-income"() {
    openModal({
      title: `${ymLabel(month.ym)} 수입`,
      body: `
        <label class="field"><span>월급</span>
          <div class="input-unit"><input class="input num" name="salary" type="number" step="any" value="${month.salary}"></div></label>
        <div class="row2">
          <label class="field"><span>기타 수입</span>
            <div class="input-unit"><input class="input num" name="extra_income" type="number" step="any" value="${month.extra_income}"></div></label>
          <label class="field"><span>기타 수입 메모</span><input class="input" name="extra_memo" value="${esc(month.extra_memo)}" placeholder="예: 소급분, 이월금"></label>
        </div>`,
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">저장</button>`,
      async onSubmit(d) {
        await applyMonth(api("PATCH", `/months/${month.ym}`, {
          salary: num(d.salary), extra_income: num(d.extra_income), extra_memo: d.extra_memo.trim(),
        }));
      },
    });
  },

  "new-block"() {
    openModal({
      title: "새 블럭",
      desc: "블럭 풀에 추가되고, 이번 달 고정지출에도 바로 들어가요.",
      body: `
        <div class="row2">
          <label class="field"><span>이름</span><input class="input" name="name" placeholder="예: 여행자금"></label>
          <label class="field"><span>금액</span>
            <div class="input-unit"><input class="input num" name="amount" type="number" step="any" placeholder="0"></div></label>
        </div>
        <div class="field"><span>분류</span>${catSeg("category", "기타")}</div>`,
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">추가</button>`,
      async onSubmit(d) {
        const block = await api("POST", "/blocks", { name: d.name, category: d.category });
        lastToggled = block.id;
        await applyMonth(api("PUT", `/months/${month.ym}/items/${block.id}`, { amount: num(d.amount) }));
      },
    });
  },

  "delete-month"() {
    openModal({
      title: `${ymLabel(month.ym)}을 삭제할까요?`,
      desc: "이 달의 수입, 블럭 체크, 금액, 메모가 모두 지워져요. 블럭 풀의 블럭은 남아요.",
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="delete" style="background:var(--neg)">삭제</button>`,
      async onSubmit() {
        await api("DELETE", `/months/${month.ym}`);
        toast(`${ymLabel(month.ym)}을 삭제했어요`);
        await refreshNav();
        location.hash = "#/";
      },
    });
  },
};

// ------------------------------------------------------------ new month view

let draft = null;   // { ym, source, exists, salary, blocks: [{key, id, name, category, hidden, checked, amount, isNew}] }
let showOldDraft = false;
let newSeq = 0;

async function loadDraft({ ym, source } = {}, keepNew = []) {
  const q = new URLSearchParams();
  if (ym) q.set("ym", ym);
  if (source) q.set("source", source);
  const d = await api("GET", "/draft?" + q);
  d.blocks = d.blocks.map((b) => ({ ...b, key: "b" + b.id, isNew: false })).concat(keepNew);
  d.extra_income = 0;
  d.extra_memo = "";
  d.memo = "";
  draft = d;
  renderNew();
}

function draftStats() {
  const on = draft.blocks.filter((b) => b.checked);
  const total = on.reduce((a, b) => a + num(b.amount), 0);
  const income = num(draft.salary) + num(draft.extra_income);
  return { count: on.length, total, free: income - total };
}

function pickCard(b) {
  return `
    <div class="pick ${catClass(b.category)} ${b.checked ? "on" : ""}" data-act="pick" data-key="${b.key}" role="checkbox"
         aria-checked="${b.checked}" tabindex="0">
      <span class="box">${ICON.check}</span>
      <span class="b-body">
        <span class="b-name">${esc(b.name)}</span>
        ${b.isNew ? '<span class="new-tag">새 블럭</span>' : b.hidden ? '<span class="old-tag">예전 블럭</span>' : ""}
      </span>
      <span class="amt-wrap"><input class="amt-input" data-key="${b.key}" type="number" step="any" value="${b.amount}" aria-label="${esc(b.name)} 금액"></span>
    </div>`;
}

function renderNew() {
  const d = draft;
  const visible = d.blocks.filter((b) => showOldDraft || !b.hidden || b.checked);
  const oldCount = d.blocks.filter((b) => b.hidden && !b.checked).length;
  const monthOpts = [...months].reverse()
    .map((m) => `<option value="${m.ym}" ${m.ym === d.source ? "selected" : ""}>${ymLabel(m.ym)}</option>`).join("");

  const sections = CATS.map((cat) => {
    const list = visible.filter((b) => b.category === cat);
    if (!list.length) return "";
    return `
      <section class="section">
        <div class="section-head">
          <h2><span class="cat-dot ${catClass(cat)}"></span>${cat}</h2>
          <span class="hint" data-cat-stat="${cat}"></span>
        </div>
        <div class="grid">${list.map(pickCard).join("")}</div>
      </section>`;
  }).join("");

  main.innerHTML = `
    <header class="page-head"><h1>새 달 만들기</h1></header>

    <section class="card setup">
      <div class="setup-row">
        <label class="field"><span>만들 달</span><input class="input" type="month" id="nYm" value="${d.ym}"></label>
        <label class="field"><span>기준 달 <small>이 달 블럭이 체크돼요</small></span>
          <select class="input" id="nSrc">${monthOpts || '<option value="">없음</option>'}</select></label>
        <label class="field"><span>월급</span>
          <div class="input-unit"><input class="input num" type="number" step="any" id="nSalary" value="${d.salary}"></div></label>
        <label class="field"><span>기타 수입</span>
          <div class="input-unit"><input class="input num" type="number" step="any" id="nExtra" value="${d.extra_income}"></div></label>
        <label class="field grow"><span>기타 수입 메모</span><input class="input" id="nExtraMemo" value="${esc(d.extra_memo)}" placeholder="예: 소급분"></label>
      </div>
      ${d.exists ? `<div class="warn">${ymLabel(d.ym)}은 이미 있어요. 다른 달을 고르세요.</div>` : ""}
    </section>

    ${sections || '<div class="section"><div class="empty">블럭이 아직 없어요. 새 블럭을 추가하세요.</div></div>'}

    <section class="section">
      <div class="grid">
        <button class="pick pick-add" data-act="draft-new-block">${ICON.plus} 새 블럭 추가</button>
      </div>
      ${oldCount ? `<button class="link-btn" data-act="draft-toggle-old">${showOldDraft ? "예전 블럭 접기" : `예전 블럭 ${oldCount}개 보기`}</button>` : ""}
    </section>

    <section class="section">
      <div class="section-head"><h2>메모</h2></div>
      <textarea class="memo" id="nMemo" placeholder="이번 달 특이사항">${esc(d.memo)}</textarea>
    </section>

    <div class="sticky-bar">
      <div class="sb-stats" id="sbStats"></div>
      <a class="btn btn-ghost" href="#/">취소</a>
      <button class="btn btn-primary" data-act="create" ${d.exists ? "disabled" : ""}>${ymLabel(d.ym)} 만들기</button>
    </div>`;
  updateDraftStats();
}

function updateDraftStats() {
  const st = draftStats();
  $("#sbStats").innerHTML = `
    <span class="sb-stat"><span>포함 블럭</span><b>${st.count}<small>개</small></b></span>
    <span class="sb-stat"><span>고정지출</span><b>${fmt(st.total)}<small>만원</small></b></span>
    <span class="sb-stat"><span>예상 여유금</span><b class="${st.free < 0 ? "neg" : "pos"}">${fmt(st.free)}<small>만원</small></b></span>`;
  CATS.forEach((cat) => {
    const el = $(`[data-cat-stat="${cat}"]`);
    if (!el) return;
    const on = draft.blocks.filter((b) => b.category === cat && b.checked);
    el.textContent = on.length ? `${on.length}개 · ${fmt(on.reduce((a, b) => a + num(b.amount), 0))}만원` : "선택 없음";
  });
}

const newActions = {
  pick(key, el) {
    const b = draft.blocks.find((x) => x.key === key);
    b.checked = !b.checked;
    el.classList.toggle("on", b.checked);
    el.setAttribute("aria-checked", b.checked);
    updateDraftStats();
  },

  "draft-toggle-old"() {
    showOldDraft = !showOldDraft;
    renderNew();
  },

  "draft-new-block"() {
    openModal({
      title: "새 블럭",
      desc: "이 달을 만들 때 블럭 풀에도 추가돼요.",
      body: `
        <div class="row2">
          <label class="field"><span>이름</span><input class="input" name="name" placeholder="예: 여행자금"></label>
          <label class="field"><span>금액</span>
            <div class="input-unit"><input class="input num" name="amount" type="number" step="any" placeholder="0"></div></label>
        </div>
        <div class="field"><span>분류</span>${catSeg("category", "기타")}</div>`,
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">추가</button>`,
      async onSubmit(d) {
        const name = d.name.trim();
        if (!name) throw new Error("블럭 이름을 입력하세요");
        const same = draft.blocks.find((b) => b.name === name);
        if (same) {
          same.checked = true;
          same.amount = num(d.amount) || same.amount;
          if (same.hidden) showOldDraft = true;
          toast(`'${name}' 블럭이 이미 있어서 체크했어요`);
        } else {
          draft.blocks.push({ key: "n" + ++newSeq, id: null, name, category: d.category, hidden: false, checked: true, amount: num(d.amount), isNew: true });
        }
        renderNew();
      },
    });
  },

  async create() {
    const d = draft;
    const items = d.blocks.filter((b) => b.checked).map((b) =>
      b.id ? { block_id: b.id, amount: num(b.amount) } : { name: b.name, category: b.category, amount: num(b.amount) });
    try {
      await api("POST", "/months", {
        ym: d.ym, salary: num(d.salary), extra_income: num(d.extra_income),
        extra_memo: d.extra_memo.trim(), memo: d.memo.trim(), items,
      });
    } catch (err) {
      return toast(err.message, "err");
    }
    toast(`${ymLabel(d.ym)}을 만들었어요`);
    await refreshNav();
    location.hash = "#/m/" + d.ym;
  },
};

// ------------------------------------------------------------ events

main.addEventListener("click", async (e) => {
  if (e.target.closest("input, textarea, select")) return;
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const handler = monthActions[act] || newActions[act] || dashActions[act] || blockActions[act];
  if (!handler) return;
  e.preventDefault();
  const id = el.dataset.id ? Number(el.dataset.id) : el.dataset.key;
  try {
    await handler(id, el);
  } catch (err) {
    toast(err.message, "err");
  }
});

main.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".block, .pick, .blk-row")) {
    e.preventDefault();
    e.target.click();
  }
});

// 월 화면에서 ← → 로 이전/다음 달 (입력 중이거나 창이 떠 있을 때는 제외)
document.addEventListener("keydown", (e) => {
  if (!month || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || $("#modal").open) return;
  if (e.target.closest("input, textarea, select")) return;
  const to = e.key === "ArrowLeft" ? month.prev : e.key === "ArrowRight" ? month.next : null;
  if (to) location.hash = "#/m/" + to;
});

main.addEventListener("input", (e) => {
  const t = e.target;
  if (blocksInput(t)) return;
  if (!draft || !location.hash.startsWith("#/new")) return;
  if (t.matches(".amt-input")) {
    draft.blocks.find((b) => b.key === t.dataset.key).amount = t.value;
  } else if (t.id === "nSalary") draft.salary = t.value;
  else if (t.id === "nExtra") draft.extra_income = t.value;
  else if (t.id === "nExtraMemo") draft.extra_memo = t.value;
  else if (t.id === "nMemo") draft.memo = t.value;
  else return;
  updateDraftStats();
});

main.addEventListener("change", async (e) => {
  const t = e.target;
  if (dashChange(t)) return;
  try {
    if (t.id === "monthMemo" && month) {
      month = await api("PATCH", `/months/${month.ym}`, { memo: t.value });
      toast("메모를 저장했어요");
    } else if (t.id === "nYm" && t.value) {
      await loadDraft({ ym: t.value }, draft.blocks.filter((b) => b.isNew));
    } else if (t.id === "nSrc") {
      await loadDraft({ ym: draft.ym, source: t.value }, draft.blocks.filter((b) => b.isNew));
    }
  } catch (err) {
    toast(err.message, "err");
  }
});

// ------------------------------------------------------------ router

async function route() {
  const hash = location.hash;
  renderNav();
  hideTip();
  if (hash === "#/blocks") {
    month = null;
    draft = null;
    return renderBlocks();
  }
  if (hash === "#/dashboard") {
    month = null;
    draft = null;
    return renderDashboard();
  }
  if (hash.startsWith("#/new")) {
    month = null;
    showOldDraft = false;
    return loadDraft();
  }
  const m = hash.match(/^#\/m\/(\d{4}-\d{2})$/);
  if (m) {
    draft = null;
    if (month?.ym !== m[1]) showOldPool = false;
    return loadMonth(m[1]);
  }
  const now = thisYm();
  const target = months.some((x) => x.ym === now) ? now : months.at(-1)?.ym;
  location.replace(target ? "#/m/" + target : "#/new");
}

window.addEventListener("hashchange", route);

(async () => {
  main.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    await Promise.all([refreshNav(), loadCategories()]);
  } catch (err) {
    main.innerHTML = `<div class="loading">서버에 연결할 수 없어요: ${esc(err.message)}</div>`;
    return;
  }
  route();
})();
