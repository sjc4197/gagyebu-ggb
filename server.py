"""가계부 로컬 웹앱 서버. 실행: python server.py"""

import os
import re
import socket
import sqlite3
import sys
import threading
import webbrowser
from contextlib import asynccontextmanager, contextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

if getattr(sys, "frozen", False):
    # PyInstaller 실행 파일: 데이터는 exe 옆에, 정적 파일은 번들 안에
    BASE_DIR = Path(sys.executable).resolve().parent
    STATIC_DIR = Path(sys._MEIPASS) / "static"
else:
    BASE_DIR = Path(__file__).resolve().parent
    STATIC_DIR = BASE_DIR / "static"
DB_PATH = Path(os.environ.get("GGB_DB", BASE_DIR / "data" / "ggb.db"))
HOST, PORT = "127.0.0.1", int(os.environ.get("GGB_PORT", 8765))

# 기본 분류 (이름 변경/삭제 불가). 사용자가 추가한 분류는 categories 테이블에 뒤로 붙는다.
DEFAULT_CATEGORIES = ["생활", "구독·회비", "저축·투자", "카드", "기타"]
MAX_CATEGORIES = 8   # 차트 색 팔레트(색약 검증 통과)가 8색까지
YM_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    builtin    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    category   TEXT    NOT NULL DEFAULT '기타',
    sort_order INTEGER NOT NULL DEFAULT 0,
    hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS months (
    ym           TEXT PRIMARY KEY,
    salary       REAL NOT NULL DEFAULT 0,
    extra_income REAL NOT NULL DEFAULT 0,
    extra_memo   TEXT NOT NULL DEFAULT '',
    memo         TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS month_items (
    ym       TEXT    NOT NULL REFERENCES months(ym) ON DELETE CASCADE,
    block_id INTEGER NOT NULL REFERENCES blocks(id),
    amount   REAL    NOT NULL,
    paid     INTEGER NOT NULL DEFAULT 0,
    memo     TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (ym, block_id)
);
"""


# ---------------------------------------------------------------- DB helpers

def init_db(path: Path | None = None) -> None:
    path = path or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        if not conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]:
            conn.executemany(
                "INSERT INTO categories (name, sort_order, builtin) VALUES (?, ?, 1)",
                [(name, i) for i, name in enumerate(DEFAULT_CATEGORIES, 1)],
            )


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def r2(x: float) -> float:
    return round(x or 0, 2)


def check_ym(ym: str) -> str:
    if not YM_RE.match(ym):
        raise HTTPException(400, f"잘못된 월 형식: {ym}")
    return ym


def next_ym(ym: str) -> str:
    y, m = map(int, ym.split("-"))
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}"


def categories_of(conn) -> list[str]:
    return [r["name"] for r in conn.execute("SELECT name FROM categories ORDER BY sort_order, id")]


def category_list(conn) -> list[dict]:
    """분류 목록. 색 번호: 기본 분류는 1~5 고정, 추가 분류는 순서대로 6, 7, 8."""
    counts = dict(conn.execute("SELECT category, COUNT(*) FROM blocks GROUP BY category").fetchall())
    out, extra = [], 0
    for r in conn.execute("SELECT * FROM categories ORDER BY sort_order, id"):
        if r["builtin"]:
            color = DEFAULT_CATEGORIES.index(r["name"]) + 1 if r["name"] in DEFAULT_CATEGORIES else 5
        else:
            extra += 1
            color = len(DEFAULT_CATEGORIES) + extra
        out.append({"id": r["id"], "name": r["name"], "builtin": bool(r["builtin"]),
                    "color": min(color, MAX_CATEGORIES), "blocks": counts.get(r["name"], 0)})
    return out


def check_category(conn, name: str) -> str:
    if name not in categories_of(conn):
        raise HTTPException(400, f"알 수 없는 분류: {name}")
    return name


def block_sorter(conn):
    order = {c: i for i, c in enumerate(categories_of(conn))}
    return lambda b: (order.get(b["category"], len(order)), b["sort_order"],
                      b["id"] if "id" in b.keys() else b["block_id"])


def all_blocks(conn) -> list[sqlite3.Row]:
    return sorted(conn.execute("SELECT * FROM blocks").fetchall(), key=block_sorter(conn))


def last_amount(conn, block_id: int, ym: str) -> float:
    """해당 월 이전(없으면 이후) 가장 가까운 달에 쓴 금액."""
    row = conn.execute(
        "SELECT amount FROM month_items WHERE block_id = ? ORDER BY (ym <= ?) DESC, ym DESC LIMIT 1",
        (block_id, ym),
    ).fetchone()
    return row["amount"] if row else 0


def get_month_row(conn, ym: str):
    row = conn.execute("SELECT * FROM months WHERE ym = ?", (check_ym(ym),)).fetchone()
    if not row:
        raise HTTPException(404, f"{ym} 달이 없습니다")
    return row


def get_block_row(conn, block_id: int):
    row = conn.execute("SELECT * FROM blocks WHERE id = ?", (block_id,)).fetchone()
    if not row:
        raise HTTPException(404, "블럭이 없습니다")
    return row


def insert_block(conn, name: str, category: str) -> int:
    name = name.strip()
    if not name:
        raise HTTPException(400, "블럭 이름을 입력하세요")
    check_category(conn, category)
    order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM blocks").fetchone()[0]
    try:
        cur = conn.execute(
            "INSERT INTO blocks (name, category, sort_order) VALUES (?, ?, ?)", (name, category, order)
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"'{name}' 블럭이 이미 있습니다")
    return cur.lastrowid


def summarize(month, items: list[dict], cats: list[str]) -> dict:
    income = month["salary"] + month["extra_income"]
    total = sum(i["amount"] for i in items)
    remaining_items = [i for i in items if not i["paid"]]
    remaining = sum(i["amount"] for i in remaining_items)
    by_cat = []
    for cat in cats:
        cat_total = sum(i["amount"] for i in items if i["category"] == cat)
        if cat_total:
            by_cat.append({"category": cat, "total": r2(cat_total)})
    return {
        "income": r2(income),
        "total": r2(total),
        "paid": r2(total - remaining),
        "remaining": r2(remaining),
        "remaining_count": len(remaining_items),
        "count": len(items),
        "free": r2(income - total),
        "by_category": by_cat,
    }


def month_detail(conn, ym: str) -> dict:
    month = get_month_row(conn, ym)
    rows = conn.execute(
        """SELECT mi.block_id, b.name, b.category, b.sort_order, mi.amount, mi.paid, mi.memo
           FROM month_items mi JOIN blocks b ON b.id = mi.block_id WHERE mi.ym = ?""",
        (ym,),
    ).fetchall()
    items = [
        {"block_id": r["block_id"], "name": r["name"], "category": r["category"],
         "amount": r["amount"], "paid": bool(r["paid"]), "memo": r["memo"]}
        for r in sorted(rows, key=block_sorter(conn))
    ]
    included = {i["block_id"] for i in items}
    pool = [
        {"id": b["id"], "name": b["name"], "category": b["category"], "hidden": bool(b["hidden"]),
         "last_amount": last_amount(conn, b["id"], ym)}
        for b in all_blocks(conn) if b["id"] not in included
    ]
    prev = conn.execute("SELECT MAX(ym) FROM months WHERE ym < ?", (ym,)).fetchone()[0]
    nxt = conn.execute("SELECT MIN(ym) FROM months WHERE ym > ?", (ym,)).fetchone()[0]
    return {
        "ym": ym,
        "salary": month["salary"],
        "extra_income": month["extra_income"],
        "extra_memo": month["extra_memo"],
        "memo": month["memo"],
        "items": items,
        "pool": pool,
        "summary": summarize(month, items, categories_of(conn)),
        "prev": prev,
        "next": nxt,
    }


# ---------------------------------------------------------------- API models

class MonthPatch(BaseModel):
    salary: float | None = None
    extra_income: float | None = None
    extra_memo: str | None = None
    memo: str | None = None


class ItemPatch(BaseModel):
    amount: float | None = None
    paid: bool | None = None
    memo: str | None = None


class NewBlock(BaseModel):
    name: str
    category: str = "기타"


class BlockPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    hidden: bool | None = None


class CategoryBody(BaseModel):
    name: str


class BlockMove(BaseModel):
    direction: int  # -1 위로, +1 아래로


class BlockMerge(BaseModel):
    into: int


class NewItem(BaseModel):
    block_id: int | None = None
    name: str | None = None      # block_id가 없으면 새 블럭 생성
    category: str = "기타"
    amount: float
    memo: str = ""


class NewMonth(BaseModel):
    ym: str
    salary: float = 0
    extra_income: float = 0
    extra_memo: str = ""
    memo: str = ""
    items: list[NewItem] = []


# ---------------------------------------------------------------- app

@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="가계부", lifespan=lifespan)


@app.middleware("http")
async def revalidate_static(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/categories")
def list_categories():
    with db() as conn:
        return category_list(conn)


@app.post("/api/categories")
def create_category(body: CategoryBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "분류 이름을 입력하세요")
    with db() as conn:
        if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] >= MAX_CATEGORIES:
            raise HTTPException(409, f"분류는 {MAX_CATEGORIES}개까지 만들 수 있어요 (차트 색 구분 한계)")
        order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories").fetchone()[0]
        try:
            conn.execute("INSERT INTO categories (name, sort_order) VALUES (?, ?)", (name, order))
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"'{name}' 분류가 이미 있어요")
        return category_list(conn)


def get_custom_category(conn, cat_id: int):
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (cat_id,)).fetchone()
    if not row:
        raise HTTPException(404, "분류가 없어요")
    if row["builtin"]:
        raise HTTPException(400, "기본 분류는 바꾸거나 지울 수 없어요")
    return row


@app.patch("/api/categories/{cat_id}")
def rename_category(cat_id: int, body: CategoryBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "분류 이름을 입력하세요")
    with db() as conn:
        row = get_custom_category(conn, cat_id)
        try:
            conn.execute("UPDATE categories SET name = ? WHERE id = ?", (name, cat_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"'{name}' 분류가 이미 있어요")
        conn.execute("UPDATE blocks SET category = ? WHERE category = ?", (name, row["name"]))
        return category_list(conn)


@app.delete("/api/categories/{cat_id}")
def delete_category(cat_id: int):
    with db() as conn:
        row = get_custom_category(conn, cat_id)
        used = conn.execute("SELECT COUNT(*) FROM blocks WHERE category = ?", (row["name"],)).fetchone()[0]
        if used:
            raise HTTPException(409, f"블럭 {used}개가 이 분류에 있어요. 다른 분류로 옮긴 뒤 지우세요")
        conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        return category_list(conn)


@app.get("/api/months")
def list_months():
    with db() as conn:
        rows = conn.execute(
            """SELECT m.ym, m.salary + m.extra_income AS income,
                      COALESCE(SUM(mi.amount), 0) AS total,
                      COALESCE(SUM(CASE WHEN mi.paid = 0 THEN mi.amount END), 0) AS remaining,
                      COUNT(mi.block_id) AS count,
                      COALESCE(SUM(CASE WHEN mi.paid = 0 THEN 1 END), 0) AS remaining_count
               FROM months m LEFT JOIN month_items mi ON mi.ym = m.ym
               GROUP BY m.ym ORDER BY m.ym"""
        ).fetchall()
    return [
        {"ym": r["ym"], "income": r2(r["income"]), "total": r2(r["total"]),
         "remaining": r2(r["remaining"]), "count": r["count"], "remaining_count": r["remaining_count"]}
        for r in rows
    ]


@app.get("/api/stats")
def stats():
    """대시보드용: 이번 달까지(미리 만들어 둔 미래 달 제외)의 월별 수입과 블럭별 금액."""
    until = date.today().strftime("%Y-%m")
    with db() as conn:
        months = conn.execute("SELECT * FROM months WHERE ym <= ? ORDER BY ym", (until,)).fetchall()
        rows = conn.execute(
            """SELECT mi.ym, mi.block_id, mi.amount FROM month_items mi
               JOIN months m ON m.ym = mi.ym WHERE m.ym <= ?""",
            (until,),
        ).fetchall()
        blocks = all_blocks(conn)
        cats = categories_of(conn)
    items_by_month: dict[str, dict[int, float]] = {}
    for r in rows:
        items_by_month.setdefault(r["ym"], {})[r["block_id"]] = r["amount"]
    return {
        "until": until,
        "categories": cats,
        "blocks": [{"id": b["id"], "name": b["name"], "category": b["category"]} for b in blocks],
        "months": [
            {"ym": m["ym"], "salary": m["salary"], "extra_income": m["extra_income"],
             "extra_memo": m["extra_memo"], "items": items_by_month.get(m["ym"], {})}
            for m in months
        ],
    }


@app.get("/api/months/{ym}")
def get_month(ym: str):
    with db() as conn:
        return month_detail(conn, ym)


@app.patch("/api/months/{ym}")
def patch_month(ym: str, body: MonthPatch):
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    with db() as conn:
        get_month_row(conn, ym)
        for k, v in fields.items():
            conn.execute(f"UPDATE months SET {k} = ? WHERE ym = ?", (v, ym))
        return month_detail(conn, ym)


@app.delete("/api/months/{ym}", status_code=204)
def delete_month(ym: str):
    with db() as conn:
        get_month_row(conn, ym)
        conn.execute("DELETE FROM months WHERE ym = ?", (ym,))


@app.put("/api/months/{ym}/items/{block_id}")
def put_item(ym: str, block_id: int, body: ItemPatch):
    """블럭을 이번 달에 포함(없으면 추가)하거나 금액/나감/메모를 수정."""
    with db() as conn:
        get_month_row(conn, ym)
        get_block_row(conn, block_id)
        exists = conn.execute(
            "SELECT 1 FROM month_items WHERE ym = ? AND block_id = ?", (ym, block_id)
        ).fetchone()
        if not exists:
            amount = body.amount if body.amount is not None else last_amount(conn, block_id, ym)
            conn.execute(
                "INSERT INTO month_items (ym, block_id, amount, paid, memo) VALUES (?, ?, ?, ?, ?)",
                (ym, block_id, amount, int(bool(body.paid)), body.memo or ""),
            )
            conn.execute("UPDATE blocks SET hidden = 0 WHERE id = ?", (block_id,))
        else:
            for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
                conn.execute(
                    f"UPDATE month_items SET {k} = ? WHERE ym = ? AND block_id = ?",
                    (int(v) if k == "paid" else v, ym, block_id),
                )
        return month_detail(conn, ym)


@app.delete("/api/months/{ym}/items/{block_id}")
def delete_item(ym: str, block_id: int):
    """블럭을 이번 달에서 뺌 (블럭 풀에는 남음)."""
    with db() as conn:
        get_month_row(conn, ym)
        conn.execute("DELETE FROM month_items WHERE ym = ? AND block_id = ?", (ym, block_id))
        return month_detail(conn, ym)


@app.get("/api/blocks")
def list_blocks():
    """블럭 관리용: 전체 블럭 + 달별 금액 기록."""
    with db() as conn:
        history: dict[int, list[dict]] = {}
        for r in conn.execute("SELECT block_id, ym, amount FROM month_items ORDER BY ym"):
            history.setdefault(r["block_id"], []).append({"ym": r["ym"], "amount": r["amount"]})
        return [
            {"id": b["id"], "name": b["name"], "category": b["category"], "hidden": bool(b["hidden"]),
             "history": history.get(b["id"], [])}
            for b in all_blocks(conn)
        ]


@app.post("/api/blocks/{block_id}/move")
def move_block(block_id: int, body: BlockMove):
    """같은 분류 안에서 순서를 한 칸 위(-1)/아래(+1)로."""
    with db() as conn:
        block = get_block_row(conn, block_id)
        same = [b for b in all_blocks(conn) if b["category"] == block["category"]]
        i = next(k for k, b in enumerate(same) if b["id"] == block_id)
        j = i + (1 if body.direction > 0 else -1)
        if 0 <= j < len(same):
            same[i], same[j] = same[j], same[i]
            # 분류 안의 순서를 1..n으로 다시 매겨 동률이 생기지 않게 한다
            base = min(b["sort_order"] for b in same)
            for k, b in enumerate(same):
                conn.execute("UPDATE blocks SET sort_order = ? WHERE id = ?", (base + k, b["id"]))
            # 다른 분류와 sort_order가 겹쳐도 정렬은 분류 우선이라 문제없음
    return list_blocks()


@app.delete("/api/blocks/{block_id}")
def delete_block(block_id: int):
    """한 번도 쓰지 않은 블럭만 삭제. 쓴 적 있으면 숨김을 쓴다."""
    with db() as conn:
        get_block_row(conn, block_id)
        used = conn.execute("SELECT COUNT(*) FROM month_items WHERE block_id = ?", (block_id,)).fetchone()[0]
        if used:
            raise HTTPException(409, f"{used}개월에 쓴 기록이 있어 삭제할 수 없어요. 숨기기를 쓰세요")
        conn.execute("DELETE FROM blocks WHERE id = ?", (block_id,))
    return list_blocks()


@app.post("/api/blocks/{block_id}/merge")
def merge_block(block_id: int, body: BlockMerge):
    """block_id의 모든 기록을 into 블럭으로 옮기고 block_id를 지운다.
    같은 달에 둘 다 있으면 금액을 더하고, 둘 다 나갔을 때만 '나감'으로 둔다."""
    if body.into == block_id:
        raise HTTPException(400, "같은 블럭으로는 합칠 수 없어요")
    with db() as conn:
        get_block_row(conn, block_id)
        get_block_row(conn, body.into)
        rows = conn.execute("SELECT * FROM month_items WHERE block_id = ?", (block_id,)).fetchall()
        for r in rows:
            target = conn.execute(
                "SELECT * FROM month_items WHERE ym = ? AND block_id = ?", (r["ym"], body.into)
            ).fetchone()
            if target:
                memo = " / ".join(m for m in (target["memo"], r["memo"]) if m)
                conn.execute(
                    "UPDATE month_items SET amount = ?, paid = ?, memo = ? WHERE ym = ? AND block_id = ?",
                    (target["amount"] + r["amount"], int(target["paid"] and r["paid"]), memo, r["ym"], body.into),
                )
            else:
                conn.execute(
                    "INSERT INTO month_items (ym, block_id, amount, paid, memo) VALUES (?, ?, ?, ?, ?)",
                    (r["ym"], body.into, r["amount"], r["paid"], r["memo"]),
                )
        conn.execute("DELETE FROM month_items WHERE block_id = ?", (block_id,))
        conn.execute("DELETE FROM blocks WHERE id = ?", (block_id,))
    return list_blocks()


@app.post("/api/blocks")
def create_block(body: NewBlock):
    with db() as conn:
        block_id = insert_block(conn, body.name, body.category)
        return dict(get_block_row(conn, block_id))


@app.patch("/api/blocks/{block_id}")
def patch_block(block_id: int, body: BlockPatch):
    fields = body.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if not fields["name"]:
            raise HTTPException(400, "블럭 이름을 입력하세요")
    with db() as conn:
        get_block_row(conn, block_id)
        if "category" in fields:
            check_category(conn, fields["category"])
        for k, v in fields.items():
            try:
                conn.execute(f"UPDATE blocks SET {k} = ? WHERE id = ?", (int(v) if k == "hidden" else v, block_id))
            except sqlite3.IntegrityError:
                raise HTTPException(409, f"'{v}' 블럭이 이미 있습니다")
        return dict(get_block_row(conn, block_id))


@app.get("/api/draft")
def draft(ym: str | None = None, source: str | None = None):
    """새 달 만들기 초안: 전체 블럭 풀 + 기준 달에 있던 블럭은 체크된 상태."""
    with db() as conn:
        latest = conn.execute("SELECT MAX(ym) FROM months").fetchone()[0]
        if ym is None:
            ym = next_ym(latest) if latest else date.today().strftime("%Y-%m")
        check_ym(ym)
        if source is None:
            source = conn.execute("SELECT MAX(ym) FROM months WHERE ym < ?", (ym,)).fetchone()[0] or latest
        src_month = conn.execute("SELECT * FROM months WHERE ym = ?", (source,)).fetchone() if source else None
        src_items = {
            r["block_id"]: r["amount"]
            for r in conn.execute("SELECT block_id, amount FROM month_items WHERE ym = ?", (source,))
        } if src_month else {}
        exists = conn.execute("SELECT 1 FROM months WHERE ym = ?", (ym,)).fetchone() is not None
        blocks = [
            {"id": b["id"], "name": b["name"], "category": b["category"], "hidden": bool(b["hidden"]),
             "checked": b["id"] in src_items,
             "amount": src_items.get(b["id"], last_amount(conn, b["id"], ym))}
            for b in all_blocks(conn)
        ]
        return {
            "ym": ym,
            "source": source if src_month else None,
            "exists": exists,
            "salary": src_month["salary"] if src_month else 0,
            "blocks": blocks,
        }


@app.post("/api/months")
def create_month(body: NewMonth):
    check_ym(body.ym)
    with db() as conn:
        if conn.execute("SELECT 1 FROM months WHERE ym = ?", (body.ym,)).fetchone():
            raise HTTPException(409, f"{body.ym} 달이 이미 있습니다")
        conn.execute(
            "INSERT INTO months (ym, salary, extra_income, extra_memo, memo) VALUES (?, ?, ?, ?, ?)",
            (body.ym, body.salary, body.extra_income, body.extra_memo, body.memo),
        )
        seen = set()
        for item in body.items:
            if item.block_id is not None:
                block_id = get_block_row(conn, item.block_id)["id"]
            else:
                row = conn.execute("SELECT id FROM blocks WHERE name = ?", ((item.name or "").strip(),)).fetchone()
                block_id = row["id"] if row else insert_block(conn, item.name or "", item.category)
            if block_id in seen:
                continue
            seen.add(block_id)
            conn.execute(
                "INSERT INTO month_items (ym, block_id, amount, memo) VALUES (?, ?, ?, ?)",
                (body.ym, block_id, item.amount, item.memo),
            )
            conn.execute("UPDATE blocks SET hidden = 0 WHERE id = ?", (block_id,))
        return month_detail(conn, body.ym)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- main

def _port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((HOST, PORT)) == 0


if __name__ == "__main__":
    import uvicorn

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")   # 한글 출력 (exe, 리다이렉트 환경)
    url = f"http://{HOST}:{PORT}"
    if _port_in_use():
        print(f"이미 실행 중입니다 → {url}")
        webbrowser.open(url)
        sys.exit(0)
    if "--no-browser" not in sys.argv:
        threading.Timer(1.2, webbrowser.open, args=(url,)).start()
    print(f"가계부 실행 중 → {url}  (종료: Ctrl+C)")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
