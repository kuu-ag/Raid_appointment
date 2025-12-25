import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import Database from "better-sqlite3";

dotenv.config();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Render/Node 환경
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// ====== 설정(레이드/등급) ======
const RAID_OPTIONS = [
  { key: "deregie", label: "디레지에" },
  { key: "inaehyang", label: "이내향혼전" },
  { key: "ozma", label: "오즈마" },
  { key: "bakal", label: "바칼" },
  { key: "custom1", label: "레이드1" },
  { key: "custom2", label: "레이드2" },
];

const GRADE_OPTIONS = [
  { key: "burning", label: "불타는 치즈", order: 1 },
  { key: "pink", label: "분홍색 치즈", order: 2 },
  { key: "yellow", label: "노란색 치즈", order: 3 },
  { key: "normal", label: "일반 등급", order: 4 },
];

// ====== 유틸 ======
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function todayKST() {
  // KST(+09:00) 날짜(YYYY-MM-DD)
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const day = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function layout(innerHtml, title = "DEVON RAID") {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Apple SD Gothic Neo,Noto Sans KR,sans-serif;background:#0b1020;color:#eaf0ff;margin:0}
    a{color:inherit}
    .wrap{max-width:980px;margin:0 auto;padding:18px}
    .box{background:#121a33;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .sp{justify-content:space-between}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#1a2550;color:#eaf0ff;text-decoration:none;cursor:pointer}
    .btn:hover{filter:brightness(1.08)}
    .btnDanger{background:#3a1630;border-color:rgba(255,255,255,.14)}
    .btnGhost{background:transparent}
    input,select{background:#0e1530;border:1px solid rgba(255,255,255,.16);color:#eaf0ff;border-radius:12px;padding:10px 12px;outline:none}
    input::placeholder{color:rgba(234,240,255,.55)}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid rgba(255,255,255,.08);padding:10px 8px;text-align:left;font-size:14px}
    th{color:rgba(234,240,255,.85);font-weight:700}
    .center{text-align:center}
    .muted{color:rgba(234,240,255,.7)}
    .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);font-size:12px}
    .hint{margin-top:10px;color:rgba(234,240,255,.7);font-size:13px;line-height:1.5}
    .ok{color:#8dffb2}
    .wait{color:#ffd27a}
    .bad{color:#ff8aa0}
    .divider{height:1px;background:rgba(255,255,255,.08);margin:14px 0}
  </style>
  <script>
    function submitOnChange(formId){ document.getElementById(formId).submit(); }
  </script>
</head>
<body>
  <div class="wrap">
    <div class="row sp" style="margin-bottom:12px">
      <div class="row">
        <div style="font-weight:800;letter-spacing:.6px">DEVON RAID</div>
        <span class="chip">KST ${esc(todayKST())}</span>
      </div>
      <div class="row">
        <a class="btn btnGhost" href="/">시청자</a>
        <a class="btn btnGhost" href="/admin">스트리머</a>
      </div>
    </div>

    ${innerHtml}

    <div class="hint" style="margin-top:18px;opacity:.8">
      ※ 이 사이트는 신청 정보 입력 후, 스트리머(관리자)가 수기로 배치/확인합니다.
    </div>
  </div>
</body>
</html>`;
}

// ====== DB ======
const db = new Database("data.sqlite");

// 테이블 생성(없으면 자동 생성)
db.exec(`
  CREATE TABLE IF NOT EXISTS day_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_kst TEXT NOT NULL,
    raid_key TEXT NOT NULL,
    code TEXT NOT NULL,
    UNIQUE(date_kst, raid_key)
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_kst TEXT NOT NULL,
    raid_key TEXT NOT NULL,

    chzzk_nickname TEXT NOT NULL,
    viewer_grade TEXT NOT NULL,
    adventure_name TEXT NOT NULL,

    dealer_count INTEGER NOT NULL,
    buffer_count INTEGER NOT NULL,

    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_apps_date_raid ON applications(date_kst, raid_key);
`);

// ====== 관리자 인증 ======
function requireAdmin(req, res, next) {
  const key = req.cookies.admin_key || "";
  if (!ADMIN_KEY) {
    // 운영자가 환경변수 미설정한 경우
    return res.status(500).send(layout(`<div class="box">
      <div class="bad"><b>ADMIN_KEY</b>가 설정되지 않았습니다.</div>
      <div class="hint">Render Environment Variables에 ADMIN_KEY를 넣어주세요.</div>
    </div>`));
  }
  if (key !== ADMIN_KEY) {
    return res.redirect("/admin/login");
  }
  return next();
}

// ====== 시청자 플로우 ======
app.get("/", (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <h2 style="margin:0 0 8px 0;">레이드 예약</h2>
        <div class="muted">먼저 레이드를 선택하세요.</div>
        <div class="divider"></div>

        <form method="GET" action="/key" class="row">
          <select name="raid" required>
            <option value="">레이드 선택</option>
            ${RAID_OPTIONS.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
          </select>
          <button class="btn" type="submit">다음</button>
        </form>

        <div class="hint">
          - 신청자는: 치지직 닉네임 / 시청자 등급 / 모험단명 / 딜러 수 / 버퍼 수만 입력합니다.<br/>
          - 배치는 스트리머가 확인 후 수기로 진행합니다.
        </div>
      </div>
    `, "DEVON RAID")
  );
});

app.get("/key", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/");

  res.send(layout(`
    <div class="box">
      <h2 style="margin:0 0 8px 0;">인증키 입력</h2>
      <div class="muted"><b>${esc(raidObj.label)}</b> 신청을 위해 오늘의 인증키가 필요합니다.</div>
      <div class="divider"></div>

      <form method="POST" action="/key" class="row">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input name="code" placeholder="오늘의 인증키" required/>
        <button class="btn" type="submit">확인</button>
      </form>
    </div>
  `, "인증키"));
});

app.post("/key", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/");

  const row = db
    .prepare("SELECT code FROM day_codes WHERE date_kst=? AND raid_key=?")
    .get(todayKST(), raid);

  if (!row || String(row.code) !== code) {
    return res.send(layout(`
      <div class="box">
        <div class="bad"><b>인증키가 올바르지 않습니다.</b></div>
        <div class="hint">스트리머가 공지한 오늘의 인증키를 입력해주세요.</div>
        <div class="divider"></div>
        <a class="btn" href="/key?raid=${encodeURIComponent(raid)}">다시 입력</a>
      </div>
    `, "인증 실패"));
  }

  // 인증 통과: cookie 저장(오늘/해당 레이드에 대해서만)
  res.cookie(`viewer_ok_${raid}_${todayKST()}`, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
  });

  return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
});

function requireViewerOk(req, res, next) {
  const raid = String(req.query.raid || req.body.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/");
  const k = `viewer_ok_${raid}_${todayKST()}`;
  if (req.cookies[k] !== "1") {
    return res.redirect(`/key?raid=${encodeURIComponent(raid)}`);
  }
  return next();
}

app.get("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/");

  res.send(layout(`
    <div class="box">
      <div class="row sp">
        <div>
          <h2 style="margin:0;">예약 신청</h2>
          <div class="muted"><b>${esc(raidObj.label)}</b> / ${esc(todayKST())}</div>
        </div>
        <a class="btn btnGhost" href="/?">처음으로</a>
      </div>

      <div class="divider"></div>

      <form method="POST" action="/reserve">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <div class="row" style="margin-bottom:10px">
          <input name="chzzk_nickname" placeholder="치지직 닉네임" required style="min-width:220px"/>
          <select name="viewer_grade" required>
            <option value="">시청자 등급</option>
            ${GRADE_OPTIONS.map(g => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("")}
          </select>
        </div>

        <div class="row" style="margin-bottom:10px">
          <input name="adventure_name" placeholder="인게임 모험단명" required style="min-width:260px"/>
        </div>

        <div class="row" style="margin-bottom:12px">
          <input type="number" name="dealer_count" min="0" max="12" placeholder="딜러 수" required/>
          <input type="number" name="buffer_count" min="0" max="12" placeholder="버퍼 수" required/>
        </div>

        <button class="btn" type="submit">신청하기</button>
      </form>

      <div class="hint">
        - 신청 후에는 스트리머가 수기로 배치하며, 확인되면 “등록완료”로 표시됩니다.
      </div>
    </div>
  `, "예약 신청"));
});

app.post("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/");

  const chzzk = String(req.body.chzzk_nickname || "").trim();
  const grade = String(req.body.viewer_grade || "").trim();
  const adv = String(req.body.adventure_name || "").trim();
  const dealer = Number(req.body.dealer_count || 0);
  const buffer = Number(req.body.buffer_count || 0);

  if (!chzzk || !adv) return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  if (!GRADE_OPTIONS.some(g => g.key === grade)) return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  if (!Number.isFinite(dealer) || dealer < 0 || dealer > 12) return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  if (!Number.isFinite(buffer) || buffer < 0 || buffer > 12) return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);

  const info = db.prepare(`
    INSERT INTO applications
    (date_kst, raid_key, chzzk_nickname, viewer_grade, adventure_name, dealer_count, buffer_count, confirmed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(todayKST(), raid, chzzk, grade, adv, dealer, buffer, Date.now());

  // 시청자가 자기 상태를 쉽게 볼 수 있게 id 저장(쿠키)
  res.cookie(`viewer_last_id_${raid}_${todayKST()}`, String(info.lastInsertRowid), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
  });

  return res.redirect(`/done?raid=${encodeURIComponent(raid)}&id=${encodeURIComponent(info.lastInsertRowid)}`);
});

app.get("/done", (req, res) => {
  const raid = String(req.query.raid || "");
  const id = Number(req.query.id || 0);
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj || !Number.isInteger(id)) return res.redirect("/");

  const row = db.prepare("SELECT confirmed FROM applications WHERE id=?").get(id);
  const confirmed = row?.confirmed === 1;

  res.send(layout(`
    <div class="box">
      <h2 style="margin:0 0 6px 0;">신청 완료</h2>
      <div class="muted"><b>${esc(raidObj.label)}</b> / ${esc(todayKST())}</div>

      <div class="divider"></div>

      <div class="row">
        <span class="chip">${confirmed ? `✅ <span class="ok">등록완료</span>` : `⏳ <span class="wait">대기중</span>`}</span>
        <a class="btn" href="/status?raid=${encodeURIComponent(raid)}&id=${encodeURIComponent(id)}">내 신청 상태 보기</a>
        <a class="btn btnGhost" href="/">처음으로</a>
      </div>

      <div class="hint">
        - 등록완료는 스트리머가 확인 처리한 경우에만 표시됩니다.
      </div>
    </div>
  `, "완료"));
});

app.get("/status", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  const id = Number(req.query.id || 0);
  if (!raidObj || !Number.isInteger(id)) return res.redirect("/");

  const a = db.prepare(`
    SELECT * FROM applications WHERE id=? AND date_kst=? AND raid_key=?
  `).get(id, todayKST(), raid);

  if (!a) {
    return res.send(layout(`
      <div class="box">
        <div class="bad"><b>신청 정보를 찾을 수 없습니다.</b></div>
        <div class="hint">오늘(${esc(todayKST())}) / ${esc(raidObj.label)} 기준으로 확인됩니다.</div>
        <div class="divider"></div>
        <a class="btn" href="/">처음으로</a>
      </div>
    `, "상태"));
  }

  const gradeLabel = GRADE_OPTIONS.find(g => g.key === a.viewer_grade)?.label || a.viewer_grade;
  const confirmed = a.confirmed === 1;

  res.send(layout(`
    <div class="box">
      <h2 style="margin:0 0 6px 0;">내 신청 상태</h2>
      <div class="muted"><b>${esc(raidObj.label)}</b> / ${esc(todayKST())}</div>
      <div class="divider"></div>

      <div class="row" style="margin-bottom:10px">
        <span class="chip">${confirmed ? `✅ <span class="ok">등록완료</span>` : `⏳ <span class="wait">대기중</span>`}</span>
      </div>

      <table>
        <tr><th>치지직 닉네임</th><td>${esc(a.chzzk_nickname)}</td></tr>
        <tr><th>시청자 등급</th><td>${esc(gradeLabel)}</td></tr>
        <tr><th>모험단명</th><td>${esc(a.adventure_name)}</td></tr>
        <tr><th>딜러</th><td>${esc(a.dealer_count)}</td></tr>
        <tr><th>버퍼</th><td>${esc(a.buffer_count)}</td></tr>
      </table>

      <div class="divider"></div>
      <a class="btn" href="/">처음으로</a>
    </div>
  `, "상태"));
});

// ====== 관리자(스트리머) ======
app.get("/admin", (req, res) => {
  // 로그인 되어 있으면 레이드 선택으로
  const key = req.cookies.admin_key || "";
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect("/admin/raid");
  return res.redirect("/admin/login");
});

app.get("/admin/login", (req, res) => {
  res.send(layout(`
    <div class="box">
      <h2 style="margin:0 0 8px 0;">스트리머 인증</h2>
      <div class="muted">관리자 키(ADMIN_KEY)를 입력하세요.</div>
      <div class="divider"></div>
      <form method="POST" action="/admin/login" class="row">
        <input name="key" placeholder="관리자 키" required style="min-width:260px"/>
        <button class="btn" type="submit">입장</button>
      </form>
      <div class="hint">
        - 관리자 키는 Render 환경변수 <b>ADMIN_KEY</b>에 설정한 값입니다.
      </div>
    </div>
  `, "관리자 로그인"));
});

app.post("/admin/login", (req, res) => {
  const key = String(req.body.key || "");
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.send(layout(`
      <div class="box">
        <div class="bad"><b>키가 올바르지 않습니다.</b></div>
        <div class="divider"></div>
        <a class="btn" href="/admin/login">다시 시도</a>
      </div>
    `, "실패"));
  }

  res.cookie("admin_key", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return res.redirect("/admin/raid");
});

app.get("/admin/logout", (req, res) => {
  res.clearCookie("admin_key");
  res.redirect("/admin/login");
});

app.get("/admin/raid", requireAdmin, (req, res) => {
  res.send(layout(`
    <div class="box">
      <div class="row sp">
        <div>
          <h2 style="margin:0 0 6px 0;">레이드 선택(관리자)</h2>
          <div class="muted">선택한 레이드의 오늘 신청만 표시됩니다.</div>
        </div>
        <a class="btn btnGhost" href="/admin/logout">로그아웃</a>
      </div>

      <div class="divider"></div>

      <form method="GET" action="/admin/list" class="row">
        <select name="raid" required>
          <option value="">레이드 선택</option>
          ${RAID_OPTIONS.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
        </select>
        <input type="hidden" name="sort" value="time"/>
        <button class="btn" type="submit">확인</button>
      </form>

      <div class="divider"></div>

      <h3 style="margin:0 0 8px 0;">오늘 인증키 설정</h3>
      <div class="muted">시청자가 신청하려면 레이드별 “오늘 인증키”가 필요합니다.</div>
      <div class="divider"></div>

      <form method="POST" action="/admin/code" class="row">
        <select name="raid" required>
          <option value="">레이드 선택</option>
          ${RAID_OPTIONS.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
        </select>
        <input name="code" placeholder="오늘 인증키" required/>
        <button class="btn" type="submit">저장</button>
      </form>

      <div class="hint">
        - 오늘(${esc(todayKST())}) 기준으로 저장됩니다.<br/>
        - 인증키를 바꾸면 시청자는 새 키로만 신청 가능합니다.
      </div>
    </div>
  `, "관리자"));
});

app.post("/admin/code", requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "");
  if (!RAID_OPTIONS.some(r => r.key === raid)) return res.redirect("/admin/raid");
  if (!code.trim()) return res.redirect("/admin/raid");

  db.prepare(`
    INSERT INTO day_codes(date_kst, raid_key, code)
    VALUES(?, ?, ?)
    ON CONFLICT(date_kst, raid_key) DO UPDATE SET code=excluded.code
  `).run(todayKST(), raid, code.trim());

  return res.redirect("/admin/raid");
});

app.get("/admin/list", requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time"); // time | grade
  const raidObj = RAID_OPTIONS.find(r => r.key === raid);
  if (!raidObj) return res.redirect("/admin/raid");

  const gradeHeaderLink =
    sort === "grade"
      ? `/admin/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `/admin/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  let apps = [];
  if (sort === "grade") {
    // 등급 정렬: 불타는 → 분홍 → 노란 → 일반 (동일 등급이면 오래된 순)
    const orderCase = `
      CASE viewer_grade
        WHEN 'burning' THEN 1
        WHEN 'pink' THEN 2
        WHEN 'yellow' THEN 3
        WHEN 'normal' THEN 4
        ELSE 99
      END
    `;
    apps = db.prepare(`
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY ${orderCase} ASC, created_at ASC
    `).all(todayKST(), raid);
  } else {
    apps = db.prepare(`
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY created_at ASC
    `).all(todayKST(), raid);
  }

  res.send(
    layout(`
      <div class="box">
        <div class="row sp" style="justify-content:space-between;">
          <div>
            <b>레이드:</b> ${esc(raidObj.label)} / <b>날짜:</b> ${esc(todayKST())}
            <span class="chip">등록완료: ${apps.filter(a => a.confirmed === 1).length}/${apps.length}</span>
          </div>
          <div class="row">
            <a class="btn" href="/admin/raid">레이드 변경</a>

            <!-- ✅ 일괄삭제 버튼 -->
            <form method="POST" action="/admin/clear"
                  onsubmit="return confirm('정말 이 레이드의 오늘 신청목록을 전부 삭제할까요? (되돌릴 수 없음)');"
                  style="margin:0;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <input type="hidden" name="sort" value="${esc(sort)}"/>
              <button class="btn btnDanger" type="submit">신청목록 일괄삭제</button>
            </form>
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

          ${
            apps.length
              ? apps
                  .map(a => {
                    const formId = `confirmForm_${a.id}`;
                    const checked = a.confirmed === 1 ? "checked" : "";
                    const gradeLabel =
                      GRADE_OPTIONS.find(g => g.key === a.viewer_grade)?.label || a.viewer_grade;

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
                        <td>${esc(gradeLabel)}</td>
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
                  })
                  .join("")
              : `<tr><td colspan="7" style="text-align:center;color:#aab5ff;">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="hint">
          - 등록완료 체크는 “확인했음” 표시이며 시청자 화면에도 ✅ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - “시청자 등급” 클릭 시: 불타는 치즈 → 분홍색 치즈 → 노란색 치즈 → 일반 등급 정렬 (다시 클릭하면 시간순).<br/>
          - “삭제”는 관리자만 가능하며 확인 후 즉시 제거됩니다.<br/>
          - “신청목록 일괄삭제”는 현재 선택한 레이드의 오늘 신청만 전부 삭제합니다.
        </div>
      </div>
    `, "관리자 목록")
  );
});

// 등록완료 토글
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

// ✅ 개별 삭제 유지
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

// ✅ 일괄 삭제 (현재 레이드/오늘 신청 전부 삭제)
app.post("/admin/clear", requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (!RAID_OPTIONS.some(r => r.key === raid)) {
    return res.redirect("/admin/raid");
  }

  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(todayKST(), raid);

  return res.redirect(`/admin/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// ====== 헬스체크 ======
app.get("/health", (req, res) => res.json({ ok: true, kst: todayKST() }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
