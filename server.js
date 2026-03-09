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
app.use(express.static("public"));
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

// =====================
// Options
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에", img: "/images/dirige.png" },
  { key: "dirige-hard", label: "디레지에-악연", img: "/images/dirige_hard.png" },
  { key: "inhwagongjeon", label: "이내황혼전", img: "/images/inhwagongjeon.png" },
  { key: "nabel-hard", label: "나벨 - 하드", img: "/images/nabel_hard.png" },
  { key: "updoong", label: "업둥교환", img: "/images/updoong.png" },
];

const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" },
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "log", label: "통나무" },
  { key: "normal", label: "일반 치즈" },
];

const GRADE_SORT = {
  streamer: 0,
  burning: 1,
  pink: 2,
  yellow: 3,
  log: 3,
  normal: 4,
};

// =====================
// DB init
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

  up2 INTEGER NOT NULL DEFAULT 0,
  up22 INTEGER NOT NULL DEFAULT 0,

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
  role TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS up_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  application_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(date_kst, raid_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_up_lineups_key
ON up_lineups(date_kst, raid_key, slot_index);
`);

function ensureColumn(table, colName, colDDL) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => String(c.name) === colName);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDDL}`);
}

ensureColumn("applications", "request_note", "request_note TEXT NOT NULL DEFAULT ''");
ensureColumn("applications", "is_streamer", "is_streamer INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "start_party", "start_party INTEGER NOT NULL DEFAULT 1");
ensureColumn("applications", "up2", "up2 INTEGER NOT NULL DEFAULT 0");
ensureColumn("applications", "up22", "up22 INTEGER NOT NULL DEFAULT 0");

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

function raidImage(key) {
  return raidByKey(key)?.img || "/images/placeholder.png";
}

function gradeLabel(key) {
  if (key === "streamer") return "스트리머";
  return GRADE_OPTIONS.find((g) => g.key === key)?.label || key;
}

function isValidKstDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function getActiveDay(raidKey) {
  const row = db.prepare("SELECT date_kst FROM day_codes WHERE raid_key=?").get(raidKey);
  return row?.date_kst || todayKST();
}

function getActiveCodeRow(raidKey) {
  return db.prepare("SELECT * FROM day_codes WHERE raid_key=?").get(raidKey) || null;
}

function getDisabledPartySet(raidKey, dateKst) {
  const rows = db
    .prepare("SELECT party_index FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?")
    .all(raidKey, dateKst);
  return new Set(rows.map((r) => r.party_index));
}

function getRaidConfig(raidKey) {
  if (raidKey === "inhwagongjeon") {
    return { buffersPerParty: 2, dealersPerParty: 6 };
  }
  return { buffersPerParty: 3, dealersPerParty: 9 };
}

// =====================
// Layout / Styles
// =====================
function buildSidebar(activeRaid = "", isAdmin = false) {
  const thumbImg = activeRaid ? raidImage(activeRaid) : "/images/streamer_profile.png";

  if (!isAdmin) {
    return `
      <aside class="sidebar">
        <div class="thumbnail">
          <span class="on-air">● On Air</span>
          <img src="${esc(thumbImg)}" alt="썸네일"
               onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>이미지 준비중</div>';">
        </div>
        <a href="/" class="side-btn">메인 로비</a>
        <a href="/lineup" class="side-btn">공대 편성표</a>
        <a href="/check" class="side-btn">예약 확인</a>
      </aside>
    `;
  }

  const isAdminLobby = !activeRaid || activeRaid === "admin_lobby";

  if (isAdminLobby) {
    return `
      <aside class="sidebar">
        <div class="thumbnail">
          <img src="/images/streamer_profile.png" alt="관리자 썸네일"
               onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>관리자 패널</div>';">
        </div>

        <button type="button" class="side-btn" onclick="openModal('modal-auth')">인증키 설정</button>
        <button type="button" class="side-btn" onclick="openModal('modal-streamer')">스트리머 예약</button>
        <a href="${esc(ADMIN_BASE)}/raid" class="side-btn">레이드 선택</a>
        <a href="${esc(ADMIN_BASE)}/logout" class="side-btn side-btn-danger">로그아웃</a>
      </aside>
    `;
  }

  return `
    <aside class="sidebar">
      <div class="thumbnail">
        <img src="${esc(thumbImg)}" alt="썸네일"
             onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>관리자 패널</div>';">
      </div>
      <a href="${esc(ADMIN_BASE)}/raid" class="side-btn">관리자 로비</a>
      <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(activeRaid)}&sort=grade" class="side-btn">신청 목록</a>
      <a href="${esc(ADMIN_BASE)}/lineup?raid=${encodeURIComponent(activeRaid)}" class="side-btn">편성표 관리</a>
      <a href="${esc(ADMIN_BASE)}/logout" class="side-btn side-btn-danger">로그아웃</a>
    </aside>
  `;
}

function layout(body, title = "레이드 예약 사이트", options = {}) {
  const isAdmin = !!options.isAdmin;
  const activeRaid = String(options.activeRaid || "");
  const sidebarContent = buildSidebar(activeRaid, isAdmin);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');

    :root{
      --bg-dark:#12132b;
      --bg-panel:#1b1c3b;
      --bg-box:#26284d;
      --input-bg:#353863;
      --border-glow:#3f4280;
      --border-light:rgba(148,163,255,.2);
      --text-main:#f8fafc;
      --text-muted:#9ca3af;
      --accent:#6b72ff;
      --accent-2:#8b5cf6;
      --danger:#ef4444;
      --success:#10b981;
      --warning:#f59e0b;
      --chip-bg:rgba(107,114,255,.12);
    }

    *{ box-sizing:border-box; font-family:'Pretendard', sans-serif; }
    html, body { margin:0; padding:0; }
    body{
      background:
        radial-gradient(circle at top left, rgba(107,114,255,.15), transparent 35%),
        radial-gradient(circle at top right, rgba(139,92,246,.14), transparent 30%),
        linear-gradient(180deg, #0f1024 0%, #13142b 100%);
      color:var(--text-main);
      min-height:100vh;
      padding:32px 18px;
    }
    a{ text-decoration:none; color:inherit; }
    img{ display:block; }

    .app-container{
      width:100%;
      max-width:1320px;
      margin:0 auto;
      display:flex;
      flex-direction:column;
      gap:22px;
    }

    .header{
      border:1px solid var(--border-glow);
      border-radius:16px;
      padding:22px 28px;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:16px;
      background:linear-gradient(180deg, rgba(27,28,59,.95), rgba(22,23,49,.95));
    }
    .header h1{
      margin:0;
      font-size:30px;
      font-weight:700;
      letter-spacing:.02em;
    }
    .header p{
      margin:6px 0 0;
      font-size:14px;
      color:var(--text-muted);
    }
    .made-by{
      border:1px solid var(--border-glow);
      padding:9px 14px;
      border-radius:10px;
      font-size:13px;
      color:var(--text-muted);
      background:rgba(38,40,77,.75);
      white-space:nowrap;
    }

    .content-wrapper{
      display:flex;
      gap:22px;
      align-items:flex-start;
    }

    .sidebar{
      width:260px;
      flex-shrink:0;
      border:1px solid var(--border-glow);
      border-radius:16px;
      padding:18px;
      background:linear-gradient(180deg, rgba(27,28,59,.96), rgba(24,25,52,.96));
      display:flex;
      flex-direction:column;
      gap:12px;
    }

    .thumbnail{
      background:var(--bg-box);
      border-radius:12px;
      height:180px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      color:var(--text-muted);
      font-size:14px;
      position:relative;
      overflow:hidden;
      border:1px solid var(--border-glow);
    }
    .thumbnail img{
      width:100%;
      height:100%;
      object-fit:cover;
    }
    .thumb-fallback{
      padding:18px;
      text-align:center;
      line-height:1.5;
    }
    .on-air{
      position:absolute;
      top:12px;
      left:12px;
      background:rgba(0,0,0,.55);
      color:#ff6b6b;
      padding:4px 9px;
      border-radius:999px;
      font-size:11px;
      font-weight:700;
      z-index:3;
    }
    .admin-badge{ color:#fca5a5; }

    .side-btn{
      display:block;
      width:100%;
      background:var(--bg-box);
      padding:13px 14px;
      border-radius:10px;
      text-align:center;
      font-size:14px;
      font-weight:600;
      transition:.15s ease;
      border:1px solid transparent;
      color:var(--text-main);
      box-shadow:none !important;
      cursor:pointer;
    }
    .side-btn:hover{
      background:var(--border-glow);
      border-color:var(--accent);
      transform:translateY(-1px);
    }
    .side-btn-danger{
      background:rgba(239,68,68,.15);
      border-color:rgba(239,68,68,.35);
      color:#fecaca;
    }
    .side-btn-danger:hover{
      background:rgba(239,68,68,.24);
      border-color:rgba(239,68,68,.55);
    }

    .main-area{
      flex:1;
      border:1px solid var(--border-glow);
      border-radius:16px;
      padding:24px;
      background:linear-gradient(180deg, rgba(27,28,59,.96), rgba(24,25,52,.96));
      min-height:620px;
      overflow:hidden;
    }

    .box{
      background:rgba(38,40,77,.72);
      border-radius:12px;
      padding:18px 20px;
      border:1px solid rgba(148,163,255,.15);
      box-shadow:none !important;
      filter:none !important;
    }

    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .sp{ justify-content:space-between; }

    .muted{ color:var(--text-muted); font-size:13px; line-height:1.65; }
    .ok{ color:#4ade80; font-weight:700; }
    .wait{ color:#fcd34d; font-weight:700; }
    .bad{ color:#fca5a5; font-weight:700; }

    .divider{
      height:1px;
      background:linear-gradient(to right, transparent, rgba(148,163,255,.35), transparent);
      margin:18px 0;
    }

    .btn{
      border:1px solid rgba(148,163,255,.38);
      background:var(--bg-box);
      color:var(--text-main);
      padding:10px 15px;
      border-radius:10px;
      cursor:pointer;
      font-weight:600;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      font-size:13px;
      transition:.15s ease;
      box-shadow:none !important;
      filter:none !important;
    }
    .btn:hover{
      background:var(--border-glow);
      border-color:var(--accent);
      transform:translateY(-1px);
    }
    .btnGhost{
      background:rgba(255,255,255,.02);
    }
    .btnDanger{
      background:rgba(239,68,68,.18);
      border-color:rgba(239,68,68,.32);
      color:#fecaca;
    }
    .btnDanger:hover{
      background:rgba(239,68,68,.28);
      border-color:rgba(239,68,68,.52);
    }
    .btnPrimary{
      background:linear-gradient(135deg, #4f46e5, #6b72ff);
      border-color:#6b72ff;
      color:white;
    }
    .btnPrimary:hover{
      background:linear-gradient(135deg, #4338ca, #5b63ff);
      border-color:#7c83ff;
    }

    .chip{
      display:inline-flex;
      gap:6px;
      align-items:center;
      padding:5px 10px;
      border-radius:999px;
      background:var(--chip-bg);
      border:1px solid rgba(148,163,255,.25);
      color:#c7d2fe;
      font-size:12px;
      text-shadow:none !important;
    }

    input, textarea, select{
      width:100%;
      min-width:0;
      background:var(--input-bg);
      border:1px solid transparent;
      color:var(--text-main);
      padding:11px 14px;
      font-size:14px;
      border-radius:8px;
      outline:none;
      transition:.15s ease;
      box-shadow:none !important;
      filter:none !important;
    }
    input::placeholder, textarea::placeholder{ color:#b4bbd2; }
    input:focus, textarea:focus, select:focus{
      border-color:var(--accent);
      background:#3d4173;
    }
    textarea{
      resize:vertical;
      min-height:42px;
    }
    select option{
      color:#111827;
      background:white;
    }

    .formGrid{
      display:grid;
      grid-template-columns:170px minmax(160px,1fr) minmax(200px,1.2fr) 150px 150px;
      gap:12px;
      align-items:end;
    }
    .field label{
      display:block;
      font-size:12px;
      color:#cbd5e1;
      margin:0 0 6px 2px;
    }
    .fieldFull{ grid-column:1 / -1; }

    table{
      width:100%;
      border-collapse:collapse;
      overflow:hidden;
      border-radius:12px;
      border:1px solid rgba(148,163,255,.2);
      background:rgba(17,24,39,.45);
      box-shadow:none !important;
      filter:none !important;
    }
    th,td{
      border-bottom:1px solid var(--border-light);
      padding:10px 10px;
      text-align:left;
      font-size:13px;
      vertical-align:middle;
    }
    th{
      background:rgba(2,6,23,.58);
      font-weight:700;
      font-size:12px;
      letter-spacing:.03em;
      color:#c7d2fe;
      text-transform:uppercase;
    }
    tr:last-child td{ border-bottom:0; }
    .center{ text-align:center; }

    .commentBox{ width:260px; max-width:100%; }
    .raidNav{ margin-bottom:4px; }
    .raidNav .btn{ font-size:12px; padding-inline:12px; }

    .bigCheck{ display:flex; align-items:center; gap:6px; cursor:pointer; }
    .bigCheck input[type="checkbox"]{ width:22px; height:22px; }

    .adminConfirm{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:5px 10px;
      border-radius:999px;
      background:rgba(2,6,23,.52);
      border:1px solid rgba(148,163,255,.32);
      cursor:pointer;
      font-size:12px;
      user-select:none;
    }
    .adminConfirm:hover{ background:#2b305d; }
    .adminConfirm input[type="checkbox"]{
      width:20px; height:20px; margin:0; cursor:pointer;
    }

    .raid-grid{
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(210px,1fr));
      gap:16px;
    }
    .raid-card{
      position:relative;
      border-radius:14px;
      overflow:hidden;
      min-height:210px;
      border:1px solid rgba(148,163,255,.2);
      transition:.18s ease;
      display:block;
      background:var(--bg-box);
    }
    .raid-card:hover{
      border-color:var(--accent);
      transform:translateY(-3px);
    }
    .raid-card img{
      width:100%;
      height:100%;
      min-height:210px;
      object-fit:cover;
      opacity:.78;
      transition:.18s ease;
    }
    .raid-card:hover img{
      opacity:1;
      transform:scale(1.03);
    }
    .raid-card .label{
      position:absolute;
      bottom:0;
      width:100%;
      text-align:center;
      padding:18px 12px 14px;
      background:linear-gradient(transparent, rgba(0,0,0,.86));
      font-weight:700;
      font-size:15px;
    }

    .partyGrid{
      display:flex;
      flex-wrap:wrap;
      gap:14px;
    }
    .partyCard{
      position:relative;
      width:120px;
      flex:0 0 120px;
      max-width:120px;
      background:rgba(2,6,23,.56);
      border-radius:14px;
      border:1px solid rgba(148,163,255,.22);
      padding:12px 12px 10px;
      box-shadow:none !important;
      filter:none !important;
    }
    .partyHeader{
      display:flex;
      align-items:center;
      justify-content:space-between;
      width:100%;
      margin-bottom:6px;
      gap:6px;
    }
    .partyTitle{
      font-size:18px;
      font-weight:800;
      line-height:1.1;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      pointer-events:none;
    }
    .partyHeader .partyDeleteBtn{
      flex-shrink:0;
      font-size:11px;
      padding:4px 7px;
      border-radius:999px;
      background:rgba(239,68,68,.18);
      border:1px solid rgba(255,120,120,.4);
      color:#fee2e2;
      cursor:pointer;
      white-space:nowrap;
      box-shadow:none !important;
    }
    .partyHeader .partyDeleteBtn:hover{ background:rgba(239,68,68,.28); }
    .partyBody{ display:flex; flex-direction:column; gap:10px; }
    .slotSection{
      background:rgba(2,6,23,.45);
      border-radius:10px;
      border:1px solid rgba(15,23,42,.9);
      padding:6px 8px 8px;
    }
    .slotSectionTitle{
      font-size:12px;
      color:#bfdbfe;
      margin:0 0 6px 2px;
    }
    .slotDivider{
      height:1px;
      margin:2px 2px 0;
      background:linear-gradient(to right,transparent,rgba(148,163,255,.5),transparent);
    }
    .slotInput, .slotStatic{
      width:100%;
      padding:7px 10px;
      margin-bottom:6px;
      font-size:13px;
      border-radius:999px;
      background:#141833;
      color:var(--text-main);
      box-shadow:none !important;
      filter:none !important;
    }
    .slotInput{
      border:1px solid rgba(71,85,105,.95);
    }
    .slotInput:focus{
      border-color:var(--accent);
      outline:none;
      box-shadow:none !important;
    }
    .slotInput[disabled]{ opacity:.45; cursor:not-allowed; }
    .slotStatic{
      border:1px solid rgba(59,130,246,.55);
      text-align:center;
    }
    .slotStatic.slotEmpty{ opacity:.45; }

    .upPartyGrid{
      display:flex;
      flex-wrap:wrap;
      gap:14px;
      align-items:flex-start;
    }
    .upPartyCard{
      position:relative;
      width:120px;
      flex:0 0 120px;
      max-width:120px;
      background:rgba(2,6,23,.56);
      border-radius:18px;
      border:1px solid rgba(148,163,255,.22);
      padding:12px;
      box-shadow:none !important;
      filter:none !important;
    }
    .upPartyCard.disabled{
      opacity:.5;
      filter:saturate(.65);
    }
    .upPartyHeader{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      margin-bottom:10px;
      gap:8px;
    }
    .upPartyTitle{
      font-size:20px;
      font-weight:900;
      letter-spacing:.02em;
      line-height:1.05;
      word-break:keep-all;
    }
    .upPartyDeleteBtn{
      flex-shrink:0;
      font-size:11px;
      padding:6px 9px;
      border-radius:10px;
      background:rgba(239,68,68,.2);
      border:1px solid rgba(255,120,120,.35);
      color:#fff;
      cursor:pointer;
      white-space:nowrap;
      box-shadow:none !important;
    }
    .upPartyDeleteBtn:hover{ background:rgba(239,68,68,.3); }
    .upPartySlots{
      display:flex;
      flex-direction:column;
      gap:12px;
      padding:0;
      border-radius:12px;
      background:transparent;
      border:0;
    }
    .upGroupBox{
      display:flex;
      flex-direction:column;
      gap:8px;
      padding:12px;
      border-radius:16px;
      border:1px solid rgba(148,163,255,.14);
    }
    .upPartyCard .slotInput,
    .upPartyCard .slotStatic{
      width:100%;
      padding:7px 6px;
      margin:0;
      font-size:13px;
      border-radius:999px;
      background:#141833;
      color:var(--text-main);
      box-shadow:none !important;
    }
    .upPartyCard .slotInput{ border:1px solid rgba(71,85,105,.95); }
    .upPartyCard .slotInput:focus{
      border-color:var(--accent);
      outline:none;
    }
    .upPartyCard .slotStatic{
      border:1px solid rgba(59,130,246,.55);
      text-align:center;
    }
    .upPartyCard .slotStatic.slotEmpty{ opacity:.45; }
    .upPartySlots .upGroupBox:nth-of-type(1){
      background:rgba(255,99,99,.12);
      border-color:rgba(255,99,99,.35);
    }
    .upPartySlots .upGroupBox:nth-of-type(2){
      background:rgba(255,215,100,.14);
      border-color:rgba(255,215,100,.4);
    }
    .upPartySlots .upGroupBox:nth-of-type(3){
      background:rgba(100,220,140,.14);
      border-color:rgba(100,220,140,.4);
    }

    .modal-overlay{
      display:none;
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.58);
      z-index:2000;
      align-items:center;
      justify-content:center;
      backdrop-filter:blur(4px);
    }
    .modal-overlay.active{
      display:flex;
    }
    .modal-content{
      width:min(560px, calc(100vw - 32px));
      background:linear-gradient(180deg, rgba(27,28,59,.98), rgba(24,25,52,.98));
      border:1px solid var(--accent);
      border-radius:14px;
      padding:22px 20px 18px;
      position:relative;
    }
    .modal-header{
      margin-bottom:16px;
    }
    .modal-header h3{
      margin:0 0 6px;
      font-size:18px;
      font-weight:700;
    }
    .modal-header p{
      margin:0;
      font-size:12px;
      color:var(--text-muted);
      line-height:1.5;
    }
    .modal-close{
      position:absolute;
      top:12px;
      right:12px;
      width:32px;
      height:32px;
      border-radius:8px;
      border:1px solid rgba(148,163,255,.28);
      background:rgba(255,255,255,.03);
      color:var(--text-main);
      cursor:pointer;
      font-size:16px;
      font-weight:700;
    }
    .modal-close:hover{
      background:var(--border-glow);
      border-color:var(--accent);
    }
    .modal-form{
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .modal-row{
      display:flex;
      gap:12px;
      align-items:flex-end;
      flex-wrap:wrap;
    }
    .modal-row > div{
      flex:1;
      min-width:140px;
    }
    /* =========================
   Viewer Reserve Screen
========================= */
.reserve-screen{
  display:flex;
  gap:22px;
  align-items:stretch;
}

.reserve-left{
  width:220px;
  flex-shrink:0;
  border:1px solid var(--border-glow);
  border-radius:14px;
  padding:14px;
  background:rgba(38,40,77,.55);
  display:flex;
  flex-direction:column;
  gap:14px;
}

.reserve-left-thumb{
  position:relative;
  width:100%;
  aspect-ratio:1 / 1;
  border-radius:12px;
  overflow:hidden;
  background:#3c3f74;
  border:1px solid rgba(148,163,255,.16);
  display:flex;
  align-items:center;
  justify-content:center;
  color:#e5e7eb;
  text-align:center;
  font-size:14px;
  line-height:1.5;
}
.reserve-left-thumb img{
  width:100%;
  height:100%;
  object-fit:cover;
}
.reserve-left-menu{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.reserve-left-menu .nav-btn{
  width:100%;
  min-height:44px;
  border:1px solid rgba(148,163,255,.16);
  background:#46497d;
  border-radius:10px;
  color:#f8fafc;
  font-size:14px;
  font-weight:600;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  transition:.15s ease;
}
.reserve-left-menu .nav-btn:hover{
  background:#555a93;
  border-color:var(--accent);
}

.reserve-right{
  flex:1;
  border:1px solid var(--border-glow);
  border-radius:14px;
  padding:18px 22px;
  background:rgba(38,40,77,.42);
  display:flex;
  flex-direction:column;
  gap:18px;
}

.reserve-top-auth{
  margin-left:auto;
  width:min(430px, 100%);
  background:#4a4f86;
  border-radius:12px;
  padding:10px 14px;
  display:flex;
  align-items:center;
  gap:12px;
}
.reserve-top-auth-label{
  min-width:150px;
  display:flex;
  align-items:center;
  gap:8px;
  font-size:14px;
  font-weight:700;
  color:#fff;
}
.reserve-top-auth input{
  background:#8e90aa;
  color:#fff;
}
.reserve-top-auth input::placeholder{
  color:#d1d5db;
}

.reserve-main{
  display:flex;
  gap:26px;
  align-items:flex-start;
}

.reserve-hero-card{
  width:172px;
  flex-shrink:0;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.reserve-hero-image{
  width:100%;
  aspect-ratio:1 / 1;
  border-radius:12px;
  overflow:hidden;
  background:#2d315f;
  border:1px solid rgba(148,163,255,.14);
  position:relative;
}
.reserve-hero-image img{
  width:100%;
  height:100%;
  object-fit:cover;
}
.reserve-hero-title{
  position:absolute;
  left:0;
  right:0;
  bottom:0;
  padding:12px 10px 10px;
  background:linear-gradient(transparent, rgba(0,0,0,.85));
  text-align:center;
  font-weight:800;
  font-size:15px;
}

.reserve-form-wrap{
  flex:1;
  display:flex;
  flex-direction:column;
  gap:16px;
}

.reserve-info-card{
  background:#4a4f86;
  border-radius:12px;
  padding:14px 16px;
}

.reserve-field-row{
  display:flex;
  align-items:center;
  gap:14px;
}
.reserve-field-row + .reserve-field-row{
  margin-top:12px;
}
.reserve-field-label{
  width:150px;
  flex-shrink:0;
  display:flex;
  align-items:center;
  gap:10px;
  color:#fff;
  font-weight:700;
  font-size:14px;
}
.reserve-field-input{
  flex:1;
}

.reserve-inline-row{
  display:flex;
  align-items:center;
  gap:18px;
  flex-wrap:wrap;
}
.reserve-inline-group{
  display:flex;
  align-items:center;
  gap:8px;
  color:#fff;
  font-size:14px;
  white-space:nowrap;
}
.reserve-inline-group input{
  width:38px;
  min-width:38px;
  height:24px;
  padding:0 6px;
  text-align:center;
  background:#8e90aa;
}

.reserve-inline-group.reserve-start-group input{
  width:78px;
  min-width:78px;
}
.reserve-submit-wrap{
  margin-top:4px;
}
.reserve-submit-btn{
  min-width:172px;
  min-height:46px;
  background:#4a4f86;
  border:1px solid rgba(148,163,255,.18);
  border-radius:10px;
  color:#fff;
  font-size:15px;
  font-weight:700;
}
.reserve-submit-btn:hover{
  background:#5b61a0;
  border-color:var(--accent);
}

.reserve-select,
.reserve-text{
  background:#8e90aa !important;
  color:#fff !important;
}
.reserve-select::placeholder,
.reserve-text::placeholder{
  color:#e5e7eb !important;
}

@media (max-width: 980px){
  .reserve-screen{
    flex-direction:column;
  }
  .reserve-left{
    width:100%;
  }
  .reserve-main{
    flex-direction:column;
  }
  .reserve-hero-card{
    width:100%;
    max-width:240px;
  }
  .reserve-top-auth{
    margin-left:0;
  }
  .reserve-field-row{
    flex-direction:column;
    align-items:flex-start;
  }
  .reserve-field-label{
    width:auto;
  }
  .reserve-field-input{
    width:100%;
  }
}
    @media (max-width:1120px){
      .content-wrapper{ flex-direction:column; }
      .sidebar{ width:100%; }
      .thumbnail{ height:160px; }
    }
    @media (max-width:980px){
      .formGrid{ grid-template-columns:1fr 1fr; }
      .fieldFull{ grid-column:1 / -1; }
    }
    @media (max-width:640px){
      body{ padding:18px 12px; }
      .header{
        padding:18px 18px;
        flex-direction:column;
        align-items:flex-start;
      }
      .header h1{ font-size:24px; }
      .main-area{ padding:18px; min-height:auto; }
      .raid-grid{ grid-template-columns:1fr; }
      .commentBox{ width:100%; }
    }
    @media (max-width:520px){
      .formGrid{ grid-template-columns:1fr; }
      .upPartyCard{ width:100%; flex:1 1 auto; max-width:none; }
      .modal-content{ width:calc(100vw - 20px); }
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
    function deleteUpParty(partyIndex){
      const msg = partyIndex + "세트를 삭제(비활성)하시겠습니까?\\n(업둥교환는 12명=1세트이며, 삭제된 세트는 자동배치/수동저장 모두 건너뜁니다.)";
      if(!confirm(msg)) return;
      const f = document.getElementById("deleteUpPartyForm");
      if(!f) return;
      const partyInput = document.getElementById("deleteUpPartyIndexInput");
      if(!partyInput) return;
      partyInput.value = String(partyIndex);
      f.submit();
    }
    function openModal(id){
      const el = document.getElementById(id);
      if(el) el.classList.add("active");
    }
    function closeModal(id){
      const el = document.getElementById(id);
      if(el) el.classList.remove("active");
    }
    window.addEventListener("click", function(e){
      const overlays = document.querySelectorAll(".modal-overlay.active");
      overlays.forEach((ov) => {
        if(e.target === ov) ov.classList.remove("active");
      });
    });
  </script>
</head>
<body>
  <div class="app-container">
    <header class="header">
      <div>
        <h1>DevonVail RAID</h1>
        <p>레이드 예약 사이트 ${isAdmin ? '<span style="color:#fca5a5;font-weight:700;">[관리자 모드]</span>' : ''}</p>
      </div>
      <div class="made-by">Made by 토엔</div>
    </header>

    <div class="content-wrapper">
      ${sidebarContent}
      <main class="main-area">
        ${body}
      </main>
    </div>
  </div>
</body>
</html>`;
}

// =====================
// Auth middleware
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
          <div class="muted">Render Environment Variables에 ADMIN_KEY를 추가하세요.</div>
        </div>
      `,
        "오류",
        { isAdmin: true }
      )
    );
  }
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// Viewer: main
// =====================
app.get("/", (req, res) => {
  const cardsHtml = RAID_OPTIONS.map(
    (r) => `
      <a class="raid-card" href="/verify?raid=${encodeURIComponent(r.key)}">
        <img src="${esc(r.img)}" alt="${esc(r.label)}"
             onerror="this.style.display='none'; this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#cbd5e1;&quot;>${esc(r.label)}</div>';">
        <div class="label">${esc(r.label)}</div>
      </a>
    `
  ).join("");

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:700;font-size:20px;margin-bottom:6px;">진행할 레이드를 선택하세요</div>
          </div
        </div>

        <div class="divider"></div>
        <div class="raid-grid">${cardsHtml}</div>

        <div class="muted" style="margin-top:14px;">
          - 일반 레이드는 기본 3버퍼 / 9딜러 구성입니다.<br/>
          - 이내황혼전은 2버퍼 / 6딜러입니다.<br/>
          - 업둥교환은 12명 = 1세트로 표시됩니다.
        </div>
      </div>
    `,
      "메인"
    )
  );
});

// =====================
// Viewer: verify
// =====================
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
      "인증키",
      { activeRaid: raid }
    )
  );
});

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
        { activeRaid: raid }
      )
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

// =====================
// Viewer: reserve form
// =====================
app.get("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raid === "updoong";
  const err = String(req.query.err || "");
  const activeDay = getActiveDay(raid);
  const codeRow = getActiveCodeRow(raid);
  const currentCode = codeRow?.code || "";

  res.send(
    layout(
      `
      <div class="reserve-screen">
        <aside class="reserve-left">
          <div class="reserve-left-thumb">
            <span class="on-air">● On Air</span>
            <img src="/images/streamer_profile.png" alt="치지직 라이브 방송 썸네일"
                 onerror="this.style.display='none'; this.parentNode.innerHTML='<div>치지직 라이브<br/>방송 썸네일</div>';">
          </div>

          <div class="reserve-left-menu">
            <a href="/" class="nav-btn">메인 로비</a>
            <a href="/lineup?raid=${encodeURIComponent(raid)}" class="nav-btn">공격대 편성표</a>
            <a href="/check?raid=${encodeURIComponent(raid)}" class="nav-btn">예약 상황 확인</a>
          </div>
        </aside>

        <section class="reserve-right">
          <div class="reserve-top-auth">
            <div class="reserve-top-auth-label">🔐 인증키 입력</div>
            <input class="reserve-text" value="${esc(currentCode)}" placeholder="스트리머가 공지한 인증키 입력" readonly />
          </div>

          ${
            err
              ? `<div class="bad" style="margin-top:-4px;"><b>${esc(err)}</b></div>`
              : ``
          }

          <div class="reserve-main">
            <div class="reserve-hero-card">
              <div class="reserve-hero-image">
                <img src="${esc(raidObj.img || "")}" alt="${esc(raidObj.label)}"
                     onerror="this.style.display='none'; this.parentNode.innerHTML+='<div style=&quot;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;&quot;>${esc(raidObj.label)}</div>';">
                <div class="reserve-hero-title">${esc(raidObj.label)}</div>
              </div>
            </div>

            <form class="reserve-form-wrap" method="POST" action="/reserve">
              <input type="hidden" name="raid" value="${esc(raid)}"/>

              <div class="reserve-info-card">
                <div class="reserve-field-row">
                  <div class="reserve-field-label">🧀 치즈 색깔</div>
                  <div class="reserve-field-input">
                    <select name="viewer_grade" class="reserve-select" required>
                      ${GRADE_OPTIONS.map(
                        (g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`
                      ).join("")}
                    </select>
                  </div>
                </div>

                <div class="reserve-field-row">
                  <div class="reserve-field-label">🟩 치지직 닉네임</div>
                  <div class="reserve-field-input">
                    <input
                      name="chzzk_nickname"
                      class="reserve-text"
                      placeholder="치지직 닉네임"
                      required
                      maxlength="40"/>
                  </div>
                </div>
              </div>

              <div class="reserve-info-card">
                <div class="reserve-field-row">
                  <div class="reserve-field-label">🎮 모험단 이름</div>
                  <div class="reserve-field-input">
                    <input
                      name="adventure_name"
                      class="reserve-text"
                      placeholder="인게임 모험단명"
                      required
                      maxlength="60"/>
                  </div>
                </div>

                <div class="reserve-field-row" style="margin-top:14px;">
                  <div class="reserve-field-input" style="width:100%;">
                    ${
                      isUp
                        ? `
                          <div class="reserve-inline-row">
                            <label class="reserve-inline-group">
                              <span>1세트</span>
                              <input type="checkbox" name="up2" style="width:22px; min-width:22px; height:22px;" />
                            </label>
                            <label class="reserve-inline-group">
                              <span>2세트</span>
                              <input type="checkbox" name="up22" style="width:22px; min-width:22px; height:22px;" />
                            </label>
                            <label class="reserve-inline-group reserve-start-group">
                              <span>원하는 시작 기수</span>
                              <input
                                name="start_party"
                                inputmode="numeric"
                                placeholder="선택 사항" />
                            </label>
                          </div>
                        `
                        : `
                          <div class="reserve-inline-row">
                            <label class="reserve-inline-group">
                              <span>딜러</span>
                              <input
                                name="dealer_count"
                                inputmode="numeric"
                                placeholder="" required />
                            </label>

                            <label class="reserve-inline-group">
                              <span>버퍼</span>
                              <input
                                name="buffer_count"
                                inputmode="numeric"
                                placeholder="" required />
                            </label>

                            <label class="reserve-inline-group reserve-start-group">
                              <span>원하는 시작 기수</span>
                              <input
                                name="start_party"
                                inputmode="numeric"
                                placeholder="선택 사항" />
                            </label>
                          </div>
                        `
                    }
                  </div>
                </div>
              </div>

              <div class="reserve-submit-wrap">
                <button class="reserve-submit-btn" type="submit">등록 완료</button>
              </div>

              <div class="muted" style="margin-top:6px;">
                진행일: <b>${esc(activeDay)}</b><br/>
                ${
                  isUp
                    ? "업둥교환는 2업둥(1개/2개) 중 하나 이상 체크해야 합니다."
                    : "원하는 시작 기수는 선택 항목이며, 비우면 1기수부터 참여하는 것으로 처리됩니다."
                }
              </div>
            </form>
          </div>
        </section>
      </div>
    `,
      "예약 신청",
      { activeRaid: raid }
    )
  );
});
// =====================
// Viewer: reserve save
// =====================
app.post("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raid === "updoong";

  const activeRow = getActiveCodeRow(raid);
  if (!activeRow || !activeRow.code) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "스트리머가 아직 인증키를 설정하지 않았습니다."
      )}`
    );
  }
  const activeDay = activeRow.date_kst;

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();

  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);

  const up2 = req.body.up2 ? 1 : 0;
  const up22 = req.body.up22 ? 1 : 0;

  let start_party = parseInt(String(req.body.start_party || "").trim(), 10);
  if (!Number.isInteger(start_party) || start_party < 1) start_party = 1;
  if (start_party > 99) start_party = 99;

  const validGradeKeys = new Set(GRADE_OPTIONS.map((g) => g.key));
  if (!viewer_grade || !validGradeKeys.has(viewer_grade) || viewer_grade === "") {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "치즈 색깔을 선택해야 예약이 가능합니다."
      )}`
    );
  }

  if (!chzzk_nickname || !adventure_name) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "닉네임/모험단 이름을 입력해 주세요."
      )}`
    );
  }

  if (isUp) {
    if (!up2 && !up22) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
          "업둥교환는 2업둥(1개/2개) 중 하나를 반드시 체크해야 합니다."
        )}`
      );
    }

    const finalUp2 = up22 ? 1 : up2;
    const finalUp22 = up22 ? 1 : 0;

    db.prepare(
      `
      INSERT INTO applications
        (created_at, date_kst, raid_key,
         viewer_grade, chzzk_nickname, adventure_name,
         dealer_count, buffer_count,
         up2, up22,
         confirmed, comment, request_note, start_party)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, '', '', ?)
    `
    ).run(
      nowISO(),
      activeDay,
      raid,
      viewer_grade,
      chzzk_nickname,
      adventure_name,
      finalUp2,
      finalUp22,
      start_party
    );
  } else {
    if (!Number.isInteger(dealer_count) || dealer_count < 0 || dealer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
          "딜러 갯수는 0~999 정수여야 합니다."
        )}`
      );
    }
    if (!Number.isInteger(buffer_count) || buffer_count < 0 || buffer_count > 999) {
      return res.redirect(
        `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
          "버퍼 갯수는 0~999 정수여야 합니다."
        )}`
      );
    }

    db.prepare(
      `
      INSERT INTO applications
        (created_at, date_kst, raid_key,
         viewer_grade, chzzk_nickname, adventure_name,
         dealer_count, buffer_count,
         up2, up22,
         confirmed, comment, request_note, start_party)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '', '', ?)
    `
    ).run(
      nowISO(),
      activeDay,
      raid,
      viewer_grade,
      chzzk_nickname,
      adventure_name,
      dealer_count,
      buffer_count,
      start_party
    );
  }

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
          <a class="btn btnPrimary" href="/lineup?raid=${encodeURIComponent(raid)}">공대 편성표</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `,
      "완료",
      { activeRaid: raid }
    )
  );
});

// =====================
// Viewer: check
// =====================
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
          <div class="raid-grid">
            ${RAID_OPTIONS.map(
              (r) => `
                <a class="raid-card" href="/check?raid=${encodeURIComponent(r.key)}">
                  <img src="${esc(r.img)}" alt="${esc(r.label)}"
                       onerror="this.style.display='none'; this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#cbd5e1;&quot;>${esc(r.label)}</div>';">
                  <div class="label">${esc(r.label)}</div>
                </a>
              `
            ).join("")}
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
        ORDER BY
          CASE viewer_grade
            WHEN 'streamer' THEN 0
            WHEN 'burning' THEN 1
            WHEN 'pink' THEN 2
            WHEN 'yellow' THEN 3
            WHEN 'log' THEN 3
            WHEN 'normal' THEN 4
            ELSE 999
          END ASC,
          datetime(created_at) ASC
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
              <span class="chip">등록완료 ${
                apps.filter((a) => a.confirmed === 1).length
              }/${apps.length}</span>
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
                ? `<th class="center">2업둥(1개)</th><th class="center">2업둥(2개)</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th class="center">상태</th>
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
                            ? `<td class="center">${a.up2 ? "✔" : "-"}</td>
                               <td class="center">${a.up22 ? "✔" : "-"}</td>`
                            : `<td class="center">${esc(a.dealer_count)}</td>
                               <td class="center">${esc(a.buffer_count)}</td>`
                        }
                        <td class="center">${status}</td>
                      </tr>
                    `;
                  })
                  .join("")
              : `<tr><td colspan="6" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;">
          - “등록완료”는 스트리머가 확인 체크한 상태입니다.<br/>
          - 코멘트는 스트리머가 남기는 안내/요청사항입니다.
        </div>
      </div>
    `,
      "예약확인",
      { activeRaid: raid }
    )
  );
});

// =====================
// Lineup utils
// =====================
function buildPartyMap(lineups, cfg) {
  const map = new Map();
  for (const row of lineups) {
    const p = row.party_index;
    if (!map.has(p)) map.set(p, { buffers: {}, dealers: {} });
    const entry = map.get(p);
    if (row.role === "buffer") entry.buffers[row.slot_index] = row.nickname;
    else entry.dealers[row.slot_index] = row.nickname;
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
              ? `<span class="chip bad">X</span>`
              : `<button class="partyDeleteBtn" type="button" onclick="deleteParty('${esc(
                  raidKey
                )}', ${p});">삭제</button>`
            : ""
        }
      </div>

      <div class="partyBody">`;

    html += `<div class="slotSection"><div class="slotSectionTitle">버퍼</div>`;
    for (let b = 1; b <= buffersPerParty; b++) {
      const bName = data.buffers[b] || "";
      if (editable && adminMode) {
        if (disableInputs) html += `<input class="slotInput" value="${esc(bName)}" placeholder="비활성" disabled/>`;
        else html += `<input class="slotInput" name="b_${p}_${b}" value="${esc(bName)}" placeholder="버퍼"/>`;
      } else {
        html += bName ? `<div class="slotStatic">${esc(bName)}</div>` : `<div class="slotStatic slotEmpty">버퍼</div>`;
      }
    }
    html += `</div><div class="slotDivider"></div>`;

    html += `<div class="slotSection"><div class="slotSectionTitle">딜러</div>`;
    for (let d = 1; d <= dealersPerParty; d++) {
      const dName = data.dealers[d] || "";
      if (editable && adminMode) {
        if (disableInputs) html += `<input class="slotInput" value="${esc(dName)}" placeholder="비활성" disabled/>`;
        else html += `<input class="slotInput" name="d_${p}_${d}" value="${esc(dName)}" placeholder="딜러"/>`;
      } else {
        html += dName ? `<div class="slotStatic">${esc(dName)}</div>` : `<div class="slotStatic slotEmpty">딜러</div>`;
      }
    }
    html += `</div></div></div>`;
  }

  html += `</div>`;
  return html;
}

// =====================
// Updoong helpers
// =====================
function upPartyFromSlot(slotIndex) {
  const s = Number(slotIndex) || 1;
  return Math.floor((s - 1) / 12) + 1;
}
function upSlotRangeFromParty(partyIndex) {
  const p = Number(partyIndex) || 1;
  const start = (p - 1) * 12 + 1;
  const end = start + 11;
  return { start, end };
}
function getMaxUpSlot(dateKst) {
  const row = db
    .prepare(
      `
      SELECT MAX(slot_index) AS mx
      FROM up_lineups
      WHERE raid_key='updoong' AND date_kst=?
    `
    )
    .get(dateKst);
  return Number(row?.mx || 0) || 0;
}
function getUpLineupMap(dateKst) {
  const rows = db
    .prepare(
      `
      SELECT slot_index, nickname
      FROM up_lineups
      WHERE raid_key='updoong' AND date_kst=?
      ORDER BY slot_index ASC
    `
    )
    .all(dateKst);

  const m = new Map();
  for (const r of rows) m.set(Number(r.slot_index), String(r.nickname || ""));
  return m;
}

function renderUpLineupParties({ dateKst, editable, adminMode, valuesMap = new Map(), disabledSet = new Set(), minPartyCount = 1 }) {
  const maxSlot = Math.max(12 * minPartyCount, getMaxUpSlot(dateKst), ...Array.from(valuesMap.keys(), (k) => Number(k) || 0));
  const partyCount = Math.max(minPartyCount, Math.ceil(maxSlot / 12), ...Array.from(disabledSet, (p) => Number(p) || 0));

  const makeSlot = (slotIndex, isDisabledParty) => {
    const name = valuesMap.get(slotIndex) || "";
    if (editable && adminMode) {
      if (isDisabledParty) {
        return `<input class="slotInput" style="margin:0;" value="${esc(name)}" placeholder="비활성" disabled/>`;
      }
      return `<input class="slotInput" style="margin:0;" name="u_${slotIndex}" value="${esc(name)}" placeholder="닉네임"/>`;
    }
    return name
      ? `<div class="slotStatic">${esc(name)}</div>`
      : `<div class="slotStatic slotEmpty">닉네임</div>`;
  };

  const allIndices = Array.from(new Set([...Array.from({ length: partyCount }, (_, i) => i + 1), ...Array.from(disabledSet)])).sort((a, b) => a - b);
  const activeIndices = allIndices.filter((i) => !disabledSet.has(i));
  const disabledIndicesArr = allIndices.filter((i) => disabledSet.has(i));
  const viewOrder = [...activeIndices, ...disabledIndicesArr];

  let html = `
    <div class="muted" style="margin-bottom:10px;">
      - 업둥교환는 <b>12명=1세트</b>이며, <b>4명 단위</b>로 구분 표시됩니다.<br/>
      - 공대 내 같은 닉네임은 1번만 들어갑니다. (2업둥(2개)은 다음 세트로 넘어가서 배치)
    </div>
    <div class="upPartyGrid">
  `;

  for (const p of viewOrder) {
    const isDisabled = disabledSet.has(p);
    const base = (p - 1) * 12;

    html += `
      <div class="upPartyCard ${isDisabled ? "disabled" : ""}">
        <div class="upPartyHeader">
          <div class="upPartyTitle">${p}세트</div>
          ${
            editable && adminMode
              ? isDisabled
                ? `<span class="chip bad">X</span>`
                : `<button class="upPartyDeleteBtn" type="button" onclick="deleteUpParty(${p})">삭제</button>`
              : ""
          }
        </div>

        <div class="upPartySlots">
          <div class="upGroupBox">
            ${makeSlot(base + 1, isDisabled)}
            ${makeSlot(base + 2, isDisabled)}
            ${makeSlot(base + 3, isDisabled)}
            ${makeSlot(base + 4, isDisabled)}
          </div>

          <div class="upGroupBox">
            ${makeSlot(base + 5, isDisabled)}
            ${makeSlot(base + 6, isDisabled)}
            ${makeSlot(base + 7, isDisabled)}
            ${makeSlot(base + 8, isDisabled)}
          </div>

          <div class="upGroupBox">
            ${makeSlot(base + 9, isDisabled)}
            ${makeSlot(base + 10, isDisabled)}
            ${makeSlot(base + 11, isDisabled)}
            ${makeSlot(base + 12, isDisabled)}
          </div>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  return { html, partyCount };
}

// =====================
// 업둥교환 자동배치
// =====================
function rebuildUpdoongLineup(dateKst) {
  const MAX_PARTY = 2;
  const SLOTS_PER_PARTY = 12;

  const disabledSet = getDisabledPartySet("updoong", dateKst);

  db.prepare(`DELETE FROM up_lineups WHERE raid_key='updoong' AND date_kst=?`).run(dateKst);

  const confirmedApps = db
    .prepare(
      `
      SELECT id, chzzk_nickname, up2, up22
      FROM applications
      WHERE raid_key='updoong' AND date_kst=? AND confirmed=1
      ORDER BY datetime(created_at) ASC, id ASC
    `
    )
    .all(dateKst);

  const insert = db.prepare(
    `
    INSERT INTO up_lineups(date_kst, raid_key, slot_index, nickname, application_id, created_at)
    VALUES(?, 'updoong', ?, ?, ?, ?)
  `
  );

  const usedCount = new Map();
  const nameSet = new Map();

  function getUsed(p) {
    return usedCount.get(p) || 0;
  }
  function getNames(p) {
    if (!nameSet.has(p)) nameSet.set(p, new Set());
    return nameSet.get(p);
  }
  function isFull(p) {
    return getUsed(p) >= SLOTS_PER_PARTY;
  }
  function add(p, name, appId) {
    const slot = (p - 1) * SLOTS_PER_PARTY + (getUsed(p) + 1);
    usedCount.set(p, getUsed(p) + 1);
    getNames(p).add(name);
    insert.run(dateKst, slot, name, appId, nowISO());
  }

  function findFirstAvailableParty(name) {
    for (let p = 1; p <= MAX_PARTY; p++) {
      if (disabledSet.has(p)) continue;
      if (isFull(p)) continue;
      if (getNames(p).has(name)) continue;
      return p;
    }
    return 0;
  }

  function findAvailablePartyPreferNext(name, baseParty) {
    for (let p = baseParty + 1; p <= MAX_PARTY; p++) {
      if (disabledSet.has(p)) continue;
      if (isFull(p)) continue;
      if (getNames(p).has(name)) continue;
      return p;
    }
    return findFirstAvailableParty(name);
  }

  for (const a of confirmedApps) {
    const name = String(a.chzzk_nickname || "").trim();
    if (!name) continue;

    const cnt = a.up22 === 1 ? 2 : 1;

    const p1 = findFirstAvailableParty(name);
    if (!p1) continue;
    add(p1, name, a.id);

    if (cnt === 2) {
      const p2 = findAvailablePartyPreferNext(name, p1);
      if (!p2) continue;
      add(p2, name, a.id);
    }
  }
}

// =====================
// Apply lineup for single application
// =====================
function applyLineupForApplication(appId, confirmed) {
  const appRow = db.prepare("SELECT * FROM applications WHERE id=?").get(appId);
  if (!appRow) return;

  const raidKey = appRow.raid_key;
  const dateKst = appRow.date_kst;

  if (raidKey === "updoong") {
    db.prepare(`DELETE FROM up_lineups WHERE raid_key='updoong' AND date_kst=? AND application_id=?`).run(dateKst, appId);
    rebuildUpdoongLineup(dateKst);
    return;
  }

  const cfg = getRaidConfig(raidKey);
  const disabledSet = getDisabledPartySet(raidKey, dateKst);
  const startParty = Math.max(1, Number(appRow.start_party || 1));

  db.prepare("DELETE FROM raid_lineups WHERE application_id=?").run(appId);
  if (!confirmed) return;

  const rows = db
    .prepare(
      `
      SELECT party_index, role, slot_index, nickname, application_id
      FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `
    )
    .all(raidKey, dateKst);

  const partyInfo = new Map();
  let maxPartyIndex = 0;

  for (const row of rows) {
    if (!partyInfo.has(row.party_index)) {
      partyInfo.set(row.party_index, { bufSlots: new Set(), dealSlots: new Set(), names: new Set() });
    }
    const info = partyInfo.get(row.party_index);
    if (row.role === "buffer") info.bufSlots.add(row.slot_index);
    else info.dealSlots.add(row.slot_index);
    info.names.add(row.nickname);
    if (row.party_index > maxPartyIndex) maxPartyIndex = row.party_index;
  }

  function findOrCreatePartyWithSpace(role, nickname) {
    const perParty = role === "buffer" ? cfg.buffersPerParty : cfg.dealersPerParty;

    for (let idx = startParty; idx <= maxPartyIndex; idx++) {
      if (disabledSet.has(idx)) continue;

      let info = partyInfo.get(idx);
      if (!info) {
        info = { bufSlots: new Set(), dealSlots: new Set(), names: new Set() };
        partyInfo.set(idx, info);
      }

      if (info.names.has(nickname)) continue;

      const used = role === "buffer" ? info.bufSlots.size : info.dealSlots.size;
      if (used < perParty) return { idx, info };
    }

    let newIdx = Math.max(maxPartyIndex + 1, startParty);
    while (disabledSet.has(newIdx)) newIdx++;
    maxPartyIndex = newIdx;

    const info = { bufSlots: new Set(), dealSlots: new Set(), names: new Set() };
    partyInfo.set(newIdx, info);
    return { idx: newIdx, info };
  }

  const insert = db.prepare(
    `
    INSERT INTO raid_lineups
      (date_kst, raid_key, party_index, role, slot_index, nickname, application_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  );

  function assignSeats(role, count) {
    const perParty = role === "buffer" ? cfg.buffersPerParty : cfg.dealersPerParty;
    if (perParty <= 0) return;

    const nickname = appRow.chzzk_nickname;

    for (let i = 0; i < count; i++) {
      const result = findOrCreatePartyWithSpace(role, nickname);
      if (!result) return;

      const { idx, info } = result;
      const slots = role === "buffer" ? info.bufSlots : info.dealSlots;

      let slotIndex = 1;
      while (slots.has(slotIndex) && slotIndex <= perParty) slotIndex++;
      if (slotIndex > perParty) continue;

      insert.run(dateKst, raidKey, idx, role, slotIndex, nickname, appId, nowISO());
      slots.add(slotIndex);
      info.names.add(nickname);
    }
  }

  assignSeats("buffer", appRow.buffer_count || 0);
  assignSeats("dealer", appRow.dealer_count || 0);
}

// =====================
// Admin routing
// =====================
app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

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
      { isAdmin: true }
    )
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
        { isAdmin: true }
      )
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

// Admin: 메인
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  const cardsHtml = RAID_OPTIONS.map(
    (r) => `
      <a class="raid-card" href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(r.key)}&sort=grade">
        <img src="${esc(r.img)}" alt="${esc(r.label)}"
             onerror="this.style.display='none'; this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#cbd5e1;&quot;>${esc(r.label)}</div>';">
        <div class="label">${esc(r.label)}</div>
      </a>
    `
  ).join("");

  const modalHtml = `
    <div class="modal-overlay" id="modal-auth">
      <div class="modal-content">
        <button type="button" class="modal-close" onclick="closeModal('modal-auth')">✕</button>
        <div class="modal-header">
          <h3>인증키 입력</h3>
          <p>레이드를 선택하고 진행일과 인증키를 설정하세요.</p>
        </div>

        <form method="POST" action="${esc(ADMIN_BASE)}/code" class="modal-form">
          <div>
            <div class="muted" style="margin-bottom:6px;">레이드</div>
            <select name="raid" required>
              <option value="">레이드 선택</option>
              ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
            </select>
          </div>

          <div class="modal-row">
            <div>
              <div class="muted" style="margin-bottom:6px;">진행일</div>
              <input name="date_kst" value="${esc(todayKST())}" placeholder="YYYY-MM-DD" required />
            </div>
            <div>
              <div class="muted" style="margin-bottom:6px;">인증키</div>
              <input name="code" placeholder="예) 1234ABCD" required />
            </div>
          </div>

          <div class="row" style="justify-content:flex-end; margin-top:4px;">
            <button type="button" class="btn btnGhost" onclick="closeModal('modal-auth')">닫기</button>
            <button type="submit" class="btn btnPrimary">등록</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="modal-streamer">
      <div class="modal-content">
        <button type="button" class="modal-close" onclick="closeModal('modal-streamer')">✕</button>
        <div class="modal-header">
          <h3>스트리머 예약</h3>
          <p>스트리머 캐릭터를 등록하면 자동배치 시 최우선으로 반영됩니다.</p>
        </div>

        <form method="POST" action="${esc(ADMIN_BASE)}/streamer-reserve" class="modal-form">
          <div>
            <div class="muted" style="margin-bottom:6px;">레이드</div>
            <select name="raid" required>
              <option value="">레이드 선택</option>
              ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
            </select>
          </div>

          <div class="modal-row">
            <div>
              <div class="muted" style="margin-bottom:6px;">딜러 수</div>
              <input name="dealer_count" inputmode="numeric" placeholder="예) 1" required />
            </div>
            <div>
              <div class="muted" style="margin-bottom:6px;">버퍼 수</div>
              <input name="buffer_count" inputmode="numeric" placeholder="예) 1" required />
            </div>
          </div>

          <div class="row" style="justify-content:flex-end; margin-top:4px;">
            <button type="button" class="btn btnGhost" onclick="closeModal('modal-streamer')">닫기</button>
            <button type="submit" class="btn btnPrimary">등록</button>
          </div>
        </form>
      </div>
    </div>
  `;

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:700;font-size:20px;margin-bottom:6px;">관리자 메인</div>
            <div class="muted">좌측 메뉴에서 인증키 설정과 스트리머 예약을 팝업으로 열 수 있습니다.</div>
          </div>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/logout">로그아웃</a>
        </div>

        <div class="divider"></div>

        <div style="font-weight:700;margin-bottom:10px;">레이드 선택</div>
        <div class="raid-grid">${cardsHtml}</div>

        <div class="divider"></div>

        <div class="muted">
          - 좌측의 <b>인증키 설정</b> 버튼: 진행일/인증키 등록 팝업<br/>
          - 좌측의 <b>스트리머 예약</b> 버튼: 스트리머 캐릭터 등록 팝업<br/>
          - 레이드 카드를 누르면 해당 레이드 신청 목록으로 이동합니다.
        </div>
      </div>

      ${modalHtml}
    `,
      "관리자",
      { isAdmin: true, activeRaid: "admin_lobby" }
    )
  );
});

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
  `
  ).run(raid, date_kst, code, nowISO());

  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.post(`${ADMIN_BASE}/streamer-reserve`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  let dealer_count = Number(req.body.dealer_count || "0");
  let buffer_count = Number(req.body.buffer_count || "0");

  if (!Number.isFinite(dealer_count)) dealer_count = 0;
  if (!Number.isFinite(buffer_count)) buffer_count = 0;

  dealer_count = Math.max(0, Math.min(999, Math.floor(dealer_count)));
  buffer_count = Math.max(0, Math.min(999, Math.floor(buffer_count)));

  if (dealer_count === 0 && buffer_count === 0) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  const dateKst = getActiveDay(raid);

  db.prepare(
    `
    INSERT INTO applications
      (created_at, date_kst, raid_key,
       viewer_grade, chzzk_nickname, adventure_name,
       dealer_count, buffer_count,
       up2, up22,
       confirmed, is_streamer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
  `
  ).run(nowISO(), dateKst, raid, "streamer", "암종호", "암종호", dealer_count, buffer_count);

  return res.redirect(`${ADMIN_BASE}/raid`);
});

// =====================
// Admin: 치즈 등급별 일괄 등록
// =====================
app.post(`${ADMIN_BASE}/bulk-confirm`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");
  const up = String(req.body.up || "");
  const group = String(req.body.group || "");

  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);

  let gradeKeys = [];
  if (group === "burning") gradeKeys = ["burning"];
  else if (group === "pink") gradeKeys = ["pink"];
  else if (group === "yellowlog") gradeKeys = ["yellow", "log"];
  else if (group === "normal") gradeKeys = ["normal"];
  else return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);

  const placeholders = gradeKeys.map(() => "?").join(",");
  const targetRows = db
    .prepare(
      `
      SELECT id
      FROM applications
      WHERE date_kst=? AND raid_key=?
        AND viewer_grade IN (${placeholders})
      ORDER BY datetime(created_at) ASC, id ASC
    `
    )
    .all(dateKst, raid, ...gradeKeys);

  db.prepare(
    `
    UPDATE applications
    SET confirmed=1
    WHERE date_kst=? AND raid_key=?
      AND viewer_grade IN (${placeholders})
  `
  ).run(dateKst, raid, ...gradeKeys);

  if (raid === "updoong") {
    rebuildUpdoongLineup(dateKst);
  } else {
    for (const r of targetRows) {
      applyLineupForApplication(Number(r.id), true);
    }
  }

  const upQS = up === "1" || up === "2" ? `&up=${encodeURIComponent(up)}` : "";
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}${upQS}`);
});

// Admin: 신청목록
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "grade");
  const upFilter = req.query.up === "1" ? "1" : req.query.up === "2" ? "2" : "";
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const isUp = raid === "updoong";
  const activeDay = getActiveDay(raid);

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=time${isUp && upFilter ? `&up=${encodeURIComponent(upFilter)}` : ""}`
      : `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=grade${isUp && upFilter ? `&up=${encodeURIComponent(upFilter)}` : ""}`;

  let apps = db
    .prepare(`SELECT * FROM applications WHERE date_kst=? AND raid_key=?`)
    .all(activeDay, raid);

  if (isUp) {
    if (upFilter === "1") {
      apps = apps.filter((a) => a.up2 === 1 || a.up22 === 1);
    } else if (upFilter === "2") {
      apps = apps.filter((a) => a.up22 === 1);
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

  const upFilterAllLink = `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`;
  const upFilter1Link = `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}&up=1`;
  const upFilter2Link = `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}&up=2`;

  const bulkUpHidden = isUp && (upFilter === "1" || upFilter === "2") ? `<input type="hidden" name="up" value="${esc(upFilter)}"/>` : "";

  const bulkButtonsHtml = `
    <div class="divider"></div>
    <div style="font-weight:900;margin-bottom:8px;">치즈 등급별 일괄등록</div>
    <div class="muted" style="margin-bottom:10px;">
      - 버튼을 누르면 해당 치즈 등급 인원이 <b>등록완료 체크</b>되고, <b>편성표에 즉시 일괄 배치</b>됩니다.
    </div>
    <div class="row" style="gap:8px;">
      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('불타는 치즈 인원을 일괄 등록(등록완료 체크 + 일괄 배치)할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="burning"/>
        <button class="btn btnGhost" type="submit">불타는 치즈 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('분홍색 치즈 인원을 일괄 등록(등록완료 체크 + 일괄 배치)할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="pink"/>
        <button class="btn btnGhost" type="submit">분홍색 치즈 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('노란색 치즈 & 통나무 인원을 일괄 등록(등록완료 체크 + 일괄 배치)할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="yellowlog"/>
        <button class="btn btnGhost" type="submit">노란색 치즈&통나무 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('일반 치즈 인원을 일괄 등록(등록완료 체크 + 일괄 배치)할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="normal"/>
        <button class="btn btnGhost" type="submit">일반치즈 일괄 등록</button>
      </form>
    </div>
  `;

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">신청목록</div>
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b>
              <span class="chip">등록완료 ${
                apps.filter((a) => a.confirmed === 1).length
              }/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/raid">레이드 변경</a>
            <a class="btn" href="${esc(ADMIN_BASE)}/lineup?raid=${encodeURIComponent(raid)}">공대 편성표</a>
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
              <a class="btn ${upFilter === "1" ? "" : "btnGhost"}" href="${esc(upFilter1Link)}">1세트</a>
              <a class="btn ${upFilter === "2" ? "" : "btnGhost"}" href="${esc(upFilter2Link)}">2세트</a>
            </div>
          `
            : ""
        }

        ${bulkButtonsHtml}

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
                ? `<th class="center">1세트</th><th class="center">2세트</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th>원하는 시작 기수</th>
            <th class="center">삭제</th>
          </tr>

          ${
            apps.length
              ? apps
                  .map((a) => {
                    const formId = `confirmForm_${a.id}`;
                    const checked = a.confirmed === 1 ? "checked" : "";
                    const commentVal = String(a.comment || "");
                    const startPartyNum = Number(a.start_party || 0);
                    const startPartyHtml =
                      startPartyNum > 1 ? `${esc(startPartyNum)}기수부터` : `<span class="muted">-</span>`;

                    return `
                      <tr>
                        <td class="center">
                          <form id="${formId}" method="POST" action="${esc(ADMIN_BASE)}/confirm" style="margin:0;">
                            <input type="hidden" name="id" value="${esc(a.id)}"/>
                            <input type="hidden" name="raid" value="${esc(raid)}"/>
                            <input type="hidden" name="sort" value="${esc(sort)}"/>
                            <input type="hidden" name="confirmed" value="${a.confirmed === 1 ? "0" : "1"}"/>
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
                            ? `<td class="center">${a.up2 ? "✔" : "-"}</td>
                               <td class="center">${a.up22 ? "✔" : "-"}</td>`
                            : `<td class="center">${esc(a.dealer_count)}</td>
                               <td class="center">${esc(a.buffer_count)}</td>`
                        }

                        <td>${startPartyHtml}</td>

                        <td class="center">
                          <form method="POST" action="${esc(ADMIN_BASE)}/delete" onsubmit="return confirm('정말 삭제하시겠습니까?');" style="margin:0;">
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
              : `<tr><td colspan="8" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;">
          - 등록완료 체크는 시청자 화면에도 ✔ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - “원하는 시작 기수”는 선택 항목이며, 자동 배치 시 해당 기수부터 배치를 시작하기 위한 참고용입니다.<br/>
          - 업둥교환 필터에서 “2업둥(1개)”는 1개 + 2개가 함께 표시됩니다.
        </div>
      </div>
    `,
      "신청목록",
      { isAdmin: true, activeRaid: raid }
    )
  );
});

app.post(`${ADMIN_BASE}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
    applyLineupForApplication(id, confirmed === 1);
  }

  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

app.post(`${ADMIN_BASE}/comment`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");
  const comment = String(req.body.comment || "").slice(0, 12);

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, id);
  }
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

app.post(`${ADMIN_BASE}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
    db.prepare("DELETE FROM raid_lineups WHERE application_id=?").run(id);
    db.prepare("DELETE FROM up_lineups WHERE application_id=?").run(id);
  }
  if (raid === "updoong") rebuildUpdoongLineup(getActiveDay("updoong"));
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");

  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const activeDay = getActiveDay(raid);

  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(activeDay, raid);

  db.prepare(
    `
    DELETE FROM raid_lineups
    WHERE date_kst=? AND raid_key=?
    AND application_id IS NOT NULL
  `
  ).run(activeDay, raid);

  db.prepare(`DELETE FROM up_lineups WHERE date_kst=? AND raid_key=?`).run(activeDay, raid);
  db.prepare(`DELETE FROM raid_disabled_parties WHERE date_kst=? AND raid_key=?`).run(activeDay, raid);

  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// =====================
// Admin: lineup manage
// =====================
app.get(`${ADMIN_BASE}/lineup`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);

  if (raid === "updoong") {
    const map = getUpLineupMap(dateKst);
    const disabledSet = getDisabledPartySet("updoong", dateKst);

    const { html: upHtml, partyCount } = renderUpLineupParties({
      dateKst,
      editable: true,
      adminMode: true,
      valuesMap: map,
      disabledSet,
      minPartyCount: 1,
    });

    res.send(
      layout(
        `
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">업둥교환 편성표 관리</div>
              <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b></div>
            </div>
            <div class="row">
              <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=grade">신청목록</a>
              <form method="POST" action="${esc(ADMIN_BASE)}/lineup/reset" style="margin:0;display:inline;">
                <input type="hidden" name="raid" value="${esc(raid)}"/>
                <button class="btn btnDanger" type="submit"
                  onclick="return confirm('업둥교환 편성표/세트 비활성 상태를 초기화합니다.\\n(편성표가 비워지고, 삭제된 세트도 복구됩니다)');">
                  편성표 초기화
                </button>
              </form>
            </div>
          </div>

          <div class="divider"></div>

          <form method="POST" action="${esc(ADMIN_BASE)}/lineup/save-up" style="margin:0;">
            <input type="hidden" name="raid" value="${esc(raid)}"/>
            <input type="hidden" name="party_count" value="${esc(partyCount)}"/>
            ${upHtml}
            <div class="row" style="margin-top:16px;">
              <button class="btn" type="submit">수동 수정 내용 저장</button>
            </div>
          </form>

          <form id="deleteUpPartyForm" method="POST" action="${esc(ADMIN_BASE)}/lineup/delete-up-party" style="display:none;">
            <input type="hidden" name="raid" value="updoong"/>
            <input type="hidden" id="deleteUpPartyIndexInput" name="party_index" value=""/>
          </form>

          <div class="muted" style="margin-top:12px;">
            - 빈 칸으로 저장하면 해당 슬롯은 비워집니다.<br/>
            - 자동배치는 “신청목록에서 등록완료 체크”를 기준으로 예약순으로 다시 채워집니다.<br/>
            - 삭제된 세트(비활성)는 자동배치/수동저장 모두 건너뜁니다.
          </div>
        </div>
      `,
        "업둥교환 편성표",
        { isAdmin: true, activeRaid: raid }
      )
    );
    return;
  }

  const cfg = getRaidConfig(raid);
  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `
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
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b></div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=grade">신청목록</a>
            <form method="POST" action="${esc(ADMIN_BASE)}/lineup/reset" style="margin:0;display:inline;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <button class="btn btnDanger" type="submit"
                onclick="return confirm('현재 레이드의 공대 진행도를 모두 초기화합니다.\\n모든 공대 편성이 삭제되고 비활성 상태도 해제되어 1공대부터 다시 편성할 수 있습니다.');">
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

        <form id="deletePartyForm" method="POST" action="${esc(ADMIN_BASE)}/lineup/delete-party" style="display:none;">
          <input type="hidden" id="deleteRaidInput" name="raid" value="${esc(raid)}"/>
          <input type="hidden" id="deletePartyIndexInput" name="party_index" value=""/>
        </form>

        <div class="muted" style="margin-top:12px;">
          - 빈 칸으로 두고 저장하면 해당 슬롯의 인원이 삭제됩니다.<br/>
          - 공대 삭제 버튼을 누르면 해당 공대의 인원은 삭제되며, 공대 진행도 초기화를 하기 전까지 비활성 상태가 됩니다.<br/>
          - “공대 진행도 초기화”를 누르면 이 레이드의 공대 편성이 모두 삭제되고 비활성 공대 설정도 해제됩니다.
        </div>
      </div>
    `,
      "공대 편성표",
      { isAdmin: true, activeRaid: raid }
    )
  );
});

app.post(`${ADMIN_BASE}/lineup/reset`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);

  if (raid === "updoong") {
    db.prepare(`DELETE FROM up_lineups WHERE raid_key='updoong' AND date_kst=?`).run(dateKst);
    db.prepare(`DELETE FROM raid_disabled_parties WHERE raid_key='updoong' AND date_kst=?`).run(dateKst);
    return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
  }

  db.prepare("DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=?").run(raid, dateKst);
  db.prepare("DELETE FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?").run(raid, dateKst);
  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

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
  `
  );

  for (let p = 1; p <= partyCount; p++) {
    if (disabledSet.has(p)) continue;

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

app.post(`${ADMIN_BASE}/lineup/save-up`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  if (raid !== "updoong") return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay("updoong");
  const disabledSet = getDisabledPartySet("updoong", dateKst);

  const partyCount = Math.max(1, Number(req.body.party_count || 1) || 1);
  const maxSlot = partyCount * 12;

  db.prepare(`DELETE FROM up_lineups WHERE raid_key='updoong' AND date_kst=?`).run(dateKst);

  const insert = db.prepare(
    `
    INSERT INTO up_lineups(date_kst, raid_key, slot_index, nickname, application_id, created_at)
    VALUES(?, 'updoong', ?, ?, NULL, ?)
  `
  );

  for (let i = 1; i <= maxSlot; i++) {
    const party = upPartyFromSlot(i);
    if (disabledSet.has(party)) continue;

    const key = `u_${i}`;
    const name = String(req.body[key] || "").trim();
    if (!name) continue;
    insert.run(dateKst, i, name, nowISO());
  }

  return res.redirect(`${ADMIN_BASE}/lineup?raid=updoong`);
});

app.post(`${ADMIN_BASE}/lineup/delete-party`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const partyIndex = Number(req.body.party_index || 0);
  if (!partyIndex) return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);

  const dateKst = getActiveDay(raid);

  const seatRows = db
    .prepare(
      `
      SELECT application_id, role, COUNT(*) AS cnt
      FROM raid_lineups
      WHERE raid_key=? AND date_kst=? AND party_index=? AND application_id IS NOT NULL
      GROUP BY application_id, role
    `
    )
    .all(raid, dateKst, partyIndex);

  const usageMap = new Map();
  for (const row of seatRows) {
    const appId = row.application_id;
    if (!appId) continue;
    if (!usageMap.has(appId)) usageMap.set(appId, { usedBuffers: 0, usedDealers: 0 });
    const u = usageMap.get(appId);
    if (row.role === "buffer") u.usedBuffers += row.cnt || 0;
    else u.usedDealers += row.cnt || 0;
  }

  for (const [appId, u] of usageMap.entries()) {
    const appRow = db.prepare(`SELECT dealer_count, buffer_count FROM applications WHERE id=?`).get(appId);
    if (!appRow) continue;

    const newDealer = Math.max(0, Number(appRow.dealer_count || 0) - (u.usedDealers || 0));
    const newBuffer = Math.max(0, Number(appRow.buffer_count || 0) - (u.usedBuffers || 0));

    db.prepare(`UPDATE applications SET dealer_count=?, buffer_count=? WHERE id=?`).run(newDealer, newBuffer, appId);
  }

  db.prepare(
    `
    INSERT INTO raid_disabled_parties(date_kst, raid_key, party_index)
    VALUES(?, ?, ?)
    ON CONFLICT(date_kst, raid_key, party_index) DO NOTHING
  `
  ).run(dateKst, raid, partyIndex);

  db.prepare(`DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=? AND party_index=?`).run(raid, dateKst, partyIndex);

  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

app.post(`${ADMIN_BASE}/lineup/delete-up-party`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  if (raid !== "updoong") return res.redirect(`${ADMIN_BASE}/raid`);

  const partyIndex = Number(req.body.party_index || 0);
  if (!partyIndex) return res.redirect(`${ADMIN_BASE}/lineup?raid=updoong`);

  const dateKst = getActiveDay("updoong");

  db.prepare(
    `
    INSERT INTO raid_disabled_parties(date_kst, raid_key, party_index)
    VALUES(?, 'updoong', ?)
    ON CONFLICT(date_kst, raid_key, party_index) DO NOTHING
  `
  ).run(dateKst, partyIndex);

  const { start, end } = upSlotRangeFromParty(partyIndex);
  db.prepare(
    `
    DELETE FROM up_lineups
    WHERE raid_key='updoong' AND date_kst=? AND slot_index BETWEEN ? AND ?
  `
  ).run(dateKst, start, end);

  rebuildUpdoongLineup(dateKst);

  return res.redirect(`${ADMIN_BASE}/lineup?raid=updoong`);
});

// =====================
// Viewer: lineup
// =====================
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
          <div class="raid-grid">
            ${RAID_OPTIONS.map(
              (r) => `
                <a class="raid-card" href="/lineup?raid=${encodeURIComponent(r.key)}">
                  <img src="${esc(r.img)}" alt="${esc(r.label)}"
                       onerror="this.style.display='none'; this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#cbd5e1;&quot;>${esc(r.label)}</div>';">
                  <div class="label">${esc(r.label)}</div>
                </a>
              `
            ).join("")}
          </div>
        </div>
      `,
        "공대 편성표"
      )
    );
  }

  const raidObj = raidByKey(raid);
  const dateKst = getActiveDay(raid);

  if (raid === "updoong") {
    const map = getUpLineupMap(dateKst);
    const disabledSet = getDisabledPartySet("updoong", dateKst);

    const { html: upHtml } = renderUpLineupParties({
      dateKst,
      editable: false,
      adminMode: false,
      valuesMap: map,
      disabledSet,
      minPartyCount: 1,
    });

    return res.send(
      layout(
        `
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">업둥교환 편성표</div>
              <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b></div>
            </div>
            <a class="btn btnGhost" href="/">메인</a>
          </div>

          <div class="divider"></div>

          ${upHtml}

          <div class="muted" style="margin-top:12px;">
            - 삭제된 세트는 비활성 상태입니다.<br/>
            - 편성은 스트리머가 수동/자동으로 조정할 수 있습니다.
          </div>
        </div>
      `,
        "업둥교환 편성표",
        { activeRaid: raid }
      )
    );
  }

  const cfg = getRaidConfig(raid);

  const lineups = db
    .prepare(
      `
      SELECT * FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
      ORDER BY party_index, role, slot_index
    `
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
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b></div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        ${partyCardsHtml}

        <div class="muted" style="margin-top:12px;">
          - 실제 진행 상황에 따라 스트리머가 수동으로 수정할 수 있습니다.<br/>
          - 빈 공대가 보인다면 아직 편성이 이루어지지 않은 상태이거나, 삭제된 공대일 수 있습니다.
        </div>
      </div>
    `,
      "공대 편성표",
      { activeRaid: raid }
    )
  );
});

// =====================
// Health
// =====================
app.get("/health", (req, res) =>
  res.json({ ok: true, kst: todayKST(), admin: ADMIN_BASE })
);

// =====================
// Start
// =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
