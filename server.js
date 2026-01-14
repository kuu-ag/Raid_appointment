// server.js  (ESM / "type": "module")
"use strict";

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.set("trust proxy", 1); // Render/프록시 환경에서 secure cookie 위해 필요
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// =====================
// ENV
// =====================
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

// 기존 관리자 비밀 URL 유지
const ADMIN_PATH = (process.env.ADMIN_PATH || "devon_path_f23d12").trim();
const ADMIN_BASE = "/" + ADMIN_PATH;

// =====================
// Options
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내향혼전" },
  { key: "nabel", label: "인공신 : 나벨" },
  { key: "nabel-hard", label: "나벨 - 하드모드" },
  { key: "updoong", label: "업둥교환" }, // 업둥교환 레이드
];

// 치즈: 기본값 "치즈 선택"(빈 값) 추가
const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" }, // 기본값
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "normal", label: "일반 치즈" },
];

// 치즈 정렬 우선순위
const GRADE_SORT = { burning: 1, pink: 2, yellow: 3, normal: 4 };

// =====================
// DB
// =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "data.sqlite"));

// 테이블 생성
db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,

  viewer_grade TEXT NOT NULL,
  chzzk_nickname TEXT NOT NULL,
  adventure_name TEXT NOT NULL,

  dealer_count INTEGER NOT NULL,
  buffer_count INTEGER NOT NULL,

  -- 업둥 전용 플래그
  up1 INTEGER NOT NULL DEFAULT 0,
  up2 INTEGER NOT NULL DEFAULT 0,

  confirmed INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  request_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_applications_date_raid
ON applications(date_kst, raid_key);

--  레이드별 Active Day + 인증키 (자정이 넘어도 행이 유지됨)
CREATE TABLE IF NOT EXISTS day_codes (
  raid_key TEXT PRIMARY KEY,
  date_kst TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// 마이그레이션: 없는 컬럼 추가
function ensureColumn(table, colName, colDDL) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => String(c.name) === colName);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDDL}`);
}

// 요청사항, 업둥 플래그 컬럼 보강 (기존 DB에 없을 때 대비)
ensureColumn("applications", "request_note", "request_note TEXT NOT NULL DEFAULT ''");
ensureColumn("applications", "up1", "up1 INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "up2", "up2 INTEGER NOT NULL DEFAULT 0");

// =====================
// Utils
// =====================
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
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
  return GRADE_OPTIONS.find((g) => g.key === key)?.label || key;
}
function isValidKstDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

// 레이드별 Active Day (없는 경우 오늘)
function getActiveDay(raidKey) {
  const row = db.prepare("SELECT date_kst FROM day_codes WHERE raid_key=?").get(raidKey);
  return row?.date_kst || todayKST();
}
function getActiveCodeRow(raidKey) {
  return db.prepare("SELECT * FROM day_codes WHERE raid_key=?").get(raidKey) || null;
}

// =====================
// Layout / CSS
// =====================
function layout(body, title = "레이드 예약 사이트") {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    :root{
      --bg:#050816;
      --bg2:#0b1024;
      --panel:#0b1226;
      --panel2: rgba(16,24,54,.96);
      --line:rgba(120,160,255,.35);
      --text:#e9eefc;
      --muted:rgba(189,198,232,.82);
      --btn:#2432ff;
      --btn2:#4351ff;
      --danger:#ff3960;
      --chip:rgba(23,34,80,.9);
      --shadow:0 16px 40px rgba(0,0,0,.65);
      --radius:18px;
      --accent:#4be0ff;
      --accent2:#ff7ce5;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans KR", sans-serif;
      background:#070a12;
      color:var(--text);
    }
    a{ color:inherit; text-decoration:none; }

    .wrap{
      max-width:1400px;
      margin:0 auto;
      padding:24px 14px 68px;
    }

    .title{
      position:relative;
      border-radius:18px;
      padding:18px 16px 20px;
      margin-bottom:18px;
      background:linear-gradient(135deg, rgba(36,50,255,.85), rgba(75,224,255,.75));
      box-shadow:0 18px 40px rgba(0,0,0,.65);
      overflow:hidden;
    }
    .title::before{
      content:"";
      position:absolute;
      inset:1px;
      border-radius:16px;
      background:linear-gradient(135deg, #050816 0%, #0b1024 40%, #141c3b 100%);
    }
    .titleInner{
      position:relative;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }
    .titleMain{
      display:flex;
      flex-direction:column;
      gap:4px;
    }
    .titleLogo{
      font-size:clamp(22px, 3.4vw, 32px);
      font-weight:900;
      letter-spacing:.06em;
      text-transform:uppercase;
    }
    .titleLogo span.accent{
      background:linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip:text;
      background-clip:text;
      color:transparent;
    }
    .titleSub{
      font-size:13px;
      color:var(--muted);
    }
    .titleBadge{
      padding:6px 10px;
      border-radius:999px;
      border:1px solid rgba(142,163,255,.5);
      background:rgba(9,16,44,.9);
      font-size:12px;
      display:inline-flex;
      align-items:center;
      gap:6px;
      color:var(--muted);
    }
    .box{
      background:var(--panel2);
      border:1px solid var(--line);
      border-radius:var(--radius);
      padding:18px;
      box-shadow:var(--shadow);
    }
    .box::before{
      content:"";
      position:absolute;
      inset:0;
      background:linear-gradient(135deg, rgba(255,255,255,.04), transparent);
      opacity:.8;
      pointer-events:none;
    }
    .boxInner{ position:relative; }

    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .sp{ justify-content:space-between; }
    .btn{
      border:1px solid rgba(148,163,255,.7);
      background:radial-gradient(circle at top,#1e293b 0,#020617 60%);
      color:var(--text);
      padding:9px 14px;
      border-radius:999px;
      cursor:pointer;
      font-weight:800;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      font-size:13px;
      box-shadow:0 10px 24px rgba(15,23,42,.9);
      transition:transform .08s ease-out, box-shadow .08s ease-out, background .08s ease-out;
    }
    .btn:hover{
      background:radial-gradient(circle at top,#1d4ed8 0,#020617 65%);
      transform:translateY(-1px);
      box-shadow:0 18px 40px rgba(15,23,42,.95);
    }
    .btnGhost{
      background:transparent;
      border-color:rgba(148,163,255,.35);
      box-shadow:none;
    }
    .btnGhost:hover{
      background:rgba(15,23,42,.9);
      box-shadow:0 8px 20px rgba(15,23,42,.8);
    }
    .btnDanger{
      background:radial-gradient(circle at top,#b91c1c 0,#450a0a 60%);
      border-color:rgba(248,113,113,.7);
    }
    .btnDanger:hover{
      background:radial-gradient(circle at top,#ef4444 0,#450a0a 60%);
    }
    .chip{
      display:inline-flex;
      gap:6px;
      align-items:center;
      padding:5px 10px;
      border-radius:999px;
      background:var(--chip);
      border:1px solid rgba(148,163,255,.4);
      color:var(--muted);
      font-size:12px;
    }
    .muted{ color:var(--muted); font-size:13px; }
    .divider{ height:1px; background:linear-gradient(to right,transparent,#3844a8,transparent); margin:16px 0; }
    .ok{ color:#4ade80; font-weight:700; }
    .wait{ color:#fde68a; font-weight:700; }
    .bad{ color:#fda4af; font-weight:700; }

    input,select,textarea{
      width:100%;
      background:linear-gradient(135deg,#050816,#020617);
      border:1px solid rgba(115,145,235,.7);
      color:var(--text);
      padding:9px 11px;
      border-radius:12px;
      outline:none;
      min-width:0;
      font-size:13px;
      box-shadow:0 6px 16px rgba(0,0,0,.55) inset;
    }
    input::placeholder,textarea::placeholder{ color:rgba(148,163,255,.6); }
    textarea{ resize:vertical; min-height:44px; }

    input:focus,select:focus,textarea:focus{
      border-color:var(--accent);
      box-shadow:0 0 0 1px var(--accent-soft), 0 0 24px rgba(56,189,248,.35);
    }

    /* 셀렉트 공통 스타일 */
    select{
      appearance:none;
      -webkit-appearance:none;
      -moz-appearance:none;
      background:linear-gradient(135deg,#050816,#020617);
      color:var(--text);          /* 선택된 값(닫힌 상태) – 밝은 글자 */
      border:1px solid rgba(115,145,235,.7);
    }

    /* 드롭다운에 펼쳐졌을 때 각 옵션 스타일  */
    select option{
      /* 많은 브라우저에서 배경색은 무시될 수 있지만, 글자색은 잘 먹음 */
      color:#111827;              /* 진한 남색/거의 검정 – 흰 배경에서도 잘 보이도록 */
      font-weight:600;
    }

    /* 선택된 옵션 */
    select option:checked{
      background:#1d4ed8;         /* 파란 하이라이트 */
      color:#ffffff;              /* 흰 글자 */
    }

    /* (선택) 비활성 옵션이 있을 경우 색 조금만 연하게 */
    select option:disabled{
      color:#6b7280;
    }

    /* 예약 폼 그리드 */
    .formGrid{
      display:grid;
      grid-template-columns: 170px minmax(160px,1fr) minmax(200px,1.2fr) 150px 150px;
      gap:10px;
      align-items:end;
    }
    .field label{
      display:block;
      font-size:12px;
      color:var(--muted);
      margin:0 0 6px 2px;
      letter-spacing:.02em;
    }
    .fieldFull{ grid-column:1 / -1; }

    @media (max-width:980px){
      .formGrid{ grid-template-columns:1fr 1fr; }
      .fieldFull{ grid-column:1 / -1; }
    }
    @media (max-width:520px){
      .formGrid{ grid-template-columns:1fr; }
      .fieldFull{ grid-column:1 / -1; }
    }

    table{
      width:100%;
      border-collapse:collapse;
      overflow:hidden;
      border-radius:14px;
      border:1px solid rgba(148,163,255,.4);
      background:rgba(10,16,32,.98);
    }
    th,td{
      border-bottom:1px solid rgba(51,65,85,.9);
      padding:10px 10px;
      text-align:left;
      font-size:13px;
      vertical-align:middle;
    }
    th{
      background:radial-gradient(circle at top,#020617 0,#020617 60%);
      font-weight:800;
      font-size:12px;
      letter-spacing:.05em;
      color:rgba(191,219,254,.9);
      text-transform:uppercase;
    }
    tr:last-child td{ border-bottom:0; }
    .center{ text-align:center; }

    .commentBox{
      width:260px;
      max-width:100%;
    }
    @media (max-width:520px){
      .commentBox{ width:100%; }
    }

    /* 관리자 레이드 버튼 영역 */
    .raidNav{ margin-bottom:4px; }
    .raidNav .btn{ font-size:12px; padding-inline:12px; }

    /* 업둥 체크박스 (시청자뷰) */
    .bigCheck {
      display:flex;
      align-items:center;
      gap:6px;
      cursor:pointer;
    }
    .bigCheck input[type="checkbox"] {
      width:22px;
      height:22px;
    }

    /* 관리자 등록완료 체크박스 큰 범위 */
    .adminConfirm{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:4px 10px;
      border-radius:999px;
      background:rgba(15,23,42,.9);
      border:1px solid rgba(148,163,255,.5);
      cursor:pointer;
      font-size:12px;
      user-select:none;
    }
    .adminConfirm:hover{
      background:rgba(37,46,94,.95);
    }
    .adminConfirm input[type="checkbox"]{
      width:20px;
      height:20px;
      margin:0;
      cursor:pointer;
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
    <div class="title">
      <div class="titleInner">
        <div class="titleMain">
          <div class="titleLogo">
            <span class="accent">DEVONVAIL</span> RAID
          </div>
          <div class="titleSub">레이드 예약 시스템</div>
        </div>
        <div class="titleBadge">
          <span>🧭뿡빵띠</span>
        </div>
      </div>
    </div>

    ${body}
  </div>
</body>
</html>`;
}

// =====================
// Auth Guards
// =====================
function requireViewerOk(req, res, next) {
  const raid = String(req.query.raid || req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  // Active Day 기준으로 쿠키 키 생성 → 자정 지나도 유지(Active Day가 바뀌기 전까지)
  const activeDay = getActiveDay(raid);
  const cookieKey = `viewer_ok_${raid}_${activeDay}`;

  if (req.cookies[cookieKey] !== "1") {
    return res.redirect(`/verify?raid=${encodeURIComponent(raid)}`);
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(500).send(
      layout(
        `
        <div class="box">
          <div class="bad"><b>ADMIN_KEY가 설정되지 않았습니다.</b></div>
          <div class="muted">Render Environment Variables에 ADMIN_KEY를 추가하세요.</div>
        </div>
      `,
        "오류",
      ),
    );
  }
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

// =====================
// Hide /admin (404)
// =====================
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// Viewer routes
// =====================
app.get("/", (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">메인 로비</div>
            <div class="muted">레이드를 선택 → 인증키 입력 → 예약 신청</div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/check">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="gap:12px;">
          ${RAID_OPTIONS.map(
            (r) => `<a class="btn" href="/verify?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`,
          ).join("")}
        </div>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 일반 레이드 한 회차 정원: 3버퍼 / 9딜러 (총 12명)<br/>
          - 업둥교환은 1업둥 / 2업둥 슬롯으로 별도 운영됩니다.<br/>
          - 신청 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>
    `),
  );
});

// 인증키 입력 화면
app.get("/verify", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const activeRow = getActiveCodeRow(raid);
  const activeDay = activeRow?.date_kst || todayKST();

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">인증키 입력</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b></div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        <form method="POST" action="/verify" class="row" style="align-items:flex-end;">
          <input type="hidden" name="raid" value="${esc(raid)}"/>
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">인증키</div>
            <input name="code" placeholder="스트리머가 공지한 인증키" required />
          </div>
          <button class="btn" type="submit">확인</button>
        </form>

        ${
          !activeRow
            ? `<div class="muted" style="margin-top:12px;line-height:1.5;">
                 - 아직 이 레이드의 인증키가 설정되지 않았을 수 있습니다.<br/>
                 - 스트리머가 관리자 화면에서 인증키를 먼저 설정해야 합니다.
               </div>`
            : ""
        }
      </div>
    `,
      "인증키",
    ),
  );
});

// 인증키 검증 → 예약 페이지
app.post("/verify", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const row = getActiveCodeRow(raid);
  if (!row || String(row.code) !== code) {
    return res.send(
      layout(
        `
        <div class="box">
          <div class="bad"><b>인증키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="/verify?raid=${encodeURIComponent(raid)}">다시 입력</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      `,
        "인증 실패",
      ),
    );
  }

  const activeDay = row.date_kst;
  res.cookie(`viewer_ok_${raid}_${activeDay}`, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
});

// 예약 화면
app.get("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raid === "updoong";
  const err = String(req.query.err || "");
  const activeDay = getActiveDay(raid);

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약 신청</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b></div>
            ${err ? `<div class="bad" style="margin-top:8px;"><b>${esc(err)}</b></div>` : ""}
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/">메인</a>
            <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <form method="POST" action="/reserve">
          <input type="hidden" name="raid" value="${esc(raid)}"/>

          <div class="formGrid">

            <div class="field">
              <label>치즈 색깔</label>
              <select name="viewer_grade" required>
                ${GRADE_OPTIONS.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("")}
              </select>
            </div>

            <div class="field">
              <label>치지직 닉네임</label>
              <input name="chzzk_nickname" placeholder="치지직 닉네임" required maxlength="40"/>
            </div>

            <div class="field">
              <label>모험단 이름</label>
              <input name="adventure_name" placeholder="인게임 모험단명" required maxlength="60"/>
            </div>

            ${
              isUp
                ? `
                  <div class="field">
                    <label>1업둥</label>
                    <label class="bigCheck">
                      <input type="checkbox" name="up1"/>
                    </label>
                  </div>
                  <div class="field">
                    <label>2업둥</label>
                    <label class="bigCheck">
                      <input type="checkbox" name="up2"/>
                    </label>
                  </div>
                `
                : `
                  <div class="field">
                    <label>딜러 갯수</label>
                    <input name="dealer_count" inputmode="numeric" placeholder="딜러 갯수" required />
                  </div>

                  <div class="field">
                    <label>버퍼 갯수</label>
                    <input name="buffer_count" inputmode="numeric" placeholder="버퍼 갯수" required />
                  </div>
                `
            }

            <div class="field fieldFull">
              <label>요청사항 (선택)</label>
              <textarea name="request_note"
                placeholder="예) 3깃수부터 참여 가능 / 자리 관련 요청 등"></textarea>
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <button class="btn" type="submit">등록</button>
          </div>
        </form>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 치즈 색깔을 “치즈 선택” 그대로 두면 등록이 안 됩니다.<br/>
          - 요청사항은 선택이며 비워도 등록됩니다.<br/>
          - ${
            isUp
              ? "업둥교환은 딜/버퍼 수 대신 1업둥, 2업둥 체크박스로 신청합니다. (둘 다 선택 가능)"
              : "등록 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다."
          }
        </div>
      </div>
    `,
      "예약 신청",
    ),
  );
});

// 예약 등록 처리
app.post("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raid === "updoong";

  // Active Day 기준으로 저장
  const activeRow = getActiveCodeRow(raid);
  if (!activeRow || !activeRow.code) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "스트리머가 아직 인증키를 설정하지 않았습니다.",
      )}`,
    );
  }
  const activeDay = activeRow.date_kst;

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();
  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);
  const up1 = req.body.up1 ? 1 : 0;
  const up2 = req.body.up2 ? 1 : 0;
  const request_note = String(req.body.request_note || ""); // 글자수 제한 제거

  const validGradeKeys = new Set(GRADE_OPTIONS.map((g) => g.key));
  if (!viewer_grade || !validGradeKeys.has(viewer_grade) || viewer_grade === "") {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "치즈 색깔을 선택해야 예약이 가능합니다.",
      )}`,
    );
  }

  if (!chzzk_nickname || !adventure_name) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "닉네임/모험단 이름을 입력해 주세요.",
      )}`,
    );
  }

  if (!isUp) {
    // 일반 레이드: 딜/버퍼 검증
    if (!Number.isInteger(dealer_count) || dealer_count < 0 || dealer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("딜러 갯수는 0~999 정수여야 합니다.")}`,
      );
    }
    if (!Number.isInteger(buffer_count) || buffer_count < 0 || buffer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("버퍼 갯수는 0~999 정수여야 합니다.")}`,
      );
    }
  }

  db.prepare(
    `
    INSERT INTO applications
      (created_at, date_kst, raid_key,
       viewer_grade, chzzk_nickname, adventure_name,
       dealer_count, buffer_count,
       up1, up2,
       confirmed, comment, request_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)
  `,
  ).run(
    nowISO(),
    activeDay,
    raid,
    viewer_grade,
    chzzk_nickname,
    adventure_name,
    isUp ? 0 : dealer_count,
    isUp ? 0 : buffer_count,
    isUp ? up1 : 0,
    isUp ? up2 : 0,
    request_note,
  );

  return res.send(
    layout(
      `
      <div class="box">
        <div style="font-weight:900;font-size:20px;margin-bottom:6px;">등록 완료</div>
        <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b></div>
        <div class="divider"></div>
        <div class="row">
          <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">추가 등록</a>
          <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `,
      "완료",
    ),
  );
});

// 예약확인(시청자용)
app.get("/check", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);

  if (!raidObj) {
    return res.send(
      layout(
        `
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약확인</div>
              <div class="muted">확인할 레이드를 선택하세요.</div>
            </div>
            <a class="btn btnGhost" href="/">메인</a>
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:12px;">
            ${RAID_OPTIONS.map(
              (r) => `<a class="btn" href="/check?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`,
            ).join("")}
          </div>
        </div>
      `,
        "예약확인",
      ),
    );
  }

  const isUp = raid === "updoong";
  const activeDay = getActiveDay(raid);
  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY datetime(created_at) ASC
    `,
    )
    .all(activeDay, raid);

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약확인</div>
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b>
              <span class="chip">등록완료 ${apps.filter((a) => a.confirmed === 1).length}/${apps.length}</span>
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
            <th>치즈 색깔</th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            ${
              isUp
                ? `<th class="center">1업둥</th><th class="center">2업둥</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th class="center">상태</th>
            <th>스트리머 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps
                  .map((a) => {
                    const status =
                      a.confirmed === 1
                        ? `<span class="ok">✔ 등록완료</span>`
                        : `<span class="wait">⏳ 대기중</span>`;
                    return `
                      <tr>
                        <td>${esc(gradeLabel(a.viewer_grade))}</td>
                        <td>${esc(a.chzzk_nickname)}</td>
                        <td>${esc(a.adventure_name)}</td>
                        ${
                          isUp
                            ? `<td class="center">${a.up1 ? "✔" : "-"}</td>
                               <td class="center">${a.up2 ? "✔" : "-"}</td>`
                            : `<td class="center">${esc(a.dealer_count)}</td>
                               <td class="center">${esc(a.buffer_count)}</td>`
                        }
                        <td class="center">${status}</td>
                        <td>${a.comment ? esc(a.comment) : `<span class="muted">-</span>`}</td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="7" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - “등록완료”는 스트리머가 확인 체크한 상태입니다.<br/>
          - 코멘트는 스트리머가 남기는 안내/요청사항입니다.<br/>
        </div>
      </div>
    `,
      "예약확인",
    ),
  );
});

// =====================
// Admin routes
// =====================
app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

// 로그인 화면
app.get(`${ADMIN_BASE}/login`, (req, res) => {
  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자 로그인</div>
            <div class="muted">관리자용 로그인화면입니다.</div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/login" class="row" style="align-items:flex-end;">
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">접속 코드</div>
            <input name="key" placeholder="관리자 접속 코드" required />
          </div>
          <button class="btn" type="submit">입장</button>
        </form>
      </div>
    `,
      "스트리머 로그인",
    ),
  );
});

app.post(`${ADMIN_BASE}/login`, (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.send(
      layout(
        `
        <div class="box">
          <div class="bad"><b>키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="${esc(ADMIN_BASE)}/login">다시 시도</a>
        </div>
      `,
        "실패",
      ),
    );
  }

  res.cookie("admin_key", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.get(`${ADMIN_BASE}/logout`, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect(`${ADMIN_BASE}/login`);
});

// 관리자: 레이드 선택 + Active Day/인증키 설정
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자</div>
            <div class="muted">레이드별 신청목록 확인 / Active Day(진행일) + 인증키 설정</div>
          </div>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/logout">로그아웃</a>
        </div>

        <div class="divider"></div>

        <div style="font-weight:900;margin-bottom:8px;">신청목록 보기</div>
        <div class="row raidNav">
          ${RAID_OPTIONS.map(
            (r) =>
              `<a class="btn" href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(
                r.key,
              )}&sort=time">${esc(r.label)}</a>`,
          ).join("")}
        </div>

        <div class="divider"></div>

        <div style="font-weight:900;margin-bottom:8px;">Active Day(진행일) + 인증키 설정</div>
        <div class="muted">
          - 여기서 설정한 <b>진행일(date)</b>이 해당 레이드의 "기준 날짜"가 됩니다.<br/>
          - 자정이 지나도 스트리머가 이 날짜를 바꾸지 않으면 인증/예약/조회가 유지됩니다.
        </div>

        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/code" class="row" style="align-items:flex-end;">
          <div style="min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">레이드</div>
            <select name="raid" required style="max-width:260px;">
              <option value="">레이드 선택</option>
              ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
            </select>
          </div>

          <div style="min-width:200px;">
            <div class="muted" style="margin-bottom:6px;">진행일(YYYY-MM-DD)</div>
            <input name="date_kst" value="${esc(todayKST())}" placeholder="예) 2025-12-28" required />
          </div>

          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">인증키</div>
            <input name="code" placeholder="예) 1234ABCD" required />
          </div>

          <button class="btn" type="submit">저장</button>
        </form>
      </div>
    `,
      "관리자",
    ),
  );
});

// Active Day + 인증키 저장
app.post(`${ADMIN_BASE}/code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const date_kst = String(req.body.date_kst || "").trim();

  if (!raidByKey(raid) || !code || !isValidKstDate(date_kst)) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  db.prepare(
    `
    INSERT INTO day_codes(raid_key, date_kst, code, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(raid_key) DO UPDATE SET
      date_kst=excluded.date_kst,
      code=excluded.code,
      updated_at=excluded.updated_at
  `,
  ).run(raid, date_kst, code, nowISO());

  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 신청목록 (관리자)
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time"); // time | grade
  const upFilter = req.query.up === "1" ? "1" : req.query.up === "2" ? "2" : "";
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const isUp = raid === "updoong";
  const activeDay = getActiveDay(raid);

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  let apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
    `,
    )
    .all(activeDay, raid);

  // 업둥 전용 필터
  if (isUp) {
    if (upFilter === "1") {
      apps = apps.filter((a) => a.up1 === 1);
    } else if (upFilter === "2") {
      apps = apps.filter((a) => a.up2 === 1);
    }
  }

  // 정렬
  if (sort === "grade" || (isUp && upFilter)) {
    // 치즈색깔 우선 + created_at 순
    apps.sort((a, b) => {
      const aa = GRADE_SORT[a.viewer_grade] ?? 999;
      const bb = GRADE_SORT[b.viewer_grade] ?? 999;
      if (aa !== bb) return aa - bb;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
  } else {
    apps.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  const upFilterAllLink = `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(
    sort,
  )}`;
  const upFilter1Link = `${ADMIN_BASE}/list?raid=${encodeURIComponent(
    raid,
  )}&sort=${encodeURIComponent(sort)}&up=1`;
  const upFilter2Link = `${ADMIN_BASE}/list?raid=${encodeURIComponent(
    raid,
  )}&sort=${encodeURIComponent(sort)}&up=2`;

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">신청목록</div>
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b>
              <span class="chip">등록완료 ${apps.filter((a) => a.confirmed === 1).length}/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/raid">레이드 변경</a>
            <form method="POST" action="${esc(ADMIN_BASE)}/clear"
                  onsubmit="return confirm('정말 이 레이드의 신청목록을 전부 삭제할까요?');"
                  style="margin:0;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <input type="hidden" name="sort" value="${esc(sort)}"/>
              <button class="btn btnDanger" type="submit">일괄삭제</button>
            </form>
          </div>
        </div>

        ${
          isUp
            ? `
            <div class="divider"></div>
            <div class="row" style="gap:8px; margin-bottom:6px;">
              <a class="btn ${!upFilter ? "" : "btnGhost"}" href="${esc(upFilterAllLink)}">전체</a>
              <a class="btn ${upFilter === "1" ? "" : "btnGhost"}" href="${esc(upFilter1Link)}">1업둥</a>
              <a class="btn ${upFilter === "2" ? "" : "btnGhost"}" href="${esc(upFilter2Link)}">2업둥</a>
            </div>
          `
            : ""
        }

        <div class="divider"></div>

        <table>
          <tr>
            <th class="center">등록완료</th>
            <th>
              <a href="${esc(gradeHeaderLink)}" style="text-decoration:underline;">
                치즈 색깔 ${sort === "grade" ? "▼" : ""}
              </a>
            </th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            ${
              isUp
                ? `<th class="center">1업둥</th><th class="center">2업둥</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th>요청사항</th>
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
                    const reqVal = String(a.request_note || "");

                    return `
                      <tr>
                        <td class="center">
                          <form id="${formId}" method="POST" action="${esc(
                        ADMIN_BASE,
                      )}/confirm" style="margin:0;">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <input type="hidden" name="confirmed" value="${
                              a.confirmed === 1 ? "0" : "1"
                            }"/>
                            <label class="adminConfirm">
                              <input type="checkbox" ${checked} onchange="submitOnChange('${formId}')"/>
                              <span>완료</span>
                            </label>
                          </form>
                        </td>

                        <td>${esc(gradeLabel(a.viewer_grade))}</td>
                        <td>${esc(a.chzzk_nickname)}</td>
                        <td>${esc(a.adventure_name)}</td>

                        ${
                          isUp
                            ? `<td class="center">${a.up1 ? "✔" : "-"}</td>
                               <td class="center">${a.up2 ? "✔" : "-"}</td>`
                            : `<td class="center">${esc(a.dealer_count)}</td>
                               <td class="center">${esc(a.buffer_count)}</td>`
                        }

                        <td>${reqVal ? esc(reqVal) : `<span class="muted">-</span>`}</td>

                        <td>
                          <form method="POST" action="${esc(ADMIN_BASE)}/comment" style="margin:0;" class="row">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <input class="commentBox" name="comment"
                                   placeholder="예) 1깃수 시작"
                                   value="${esc(commentVal)}"/>
                            <button class="btn" type="submit">저장</button>
                          </form>
                        </td>

                        <td class="center">
                          <form method="POST" action="${esc(
                            ADMIN_BASE,
                          )}/delete" onsubmit="return confirm('정말 삭제하시겠습니까?');" style="margin:0;">
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
              : `<tr><td colspan="9" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 등록완료 체크는 시청자 화면에도 ✔ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - “요청사항”은 시청자가 작성한 내용(선택)이며, 스트리머 확인용입니다.<br/>
          - 업둥교환의 1업둥/2업둥 필터를 사용하면 해당 업둥만 치즈색깔 순으로 정렬됩니다.
        </div>
      </div>
    `,
      "신청목록",
    ),
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
  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// 코멘트 저장 (12글자 제한 유지)
app.post(`${ADMIN_BASE}/comment`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const comment = String(req.body.comment || "").slice(0, 12);

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, id);
  }
  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// 개별 삭제
app.post(`${ADMIN_BASE}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
  }
  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// Active Day 기준 일괄삭제
app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const activeDay = getActiveDay(raid);
  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(activeDay, raid);

  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// health
app.get("/health", (req, res) =>
  res.json({ ok: true, kst: todayKST(), admin: ADMIN_BASE }),
);

// start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
