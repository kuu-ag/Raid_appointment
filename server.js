import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

dotenv.config();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ME";

const db = new Database("data.sqlite");
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS access_codes (
    date TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    raid TEXT NOT NULL,
    viewer_grade TEXT NOT NULL,
    chzzk_nickname TEXT NOT NULL,
    adventure_name TEXT NOT NULL,
    dealer_count INTEGER NOT NULL,
    buffer_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_unique_apply
    ON applications(date, raid, chzzk_nickname);

  CREATE INDEX IF NOT EXISTS ix_app_date_raid
    ON applications(date, raid);
`);

// --- Migration: confirmed 컬럼 추가(기존 DB에도 자동 적용) ---
function ensureConfirmedColumn() {
  const cols = db.prepare(`PRAGMA table_info(applications)`).all();
  const hasConfirmed = cols.some((c) => c.name === "confirmed");
  if (!hasConfirmed) {
    db.exec(`ALTER TABLE applications ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;`);
  }
}
ensureConfirmedColumn();

const RAID_OPTIONS = [
  { key: "diregie", label: "디레지에" },
  { key: "twilight", label: "이내황혼전" },
  { key: "nabel", label: "인공신: 나벨" },
  { key: "mist", label: "안개신" }
];

const GRADE_OPTIONS = [
  { key: "FIRE", label: "불타는 치즈" },
  { key: "PINK", label: "분홍색 치즈" },
  { key: "YELLOW", label: "노란색 치즈" },
  { key: "NORMAL", label: "일반 등급" }
];

const GRADE_PRIORITY = {
  FIRE: 1,
  PINK: 2,
  YELLOW: 3,
  NORMAL: 4
};

function todayKST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function layout(body) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>데본베일 레이드 예약</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f6f6f6; margin:0; }
    .wrap { max-width: 980px; margin: 24px auto; padding: 0 14px; }
    .title { text-align:center; font-weight:900; font-size:22px; background:#fff; border:2px solid #000; padding:16px; }
    .box { background:#fff; border:2px solid #000; padding:16px; margin-top:16px; }
    .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn { border:2px solid #000; padding:8px 14px; background:#fff; cursor:pointer; font-weight:800; }
    .btnDanger { border-color:#b00020; color:#b00020; }
    input, select { padding:8px; border:2px solid #000; background:#fff; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th,td { border:1px solid #ccc; padding:6px; font-size:13px; vertical-align: middle; }
    th { background:#eee; }
    .hint { color:#666; font-size:12px; margin-top:8px; line-height:1.4; }
    a { color: inherit; }
    .center { text-align:center; }
    .chip { display:inline-block; padding:2px 8px; border:1px solid #aaa; font-size:12px; background:#fff; }
    .ok { font-weight:900; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">데본베일 레이드 예약 사이트</div>
    ${body}
  </div>

  <script>
    function submitOnChange(formId) {
      const f = document.getElementById(formId);
      if (f) f.submit();
    }
  </script>
</body>
</html>`;
}

function requireViewer(req, res, next) {
  if (req.cookies.viewer === todayKST()) return next();
  return res.redirect("/auth");
}

function requireAdmin(req, res, next) {
  if (req.cookies.admin === "1") return next();
  return res.redirect("/admin");
}

/* =========================
   Viewer (시청자)
========================= */

app.get("/", (req, res) => {
  res.send(layout(`
    <div class="box">
      <a class="btn" href="/auth">시작</a>
    </div>
  `));
});

app.get("/auth", (req, res) => {
  res.send(layout(`
    <div class="box">
      <form method="POST" action="/auth">
        <div class="row">
          <div>인증키</div>
          <input name="code" autocomplete="off" required />
          <button class="btn" type="submit">확인</button>
        </div>
      </form>
      <div class="hint">시청자가 인증에 필요한 인증키 등록</div>
    </div>
  `));
});

app.post("/auth", (req, res) => {
  const row = db.prepare("SELECT code_hash FROM access_codes WHERE date=?").get(todayKST());
  const code = String(req.body.code || "");
  if (!row || !bcrypt.compareSync(code, row.code_hash)) {
    return res.redirect("/auth");
  }
  res.cookie("viewer", todayKST(), { httpOnly: true, sameSite: "lax" });
  return res.redirect("/raid");
});

app.get("/raid", requireViewer, (req, res) => {
  res.send(layout(`
    <div class="box">
      <div class="row">
        ${RAID_OPTIONS.map(r => `
          <form method="POST" action="/raid" style="display:inline;">
            <input type="hidden" name="raid" value="${esc(r.key)}"/>
            <button class="btn" type="submit">${esc(r.label)}</button>
          </form>
        `).join("")}
      </div>
      <div class="hint">&lt;4개중 하나를 선택해서 다음으로 진행&gt;</div>
    </div>
  `));
});

app.post("/raid", requireViewer, (req, res) => {
  const raid = String(req.body.raid || "");
  if (!RAID_OPTIONS.some(r => r.key === raid)) return res.redirect("/raid");
  res.cookie("raid", raid, { httpOnly: true, sameSite: "lax" });
  return res.redirect("/reserve");
});

app.get("/reserve", requireViewer, (req, res) => {
  const raid = req.cookies.raid;
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/raid");

  // ✅ confirmed 포함해서 가져오기
  const apps = db.prepare(`
    SELECT viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, confirmed
    FROM applications
    WHERE date=? AND raid=?
    ORDER BY id DESC
  `).all(todayKST(), raid);

  res.send(layout(`
    <div class="box">
      <div class="hint">
        선택 레이드: <b>${esc(raidObj.label)}</b> / 시청자가 등록한 내용을 볼 수 있음.<br/>
        - ✅ 등록완료: 스트리머가 신청을 확인한 상태<br/>
        - ⏳ 대기중: 아직 확인 전
      </div>
      <table>
        <tr>
          <th class="center">상태</th>
          <th>시청자 등급</th><th>치지직 닉</th><th>모험단</th><th>딜러</th><th>버퍼</th>
        </tr>
        ${apps.length ? apps.map(a => {
          const status = a.confirmed === 1
            ? `<span class="ok">✅ 등록완료</span>`
            : `⏳ 대기중`;
          return `
            <tr>
              <td class="center">${status}</td>
              <td>${esc(GRADE_OPTIONS.find(g=>g.key===a.viewer_grade)?.label || a.viewer_grade)}</td>
              <td>${esc(a.chzzk_nickname)}</td>
              <td>${esc(a.adventure_name)}</td>
              <td>${esc(a.dealer_count)}</td>
              <td>${esc(a.buffer_count)}</td>
            </tr>
          `;
        }).join("") : `<tr><td colspan="6" style="text-align:center;color:#666;">아직 신청이 없습니다.</td></tr>`}
      </table>
    </div>

    <div class="box">
      <form method="POST" action="/reserve">
        <div class="row">
          <div style="min-width:110px;">시청자 등급</div>
          <select name="viewer_grade" required>
            ${GRADE_OPTIONS.map(g=>`<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("")}
          </select>
        </div>

        <div class="row" style="margin-top:10px;">
          <div style="min-width:110px;">치지직 닉네임</div>
          <input name="chzzk_nickname" required maxlength="32" />
        </div>

        <div class="row" style="margin-top:10px;">
          <div style="min-width:110px;">모험단 이름</div>
          <input name="adventure_name" required maxlength="32" />
        </div>

        <div class="row" style="margin-top:10px;">
          <div style="min-width:110px;">딜러 갯수</div>
          <input name="dealer_count" required inputmode="numeric" pattern="[0-9]+" />
        </div>

        <div class="row" style="margin-top:10px;">
          <div style="min-width:110px;">버퍼 갯수</div>
          <input name="buffer_count" required inputmode="numeric" pattern="[0-9]+" />
        </div>

        <div class="row" style="margin-top:12px;">
          <button class="btn" type="submit">등록</button>
          <a class="btn" href="/raid">레이드 다시 선택</a>
        </div>
      </form>

      <div class="hint">※ 회차/배정 결과는 표시되지 않습니다. 배치는 스트리머가 수기로 진행합니다.</div>
    </div>
  `));
});

app.post("/reserve", requireViewer, (req, res) => {
  const raid = req.cookies.raid;
  if (!RAID_OPTIONS.some(r => r.key === raid)) return res.redirect("/raid");

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk = String(req.body.chzzk_nickname || "").trim();
  const adv = String(req.body.adventure_name || "").trim();
  const dealer = Number(req.body.dealer_count);
  const buffer = Number(req.body.buffer_count);

  if (!GRADE_OPTIONS.some(g => g.key === viewer_grade)) return res.redirect("/reserve");
  if (!chzzk || !adv) return res.redirect("/reserve");
  if (!Number.isInteger(dealer) || dealer < 0) return res.redirect("/reserve");
  if (!Number.isInteger(buffer) || buffer < 0) return res.redirect("/reserve");

  try {
    db.prepare(`
      INSERT INTO applications
      (date, raid, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, created_at, confirmed)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `).run(todayKST(), raid, viewer_grade, chzzk, adv, dealer, buffer);
  } catch {}

  return res.redirect("/reserve");
});

/* =========================
   Admin (스트리머)
========================= */

app.get("/admin", (req, res) => {
  res.send(layout(`
    <div class="box">
      <form method="POST" action="/admin">
        <div class="row">
          <div>관리자 키</div>
          <input name="key" autocomplete="off" required />
          <button class="btn" type="submit">입장</button>
        </div>
      </form>
      <div class="hint">※ 로그인 대신 관리자 키로 보호됩니다.</div>
    </div>
  `));
});

app.post("/admin", (req, res) => {
  if (req.body.key === ADMIN_KEY) {
    res.cookie("admin", "1", { httpOnly: true, sameSite: "lax" });
    return res.redirect("/admin/code");
  }
  return res.redirect("/admin");
});

app.get("/admin/code", requireAdmin, (req, res) => {
  res.send(layout(`
    <div class="box">
      <form method="POST" action="/admin/code">
        <div class="row">
          <div>오늘 인증키</div>
          <input name="code" autocomplete="off" required />
          <button class="btn" type="submit">저장</button>
          <a class="btn" href="/admin/raid">예약 확인</a>
        </div>
      </form>
      <div class="hint">시청자가 인증에 필요한 인증키 등록</div>
    </div>
  `));
});

app.post("/admin/code", requireAdmin, (req, res) => {
  const hash = bcrypt.hashSync(String(req.body.code || ""), 10);
  db.prepare(`
    INSERT INTO access_codes(date, code_hash, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET code_hash=excluded.code_hash, updated_at=excluded.updated_at
  `).run(todayKST(), hash);

  return res.redirect("/admin/code");
});

app.get("/admin/raid", requireAdmin, (req, res) => {
  res.send(layout(`
    <div class="box">
      <div class="row">
        ${RAID_OPTIONS.map(r => `
          <form method="GET" action="/admin/list" style="display:inline;">
            <input type="hidden" name="raid" value="${esc(r.key)}"/>
            <button class="btn" type="submit">${esc(r.label)}</button>
          </form>
        `).join("")}
      </div>
      <div class="hint">관리할 레이드를 선택하세요.</div>
      <div style="margin-top:12px;">
        <a class="btn" href="/admin/code">← 인증키 화면</a>
      </div>
    </div>
  `));
});

app.get("/admin/list", requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/admin/raid");

  const sort = String(req.query.sort || "time"); // time | grade

  let apps = db.prepare(`
    SELECT id, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, confirmed
    FROM applications
    WHERE date=? AND raid=?
    ORDER BY id DESC
  `).all(todayKST(), raid);

  if (sort === "grade") {
    apps.sort((a, b) => {
      const pa = GRADE_PRIORITY[a.viewer_grade] ?? 999;
      const pb = GRADE_PRIORITY[b.viewer_grade] ?? 999;
      if (pa !== pb) return pa - pb;
      return b.id - a.id;
    });
  }

  const gradeHeaderLink =
    sort === "grade"
      ? `/admin/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `/admin/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  res.send(layout(`
    <div class="box">
      <div class="row" style="justify-content:space-between;">
        <div>
          <b>레이드:</b> ${esc(raidObj.label)} / <b>날짜:</b> ${esc(todayKST())}
          <span class="chip">등록완료: ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
        </div>
        <div class="row">
          <a class="btn" href="/admin/raid">레이드 변경</a>
        </div>
      </div>

      <table>
        <tr>
          <th class="center">등록완료</th>
          <th>
            <a href="${esc(gradeHeaderLink)}" style="text-decoration:underline;">
              시청자 등급 ${sort === "grade" ? "▼" : ""}
            </a>
          </th>
          <th>치지직 닉네임</th>
          <th>모험단 이름</th>
          <th>딜러</th>
          <th>버퍼</th>
          <th class="center">삭제</th>
        </tr>

        ${apps.length ? apps.map(a => {
          const formId = `confirmForm_${a.id}`;
          const checked = a.confirmed === 1 ? "checked" : "";
          return `
            <tr>
              <td class="center">
                <form id="${formId}" method="POST" action="/admin/confirm" style="margin:0;">
                  <input type="hidden" name="id" value="${esc(a.id)}"/>
                  <input type="hidden" name="raid" value="${esc(raid)}"/>
                  <input type="hidden" name="sort" value="${esc(sort)}"/>
                  <input type="hidden" name="confirmed" value="${a.confirmed === 1 ? "0" : "1"}"/>
                  <input type="checkbox" ${checked} onchange="submitOnChange('${formId}')"/>
                </form>
              </td>
              <td>${esc(GRADE_OPTIONS.find(g=>g.key===a.viewer_grade)?.label || a.viewer_grade)}</td>
              <td>${esc(a.chzzk_nickname)}</td>
              <td>${esc(a.adventure_name)}</td>
              <td>${esc(a.dealer_count)}</td>
              <td>${esc(a.buffer_count)}</td>
              <td class="center">
                <form method="POST" action="/admin/delete"
                      onsubmit="return confirm('정말 삭제하시겠습니까?');"
                      style="margin:0;">
                  <input type="hidden" name="id" value="${esc(a.id)}"/>
                  <input type="hidden" name="raid" value="${esc(raid)}"/>
                  <input type="hidden" name="sort" value="${esc(sort)}"/>
                  <button class="btn btnDanger" type="submit">삭제</button>
                </form>
              </td>
            </tr>
          `;
        }).join("") : `<tr><td colspan="7" style="text-align:center;color:#666;">오늘 신청이 없습니다.</td></tr>`}
      </table>

      <div class="hint">
        - 등록완료 체크는 “확인했음” 표시이며 시청자 화면에도 ✅ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
        - “시청자 등급” 클릭 시: 불타는 치즈 → 분홍색 치즈 → 노란색 치즈 → 일반 등급 정렬 (다시 클릭하면 시간순).<br/>
        - “삭제”는 관리자만 가능하며 확인 후 즉시 제거됩니다.
      </div>
    </div>
  `));
});

// ✅ 등록완료 토글 (시청자 화면 상태 표시와 연동됨)
app.post("/admin/confirm", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
  }

  if (RAID_OPTIONS.some(r => r.key === raid)) {
    return res.redirect(`/admin/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
  }
  return res.redirect("/admin/raid");
});

// ✅ 삭제 유지
app.post("/admin/delete", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
  }

  if (RAID_OPTIONS.some(r => r.key === raid)) {
    return res.redirect(`/admin/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
  }
  return res.redirect("/admin/raid");
});

app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
