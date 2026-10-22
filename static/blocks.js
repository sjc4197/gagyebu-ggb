"use strict";
/* 블럭 관리: 전체 블럭 목록, 이름/분류/숨김 수정, 순서 변경, 합치기, 삭제. app.js의 유틸을 쓴다. */

let blockList = [];
let blockMonths = [];               // 기록이 있는 모든 달 (작은 막대 차트 x축)
let blockFilter = { q: "", view: "all" };

const BLOCK_VIEWS = [["all", "전체"], ["active", "보이는 블럭"], ["hidden", "숨긴 블럭"]];

async function renderBlocks() {
  if (!blockList.length) main.innerHTML = '<div class="loading">불러오는 중…</div>';
  try {
    setBlockList(await api("GET", "/blocks"));
  } catch (err) {
    main.innerHTML = `<div class="loading">블럭을 불러올 수 없어요: ${esc(err.message)}</div>`;
    return;
  }
  drawBlocksPage();
}

function setBlockList(list) {
  blockList = list;
  blockMonths = [...new Set(list.flatMap((b) => b.history.map((h) => h.ym)))].sort();
}

function drawBlocksPage() {
  const hiddenCount = blockList.filter((b) => b.hidden).length;
  main.innerHTML = `
    <header class="page-head">
      <div>
        <h1>블럭 관리</h1>
        <p class="page-sub">블럭 ${blockList.length}개 · 숨김 ${hiddenCount}개 · 여기서 바꾼 이름과 분류는 모든 달에 적용돼요</p>
      </div>
      <div class="head-actions">
        ${CATS.length < MAX_CATS ? `<button class="btn btn-ghost" data-act="blk-cat-new">${ICON.plus} 새 분류</button>` : ""}
        <button class="btn btn-primary" data-act="blk-new">${ICON.plus} 새 블럭</button>
      </div>
    </header>
    <div class="filter-row">
      <div class="tabs" role="group" aria-label="보기">
        ${BLOCK_VIEWS.map(([k, l]) => `<button class="tab ${blockFilter.view === k ? "on" : ""}" data-act="blk-view" data-key="${k}" aria-pressed="${blockFilter.view === k}">${l}</button>`).join("")}
      </div>
      <input class="input blk-search" id="blkSearch" type="search" placeholder="블럭 이름 검색" value="${esc(blockFilter.q)}">
    </div>
    <div id="blkList"></div>`;
  drawBlockList();
}

function drawBlockList() {
  const q = blockFilter.q.trim().toLowerCase();
  const visible = blockList.filter((b) =>
    (blockFilter.view === "all" || (blockFilter.view === "hidden") === b.hidden)
    && (!q || b.name.toLowerCase().includes(q)));
  const showEmpty = !q && blockFilter.view === "all";
  const html = CAT_LIST.map((c) => {
    const cat = c.name;
    const all = blockList.filter((b) => b.category === cat);
    const list = visible.filter((b) => b.category === cat);
    if (!list.length && !(showEmpty && !c.builtin)) return "";
    return `
      <section class="section">
        <div class="section-head">
          <h2><span class="cat-dot ${catClass(cat)}"></span>${esc(cat)}</h2>
          <span class="hint">${list.length}개${c.builtin ? "" : " · 직접 만든 분류"}</span>
          ${c.builtin ? "" : `
            <span class="right cat-actions">
              <button class="link-btn" data-act="blk-cat-rename" data-id="${c.id}">이름 변경</button>
              <button class="link-btn danger" data-act="blk-cat-delete" data-id="${c.id}">분류 삭제</button>
            </span>`}
        </div>
        ${list.length
          ? `<div class="card blk-table">${list.map((b) => blockRow(b, all)).join("")}</div>`
          : '<div class="empty">이 분류에 블럭이 없어요. 블럭 수정에서 분류를 바꾸거나 새 블럭을 만들어 넣으세요.</div>'}
      </section>`;
  }).join("");
  $("#blkList").innerHTML = html || '<div class="section"><div class="empty">조건에 맞는 블럭이 없어요</div></div>';
}

function blockRow(b, sameCat) {
  const h = b.history;
  const last = h.at(-1);
  const idx = sameCat.indexOf(b);
  const reorder = !blockFilter.q && blockFilter.view === "all";   // 걸러 보는 중엔 순서 변경 숨김
  return `
    <div class="blk-row ${catClass(b.category)} ${b.hidden ? "is-hidden" : ""}" data-act="blk-edit" data-id="${b.id}" role="button" tabindex="0">
      <div class="blk-name">
        <span class="chip-dot"></span>
        <span class="blk-title">${esc(b.name)}</span>
        ${b.hidden ? '<span class="old-tag">숨김</span>' : ""}
      </div>
      <div class="blk-last">
        ${last ? `<b>${fmt(last.amount)}</b><span>${ymLabel(last.ym)}</span>` : '<span class="muted">기록 없음</span>'}
      </div>
      <div class="blk-usage">${h.length ? `${h.length}개월 사용<span>${shortYm(h[0].ym)} ~ ${shortYm(last.ym)}</span>` : '<span class="muted">아직 안 씀</span>'}</div>
      <div class="blk-spark">${sparkBars(b)}</div>
      <div class="blk-actions">
        ${reorder ? `
          <button class="icon-btn sm" ${idx === 0 ? "disabled" : ""} data-act="blk-up" data-id="${b.id}" title="위로">${ICON.up}</button>
          <button class="icon-btn sm" ${idx === sameCat.length - 1 ? "disabled" : ""} data-act="blk-down" data-id="${b.id}" title="아래로">${ICON.down}</button>` : ""}
        <button class="icon-btn sm" data-act="${b.hidden ? "blk-unhide" : "blk-hide"}" data-id="${b.id}" title="${b.hidden ? "다시 보이기" : "숨기기"}">${b.hidden ? ICON.undo : ICON.eyeOff}</button>
      </div>
    </div>`;
}

const shortYm = (ym) => `${ym.slice(2, 4)}.${ym.slice(5)}`;

/** 전체 기간에서 이 블럭의 달별 금액을 작은 막대로. 빈 달은 점. */
function sparkBars(b) {
  if (!blockMonths.length) return "";
  const amounts = new Map(b.history.map((h) => [h.ym, h.amount]));
  const max = Math.max(...b.history.map((h) => h.amount), 0) || 1;
  const n = blockMonths.length, W = 132, H = 26, gap = 2;
  const w = Math.max(2, (W - gap * (n - 1)) / n);
  const bars = blockMonths.map((ym, i) => {
    const x = i * (w + gap);
    const v = amounts.get(ym);
    if (v == null) return `<rect x="${x}" y="${H - 2}" width="${w}" height="2" rx="1" class="sp-empty"/>`;
    const bh = Math.max(3, (v / max) * H);
    return `<rect x="${x}" y="${H - bh}" width="${w}" height="${bh}" rx="${Math.min(2, w / 2)}" fill="var(--c)"><title>${ymLabel(ym)} ${fmt(v)}</title></rect>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${bars}</svg>`;
}

// ------------------------------------------------------------ modals

function blockEditModal(b) {
  const others = blockList.filter((x) => x.id !== b.id)
    .sort((x, y) => (x.category === b.category ? 0 : 1) - (y.category === b.category ? 0 : 1));
  const history = b.history.length
    ? `<div class="hist">${[...b.history].reverse().map((h) => `<span><small>${shortYm(h.ym)}</small><b>${fmt(h.amount)}</b></span>`).join("")}</div>`
    : '<p class="muted small">아직 어느 달에도 쓰지 않았어요.</p>';
  openModal({
    title: esc(b.name),
    desc: b.history.length ? `${b.history.length}개월 사용 · 최근 ${ymLabel(b.history.at(-1).ym)} ${fmt(b.history.at(-1).amount)}만원` : "",
    body: `
      <label class="field"><span>이름</span><input class="input" name="name" value="${esc(b.name)}"></label>
      <div class="field"><span>분류</span>${catSeg("category", b.category)}</div>
      <label class="check-field"><input type="checkbox" name="hidden" ${b.hidden ? "checked" : ""}><span>블럭 풀에서 숨기기 <small>(예전 블럭으로 보관, 기록은 유지)</small></span></label>
      <div class="field"><span>금액 기록 <small>최근 달부터</small></span>${history}</div>
      <div class="divider">다른 블럭으로 합치기</div>
      <div class="merge-row">
        <select class="input" name="merge_into">
          <option value="">합칠 블럭 선택</option>
          ${others.map((o) => `<option value="${o.id}">${esc(o.name)} · ${o.category}${o.hidden ? " (숨김)" : ""}</option>`).join("")}
        </select>
        <button class="btn btn-ghost" value="merge" formnovalidate>합치기</button>
      </div>
      <p class="muted small">이 블럭의 모든 달 기록이 선택한 블럭으로 옮겨지고, 이 블럭은 없어져요. 예: A 모임 회비 → B 모임 회비</p>`,
    actions: `
      ${b.history.length ? "" : '<button class="btn btn-danger" value="delete" formnovalidate>삭제</button>'}
      <span class="spacer"></span>
      <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
      <button class="btn btn-primary" value="save">저장</button>`,
    async onSubmit(d, action) {
      if (action === "delete") {
        setBlockList(await api("DELETE", `/blocks/${b.id}`));
        drawBlocksPage();
        return toast(`'${b.name}' 블럭을 삭제했어요`);
      }
      if (action === "merge") {
        const into = blockList.find((x) => x.id === Number(d.merge_into));
        if (!into) throw new Error("합칠 블럭을 고르세요");
        mergeConfirm(b, into);
        return false;   // 확인 모달로 바뀌었으니 닫지 않음
      }
      const name = d.name.trim();
      if (!name) throw new Error("블럭 이름을 입력하세요");
      await api("PATCH", `/blocks/${b.id}`, { name, category: d.category, hidden: d.hidden === "on" });
      await reloadBlocks();
      toast("저장했어요");
    },
  });
}

function mergeConfirm(from, into) {
  const overlap = from.history.filter((h) => into.history.some((x) => x.ym === h.ym)).length;
  openModal({
    title: "블럭을 합칠까요?",
    desc: `'${esc(from.name)}'의 ${from.history.length}개월 기록을 '${esc(into.name)}'(으)로 옮기고, '${esc(from.name)}' 블럭은 없어져요.`
      + (overlap ? ` 같은 달에 둘 다 있는 ${overlap}개월은 금액을 더해요.` : "")
      + " 되돌릴 수 없어요.",
    actions: `
      <span class="spacer"></span>
      <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
      <button class="btn btn-primary" value="merge" style="background:var(--neg)">합치기</button>`,
    async onSubmit() {
      setBlockList(await api("POST", `/blocks/${from.id}/merge`, { into: into.id }));
      drawBlocksPage();
      refreshNav();
      toast(`'${from.name}' 블럭을 '${into.name}' 블럭에 합쳤어요`);
    },
  });
}

async function reloadBlocks() {
  const [list] = await Promise.all([api("GET", "/blocks"), loadCategories()]);
  setBlockList(list);
  drawBlocksPage();
}

function categoryNameModal({ title, desc, value = "", submit, onSave }) {
  openModal({
    title,
    desc,
    body: `<label class="field"><span>분류 이름</span><input class="input" name="name" maxlength="12" value="${esc(value)}" placeholder="예: 건강"></label>`,
    actions: `
      <span class="spacer"></span>
      <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
      <button class="btn btn-primary" value="save">${submit}</button>`,
    async onSubmit(d) {
      const name = d.name.trim();
      if (!name) throw new Error("분류 이름을 입력하세요");
      await onSave(name);
      await reloadBlocks();
    },
  });
}

const blockActions = {
  "blk-cat-new"() {
    categoryNameModal({
      title: "새 분류",
      desc: `분류는 ${MAX_CATS}개까지 만들 수 있어요 (지금 ${CATS.length}개). 색은 자동으로 정해져요.`,
      submit: "만들기",
      onSave: (name) => api("POST", "/categories", { name }).then(() => toast(`'${name}' 분류를 만들었어요`)),
    });
  },
  "blk-cat-rename"(id) {
    const c = CAT_LIST.find((x) => x.id === id);
    categoryNameModal({
      title: "분류 이름 변경",
      desc: "이 분류에 속한 블럭에도 바로 적용돼요.",
      value: c.name,
      submit: "저장",
      onSave: (name) => api("PATCH", `/categories/${id}`, { name }),
    });
  },
  "blk-cat-delete"(id) {
    const c = CAT_LIST.find((x) => x.id === id);
    if (c.blocks) return toast(`블럭 ${c.blocks}개가 '${c.name}' 분류에 있어요. 다른 분류로 옮긴 뒤 지우세요`, "err");
    openModal({
      title: `'${esc(c.name)}' 분류를 삭제할까요?`,
      desc: "비어 있는 분류라 지워도 기록에는 영향이 없어요.",
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="delete" style="background:var(--neg)">삭제</button>`,
      async onSubmit() {
        await api("DELETE", `/categories/${id}`);
        await reloadBlocks();
        toast("분류를 삭제했어요");
      },
    });
  },
  "blk-view"(key) {
    blockFilter.view = key;
    drawBlocksPage();
  },
  "blk-edit"(id) {
    blockEditModal(blockList.find((b) => b.id === id));
  },
  async "blk-up"(id) {
    setBlockList(await api("POST", `/blocks/${id}/move`, { direction: -1 }));
    drawBlockList();
  },
  async "blk-down"(id) {
    setBlockList(await api("POST", `/blocks/${id}/move`, { direction: 1 }));
    drawBlockList();
  },
  async "blk-hide"(id) {
    await api("PATCH", `/blocks/${id}`, { hidden: true });
    await reloadBlocks();
  },
  async "blk-unhide"(id) {
    await api("PATCH", `/blocks/${id}`, { hidden: false });
    await reloadBlocks();
  },
  "blk-new"() {
    openModal({
      title: "새 블럭",
      desc: "블럭 풀에 추가돼요. 어느 달에 넣을지는 월 화면이나 새 달 만들기에서 고르면 돼요.",
      body: `
        <label class="field"><span>이름</span><input class="input" name="name" placeholder="예: 헬스장"></label>
        <div class="field"><span>분류</span>${catSeg("category", "기타")}</div>`,
      actions: `
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">추가</button>`,
      async onSubmit(d) {
        await api("POST", "/blocks", { name: d.name, category: d.category });
        await reloadBlocks();
        toast("블럭을 추가했어요");
      },
    });
  },
};

function blocksInput(t) {
  if (t.id !== "blkSearch") return false;
  blockFilter.q = t.value;
  drawBlockList();
  return true;
}
