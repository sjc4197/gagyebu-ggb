"use strict";
/* 여유금 사용: 월 화면의 여유금 칸을 누르면 열리는 패널.
   주차별(1~7일 / 8~14일 / 15~21일 / 22일~말일) 사용 내역과 이월금 입력. app.js의 유틸을 쓴다. */

const FREE_KEY = "ggb.freeOpen";
let freeOpen = false;
try { freeOpen = localStorage.getItem(FREE_KEY) === "1"; } catch {}

/** 이번 달이면 오늘이 속한 주차(1~4), 아니면 0 */
function currentWeek(ym) {
  if (ym !== thisYm()) return 0;
  return Math.min(4, Math.floor((new Date().getDate() - 1) / 7) + 1);
}

/** 히어로의 여유금 칸 아래 한 줄 */
function freeStatSub(s) {
  if (!s.carryover && !s.spent) return "수입 − 고정지출 · 눌러서 사용 내역";
  const parts = [`여유 ${fmt(s.free)}`];
  if (s.carryover) parts.push(`+ 이월 ${fmt(s.carryover)}`);
  if (s.spent) parts.push(`− 사용 ${fmt(s.spent)}`);
  return parts.join(" ");
}

function freeStat(s) {
  const used = s.carryover || s.spent;
  return `
    <button class="stat stat-btn free-stat ${freeOpen ? "open" : ""}" data-act="free-toggle" aria-expanded="${freeOpen}" aria-controls="freePanel" title="여유금 사용 내역 ${freeOpen ? "접기" : "보기"}">
      <span class="stat-label">${used ? "남은 여유금" : "여유금"} ${ICON.down}</span>
      <span class="stat-num ${s.left < 0 ? "neg" : "pos"}">${fmt(s.left)}<small>만원</small></span>
      <span class="stat-sub">${freeStatSub(s)}</span>
    </button>`;
}

function freePanel(m) {
  const s = m.summary;
  const now = currentWeek(m.ym);
  const ratio = s.available > 0 ? Math.min(1, s.spent / s.available) : s.spent > 0 ? 1 : 0;
  const weeks = m.week_labels.map((label, i) => {
    const w = i + 1;
    const list = m.spends.filter((x) => x.week === w);
    return `
      <div class="fw ${w === now ? "now" : ""}">
        <div class="fw-head">
          <span class="fw-title">${w}주 <small>${label}</small></span>
          ${w === now ? '<em class="fw-now">이번 주</em>' : ""}
          <b class="fw-sum ${list.length ? "" : "empty"}">${list.length ? fmt(s.spent_by_week[i]) : "–"}</b>
        </div>
        ${list.length ? `<ul class="fw-list">${list.map((x) => `
          <li><button class="fw-item" data-act="free-edit" data-id="${x.id}" title="수정 / 삭제">
            <b>${fmt(x.amount)}</b><span>${x.memo ? esc(x.memo) : '<i class="muted">사유 없음</i>'}</span>${ICON.pencil}
          </button></li>`).join("")}</ul>` : ""}
        <form class="fw-add" data-week="${w}" autocomplete="off">
          <div class="input-unit sm"><input class="input num" name="amount" type="number" step="any" min="0" placeholder="0" aria-label="${w}주 사용 금액"></div>
          <input class="input" name="memo" placeholder="사유" maxlength="40" aria-label="${w}주 사유">
          <button class="icon-btn sm fw-plus" type="submit" title="추가">${ICON.plus}</button>
        </form>
      </div>`;
  }).join("");

  return `
    <section class="card free-panel" id="freePanel">
      <div class="fp-head">
        <div class="fp-left">
          <div class="fp-label">남은 여유금</div>
          <div class="fp-num ${s.left < 0 ? "neg" : ""}">${fmt(s.left)}<small>만원</small></div>
          <div class="meter ${ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : ""}" role="img" aria-label="쓸 수 있는 돈 중 ${Math.round(ratio * 100)}% 사용">
            <i style="width:${ratio * 100}%"></i>
          </div>
          <div class="fp-formula">
            <span>여유금 <b>${fmt(s.free)}</b></span>
            <span class="op">+</span><span>이월금 <b>${fmt(s.carryover)}</b></span>
            <span class="op">−</span><span>사용 <b>${fmt(s.spent)}</b></span>
            <span class="op">=</span><span>남은 <b>${fmt(s.left)}</b></span>
          </div>
        </div>
        <label class="field fp-carry">
          <span>이월금 <small>지난달에서 넘어온 돈, 직접 입력</small></span>
          <div class="input-unit"><input class="input num" id="carryover" type="number" step="any" value="${m.carryover}"></div>
        </label>
      </div>
      <div class="fw-grid">${weeks}</div>
    </section>`;
}

const freeActions = {
  "free-toggle"() {
    freeOpen = !freeOpen;
    try { localStorage.setItem(FREE_KEY, freeOpen ? "1" : "0"); } catch {}
    renderMonth();
    if (freeOpen) $("#freePanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },

  "free-edit"(id) {
    const x = month.spends.find((s) => s.id === id);
    openModal({
      title: "여유금 사용 내역",
      body: `
        <div class="row2">
          <label class="field"><span>금액</span>
            <div class="input-unit"><input class="input num" name="amount" type="number" step="any" value="${x.amount}"></div></label>
          <label class="field"><span>주차</span>
            <select class="input" name="week">${month.week_labels.map((l, i) => `<option value="${i + 1}" ${x.week === i + 1 ? "selected" : ""}>${i + 1}주 (${l})</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>사유</span><input class="input" name="memo" maxlength="40" value="${esc(x.memo)}" placeholder="예: 회식, 옷"></label>`,
      actions: `
        <button class="btn btn-danger" value="delete" formnovalidate>삭제</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">저장</button>`,
      async onSubmit(d, action) {
        if (action === "delete") {
          await applyMonth(api("DELETE", `/spend/${id}`));
          return toast("사용 내역을 지웠어요");
        }
        const amount = num(d.amount);
        if (!(amount > 0)) throw new Error("금액은 0보다 커야 해요");
        await applyMonth(api("PATCH", `/spend/${id}`, { amount, week: Number(d.week), memo: d.memo.trim() }));
      },
    });
  },
};

/** 주차 칸의 인라인 추가 폼 제출 */
async function freeSubmit(form) {
  const week = Number(form.dataset.week);
  const amount = num(form.amount.value);
  if (!(amount > 0)) {
    toast("금액을 입력하세요", "err");
    form.amount.focus();
    return;
  }
  await applyMonth(api("POST", `/months/${month.ym}/spend`, { week, amount, memo: form.memo.value.trim() }));
  $(`.fw-add[data-week="${week}"] input[name=amount]`)?.focus();
}

/** 이월금 입력 저장. 처리했으면 true */
async function freeChange(t) {
  if (t.id !== "carryover" || !month) return false;
  await applyMonth(api("PATCH", `/months/${month.ym}`, { carryover: num(t.value) }));
  toast("이월금을 저장했어요");
  return true;
}

main.addEventListener("submit", async (e) => {
  const form = e.target.closest(".fw-add");
  if (!form) return;
  e.preventDefault();
  try {
    await freeSubmit(form);
  } catch (err) {
    toast(err.message, "err");
  }
});
