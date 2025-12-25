"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");

const app = express();
app.set("trust proxy", 1); // Render/프록시 환경에서 secure cookie 위해 필요

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// =====================
// 환경변수
// =====================
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

// ✅ 비밀 관리자 URL: https://도메인/<ADMIN_PATH>
const ADMIN_PATH = (process.env.ADMIN_PATH || "").trim(); // 예: "kuu_ag_9f3k2"
if (!ADMIN_PATH) {
  console.warn("[WARN] ADMIN_PATH is empty. Set ADMIN_PATH in Render env.");
}
const ADMIN_BASE = "/" + ADMIN_PATH;

// =====================
// 레이드/등급 옵션
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내향혼전" },
  { key: "narbel", label: "인공신 : 나벨" },
  { key: "narble-hard", label: "나벨 : 하드모드" },
];

const GRADE_OPTIONS = [
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "normal", label: "일반 등급" },
];

// =====================
// DB (Render에서 디스크 없으면 재시작 시 초기화될 수 있음)
// =====================
const db = new Database("data.db");

// 테이블 생성
db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  viewer_grade TEXT NOT NULL,
  chzzk_nickname TEXT NOT NULL,
  adventure_name TEXT NOT NULL,
  dealer_count INTEGER NOT NULL,
  buffer_count INTEGER NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_date_raid
ON applications(date_kst, raid_key);

CREATE TABLE IF NOT EXISTS day_codes (
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (date_kst, raid_key)
);
`);

// =====================
// 유틸
// =====================
function todayKST() {
  // KST(UTC+9) 기준 yyyy-mm-dd
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function raidByKey(key) {
  return RAID_OPTIONS.find((r) => r.key === key);
}

function gradeLabel(key) {
  return (GRADE_OPTIONS.find((g) => g.key === key) || {}).label || key;
}

function gradeOrderValue(key) {
  // 불치→분치→노치→일반
  switch (key) {
    case "burning":
      return 1;
    case "pink":
      return 2;
    case "yellow":
      return 3;
    case "normal":
      return 4;
    default:
      return 99;
  }
}

function layout(body, title = "데본베일 레이드 예약 사이트") {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    :root{
      --bg:#0b0f1a;
      --panel:#121a2a;
      --line:#2a3552;
      --text:#e9eefc;
      --muted:#aab5ff;
      --btn:#1c2a52;
      --btn2:#263a75;
      --danger:#7a1d2a;
      --good:#1e6b3a;
      --warn:#7a5f1d;
      --chip:#1a2442;
      --shadow: 0 8px 30px rgba(0,0,0,.35);
      --radius:16px;
    }
    body{
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: linear-gradient(180deg, #070a12, #0b0f1a);
      color: var(--text);
    }
    .wrap{
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px 16px 60px;
    }
    .title{
      border:3px solid #ffffff;
      background: #0b1226;
      box-shadow: var(--shadow);
      border-radius: 10px;
      text-align:center;
      font-weight: 900;
      font-size: clamp(20px, 3.2vw, 34px);
      padding: 18px 10px;
      letter-spacing: .5px;
    }
    .box{
      margin-top:18px;
      background: rgba(18,26,42,.9);
      border:1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .sp{ justify-content:space-between; }
    .btn{
      appearance:none; border:1px solid var(--line);
      background: var(--btn);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 12px;
      cursor:pointer;
      font-weight:700;
      text-decoration:none;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
    }
    .btn:hover{ background: var(--btn2); }
    .btnDanger{ background: var(--danger); border-color:#aa3a49; }
    .btnDanger:hover{ filter: brightness(1.08); }
    .btnGhost{ background: transparent; }
    .miniBtn{ padding: 8px 10px; border-radius: 10px; font-size: 13px; }
    input, select{
      background:#0b1226;
      border:1px solid var(--line);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 12px;
      outline:none;
    }
    input::placeholder{ color:#7f8ab8; }
    .muted{ color: var(--muted); font-size: 14px; }
    .divider{ height:1px; background: var(--line); margin: 14px 0; }
    .chip{
      background: var(--chip);
      border:1px solid var(--line);
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 13px;
      color: var(--muted);
      display:inline-flex;
      gap:6px;
      align-items:center;
      margin-left:8px;
    }
    .ok{ color:#b6ffcf; }
    .wait{ color:#ffd7a6; }
    .bad{ color:#ffb6c2; }
    .hint{
      margin-top:12px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }
    table{
      width:100%;
      border-collapse: collapse;
      overflow:hidden;
      border-radius: 14px;
      border:1px solid var(--line);
      background: #0b1226;
    }
    th, td{
      border-bottom: 1px solid var(--line);
      padding: 10px 10px;
      text-align:left;
      font-size: 14px;
      vertical-align: middle;
    }
    th{
      background: #0e1731;
      color: #dbe4ff;
      font-size: 13px;
      letter-spacing: .2px;
    }
    tr:hover td{ background: rgba(255,255,255,.03); }
    .center{ text-align:center; }
    .commentBox{
      width: min(360px, 42vw);
    }
    .footerNav{
      margin-top:14px;
      display:flex;
      gap:10px;
      flex-wrap:wrap;
    }
    @media (max-width: 520px){
      .commentBox{ width: 100%; }
      th, td{ font-size: 13px; }
    }
  </style>
  <script>
    function submitOnChange(formId){
      const f = document.getElementById(formId);
      if(f) f.submit();
    }
  </script>
</head>
<body>
  <div class="wrap">
    <div class="title">데본베일 레이드 예약 사이트</div>
    ${body}
  </div>
</body>
</html>`;
}

// =====================
// 관리자 인증 미들웨어
// =====================
function requireAdmin(req, res, next) {
  const key = String(req.cookies.admin_key || "");
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.redirect(`${ADMIN_BASE}/login`);
  }
  return next();
}

// ✅ /admin 자체는 아예 숨김(404)
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// 시청자 화면
// =====================

// 메인: 레이드 선택
app.get("/", (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <h2 style="margin:0 0 6px 0;">메인 홈</h2>
            <div class="muted">레이드를 선택하면 예약/확인을 진행할 수 있습니다.</div>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="gap:12px;">
          ${RAID_OPTIONS.map(
            (r) =>
              `<a class="btn" href="/verify?raid=${encodeURIComponent(r.key)}">${esc(
                r.label
              )}</a>`
          ).join("")}
        </div>

        <div class="hint">
          - 시청자는 “레이드 섹션/회차 선택”은 하지 않습니다. 스트리머가 수기로 배치합니다.<br/>
          - 신청 후에는 “예약확인” 화면에서 등록완료/대기중, 코멘트를 확인할 수 있습니다.
        </div>

        <div class="footerNav">
          <a class="btn btnGhost" href="/check">예약확인</a>
        </div>
      </div>
    `)
  );
});

// 인증키 입력 화면
app.get("/verify", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <h2 style="margin:0 0 6px 0;">인증키 입력</h2>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
          </div>
          <a class="btn btnGhost" href="/">뒤로</a>
        </div>

        <div class="divider"></div>

        <form method="POST" action="/verify" class="row">
          <input type="hidden" name="raid" value="${esc(raid)}"/>
          <input name="code" placeholder="오늘 인증키" required style="min-width:240px"/>
          <button class="btn" type="submit">확인</button>
        </form>

        <div class="hint">
          - 오늘 인증키는 스트리머가 레이드별로 따로 설정합니다.
        </div>
      </div>
    `)
  );
});

// 인증키 확인 후 예약화면 이동
app.post("/verify", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const row = db
    .prepare("SELECT code FROM day_codes WHERE date_kst=? AND raid_key=?")
    .get(todayKST(), raid);

  if (!row || row.code !== code) {
    return res.send(
      layout(`
        <div class="box">
          <div class="bad"><b>인증키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="/verify?raid=${encodeURIComponent(raid)}">다시 입력</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      `)
    );
  }

  // 인증 통과하면 예약 페이지로
  return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
});

// 예약 화면
app.get("/reserve", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <h2 style="margin:0 0 6px 0;">예약 신청</h2>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/">메인</a>
            <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <form method="POST" action="/reserve" class="row" style="align-items:flex-start;">
          <input type="hidden" name="raid" value="${esc(raid)}"/>

          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">시청자 등급</div>
            <select name="viewer_grade" required style="width:100%;">
              ${GRADE_OPTIONS.map(g => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("")}
            </select>
          </div>

          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">치지직 닉네임</div>
            <input name="chzzk_nickname" required placeholder="예) 토엔" style="width:100%;"/>
          </div>

          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">모험단 이름</div>
            <input name="adventure_name" required placeholder="예) 흑조군단" style="width:100%;"/>
          </div>

          <div style="flex:0.6; min-width:140px;">
            <div class="muted" style="margin-bottom:6px;">딜러 갯수</div>
            <input name="dealer_count" type="number" min="0" max="9999" required placeholder="정수" style="width:100%;"/>
          </div>

          <div style="flex:0.6; min-width:140px;">
            <div class="muted" style="margin-bottom:6px;">버퍼 갯수</div>
            <input name="buffer_count" type="number" min="0" max="9999" required placeholder="정수" style="width:100%;"/>
          </div>

          <div style="width:100%; margin-top:8px;">
            <button class="btn" type="submit">등록</button>
          </div>
        </form>

        <div class="hint">
          - 한 회차 정원: 3버퍼/9딜러(총 12명). 하루 최대 20회차까지 진행 가능(수기 배치).<br/>
          - 등록 후 “예약확인”에서 <b>등록완료/대기중</b> 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>
    `)
  );
});

// 예약 등록 처리 (인증키 검증 포함)
app.post("/reserve", (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  // 오늘 인증키가 설정되어 있어야 등록 가능 (키를 모르면 verify를 못 지나가지만, 안전장치)
  const codeRow = db
    .prepare("SELECT code FROM day_codes WHERE date_kst=? AND raid_key=?")
    .get(todayKST(), raid);
  if (!codeRow || !codeRow.code) {
    return res.send(
      layout(`
        <div class="box">
          <div class="bad"><b>오늘 인증키가 아직 설정되지 않았습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="/">메인</a>
        </div>
      `)
    );
  }

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();
  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);

  if (!GRADE_OPTIONS.some((g) => g.key === viewer_grade)) {
    return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  }
  if (!chzzk_nickname || !adventure_name) {
    return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  }
  if (!Number.isFinite(dealer_count) || dealer_count < 0 || dealer_count > 9999) {
    return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  }
  if (!Number.isFinite(buffer_count) || buffer_count < 0 || buffer_count > 9999) {
    return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
  }

  db.prepare(`
    INSERT INTO applications
    (date_kst, raid_key, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, confirmed, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, '', ?)
  `).run(
    todayKST(),
    raid,
    viewer_grade,
    chzzk_nickname,
    adventure_name,
    Math.trunc(dealer_count),
    Math.trunc(buffer_count),
    nowISO()
  );

  return res.send(
    layout(`
      <div class="box" style="text-align:center;">
        <h2 style="margin:0 0 10px 0;">등록이 완료되었습니다.</h2>
        <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
        <div class="divider"></div>
        <div class="row" style="justify-content:center;">
          <a class="btn" href="/check?raid=${encodeURIComponent(raid)}">예약확인으로 이동</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `)
  );
});

// 예약확인 (레이드 선택 가능)
app.get("/check", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);

  // 레이드 미선택이면 선택 화면
  if (!raidObj) {
    return res.send(
      layout(`
        <div class="box">
          <div class="row sp">
            <div>
              <h2 style="margin:0 0 6px 0;">예약확인</h2>
              <div class="muted">확인할 레이드를 선택하세요. (오늘 신청 목록만 표시)</div>
            </div>
            <a class="btn btnGhost" href="/">메인</a>
          </div>

          <div class="divider"></div>

          <div class="row" style="gap:12px;">
            ${RAID_OPTIONS.map(
              (r) =>
                `<a class="btn" href="/check?raid=${encodeURIComponent(r.key)}">${esc(
                  r.label
                )}</a>`
            ).join("")}
          </div>
        </div>
      `)
    );
  }

  const apps = db
    .prepare(
      `SELECT * FROM applications
       WHERE date_kst=? AND raid_key=?
       ORDER BY created_at ASC`
    )
    .all(todayKST(), raid);

  return res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <h2 style="margin:0 0 6px 0;">예약확인</h2>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b>
              <span class="chip">등록완료 ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/">메인</a>
            <a class="btn" href="/verify?raid=${encodeURIComponent(raid)}">예약하기</a>
          </div>
        </div>

        <div class="divider"></div>

        <table>
          <tr>
            <th>시청자 등급</th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            <th class="center">딜러</th>
            <th class="center">버퍼</th>
            <th class="center">상태</th>
            <th>스트리머 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps
                  .map((a) => {
                    const status = a.confirmed === 1
                      ? `<span class="ok">✅ 등록완료</span>`
                      : `<span class="wait">⏳ 대기중</span>`;
                    return `
                      <tr>
                        <td>${esc(gradeLabel(a.viewer_grade))}</td>
                        <td>${esc(a.chzzk_nickname)}</td>
                        <td>${esc(a.adventure_name)}</td>
                        <td class="center">${esc(a.dealer_count)}</td>
                        <td class="center">${esc(a.buffer_count)}</td>
                        <td class="center">${status}</td>
                        <td>${esc(a.comment || "")}</td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="7" class="center muted">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="hint">
          - “등록완료”는 스트리머가 확인했다고 체크한 상태입니다.<br/>
          - 코멘트는 스트리머가 남긴 메모이며, 여기에 안내/요청사항이 적힐 수 있습니다.
        </div>
      </div>
    `)
  );
});

// =====================
// 관리자(스트리머) 화면 - 비밀 URL로만 접속
// =====================

// 비밀 URL 루트
app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

// 로그인
app.get(`${ADMIN_BASE}/login`, (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <h2 style="margin:0 0 8px 0;">스트리머 인증</h2>
        <div class="muted">관리자 키(ADMIN_KEY)를 입력하세요.</div>
        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/login" class="row">
          <input name="key" placeholder="관리자 키" required style="min-width:260px"/>
          <button class="btn" type="submit">입장</button>
        </form>

        <div class="hint">
          - 이 페이지 주소는 비밀 URL 입니다. (/admin 으로는 접속 불가)<br/>
          - Render 환경변수 <b>ADMIN_KEY</b>, <b>ADMIN_PATH</b> 설정이 필요합니다.
        </div>
      </div>
    `)
  );
});

app.post(`${ADMIN_BASE}/login`, (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.send(
      layout(`
        <div class="box">
          <div class="bad"><b>키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="${esc(ADMIN_BASE)}/login">다시 시도</a>
        </div>
      `)
    );
  }

  res.cookie("admin_key", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.get(`${ADMIN_BASE}/logout`, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect(`${ADMIN_BASE}/login`);
});

// 관리자: 레이드 선택 + 오늘 인증키 설정
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <h2 style="margin:0 0 6px 0;">관리자</h2>
            <div class="muted">레이드별 신청목록 확인 / 오늘 인증키 설정</div>
          </div>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/logout">로그아웃</a>
        </div>

        <div class="divider"></div>

        <h3 style="margin:0 0 8px 0;">신청목록 보기</h3>
        <form method="GET" action="${esc(ADMIN_BASE)}/list" class="row">
          <select name="raid" required>
            <option value="">레이드 선택</option>
            ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
          </select>
          <input type="hidden" name="sort" value="time"/>
          <button class="btn" type="submit">확인</button>
        </form>

        <div class="divider"></div>

        <h3 style="margin:0 0 8px 0;">오늘 인증키 설정</h3>
        <div class="muted">시청자가 신청하려면 레이드별 “오늘 인증키”가 필요합니다.</div>
        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/code" class="row">
          <select name="raid" required>
            <option value="">레이드 선택</option>
            ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
          </select>
          <input name="code" placeholder="오늘 인증키" required/>
          <button class="btn" type="submit">저장</button>
        </form>

        <div class="hint">
          - 날짜는 KST 기준: <b>${esc(todayKST())}</b><br/>
          - 인증키를 변경하면 시청자는 새 키로만 신청 가능
        </div>
      </div>
    `)
  );
});

app.post(`${ADMIN_BASE}/code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  if (!raidByKey(raid) || !code) return res.redirect(`${ADMIN_BASE}/raid`);

  db.prepare(`
    INSERT INTO day_codes(date_kst, raid_key, code)
    VALUES(?, ?, ?)
    ON CONFLICT(date_kst, raid_key) DO UPDATE SET code=excluded.code
  `).run(todayKST(), raid, code);

  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 관리자: 신청목록
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time"); // time | grade
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  let apps = [];
  if (sort === "grade") {
    const orderCase = `
      CASE viewer_grade
        WHEN 'burning' THEN 1
        WHEN 'pink' THEN 2
        WHEN 'yellow' THEN 3
        WHEN 'normal' THEN 4
        ELSE 99
      END
    `;
    apps = db
      .prepare(
        `SELECT * FROM applications
         WHERE date_kst=? AND raid_key=?
         ORDER BY ${orderCase} ASC, created_at ASC`
      )
      .all(todayKST(), raid);
  } else {
    apps = db
      .prepare(
        `SELECT * FROM applications
         WHERE date_kst=? AND raid_key=?
         ORDER BY created_at ASC`
      )
      .all(todayKST(), raid);
  }

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <b>레이드:</b> ${esc(raidObj.label)} / <b>날짜:</b> ${esc(todayKST())}
            <span class="chip">등록완료: ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
          </div>
          <div class="row">
            <a class="btn" href="${esc(ADMIN_BASE)}/raid">레이드 변경</a>

            <form method="POST" action="${esc(ADMIN_BASE)}/clear"
                  onsubmit="return confirm('정말 이 레이드의 오늘 신청목록을 전부 삭제할까요? (되돌릴 수 없음)');"
                  style="margin:0;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <input type="hidden" name="sort" value="${esc(sort)}"/>
              <button class="btn btnDanger" type="submit">신청목록 일괄삭제</button>
            </form>
          </div>
        </div>

        <div class="divider"></div>

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
            <th class="center">딜러</th>
            <th class="center">버퍼</th>
            <th>코멘트</th>
            <th class="center">삭제</th>
          </tr>

          ${
            apps.length
              ? apps
                  .map((a) => {
                    const formId = `confirmForm_${a.id}`;
                    const checked = a.confirmed === 1 ? "checked" : "";
                    const commentVal = String(a.comment || "");

                    return `
                      <tr>
                        <td class="center">
                          <form id="${formId}" method="POST" action="${esc(ADMIN_BASE)}/confirm" style="margin:0;">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <input type="hidden" name="confirmed" value="${a.confirmed === 1 ? "0" : "1"}"/>
                            <input type="checkbox" ${checked} onchange="submitOnChange('${formId}')"/>
                          </form>
                        </td>

                        <td>${esc(gradeLabel(a.viewer_grade))}</td>
                        <td>${esc(a.chzzk_nickname)}</td>
                        <td>${esc(a.adventure_name)}</td>
                        <td class="center">${esc(a.dealer_count)}</td>
                        <td class="center">${esc(a.buffer_count)}</td>

                        <td>
                          <form method="POST" action="${esc(ADMIN_BASE)}/comment" style="margin:0;" class="row">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <input class="commentBox" name="comment"
                                   placeholder="예) 3회차 가능 / 디코 부탁 / 오늘 마감"
                                   value="${esc(commentVal)}"/>
                            <button class="btn miniBtn" type="submit">저장</button>
                          </form>
                        </td>

                        <td class="center">
                          <form method="POST" action="${esc(ADMIN_BASE)}/delete"
                                onsubmit="return confirm('정말 삭제하시겠습니까?');"
                                style="margin:0;">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <button class="btn btnDanger miniBtn" type="submit">삭제</button>
                          </form>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="8" class="center muted">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="hint">
          - 등록완료 체크는 “확인했음” 표시이며 시청자 화면에도 ✅ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - “시청자 등급” 클릭 시: 불타는 치즈 → 분홍색 치즈 → 노란색 치즈 → 일반 등급 정렬 (다시 클릭하면 시간순).<br/>
          - 코멘트는 시청자 예약확인 화면에서도 보입니다.
        </div>
      </div>
    `)
  );
});

// 등록완료 토글
app.post(`${ADMIN_BASE}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
  }

  if (raidByKey(raid)) {
    return res.redirect(
      `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`
    );
  }
  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 코멘트 저장
app.post(`${ADMIN_BASE}/comment`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const comment = String(req.body.comment || "").slice(0, 200);

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, id);
  }

  if (raidByKey(raid)) {
    return res.redirect(
      `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`
    );
  }
  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 개별 삭제
app.post(`${ADMIN_BASE}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
  }

  if (raidByKey(raid)) {
    return res.redirect(
      `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`
    );
  }
  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 레이드별 오늘 신청목록 일괄삭제
app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(todayKST(), raid);

  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`
  );
});

// =====================
// 실행
// =====================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
