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
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// =====================
// ENV
// =====================
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const ADMIN_PATH = (process.env.ADMIN_PATH || "devon_path_f23d12").trim();
const ADMIN_BASE = "/" + ADMIN_PATH;
const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";

// =====================
// Options
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내황혼전" },
  { key: "nabel-hard", label: "나벨 - 하드모드" },
  { key: "updoong", label: "업둥벞교" },
];

const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" },
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "log", label: "통나무" }, // 노란 치즈 동급
  { key: "normal", label: "일반 치즈" },
];

// 정렬 우선순위: 스트리머(관리자용) > 불타는 > 분홍 > 노란/통나무 > 일반
const GRADE_SORT = {
  streamer: 0,
  burning: 1,
  pink: 2,
  yellow: 3,
  log: 3,
  normal: 4,
};

// =====================
// DB
// =====================
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

  is_streamer INTEGER NOT NULL DEFAULT 0,

  -- 업둥벞교 전용(2업둥 1개/2개)
  up1 INTEGER NOT NULL DEFAULT 0,
  up2 INTEGER NOT NULL DEFAULT 0,

  confirmed INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  request_note TEXT NOT NULL DEFAULT '',
  start_party INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_applications_date_raid
ON applications(date_kst, raid_key);

CREATE TABLE IF NOT EXISTS day_codes (
  raid_key TEXT PRIMARY KEY,
  date_kst TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raid_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL,
  role TEXT NOT NULL,           -- 'buffer' | 'dealer' | 'up'
  slot_index INTEGER NOT NULL,  -- 역할 내 순번 (up는 1~12)
  nickname TEXT NOT NULL,
  application_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lineups_key
ON raid_lineups(date_kst, raid_key, party_index);

CREATE TABLE IF NOT EXISTS raid_disabled_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL,
  UNIQUE(date_kst, raid_key, party_index)
);
`);

function ensureColumn(table, colName, colDDL) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => String(c.name) === colName);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDDL}`);
}
ensureColumn("applications", "request_note", "request_note TEXT NOT NULL DEFAULT ''");
ensureColumn("applications", "up1", "up1 INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "up2", "up2 INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "is_streamer", "is_streamer INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "start_party", "start_party INTEGER NOT NULL DEFAULT 1");

// =====================
// Utils
// =====================
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
  if (key === "streamer") return "스트리머";
  return GRADE_OPTIONS.find((g) => g.key === key)?.label || key;
}
function isValidKstDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}
function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const y = Math.trunc(x);
  if (y < min) return min;
  if (y > max) return max;
  return y;
}
function gradeOrder(gradeKey) {
  const k = String(gradeKey || "");
  return Number.isFinite(GRADE_SORT[k]) ? GRADE_SORT[k] : 999;
}

function getActiveDay(raidKey) {
  const row = db.prepare("SELECT date_kst FROM day_codes WHERE raid_key=?").get(raidKey);
  return row?.date_kst || todayKST();
}
function getActiveCodeRow(raidKey) {
  return db.prepare("SELECT * FROM day_codes WHERE raid_key=?").get(raidKey) || null;
}
function upsertDayCode(raidKey, dateKst, code) {
  db.prepare(
    `
    INSERT INTO day_codes(raid_key, date_kst, code, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(raid_key) DO UPDATE SET
      date_kst=excluded.date_kst,
      code=excluded.code,
      updated_at=excluded.updated_at
  `
  ).run(raidKey, dateKst, code, nowISO());
}

function getDisabledPartySet(raidKey, dateKst) {
  const rows = db
    .prepare("SELECT party_index FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?")
    .all(raidKey, dateKst);
  return new Set(rows.map((r) => r.party_index));
}
function disableParty(raidKey, dateKst, partyIndex) {
  db.prepare(
    `INSERT OR IGNORE INTO raid_disabled_parties(date_kst, raid_key, party_index) VALUES(?, ?, ?)`
  ).run(dateKst, raidKey, partyIndex);
}
function enableAllParties(raidKey, dateKst) {
  db.prepare(`DELETE FROM raid_disabled_parties WHERE date_kst=? AND raid_key=?`).run(dateKst, raidKey);
}

function getRaidConfig(raidKey) {
  if (raidKey === "inhwagongjeon") return { buffersPerParty: 2, dealersPerParty: 6 };
  // 그 외 일반 레이드는 3버퍼/9딜러
  return { buffersPerParty: 3, dealersPerParty: 9 };
}

function gradeOrderSqlCase() {
  return `
    CASE viewer_grade
      WHEN 'streamer' THEN 0
      WHEN 'burning' THEN 1
      WHEN 'pink' THEN 2
      WHEN 'yellow' THEN 3
      WHEN 'log' THEN 3
      WHEN 'normal' THEN 4
      ELSE 999
    END
  `;
}

function cookieSecure() {
  // 로컬 http에서 secure 쿠키면 안 박혀서 인증이 안 되는 경우가 많음
  return IS_PROD;
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
      --ok:#4ade80;
      --warn:#fde68a;
      --bad:#fda4af;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans KR", sans-serif;
      background:var(--bg);
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
    .stack{ display:flex; flex-direction:column; gap:10px; }

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
    .btnDanger:hover{ background:var(--danger-hover); }

    .btnMainLineup{
      background:linear-gradient(135deg,#2563eb,#3b82f6);
      border-color:rgba(99,102,241,.8);
      box-shadow:0 16px 34px rgba(37,99,235,.25);
    }
    .btnMainLineup:hover{
      background:linear-gradient(135deg,#1d4ed8,#2563eb);
      transform:translateY(-1px);
      box-shadow:0 20px 42px rgba(37,99,235,.28);
    }
    .btnAccent{
      background:linear-gradient(135deg, rgba(75,224,255,.22), rgba(255,124,229,.18));
      border-color:rgba(75,224,255,.65);
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
    .muted{
      color:var(--muted);
      font-size:13px;
      line-height:1.5;
    }
    .divider{ height:1px; background:linear-gradient(to right,transparent,#3844a8,transparent); margin:16px 0; }
    .ok{ color:var(--ok); font-weight:700; }
    .wait{ color:var(--warn); font-weight:700; }
    .bad{ color:var(--bad); font-weight:700; }

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

    select{
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
    select option{ background:#ffffff; color:#111827; font-weight:500; }

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

    .commentBox{ width:260px; max-width:100%; }
    @media (max-width:520px){ .commentBox{ width:100%; } }

    .raidNav{ margin-bottom:4px; }
    .raidNav .btn{ font-size:12px; padding-inline:12px; }

    .bigCheck{ display:flex; align-items:center; gap:6px; cursor:pointer; }
    .bigCheck input[type="checkbox"]{ width:22px; height:22px; }

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
    .adminConfirm:hover{ background:#1f2937; }
    .adminConfirm input[type="checkbox"]{ width:20px; height:20px; margin:0; cursor:pointer; }

    /* 공대 카드(일반) */
    .partyGrid{ display:flex; flex-wrap:wrap; gap:14px; }
    .partyCard{
      position:relative;
      width:120px; flex:0 0 120px; max-width:120px;
      background:#020617;
      border-radius:14px;
      border:1px solid rgba(148,163,255,.4);
      padding:12px 12px 10px;
    }
    .partyHeader{
      display:flex; align-items:center; justify-content:space-between;
      width:100%; margin-bottom:6px;
    }
    .partyTitle{
      font-size:18px; font-weight:900;
      text-align:left; line-height:1.1;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      pointer-events:none;
    }
    .partyHeader .partyDeleteBtn{
      flex-shrink:0;
      font-size:11px;
      padding:3px 6px;
      border-radius:999px;
      background:#b91c1c;
      border:1px solid rgba(255,120,120,0.6);
      color:white;
      cursor:pointer;
      white-space:nowrap;
    }
    .partyHeader .partyDeleteBtn:hover{ background:#dc2626; }

    .partyBody{ display:flex; flex-direction:column; gap:10px; }

    .slotSection{
      background:#020617;
      border-radius:10px;
      border:1px solid rgba(15,23,42,.9);
      padding:6px 8px 8px;
    }
    .slotSectionTitle{
      font-size:12px;
      color:rgba(191,219,254,.8);
      margin:0 0 6px 2px;
    }
    .slotDivider{
      height:1px;
      margin:2px 2px 0;
      background:linear-gradient(to right,transparent,rgba(148,163,255,.7),transparent);
    }

    .slotInput{
      width:100%;
      padding:6px 10px;
      margin-bottom:6px;
      font-size:13px;
      border-radius:999px;
      border:1px solid rgba(71,85,105,.95);
      background:#020617;
      color:var(--text);
      box-shadow:0 3px 10px rgba(15,23,42,.85) inset;
    }
    .slotInput::placeholder{ color:rgba(148,163,255,.6); }
    .slotInput:focus{
      border-color:var(--accent);
      box-shadow:0 0 0 1px rgba(56,189,248,.35), 0 0 18px rgba(56,189,248,.35);
      outline:none;
    }
    .slotInput[disabled]{ opacity:.45; cursor:not-allowed; }

    .slotStatic{
      width:100%;
      padding:6px 10px;
      margin-bottom:6px;
      font-size:13px;
      border-radius:999px;
      border:1px solid rgba(30,64,175,.9);
      background:#020617;
      text-align:center;
    }
    .slotStatic.slotEmpty{ opacity:.4; }

    /* 업둥벞교(Up) 공대 카드 - UI 개선: 4명 단위 라인 + 3블록(1~4/5~8/9~12) */
    .upGrid{ display:flex; flex-wrap:wrap; gap:14px; }
    .upCard{
      width:260px;
      flex:0 0 260px;
      max-width:260px;
      background:#020617;
      border-radius:14px;
      border:1px solid rgba(148,163,255,.4);
      padding:12px 12px 10px;
    }
    .upBody{ display:flex; flex-direction:column; gap:10px; }
    .upBlock{
      border:1px solid rgba(15,23,42,.9);
      background:rgba(2,6,23,.75);
      border-radius:12px;
      padding:10px 10px 8px;
    }
    .upBlockTitle{
      font-size:12px;
      color:rgba(191,219,254,.85);
      margin:0 0 8px 2px;
      letter-spacing:.02em;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:8px;
    }
    .upBlockTitle .chip{ padding:3px 8px; font-size:11px; }
    .upSlotsGrid{
      display:grid;
      grid-template-columns: 1fr;
      gap:8px;
    }
    .upSlot{
      display:flex;
      align-items:center;
      gap:8px;
    }
    .upSlotIdx{
      width:44px;
      flex:0 0 44px;
      text-align:center;
      font-size:12px;
      color:rgba(191,219,254,.75);
      border:1px solid rgba(148,163,255,.25);
      background:rgba(9,16,44,.8);
      border-radius:10px;
      padding:7px 0;
    }

    @media (max-width:520px){
      .upCard{ width:100%; max-width:100%; flex:1 1 auto; }
    }
  </style>

  <script>
    function submitOnChange(formId){
      const f = document.getElementById(formId);
      if(f) f.submit();
    }
    function deleteParty(raidKey, partyIndex){
      const msg = partyIndex + "기수를 삭제(비활성)하시겠습니까?\\n(해당 기수에 배치된 인원은 모두 편성표에서 제거됩니다.)";
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
    function enableAllParties(raidKey){
      const msg = "삭제(비활성)된 기수를 전부 복구하시겠습니까?";
      if(!confirm(msg)) return;
      const f = document.getElementById("enableAllForm");
      if(!f) return;
      document.getElementById("enableAllRaidInput").value = raidKey;
      f.submit();
    }
    function confirmBuild(){
      return confirm("자동 편성을 실행할까요?\\n(해당 날짜/레이드의 편성표는 새로 생성됩니다.)");
    }
    function confirmResetLineup(){
      return confirm("편성표를 초기화할까요?\\n(해당 날짜/레이드의 모든 슬롯이 비워집니다.)");
    }
  </script>
</head>
<body>
  <div class="wrap">
    <div class="title">
      <div class="titleInner">
        <div class="titleMain">
          <div class="titleLogo"><span class="accent">DevonVail</span> RAID</div>
          <div class="titleSub">레이드 예약 시스템</div>
        </div>
        <div class="titleBadge"><span>Made by 🧭뿡빵띠</span></div>
      </div>
    </div>

    ${body}
  </div>
</body>
</html>`;
}

// =====================
// Auth Middleware
// =====================
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
          <div class="muted">Environment Variables에 ADMIN_KEY를 추가하세요.</div>
        </div>
      `,
        "오류"
      )
    );
  }
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

// /admin 숨김 처리
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// Viewer Routes
// =====================

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
            <a class="btn btnMainLineup" href="/lineup">공대편성표 보기</a>
            <a class="btn btnGhost" href="/check">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="gap:12px;">
          ${RAID_OPTIONS.map(
            (r) => `<a class="btn" href="/verify?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`
          ).join("")}
        </div>

        <div class="muted" style="margin-top:12px;">
          - 일반 레이드 한 회차 정원: 3버퍼 / 9딜러 (총 12명)<br/>
          - 이내황혼전은 2버퍼 / 6딜러 (총 8명)<br/>
          - 업둥벞교는 버퍼/딜러 구분 없이 12명 단위로 편성됩니다. (4명 단위 블록 UI)<br/>
          - 신청 후 “예약확인”에서 등록완료/대기중 및 <b>암종호 코멘트</b>를 확인할 수 있습니다.
        </div>

        <div class="divider"></div>
        <div class="muted">
          관리자 페이지: <b>${esc(ADMIN_BASE)}</b> (관리자만 접속)
        </div>
      </div>
    `)
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
            ? `<div class="muted" style="margin-top:12px;">
                 - 아직 이 레이드의 인증키가 설정되지 않았을 수 있습니다.<br/>
                 - 스트리머가 관리자 화면에서 인증키를 먼저 설정해야 합니다.
               </div>`
            : ""
        }
      </div>
    `,
      "인증키"
    )
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
        "인증 실패"
      )
    );
  }

  const activeDay = row.date_kst;
  res.cookie(`viewer_ok_${raid}_${activeDay}`, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
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
                    <label>2업둥 (1)</label>
                    <label class="bigCheck">
                      <input type="checkbox" name="up1"/>
                      <span class="muted" style="font-size:12px;">1기수 배치</span>
                    </label>
                  </div>
                  <div class="field">
                    <label>2업둥 (2)</label>
                    <label class="bigCheck">
                      <input type="checkbox" name="up2"/>
                      <span class="muted" style="font-size:12px;">다른 기수 추가 배치</span>
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
              <label>원하는 시작 기수 (선택)</label>
              <input name="start_party" inputmode="numeric" placeholder="예) 3 (3기수부터 참여 희망 시)"/>
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <button class="btn" type="submit">등록</button>
          </div>
        </form>

        <div class="muted" style="margin-top:12px;">
          - 치즈 색깔을 “치즈 선택” 그대로 두면 등록이 안 됩니다.<br/>
          - 원하는 시작 기수는 선택 항목이며, 비우면 1기수부터 참여하는 것으로 처리됩니다.<br/>
          - ${
            isUp
              ? "<b>업둥벞교 편성 기준</b>: 신청 순서/등급순으로 12명 단위 편성, <b>한 기수에 동일 닉네임 1회</b>, 2업둥(1)+(2) 둘 다 체크 시 <b>서로 다른 2개 기수에 분산 배치</b>됩니다."
              : "등록 후 “예약확인”에서 등록완료/대기중 및 암종호 코멘트를 확인할 수 있습니다."
          }
        </div>
      </div>
    `,
      "예약 신청"
    )
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
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("스트리머가 아직 인증키를 설정하지 않았습니다.")}`
    );
  }
  const activeDay = activeRow.date_kst;

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();

  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);

  // 업둥: up1/up2 = 2업둥(1)/(2)
  const up1 = req.body.up1 ? 1 : 0;
  const up2 = req.body.up2 ? 1 : 0;

  let start_party = parseInt(String(req.body.start_party || "").trim(), 10);
  if (!Number.isInteger(start_party) || start_party < 1) start_party = 1;
  if (start_party > 99) start_party = 99;

  const validGradeKeys = new Set(GRADE_OPTIONS.map((g) => g.key));
  if (!viewer_grade || !validGradeKeys.has(viewer_grade) || viewer_grade === "") {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("치즈 색깔을 선택해야 예약이 가능합니다.")}`
    );
  }

  if (!chzzk_nickname || !adventure_name) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("닉네임/모험단 이름을 입력해 주세요.")}`
    );
  }

  if (!isUp) {
    if (!Number.isInteger(dealer_count) || dealer_count < 0 || dealer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("딜러 갯수는 0~999 정수여야 합니다.")}`
      );
    }
    if (!Number.isInteger(buffer_count) || buffer_count < 0 || buffer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("버퍼 갯수는 0~999 정수여야 합니다.")}`
      );
    }
  } else {
    if (!up1 && !up2) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("업둥벞교는 2업둥(1) 또는 2업둥(2) 중 최소 1개는 체크해야 합니다.")}`
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
       confirmed, comment, request_note, start_party)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?)
  `
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
    start_party
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
          <a class="btn btnMainLineup" href="/lineup?raid=${encodeURIComponent(raid)}">공대 편성표</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `,
      "완료"
    )
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
            ${RAID_OPTIONS.map((r) => `<a class="btn" href="/check?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`).join("")}
          </div>
        </div>
      `,
        "예약확인"
      )
    );
  }

  const isUp = raid === "updoong";
  const activeDay = getActiveDay(raid);

  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY ${gradeOrderSqlCase()} ASC, datetime(created_at) ASC
      `
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
                ? `<th class="center">2업둥(1)</th><th class="center">2업둥(2)</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th class="center">상태</th>
            <th>암종호 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps
                  .map((a) => {
                    const status =
                      a.confirmed === 1 ? `<span class="ok">✔ 등록완료</span>` : `<span class="wait">⏳ 대기중</span>`;
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

        <div class="muted" style="margin-top:12px;">
          - “등록완료”는 스트리머가 확인 체크한 상태입니다.<br/>
          - 코멘트는 암종호(스트리머)가 남기는 안내/요청사항입니다.<br/>
        </div>
      </div>
    `,
      "예약확인"
    )
  );
});

// =====================
// Lineup helpers (render)
// =====================
function buildPartyMap(lineups) {
  const map = new Map();
  for (const row of lineups) {
    const p = row.party_index;
    if (!map.has(p)) map.set(p, { buffers: {}, dealers: {}, up: {} });
    const entry = map.get(p);
    if (row.role === "buffer") entry.buffers[row.slot_index] = row.nickname;
    else if (row.role === "dealer") entry.dealers[row.slot_index] = row.nickname;
    else if (row.role === "up") entry.up[row.slot_index] = row.nickname;
  }
  return map;
}

function renderPartyCards({ raidKey, partyMap, cfg, editable, adminMode, disabledSet = new Set() }) {
  const buffersPerParty = cfg.buffersPerParty;
  const dealersPerParty = cfg.dealersPerParty;

  const indexSet = new Set([...Array.from(partyMap.keys()), ...Array.from(disabledSet)]);
  if (indexSet.size === 0) return `<div class="muted">편성된 공대가 없습니다.</div>`;

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
        <div class="partyTitle">${p}기수</div>
        ${
          editable && adminMode
            ? isDisabled
              ? `<span class="chip bad">삭제됨</span>`
              : `<button class="partyDeleteBtn" type="button" onclick="deleteParty('${esc(raidKey)}', ${p});">삭제</button>`
            : ""
        }
      </div>

      <div class="partyBody">`;

    // 버퍼
    html += `<div class="slotSection"><div class="slotSectionTitle">버퍼</div>`;
    for (let b = 1; b <= buffersPerParty; b++) {
      const bName = data.buffers[b] || "";
      if (editable && adminMode) {
        if (disableInputs) {
          html += `<input class="slotInput" value="${esc(bName)}" placeholder="비활성" disabled/>`;
        } else {
          html += `<input class="slotInput" name="b_${p}_${b}" value="${esc(bName)}" placeholder="버퍼"/>`;
        }
      } else {
        html += bName ? `<div class="slotStatic">${esc(bName)}</div>` : `<div class="slotStatic slotEmpty">버퍼</div>`;
      }
    }
    html += `</div>`;

    html += `<div class="slotDivider"></div>`;

    // 딜러
    html += `<div class="slotSection"><div class="slotSectionTitle">딜러</div>`;
    for (let d = 1; d <= dealersPerParty; d++) {
      const dName = data.dealers[d] || "";
      if (editable && adminMode) {
        if (disableInputs) {
          html += `<input class="slotInput" value="${esc(dName)}" placeholder="비활성" disabled/>`;
        } else {
          html += `<input class="slotInput" name="d_${p}_${d}" value="${esc(dName)}" placeholder="딜러"/>`;
        }
      } else {
        html += dName ? `<div class="slotStatic">${esc(dName)}</div>` : `<div class="slotStatic slotEmpty">딜러</div>`;
      }
    }
    html += `</div>`;

    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * 업둥벞교 공대 렌더 (UI 개선)
 * - 12명
 * - 4명 단위 3블록(1~4/5~8/9~12)
 */
function renderUpParties({ raidKey, partyMap, editable, adminMode, disabledSet = new Set() }) {
  const indexSet = new Set([...Array.from(partyMap.keys()), ...Array.from(disabledSet)]);
  if (indexSet.size === 0) return `<div class="muted">편성된 공대가 없습니다.</div>`;

  const allIndices = Array.from(indexSet).sort((a, b) => a - b);
  const activeIndices = allIndices.filter((i) => !disabledSet.has(i));
  const disabledIndicesArr = allIndices.filter((i) => disabledSet.has(i));
  const viewOrder = [...activeIndices, ...disabledIndicesArr];

  let html = `<div class="upGrid">`;

  for (const p of viewOrder) {
    const data = partyMap.get(p) || { up: {} };
    const isDisabled = disabledSet.has(p);
    const disableInputs = editable && adminMode && isDisabled;

    const block = (title, from, to) => {
      let inner = `
        <div class="upBlock">
          <div class="upBlockTitle">
            <span>${esc(title)}</span>
            <span class="chip">${from}~${to}</span>
          </div>
          <div class="upSlotsGrid">
      `;
      for (let i = from; i <= to; i++) {
        const name = data.up?.[i] || "";
        if (editable && adminMode) {
          if (disableInputs) {
            inner += `
              <div class="upSlot">
                <div class="upSlotIdx">#${i}</div>
                <input class="slotInput" style="margin:0;" value="${esc(name)}" placeholder="비활성" disabled />
              </div>
            `;
          } else {
            inner += `
              <div class="upSlot">
                <div class="upSlotIdx">#${i}</div>
                <input class="slotInput" style="margin:0;" name="u_${p}_${i}" value="${esc(name)}" placeholder="닉네임" />
              </div>
            `;
          }
        } else {
          inner += `
            <div class="upSlot">
              <div class="upSlotIdx">#${i}</div>
              ${
                name
                  ? `<div class="slotStatic" style="margin:0; text-align:left;">${esc(name)}</div>`
                  : `<div class="slotStatic slotEmpty" style="margin:0; text-align:left;">빈 슬롯</div>`
              }
            </div>
          `;
        }
      }
      inner += `</div></div>`;
      return inner;
    };

    html += `<div class="upCard">
      <div class="partyHeader">
        <div class="partyTitle">${p}기수</div>
        ${
          editable && adminMode
            ? isDisabled
              ? `<span class="chip bad">삭제됨</span>`
              : `<button class="partyDeleteBtn" type="button" onclick="deleteParty('${esc(raidKey)}', ${p});">삭제</button>`
            : ""
        }
      </div>

      <div class="upBody">
        ${block("1블록", 1, 4)}
        ${block("2블록", 5, 8)}
        ${block("3블록", 9, 12)}
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// =====================
// Auto Build (Normal raids)
// =====================
function clearLineups(raidKey, dateKst) {
  db.prepare("DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=?").run(raidKey, dateKst);
}
function insertLineupRow({ dateKst, raidKey, partyIndex, role, slotIndex, nickname, applicationId }) {
  db.prepare(
    `
    INSERT INTO raid_lineups(date_kst, raid_key, party_index, role, slot_index, nickname, application_id, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(dateKst, raidKey, partyIndex, role, slotIndex, nickname, applicationId ?? null, nowISO());
}
function nextPartyIndexGenerator(disabledSet) {
  let p = 1;
  return () => {
    while (disabledSet.has(p)) p++;
    return p;
  };
}
function findOrCreateParty(state, disabledSet, minParty) {
  // state: {parties: Map<p, {buffers:[], dealers:[], up:[], nickSet:Set}>}
  let p = minParty;
  while (disabledSet.has(p)) p++;
  while (true) {
    if (!state.parties.has(p)) {
      state.parties.set(p, { buffers: [], dealers: [], up: [], nickSet: new Set() });
      return p;
    }
    return p;
  }
}

function buildNormalLineup({ raidKey, dateKst, disabledSet }) {
  const cfg = getRaidConfig(raidKey);
  const buffersPerParty = cfg.buffersPerParty;
  const dealersPerParty = cfg.dealersPerParty;

  // 신청 목록 (등급순 + 신청순)
  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY ${gradeOrderSqlCase()} ASC, datetime(created_at) ASC
    `
    )
    .all(dateKst, raidKey);

  // 토큰화 (딜/버퍼 각각 슬롯 수만큼)
  const tokens = [];
  for (const a of apps) {
    const base = {
      appId: a.id,
      nickname: String(a.chzzk_nickname || "").trim(),
      grade: a.viewer_grade,
      created_at: a.created_at,
      start_party: clampInt(a.start_party, 1, 99, 1),
    };

    const bCnt = clampInt(a.buffer_count, 0, 999, 0);
    const dCnt = clampInt(a.dealer_count, 0, 999, 0);

    for (let i = 1; i <= bCnt; i++) tokens.push({ ...base, role: "buffer", nth: i });
    for (let i = 1; i <= dCnt; i++) tokens.push({ ...base, role: "dealer", nth: i });
  }

  // 파티 상태
  const state = { parties: new Map() };
  const partyIndices = [];
  const ensureParty = (minParty) => {
    let p = minParty;
    while (disabledSet.has(p)) p++;
    if (!state.parties.has(p)) {
      state.parties.set(p, { buffers: [], dealers: [], up: [], nickSet: new Set() });
      partyIndices.push(p);
    }
    return p;
  };

  function placeToken(t) {
    // 최소 시작 기수부터 탐색
    let p = Math.max(1, t.start_party || 1);
    while (disabledSet.has(p)) p++;

    while (true) {
      const partyIndex = ensureParty(p);
      const party = state.parties.get(partyIndex);

      if (t.role === "buffer") {
        if (party.buffers.length < buffersPerParty) {
          party.buffers.push(t);
          return true;
        }
      } else {
        // dealer
        if (party.dealers.length < dealersPerParty) {
          party.dealers.push(t);
          return true;
        }
      }

      // 다음 기수로
      p++;
      while (disabledSet.has(p)) p++;
      if (p > 999) return false;
    }
  }

  for (const t of tokens) placeToken(t);

  // DB 저장
  clearLineups(raidKey, dateKst);

  partyIndices.sort((a, b) => a - b);
  for (const p of partyIndices) {
    const party = state.parties.get(p);

    // buffers: slot 1..N
    for (let i = 0; i < party.buffers.length && i < buffersPerParty; i++) {
      const t = party.buffers[i];
      const label = party.buffers.filter((x) => x.nickname === t.nickname).length > 1 ? `${t.nickname} (${t.nth})` : t.nickname;
      insertLineupRow({
        dateKst,
        raidKey,
        partyIndex: p,
        role: "buffer",
        slotIndex: i + 1,
        nickname: label,
        applicationId: t.appId,
      });
    }
    // dealers: slot 1..N
    for (let i = 0; i < party.dealers.length && i < dealersPerParty; i++) {
      const t = party.dealers[i];
      const label = party.dealers.filter((x) => x.nickname === t.nickname).length > 1 ? `${t.nickname} (${t.nth})` : t.nickname;
      insertLineupRow({
        dateKst,
        raidKey,
        partyIndex: p,
        role: "dealer",
        slotIndex: i + 1,
        nickname: label,
        applicationId: t.appId,
      });
    }
  }

  return { partiesBuilt: partyIndices.length, totalApps: apps.length, totalTokens: tokens.length };
}

// =====================
// Auto Build (Updoong)
// =====================
function buildUpdoongLineup({ raidKey, dateKst, disabledSet }) {
  // 업둥벞교 전용 규칙:
  // - 한 기수 12명
  // - 한 기수 내 동일 닉네임 1회
  // - up1 / up2는 각각 1회 배치. 둘 다 체크 시 서로 다른 기수로 분산
  // - start_party 존중 (최소 기수)
  // - 등급순 + 신청순으로 배치

  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY ${gradeOrderSqlCase()} ASC, datetime(created_at) ASC
    `
    )
    .all(dateKst, raidKey);

  // 배치 유닛 생성
  const units = [];
  for (const a of apps) {
    const nick = String(a.chzzk_nickname || "").trim();
    if (!nick) continue;

    const base = {
      appId: a.id,
      nickname: nick,
      grade: a.viewer_grade,
      created_at: a.created_at,
      start_party: clampInt(a.start_party, 1, 99, 1),
    };

    if (a.up1) units.push({ ...base, which: "up1" });
    if (a.up2) units.push({ ...base, which: "up2" });
  }

  // 정렬(이미 SQL에서 정렬했지만, 안전하게 2차 정렬 유지)
  units.sort((a, b) => {
    const g = gradeOrder(a.grade) - gradeOrder(b.grade);
    if (g !== 0) return g;
    const ta = Date.parse(a.created_at || "") || 0;
    const tb = Date.parse(b.created_at || "") || 0;
    if (ta !== tb) return ta - tb;
    // up1 먼저
    if (a.which !== b.which) return a.which === "up1" ? -1 : 1;
    return (a.appId || 0) - (b.appId || 0);
  });

  // 파티 상태
  const parties = new Map(); // p -> { slots:Array(12).fill(""), nickSet:Set }
  const partyList = [];
  const appUp1Party = new Map(); // appId -> p

  function ensureParty(p) {
    let x = p;
    while (disabledSet.has(x)) x++;
    if (!parties.has(x)) {
      parties.set(x, { slots: Array(12).fill(""), nickSet: new Set() });
      partyList.push(x);
    }
    return x;
  }
  function findSlotIndex(party) {
    for (let i = 0; i < 12; i++) {
      if (!party.slots[i]) return i; // 0-based
    }
    return -1;
  }

  function placeUnit(u) {
    let p = Math.max(1, u.start_party || 1);
    while (disabledSet.has(p)) p++;

    const mustDifferentParty = u.which === "up2" && appUp1Party.has(u.appId);
    const forbiddenParty = mustDifferentParty ? appUp1Party.get(u.appId) : null;

    while (p <= 999) {
      const pi = ensureParty(p);
      const party = parties.get(pi);

      if (forbiddenParty && pi === forbiddenParty) {
        p++;
        while (disabledSet.has(p)) p++;
        continue;
      }

      // 닉 중복 방지
      if (party.nickSet.has(u.nickname)) {
        p++;
        while (disabledSet.has(p)) p++;
        continue;
      }

      const slot = findSlotIndex(party);
      if (slot === -1) {
        // 만석
        p++;
        while (disabledSet.has(p)) p++;
        continue;
      }

      party.slots[slot] = u.nickname;
      party.nickSet.add(u.nickname);

      // up1이면 기록
      if (u.which === "up1") appUp1Party.set(u.appId, pi);

      return { partyIndex: pi, slotIndex: slot + 1 };
    }

    return null;
  }

  clearLineups(raidKey, dateKst);

  const placed = [];
  for (const u of units) {
    const pos = placeUnit(u);
    if (!pos) continue;
    placed.push({ ...u, ...pos });
    insertLineupRow({
      dateKst,
      raidKey,
      partyIndex: pos.partyIndex,
      role: "up",
      slotIndex: pos.slotIndex,
      nickname: u.nickname,
      applicationId: u.appId,
    });
  }

  partyList.sort((a, b) => a - b);
  return { partiesBuilt: partyList.length, totalApps: apps.length, totalUnits: units.length, placed: placed.length };
}

// =====================
// Lineup view (Viewer)
// =====================
app.get("/lineup", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raid ? raidByKey(raid) : null;

  const raidNav = `
    <div class="row raidNav" style="gap:10px;">
      ${RAID_OPTIONS.map((r) => {
        const active = raid === r.key;
        return `<a class="btn ${active ? "btnAccent" : ""}" href="/lineup?raid=${encodeURIComponent(r.key)}">${esc(
          r.label
        )}</a>`;
      }).join("")}
    </div>
  `;

  if (!raidObj) {
    return res.send(
      layout(
        `
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">공대 편성표</div>
              <div class="muted">레이드를 선택해 주세요.</div>
            </div>
            <div class="row">
              <a class="btn btnGhost" href="/">메인</a>
              <a class="btn btnGhost" href="/check">예약확인</a>
            </div>
          </div>
          <div class="divider"></div>
          ${raidNav}
        </div>
      `,
        "공대 편성표"
      )
    );
  }

  const activeDay = getActiveDay(raid);
  const disabledSet = getDisabledPartySet(raid, activeDay);

  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE date_kst=? AND raid_key=?
      ORDER BY party_index ASC, role ASC, slot_index ASC
    `
    )
    .all(activeDay, raid);

  const partyMap = buildPartyMap(lineups);

  const bodyHtml =
    raid === "updoong"
      ? renderUpParties({ raidKey: raid, partyMap, editable: false, adminMode: false, disabledSet })
      : renderPartyCards({
          raidKey: raid,
          partyMap,
          cfg: getRaidConfig(raid),
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
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b></div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/">메인</a>
            <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        ${raidNav}

        <div class="divider"></div>

        ${bodyHtml}

        <div class="muted" style="margin-top:12px;">
          - 이 편성표는 스트리머(관리자)가 자동 편성 또는 수동 수정으로 관리합니다.<br/>
          - 삭제된 기수는 편성표의 마지막에 표시될 수 있습니다.<br/>
        </div>
      </div>
    `,
      "공대 편성표"
    )
  );
});

// =====================
// Admin Routes
// =====================

// Admin: login
app.get(`${ADMIN_BASE}/login`, (req, res) => {
  res.send(
    layout(
      `
      <div class="box" style="max-width:520px;margin:0 auto;">
        <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자 로그인</div>
        <div class="muted">ADMIN_KEY 쿠키 인증</div>
        <div class="divider"></div>
        <form method="POST" action="${ADMIN_BASE}/login" class="stack">
          <input name="key" placeholder="ADMIN_KEY 입력" required/>
          <button class="btn" type="submit">로그인</button>
          <a class="btn btnGhost" href="/">메인</a>
        </form>
      </div>
    `,
      "관리자 로그인"
    )
  );
});
app.post(`${ADMIN_BASE}/login`, (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.send(
      layout(
        `
        <div class="box" style="max-width:520px;margin:0 auto;">
          <div class="bad"><b>키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="${ADMIN_BASE}/login">다시 시도</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      `,
        "로그인 실패"
      )
    );
  }

  res.cookie("admin_key", ADMIN_KEY, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });

  return res.redirect(`${ADMIN_BASE}`);
});

app.post(`${ADMIN_BASE}/logout`, requireAdmin, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect("/");
});

// Admin: dashboard
app.get(`${ADMIN_BASE}`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || RAID_OPTIONS[0].key);
  const raidObj = raidByKey(raid) || RAID_OPTIONS[0];
  const date = String(req.query.date || getActiveDay(raidObj.key));
  const dateKst = isValidKstDate(date) ? date : getActiveDay(raidObj.key);

  const codeRow = getActiveCodeRow(raidObj.key);
  const codeDate = codeRow?.date_kst || todayKST();
  const codeVal = codeRow?.code || "";

  const apps = db
    .prepare(
      `
      SELECT * FROM applications
      WHERE date_kst=? AND raid_key=?
      ORDER BY ${gradeOrderSqlCase()} ASC, datetime(created_at) ASC
    `
    )
    .all(dateKst, raidObj.key);

  const disabledSet = getDisabledPartySet(raidObj.key, dateKst);

  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE date_kst=? AND raid_key=?
      ORDER BY party_index ASC, role ASC, slot_index ASC
    `
    )
    .all(dateKst, raidObj.key);

  const partyMap = buildPartyMap(lineups);

  const raidNav = `
    <div class="row raidNav" style="gap:10px;">
      ${RAID_OPTIONS.map((r) => {
        const active = raidObj.key === r.key;
        return `<a class="btn ${active ? "btnAccent" : ""}" href="${ADMIN_BASE}?raid=${encodeURIComponent(r.key)}&date=${encodeURIComponent(
          dateKst
        )}">${esc(r.label)}</a>`;
      }).join("")}
    </div>
  `;

  const lineupHtml =
    raidObj.key === "updoong"
      ? renderUpParties({ raidKey: raidObj.key, partyMap, editable: true, adminMode: true, disabledSet })
      : renderPartyCards({
          raidKey: raidObj.key,
          partyMap,
          cfg: getRaidConfig(raidObj.key),
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
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자</div>
            <div class="muted">레이드/날짜 선택 → 인증키 설정 → 자동 편성/수동 수정</div>
          </div>
          <form method="POST" action="${ADMIN_BASE}/logout">
            <button class="btn btnGhost" type="submit">로그아웃</button>
          </form>
        </div>

        <div class="divider"></div>

        ${raidNav}

        <div class="divider"></div>

        <form method="GET" action="${ADMIN_BASE}" class="row" style="align-items:flex-end;">
          <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
          <div style="width:220px;">
            <div class="muted" style="margin-bottom:6px;">작업 날짜(KST)</div>
            <input name="date" value="${esc(dateKst)}" placeholder="YYYY-MM-DD"/>
          </div>
          <button class="btn" type="submit">이 날짜로 보기</button>
          <a class="btn btnGhost" href="/lineup?raid=${encodeURIComponent(raidObj.key)}" target="_blank" rel="noreferrer">뷰어 편성표</a>
          <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raidObj.key)}" target="_blank" rel="noreferrer">뷰어 예약확인</a>
        </form>

        <div class="divider"></div>

        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:16px;margin-bottom:6px;">인증키 설정</div>
            <div class="muted">현재 활성: <b>${esc(codeDate)}</b> / 코드: <b>${esc(codeVal || "(미설정)")}</b></div>
          </div>
        </div>

        <form method="POST" action="${ADMIN_BASE}/set-code" class="row" style="align-items:flex-end;margin-top:10px;">
          <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
          <div style="width:220px;">
            <div class="muted" style="margin-bottom:6px;">진행일</div>
            <input name="date_kst" value="${esc(dateKst)}" placeholder="YYYY-MM-DD" required/>
          </div>
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">인증키</div>
            <input name="code" value="${esc(codeVal)}" placeholder="스트리머가 공지할 키" required/>
          </div>
          <button class="btn" type="submit">저장</button>
        </form>

        <div class="divider"></div>

        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:16px;margin-bottom:6px;">자동 편성</div>
            <div class="muted">
              - 일반: 버퍼/딜러 슬롯 기준으로 채움<br/>
              - 업둥벞교: 12명 단위, <b>한 기수 동일 닉 1회</b>, 2업둥(1)+(2)면 <b>서로 다른 기수</b>
            </div>
          </div>
          <div class="row">
            <form method="POST" action="${ADMIN_BASE}/build" onsubmit="return confirmBuild();">
              <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
              <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
              <button class="btn" type="submit">자동 편성 실행</button>
            </form>

            <form method="POST" action="${ADMIN_BASE}/reset-lineup" onsubmit="return confirmResetLineup();">
              <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
              <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
              <button class="btn btnDanger" type="submit">편성표 초기화</button>
            </form>

            <button class="btn btnGhost" type="button" onclick="enableAllParties('${esc(raidObj.key)}');">삭제 기수 복구</button>
          </div>
        </div>

        <div class="divider"></div>

        <div style="font-weight:900;font-size:16px;margin-bottom:6px;">예약 목록 (${apps.length})</div>
        <table>
          <tr>
            <th>등급</th>
            <th>치지직</th>
            <th>모험단</th>
            ${
              raidObj.key === "updoong"
                ? `<th class="center">2업둥(1)</th><th class="center">2업둥(2)</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th class="center">시작기수</th>
            <th class="center">등록완료</th>
            <th>암종호 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps
                  .map((a) => {
                    const checked = a.confirmed === 1 ? "checked" : "";
                    return `
                      <tr>
                        <td>${esc(gradeLabel(a.viewer_grade))}</td>
                        <td>${esc(a.chzzk_nickname)}</td>
                        <td>${esc(a.adventure_name)}</td>
                        ${
                          raidObj.key === "updoong"
                            ? `<td class="center">${a.up1 ? "✔" : "-"}</td><td class="center">${a.up2 ? "✔" : "-"}</td>`
                            : `<td class="center">${esc(a.dealer_count)}</td><td class="center">${esc(a.buffer_count)}</td>`
                        }
                        <td class="center">${esc(a.start_party)}</td>
                        <td class="center">
                          <form method="POST" action="${ADMIN_BASE}/toggle-confirm" style="margin:0;">
                            <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
                            <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
                            <input type="hidden" name="app_id" value="${esc(a.id)}"/>
                            <label class="adminConfirm">
                              <input type="checkbox" onchange="this.form.submit()" ${checked}/>
                              <span>${a.confirmed === 1 ? "완료" : "대기"}</span>
                            </label>
                          </form>
                        </td>
                        <td>
                          <form method="POST" action="${ADMIN_BASE}/set-comment" class="row" style="margin:0; gap:8px;">
                            <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
                            <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
                            <input type="hidden" name="app_id" value="${esc(a.id)}"/>
                            <input class="commentBox" name="comment" value="${esc(a.comment || "")}" placeholder="암종호 코멘트"/>
                            <button class="btn btnGhost" type="submit">저장</button>
                          </form>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="7" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="divider"></div>

        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:16px;margin-bottom:6px;">공대 편성표 (수동 수정 가능)</div>
            <div class="muted">
              - 삭제 버튼은 해당 기수를 비활성 처리합니다.<br/>
              - 수동 수정 후 “저장”을 눌러야 반영됩니다.
            </div>
          </div>
          <form method="POST" action="${ADMIN_BASE}/save-lineup">
            <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
            <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
            <button class="btn" type="submit">편성표 저장</button>
          </form>
        </div>

        <div class="divider"></div>

        <form method="POST" action="${ADMIN_BASE}/save-lineup" id="lineupForm">
          <input type="hidden" name="raid" value="${esc(raidObj.key)}"/>
          <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
          ${lineupHtml}
          <div class="divider"></div>
          <div class="row">
            <button class="btn" type="submit">편성표 저장</button>
          </div>
        </form>

        <!-- 삭제 기수 -->
        <form method="POST" action="${ADMIN_BASE}/delete-party" id="deletePartyForm" style="display:none;">
          <input type="hidden" name="raid" id="deleteRaidInput"/>
          <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
          <input type="hidden" name="party_index" id="deletePartyIndexInput"/>
        </form>

        <!-- 삭제 기수 복구 -->
        <form method="POST" action="${ADMIN_BASE}/enable-all-parties" id="enableAllForm" style="display:none;">
          <input type="hidden" name="raid" id="enableAllRaidInput"/>
          <input type="hidden" name="date_kst" value="${esc(dateKst)}"/>
        </form>

        <div class="divider"></div>
        <div class="muted">
          삭제(비활성) 기수: ${
            Array.from(disabledSet).sort((a, b) => a - b).map((x) => `<span class="chip">${x}기수</span>`).join(" ") ||
            `<span class="muted">없음</span>`
          }
        </div>
      </div>
    `,
      "관리자"
    )
  );
});

// Admin: set code
app.post(`${ADMIN_BASE}/set-code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : todayKST();
  if (!code) return res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);

  upsertDayCode(raid, dateKst, code);
  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: toggle confirm
app.post(`${ADMIN_BASE}/toggle-confirm`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const appId = Number(req.body.app_id);

  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  const row = db.prepare("SELECT confirmed FROM applications WHERE id=?").get(appId);
  const nextVal = row && row.confirmed === 1 ? 0 : 1;
  db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(nextVal, appId);

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: set comment
app.post(`${ADMIN_BASE}/set-comment`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const appId = Number(req.body.app_id);
  const comment = String(req.body.comment || "");

  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, appId);

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: build auto lineup (normal + updoong)
app.post(`${ADMIN_BASE}/build`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");

  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  const disabledSet = getDisabledPartySet(raid, dateKst);

  try {
    if (raid === "updoong") {
      buildUpdoongLineup({ raidKey: raid, dateKst, disabledSet });
    } else {
      buildNormalLineup({ raidKey: raid, dateKst, disabledSet });
    }
  } catch (e) {
    return res.status(500).send(
      layout(
        `
        <div class="box">
          <div class="bad"><b>자동 편성 중 오류</b></div>
          <div class="muted" style="white-space:pre-wrap;margin-top:8px;">${esc(String(e?.stack || e))}</div>
          <div class="divider"></div>
          <a class="btn" href="${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}">돌아가기</a>
        </div>
      `,
        "오류"
      )
    );
  }

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: reset lineup
app.post(`${ADMIN_BASE}/reset-lineup`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  clearLineups(raid, dateKst);
  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: delete party (disable + clear lineup for that party)
app.post(`${ADMIN_BASE}/delete-party`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const partyIndex = clampInt(req.body.party_index, 1, 999, 1);

  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);

  // 비활성 등록 + 해당 기수 라인업 삭제
  disableParty(raid, dateKst, partyIndex);
  db.prepare("DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=? AND party_index=?").run(raid, dateKst, partyIndex);

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: enable all parties
app.post(`${ADMIN_BASE}/enable-all-parties`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  enableAllParties(raid, dateKst);

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// Admin: save lineup (manual inputs -> raid_lineups rebuild)
app.post(`${ADMIN_BASE}/save-lineup`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const date_kst = String(req.body.date_kst || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}`);

  const dateKst = isValidKstDate(date_kst) ? date_kst : getActiveDay(raid);
  const disabledSet = getDisabledPartySet(raid, dateKst);

  // 입력에서 파티/슬롯 추출
  // 일반: b_{party}_{slot}, d_{party}_{slot}
  // 업둥: u_{party}_{slot}
  const entries = [];

  for (const [k, v] of Object.entries(req.body || {})) {
    if (!k || typeof k !== "string") continue;

    if (raid === "updoong") {
      const m = /^u_(\d{1,3})_(\d{1,2})$/.exec(k);
      if (!m) continue;
      const party = clampInt(m[1], 1, 999, 1);
      const slot = clampInt(m[2], 1, 12, 1);
      if (disabledSet.has(party)) continue;
      const name = String(v || "").trim();
      if (!name) continue;
      entries.push({ party, role: "up", slot, name });
    } else {
      let m = /^b_(\d{1,3})_(\d{1,2})$/.exec(k);
      if (m) {
        const party = clampInt(m[1], 1, 999, 1);
        const slot = clampInt(m[2], 1, 99, 1);
        if (disabledSet.has(party)) continue;
        const name = String(v || "").trim();
        if (name) entries.push({ party, role: "buffer", slot, name });
        continue;
      }
      m = /^d_(\d{1,3})_(\d{1,2})$/.exec(k);
      if (m) {
        const party = clampInt(m[1], 1, 999, 1);
        const slot = clampInt(m[2], 1, 99, 1);
        if (disabledSet.has(party)) continue;
        const name = String(v || "").trim();
        if (name) entries.push({ party, role: "dealer", slot, name });
        continue;
      }
    }
  }

  // 저장: 해당 날짜/레이드 라인업 전체 재작성(비활성 기수는 입력 자체가 막히므로 자동 제외)
  clearLineups(raid, dateKst);

  entries.sort((a, b) => a.party - b.party || a.role.localeCompare(b.role) || a.slot - b.slot);

  for (const e of entries) {
    insertLineupRow({
      dateKst,
      raidKey: raid,
      partyIndex: e.party,
      role: e.role,
      slotIndex: e.slot,
      nickname: e.name,
      applicationId: null,
    });
  }

  res.redirect(`${ADMIN_BASE}?raid=${encodeURIComponent(raid)}&date=${encodeURIComponent(dateKst)}`);
});

// =====================
// Server
// =====================
app.listen(PORT, () => {
  console.log(`[OK] Server listening on :${PORT}`);
  console.log(`[ADMIN] ${ADMIN_BASE}`);
});
