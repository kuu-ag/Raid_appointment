// server.js (ESM / "type": "module")
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
app.set("trust proxy", 1); // 프록시 설정
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ENV 설정
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

const ADMIN_PATH = (process.env.ADMIN_PATH || "devon_path_f23d12").trim();
const ADMIN_BASE = "/" + ADMIN_PATH;

// 옵션 상수
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내황혼전" },
  { key: "nabel", label: "인공신 : 나벨" },
  { key: "nabel-hard", label: "나벨 - 하드모드" },
  { key: "updoong", label: "업둥교환" },
];

const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" },
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "normal", label: "일반 치즈" },
];

const GRADE_SORT = { burning: 1, pink: 2, yellow: 3, normal: 4 };

// DB 초기화
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "data.sqlite"));

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

--  레이드별 진행일 + 인증키
CREATE TABLE IF NOT EXISTS day_codes (
  raid_key TEXT PRIMARY KEY,
  date_kst TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/* 공대 편성표 */
CREATE TABLE IF NOT EXISTS raid_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL, -- 1공대, 2공대 ...
  role TEXT NOT NULL,           -- 'buffer' | 'dealer'
  slot_index INTEGER NOT NULL,  -- 각 역할 내 순번
  nickname TEXT NOT NULL,
  application_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lineups_key
ON raid_lineups(date_kst, raid_key, party_index);

/* 비활성 공대 목록 */
CREATE TABLE IF NOT EXISTS raid_disabled_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL,
  UNIQUE(date_kst, raid_key, party_index)
);
`);

// 컬럼 체크
function ensureColumn(table, colName, colDDL) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => String(c.name) === colName);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDDL}`);
}

ensureColumn("applications", "request_note", "request_note TEXT NOT NULL DEFAULT ''");
ensureColumn("applications", "up1", "up1 INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "up2", "up2 INTEGER NOT NULL DEFAULT 0");

// 유틸 함수
function todayKST() {
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
  return GRADE_OPTIONS.find((g) => g.key === key)?.label || key;
}
function isValidKstDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

// 레이드 날짜/코드
function getActiveDay(raidKey) {
  const row = db.prepare("SELECT date_kst FROM day_codes WHERE raid_key=?").get(raidKey);
  return row?.date_kst || todayKST();
}
function getActiveCodeRow(raidKey) {
  return db.prepare("SELECT * FROM day_codes WHERE raid_key=?").get(raidKey) || null;
}

// 비활성 공대 Set
function getDisabledPartySet(raidKey, dateKst) {
  const rows = db
    .prepare(
      "SELECT party_index FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?",
    )
    .all(raidKey, dateKst);
  return new Set(rows.map((r) => r.party_index));
}

// 레이드별 공대 구성
function getRaidConfig(raidKey) {
  if (raidKey === "inhwagongjeon") {
    return { buffersPerParty: 2, dealersPerParty: 6 };
  }
  return { buffersPerParty: 3, dealersPerParty: 9 };
}

// 레이아웃 / 스타일
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
      --panel2:#0f172a;
      --line:rgba(120,160,255,.35);
      --text:#e9eefc;
      --muted:rgba(189,198,232,.82);
      --btn:#111827;
      --btn-hover:#1f2937;
      --danger:#b91c1c;
      --danger-hover:#dc2626;
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
      background:#050816;
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
      border-radius:var(--radius);
      padding:20px 18px 18px;
      border:1px solid var(--line);
      box-shadow:var(--shadow);
      position:relative;
    }

    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .sp{ justify-content:space-between; }

    .btn{
      border:1px solid rgba(148,163,255,.7);
      background:var(--btn);
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
      background:var(--btn-hover);
      transform:translateY(-1px);
      box-shadow:0 14px 30px rgba(15,23,42,.9);
    }
    .btnGhost{
      background:transparent;
      border-color:rgba(148,163,255,.35);
      box-shadow:none;
    }
    .btnGhost:hover{
      background:var(--btn-hover);
      box-shadow:0 10px 24px rgba(15,23,42,.9);
    }
    .btnDanger{
      background:var(--danger);
      border-color:rgba(248,113,113,.7);
    }
    .btnDanger:hover{
      background:var(--danger-hover);
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

    input,textarea{
      width:100%;
      background:#020617;
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
      box-shadow:0 0 0 1px rgba(56,189,248,.4), 0 0 24px rgba(56,189,248,.35);
    }

    select {
      appearance:none;
      -webkit-appearance:none;
      -moz-appearance:none;
      width:100%;
      padding:9px 11px;
      border-radius:12px;
      border:1px solid rgba(115,145,235,.7);
      background:#050816;
      color:#f9fafb;
      box-shadow:0 6px 16px rgba(0,0,0,.55) inset;
      font-size:13px;
      outline:none;
    }

    select:focus {
      border-color:var(--accent);
      box-shadow:0 0 0 1px rgba(56,189,248,.4),
                  0 0 24px rgba(56,189,248,.35);
    }

    select option {
      background:#ffffff;
      color:#111827;
      font-weight:500;
    }

    select option:checked,
    select option:hover {
      background:#1d4ed8;
      color:#ffffff;
    }

    select option:disabled {
      color:#9ca3af;
      background:#e5e7eb;
    }

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
      padding:8px 8px;
      text-align:left;
      font-size:13px;
      vertical-align:middle;
    }
    th{
      background:#020617;
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

    .raidNav{ margin-bottom:4px; }
    .raidNav .btn{ font-size:12px; padding-inline:12px; }

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

    .adminConfirm{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:4px 10px;
      border-radius:999px;
      background:#020617;
      border:1px solid rgba(148,163,255,.5);
      cursor:pointer;
      font-size:12px;
      user-select:none;
    }
    .adminConfirm:hover{
      background:#1f2937;
    }
    .adminConfirm input[type="checkbox"]{
      width:20px;
      height:20px;
      margin:0;
      cursor:pointer;
    }

    .partyGrid{
      display:flex;
      flex-wrap:wrap;
      gap:14px;
    }
    .partyCard{
      flex:1 1 calc(25% - 12px);
      min-width:260px;
      max-width:320px;
      background:#020617;
      border-radius:14px;
      border:1px solid rgba(148,163,255,.4);
      padding:12px 12px 10px;
    }
    .partyHeader{
      display:flex;
      justify-content:space-between;
      align-items:center;
      font-weight:800;
      margin-bottom:6px;
      font-size:14px;
    }
    .partyTitle{
      display:flex;
      align-items:center;
      gap:6px;
    }
    .partyBody table{
      width:100%;
      border-radius:10px;
      border:1px solid rgba(51,65,85,.9);
      background:#020617;
    }
    .partyBody th{
      text-align:center;
      font-size:11px;
      padding:4px 4px;
    }
    .partyBody td{
      padding:4px 4px;
      font-size:12px;
      text-align:center;
    }
    .slotInput{
      width:100%;
      padding:4px 6px;
      font-size:12px;
      border-radius:8px;
      border:1px solid rgba(71,85,105,.9);
      background:#020617;
      color:var(--text);
    }
    .slotInput::placeholder{
      color:rgba(148,163,255,.55);
    }
    .slotInput:focus{
      border-color:var(--accent);
      box-shadow:0 0 0 1px rgba(56,189,248,.3);
      outline:none;
    }
    .slotInput[disabled]{
      opacity:0.4;
      cursor:not-allowed;
    }
  </style>
  <script>
    function submitOnChange(formId){
      const f = document.getElementById(formId);
      if(f) f.submit();
    }

    function deleteParty(raidKey, partyIndex){
      const msg = partyIndex + "공대를 삭제하시겠습니까?\\n(해당 공대에 배치된 인원은 모두 삭제되고, 공대 진행도 초기화를 하기 전까지 비활성 상태가 됩니다.)";
      if(!confirm(msg)) return;
      const f = document.getElementById("deletePartyForm");
      if(!f) return;
      const raidInput = document.getElementById("deleteRaidInput");
      const partyInput = document.getElementById("deletePartyIndexInput");
      if(!raidInput || !partyInput) return;
      raidInput.value = raidKey;
      partyInput.value = String(partyIndex);
      f.submit();
    }
  </script>
</head>
<body>
  <div class="wrap">
    <div class="title">
      <div class="titleInner">
        <div class="titleMain">
          <div class="titleLogo">
            <span class="accent">DevonVail</span> RAID
          </div>
          <div class="titleSub">레이드 예약 시스템</div>
        </div>
        <div class="titleBadge">
          <span>Made by 🧭뿡빵띠</span>
        </div>
      </div>
    </div>

    ${body}
  </div>
</body>
</html>`;
}

// 인증 미들웨어
function requireViewerOk(req, res, next) {
  const raid = String(req.query.raid || req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

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

// /admin 숨김 처리
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// Viewer: 메인
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
            <a class="btn btnGhost" href="/lineup">공대편성표 보기</a>
            <a class="btn btnGhost" href="/check">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="gap:12px;">
          ${RAID_OPTIONS.map(
            (r) => `<a class="btn" href="/verify?raid=${encodeURIComponent(r.key)}">${esc(
              r.label,
            )}</a>`,
          ).join("")}
        </div>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 일반 레이드 한 회차 정원: 3버퍼 / 9딜러 (총 12명)<br/>
          - 이내황혼전은 2버퍼 / 6딜러 (총 8명)<br/>
          - 업둥교환은 1업둥 / 2업둥 슬롯으로 별도 운영됩니다.<br/>
          - 신청 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>
    `),
  );
});

// Viewer: 인증 페이지
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
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(
        activeDay,
      )}</b></div>
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

// Viewer: 인증 처리
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

// Viewer: 예약 폼
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
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(
        activeDay,
      )}</b></div>
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

// Viewer: 예약 저장
app.post("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raid === "updoong";

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
  const request_note = String(req.body.request_note || "");

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
    if (!Number.isInteger(dealer_count) || dealer_count < 0 || dealer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
          "딜러 갯수는 0~999 정수여야 합니다.",
        )}`,
      );
    }
    if (!Number.isInteger(buffer_count) || buffer_count < 0 || buffer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
          "버퍼 갯수는 0~999 정수여야 합니다.",
        )}`,
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
        <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(
          activeDay,
        )}</b></div>
        <div class="divider"></div>
        <div class="row">
          <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">추가 등록</a>
          <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          <a class="btn btnGhost" href="/lineup?raid=${encodeURIComponent(
            raid,
          )}">공대 편성표</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `,
      "완료",
    ),
  );
});

// Viewer: 예약확인
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
              (r) =>
                `<a class="btn" href="/check?raid=${encodeURIComponent(r.key)}">${esc(
                  r.label,
                )}</a>`,
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
              <span class="chip">등록완료 ${apps.filter((a) => a.confirmed === 1).length}/${
        apps.length
      }</span>
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

// 공대 편성용 유틸
function buildPartyMap(lineups, cfg) {
  const map = new Map();
  for (const row of lineups) {
    const p = row.party_index;
    if (!map.has(p)) {
      map.set(p, { buffers: {}, dealers: {} });
    }
    const entry = map.get(p);
    if (row.role === "buffer") entry.buffers[row.slot_index] = row.nickname;
    else entry.dealers[row.slot_index] = row.nickname;
  }
  return map;
}

function renderPartyCards({ raidKey, partyMap, cfg, editable, adminMode, disabledSet = new Set() }) {
  const buffersPerParty = cfg.buffersPerParty;
  const dealersPerParty = cfg.dealersPerParty;
  const dealersPerRow = 3;

  const indexSet = new Set([
    ...Array.from(partyMap.keys()),
    ...Array.from(disabledSet),
  ]);

  if (indexSet.size === 0) {
    return `<div class="muted">편성된 공대가 없습니다.</div>`;
  }

  const allIndices = Array.from(indexSet).sort((a, b) => a - b);

  const activeIndices = allIndices.filter((i) => !disabledSet.has(i));
  const disabledIndicesArr = allIndices.filter((i) => disabledSet.has(i));
  const viewOrder = [...activeIndices, ...disabledIndicesArr];

  let html = `<div class="partyGrid">`;

  for (const p of viewOrder) {
    const data = partyMap.get(p) || { buffers: {}, dealers: {} };
    const isDisabled = disabledSet.has(p);
    const disableInputs = editable && adminMode && isDisabled;

    html += `<div class="partyCard">
      <div class="partyHeader">
        <div class="partyTitle"><span>${p}공대</span></div>
        ${
          editable && adminMode
            ? isDisabled
              ? `<span class="chip bad">삭제된 공대</span>`
              : `<button class="btn btnDanger" type="button"
                   onclick="deleteParty('${esc(raidKey)}', ${p});">
                   공대 삭제
                 </button>`
            : ""
        }
      </div>
      <div class="partyBody">
        <table>
          <tr>
            <th style="width:70px;">버퍼</th>
            <th>딜러</th>
          </tr>
    `;

    for (let b = 1; b <= buffersPerParty; b++) {
      const bName = data.buffers[b] || "";
      const dealerCells = [];
      for (let c = 0; c < dealersPerRow; c++) {
        const dIndex = (b - 1) * dealersPerRow + c + 1;
        if (dIndex > dealersPerParty) continue;
        const dName = data.dealers[dIndex] || "";

        if (editable && adminMode) {
          if (disableInputs) {
            dealerCells.push(
              `<td><input class="slotInput" value="${esc(
                dName,
              )}" placeholder="비활성" disabled/></td>`,
            );
          } else {
            dealerCells.push(
              `<td><input class="slotInput" name="d_${p}_${dIndex}" value="${esc(
                dName,
              )}" placeholder="딜러"/></td>`,
            );
          }
        } else {
          dealerCells.push(`<td>${dName ? esc(dName) : "&nbsp;"}</td>`);
        }
      }

      html += `<tr>`;
      if (editable && adminMode) {
        if (disableInputs) {
          html += `<td><input class="slotInput" value="${esc(
            bName,
          )}" placeholder="비활성" disabled/></td>`;
        } else {
          html += `<td style="border-right:1px solid rgba(148,163,255,.35);">
          <input class="slotInput" name="b_${p}_${b}" 
          value="${esc(bName)}" placeholder="버퍼"/></td>`;
        }
      } else {
        html += `<td style="border-right:1px solid rgba(148,163,255,.35);">${bName ? esc(bName) : "&nbsp;"}</td>`;
      }

      if (dealerCells.length) {
        html += `<td><table style="width:100%;border:0;background:transparent;"><tr>${dealerCells.join(
          "",
        )}</tr></table></td>`;
      } else {
        html += `<td>&nbsp;</td>`;
      }
      html += `</tr>`;
    }

    html += `</table>
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// 자동배치 (확정 여부 옵션)
function rebuildLineupForRaid(raidKey, { useConfirmedOnly = false } = {}) {
  if (raidKey === "updoong") return;

  const cfg = getRaidConfig(raidKey);
  const dateKst = getActiveDay(raidKey);
  const disabledSet = getDisabledPartySet
    ? getDisabledPartySet(raidKey, dateKst)
    : new Set();

  db.prepare(
    "DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=? AND application_id IS NOT NULL",
  ).run(raidKey, dateKst);

  const existing = db
    .prepare(
      `
      SELECT party_index, role, slot_index, nickname, application_id
      FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `,
    )
    .all(raidKey, dateKst);

  const parties = [];
  const partyStateMap = new Map();

  function getOrCreatePartyState(index) {
    let p = partyStateMap.get(index);
    if (!p) {
      p = {
        index,
        usedNames: new Set(),
        bufferSlots: new Set(),
        dealerSlots: new Set(),
      };
      partyStateMap.set(index, p);
      parties.push(p);
    }
    return p;
  }

  for (const row of existing) {
    const p = getOrCreatePartyState(row.party_index);
    if (row.nickname) {
      p.usedNames.add(row.nickname);
    }
    if (row.role === "buffer") {
      p.bufferSlots.add(row.slot_index);
    } else if (row.role === "dealer") {
      p.dealerSlots.add(row.slot_index);
    }
  }

  let nextPartyIndex = 1;
  function createParty() {
    const usedIndices = new Set(parties.map((p) => p.index));
    let idx = nextPartyIndex;
    while (disabledSet.has(idx) || usedIndices.has(idx)) {
      idx++;
    }
    nextPartyIndex = idx + 1;
    const p = {
      index: idx,
      usedNames: new Set(),
      bufferSlots: new Set(),
      dealerSlots: new Set(),
    };
    parties.push(p);
    partyStateMap.set(idx, p);
    return p;
  }

  function findPartyWithSpace(role, nickname) {
    const perParty = role === "buffer" ? cfg.buffersPerParty : cfg.dealersPerParty;
    for (const p of parties) {
      if (disabledSet.has(p.index)) continue;
      if (p.usedNames.has(nickname)) continue;
      const usedCount =
        role === "buffer" ? p.bufferSlots.size : p.dealerSlots.size;
      if (usedCount < perParty) return p;
    }
    return null;
  }

  const insert = db.prepare(
    `
    INSERT INTO raid_lineups
      (date_kst, raid_key, party_index, role, slot_index, nickname, application_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );

  function allocSeat(role, nickname, appId) {
    const perParty = role === "buffer" ? cfg.buffersPerParty : cfg.dealersPerParty;
    if (perParty <= 0) return;

    let party = findPartyWithSpace(role, nickname);
    if (!party) {
      party = createParty();
    }

    const usedCount =
      role === "buffer" ? party.bufferSlots.size : party.dealerSlots.size;
    if (usedCount >= perParty) {
      party = createParty();
    }

    const slots = role === "buffer" ? party.bufferSlots : party.dealerSlots;
    let slotIndex = 1;
    while (slots.has(slotIndex) && slotIndex <= perParty) {
      slotIndex++;
    }
    if (slotIndex > perParty) {
      return;
    }

    insert.run(
      dateKst,
      raidKey,
      party.index,
      role,
      slotIndex,
      nickname,
      appId,
      nowISO(),
    );

    slots.add(slotIndex);
    party.usedNames.add(nickname);
  }

  const confirmedClause = useConfirmedOnly ? "AND confirmed=1" : "";
  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE raid_key=? AND date_kst=? ${confirmedClause}
      ORDER BY
        CASE viewer_grade
          WHEN 'burning' THEN 1
          WHEN 'pink' THEN 2
          WHEN 'yellow' THEN 3
          WHEN 'normal' THEN 4
          ELSE 9
        END,
        datetime(created_at) ASC,
        id ASC
    `,
    )
    .all(raidKey, dateKst);

  if (!apps.length) return;

  for (const app of apps) {
    for (let i = 0; i < app.buffer_count; i++) {
      allocSeat("buffer", app.chzzk_nickname, app.id);
    }
    for (let i = 0; i < app.dealer_count; i++) {
      allocSeat("dealer", app.chzzk_nickname, app.id);
    }
  }
}

// Admin: 기본 라우팅
app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

// Admin: 로그인 페이지
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

// Admin: 로그인 처리
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

// Admin: 로그아웃
app.get(`${ADMIN_BASE}/logout`, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect(`${ADMIN_BASE}/login`);
});

// Admin: 메인 / 인증키 설정
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자</div>
            <div class="muted">레이드별 신청목록 확인 / 진행일 + 인증키 설정 / 공대편성</div>
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

        <div style="font-weight:900;margin-bottom:8px;">진행일 + 인증키 설정</div>
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
              ${RAID_OPTIONS.map(
                (r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`,
              ).join("")}
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

// Admin: 인증키 저장
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

// Admin: 신청목록
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time");
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

  if (isUp) {
    if (upFilter === "1") {
      apps = apps.filter((a) => a.up1 === 1);
    } else if (upFilter === "2") {
      apps = apps.filter((a) => a.up2 === 1);
    }
  }

  if (sort === "grade" || (isUp && upFilter)) {
    apps.sort((a, b) => {
      const aa = GRADE_SORT[a.viewer_grade] ?? 999;
      const bb = GRADE_SORT[b.viewer_grade] ?? 999;
      if (aa !== bb) return aa - bb;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
  } else {
    apps.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  const upFilterAllLink = `${ADMIN_BASE}/list?raid=${encodeURIComponent(
    raid,
  )}&sort=${encodeURIComponent(sort)}`;
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
              <span class="chip">등록완료 ${apps.filter((a) => a.confirmed === 1).length}/${
        apps.length
      }</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/raid">레이드 변경</a>
            <a class="btn" href="${esc(ADMIN_BASE)}/lineup?raid=${encodeURIComponent(
        raid,
      )}">공대 편성표</a>
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

// Admin: 등록완료 토글
app.post(`${ADMIN_BASE}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
  }

  rebuildLineupForRaid(raid, { useConfirmedOnly: true });

  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// Admin: 코멘트 저장
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

// Admin: 개별 삭제
app.post(`${ADMIN_BASE}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
    db.prepare("DELETE FROM raid_lineups WHERE application_id=?").run(id);
  }
  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// Admin: 일괄삭제
app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const activeDay = getActiveDay(raid);
  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(activeDay, raid);
  db.prepare("DELETE FROM raid_lineups WHERE date_kst=? AND raid_key=?").run(activeDay, raid);
  db.prepare("DELETE FROM raid_disabled_parties WHERE date_kst=? AND raid_key=?").run(
    activeDay,
    raid,
  );

  return res.redirect(
    `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`,
  );
});

// Admin: 공대 편성표 관리
app.get(`${ADMIN_BASE}/lineup`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);
  const cfg = getRaidConfig(raid);

  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `,
    )
    .all(raid, dateKst);

  const disabledSet = getDisabledPartySet(raid, dateKst);
  const partyMap = buildPartyMap(lineups, cfg);
  const partyCardsHtml = renderPartyCards({
    raidKey: raid,
    partyMap,
    cfg,
    editable: true,
    adminMode: true,
    disabledSet,
  });

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">공대 편성표 관리</div>
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(
              ADMIN_BASE,
            )}/list?raid=${encodeURIComponent(raid)}&sort=time">신청목록</a>
            <form method="POST" action="${esc(
              ADMIN_BASE,
            )}/lineup/auto" style="margin:0;display:inline;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <button class="btn" type="submit"
                onclick="return confirm('현재 확정된 예약을 기준으로 공대 편성표를 다시 자동 배치합니다.\\n기존 배치는 모두 덮어씌워집니다.');">
                전체 자동배치
              </button>
            </form>
            <form method="POST" action="${esc(
              ADMIN_BASE,
            )}/lineup/reset" style="margin:0;display:inline;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <button class="btn btnDanger" type="submit"
                onclick="return confirm('현재 레이드의 공대 진행도를 모두 초기화합니다.\\n모든 공대 편성이 삭제되고 비활성 상태도 해제됩니다.');">
                공대 진행도 초기화
              </button>
            </form>
          </div>
        </div>

        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/lineup/save">
          <input type="hidden" name="raid" value="${esc(raid)}"/>
          <input type="hidden" name="party_count" value="${Math.max(0, ...partyMap.keys()) || 0}"/>

          ${partyCardsHtml}

          <div class="row" style="margin-top:16px;">
            <button class="btn" type="submit">수동 수정 내용 저장</button>
          </div>
        </form>

        <form id="deletePartyForm"
              method="POST"
              action="${esc(ADMIN_BASE)}/lineup/delete-party"
              style="display:none;">
          <input type="hidden" id="deleteRaidInput" name="raid" value="${esc(raid)}"/>
          <input type="hidden" id="deletePartyIndexInput" name="party_index" value=""/>
        </form>

        <div class="muted" style="margin-top:12px;line-height:1.5%;">
          - 빈 칸으로 두고 저장하면 해당 슬롯의 인원이 삭제됩니다.<br/>
          - 공대 삭제 버튼을 누르면 해당 공대의 인원은 삭제되며, 공대 진행도 초기화를 하기 전까지 비활성 상태가 되어 자동배치/추가 배치에서 사용되지 않습니다.<br/>
          - “전체 자동배치”를 누르면 현재 확정(등록완료)된 예약을 기준으로 다시 편성합니다.<br/>
          - “공대 진행도 초기화”를 누르면 이 레이드의 공대 편성이 모두 삭제되고, 비활성 공대 설정도 해제되어 1공대부터 다시 편성할 수 있습니다.
        </div>
      </div>
    `,
      "공대 편성표",
    ),
  );
});

// Admin: 공대 자동배치 실행
app.post(`${ADMIN_BASE}/lineup/auto`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  rebuildLineupForRaid(raid, { useConfirmedOnly: false });

  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

// Admin: 공대 진행도 초기화
app.post(`${ADMIN_BASE}/lineup/reset`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  const dateKst = getActiveDay(raid);

  db.prepare(
    "DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=?"
  ).run(raid, dateKst);

  db.prepare(
    "DELETE FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?"
  ).run(raid, dateKst);

  return res.redirect(
    `${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`
  );
});

// Admin: 공대 수동 저장
app.post(`${ADMIN_BASE}/lineup/save`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);
  const cfg = getRaidConfig(raid);
  const partyCount = Number(req.body.party_count || 0) || 0;
  const disabledSet = getDisabledPartySet(raid, dateKst);

  db.prepare("DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=?").run(raid, dateKst);

  const insert = db.prepare(
    `
    INSERT INTO raid_lineups
      (date_kst, raid_key, party_index, role, slot_index, nickname, application_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `,
  );

  for (let p = 1; p <= partyCount; p++) {
    const isDisabled = disabledSet.has(p);
    if (isDisabled) continue;

    for (let b = 1; b <= cfg.buffersPerParty; b++) {
      const key = `b_${p}_${b}`;
      const name = String(req.body[key] || "").trim();
      if (!name) continue;
      insert.run(dateKst, raid, p, "buffer", b, name, nowISO());
    }
    for (let d = 1; d <= cfg.dealersPerParty; d++) {
      const key = `d_${p}_${d}`;
      const name = String(req.body[key] || "").trim();
      if (!name) continue;
      insert.run(dateKst, raid, p, "dealer", d, name, nowISO());
    }
  }

  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

// Admin: 공대 삭제
app.post(`${ADMIN_BASE}/lineup/delete-party`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const partyIndex = Number(req.body.party_index || 0);
  if (!partyIndex) {
    return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
  }

  const dateKst = getActiveDay(raid);

  const seatRows = db
    .prepare(
      `
      SELECT application_id, role, COUNT(*) AS cnt
      FROM raid_lineups
      WHERE raid_key=? AND date_kst=? AND party_index=? AND application_id IS NOT NULL
      GROUP BY application_id, role
    `,
    )
    .all(raid, dateKst, partyIndex);

  const usageMap = new Map();
  for (const row of seatRows) {
    const appId = row.application_id;
    if (!appId) continue;
    if (!usageMap.has(appId)) {
      usageMap.set(appId, { usedBuffers: 0, usedDealers: 0 });
    }
    const u = usageMap.get(appId);
    if (row.role === "buffer") {
      u.usedBuffers += row.cnt || 0;
    } else if (row.role === "dealer") {
      u.usedDealers += row.cnt || 0;
    }
  }

  for (const [appId, u] of usageMap.entries()) {
    const app = db
      .prepare(
        `
        SELECT dealer_count, buffer_count
        FROM applications
        WHERE id=?
      `,
      )
      .get(appId);

    if (!app) continue;

    const newDealer = Math.max(0, Number(app.dealer_count || 0) - (u.usedDealers || 0));
    const newBuffer = Math.max(0, Number(app.buffer_count || 0) - (u.usedBuffers || 0));

    db.prepare(
      `
      UPDATE applications
      SET dealer_count=?, buffer_count=?
      WHERE id=?
    `,
    ).run(newDealer, newBuffer, appId);
  }

  db.prepare(
    `
    INSERT INTO raid_disabled_parties(date_kst, raid_key, party_index)
    VALUES(?, ?, ?)
    ON CONFLICT(date_kst, raid_key, party_index) DO NOTHING
  `,
  ).run(dateKst, raid, partyIndex);

  db.prepare(
    "DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=? AND party_index=?",
  ).run(raid, dateKst, partyIndex);

  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

// Viewer: 공대 편성표 (read-only)
app.get("/lineup", (req, res) => {
  const raid = String(req.query.raid || "");
  const hasRaid = !!raidByKey(raid);

  if (!hasRaid) {
    return res.send(
      layout(
        `
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">공대 편성표</div>
              <div class="muted">확인할 레이드를 선택하세요.</div>
            </div>
            <a class="btn btnGhost" href="/">메인</a>
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:12px;">
            ${RAID_OPTIONS.map(
              (r) =>
                `<a class="btn" href="/lineup?raid=${encodeURIComponent(r.key)}">${esc(
                  r.label,
                )}</a>`,
            ).join("")}
          </div>
        </div>
      `,
        "공대 편성표",
      ),
    );
  }

  const raidObj = raidByKey(raid);
  const dateKst = getActiveDay(raid);
  const cfg = getRaidConfig(raid);

  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `,
    )
    .all(raid, dateKst);

  const disabledSet = getDisabledPartySet(raid, dateKst);
  const partyMap = buildPartyMap(lineups, cfg);
  const partyCardsHtml = renderPartyCards({
    raidKey: raid,
    partyMap,
    cfg,
    editable: false,
    adminMode: false,
    disabledSet,
  });

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">공대 편성표</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(
        dateKst,
      )}</b></div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        ${partyCardsHtml}

        <div class="muted" style="margin-top:12px;line-height:1.5%;">
          - 실제 진행 상황에 따라 스트리머가 수동으로 수정할 수 있습니다.<br/>
          - 빈 공대가 보인다면 아직 편성이 이루어지지 않은 상태이거나, 삭제된 공대일 수 있습니다.
        </div>
      </div>
    `,
      "공대 편성표",
    ),
  );
});

// 헬스체크
app.get("/health", (req, res) =>
  res.json({ ok: true, kst: todayKST(), admin: ADMIN_BASE }),
);

// 서버 시작
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
