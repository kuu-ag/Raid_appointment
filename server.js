// server.js (ESM / "type": "module")
"use strict";

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { registerTimelineFeature } from "./timelineFeature.js";
import { registerDuncleDropRateFeature } from "./duncleDropRateFeature.js";
import { registerHomeworkFeature } from "./homeworkFeature.js";

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
const IS_PROD = process.env.NODE_ENV === "production";
const GOOGLE_ADSENSE_CLIENT = (process.env.GOOGLE_ADSENSE_CLIENT || "").trim();
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "touen9972@gmail.com").trim();

// =====================
// Options
// =====================
const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" },
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "log", label: "통나무" },
  { key: "normal", label: "시청자" },
];

const GRADE_SORT = {
  streamer: 0,
  burning: 1,
  pink: 2,
  yellow: 3,
  log: 3,
  normal: 4,
};

const DEFAULT_RAIDS = [
  {
    raid_key: "dirige",
    label: "디레지에",
    img: "/images/dirige.png",
    default_buffer_slots: 3,
    default_dealer_slots: 9,
    raid_type: "normal",
    sort_order: 1,
    is_custom: 0,
  },
  {
    raid_key: "dirige-hard",
    label: "디레지에 : 악연",
    img: "/images/dirige_hard.png",
    default_buffer_slots: 3,
    default_dealer_slots: 9,
    raid_type: "normal",
    sort_order: 2,
    is_custom: 0,
  },
  {
    raid_key: "inhwagongjeon",
    label: "이내황혼전",
    img: "/images/inhwagongjeon.png",
    default_buffer_slots: 2,
    default_dealer_slots: 6,
    raid_type: "normal",
    sort_order: 3,
    is_custom: 0,
  },
  {
    raid_key: "nabel-hard",
    label: "인공신 나벨 : 하드",
    img: "/images/nabel_hard.png",
    default_buffer_slots: 3,
    default_dealer_slots: 9,
    raid_type: "normal",
    sort_order: 4,
    is_custom: 0,
  },
  {
    raid_key: "updoong",
    label: "업둥교환",
    img: "/images/updoong.png",
    default_buffer_slots: 0,
    default_dealer_slots: 0,
    raid_type: "updoong",
    sort_order: 5,
    is_custom: 0,
  },
];

// =====================
// DB init
// =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS raids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  img TEXT NOT NULL DEFAULT '',
  default_buffer_slots INTEGER NOT NULL DEFAULT 3,
  default_dealer_slots INTEGER NOT NULL DEFAULT 9,
  raid_type TEXT NOT NULL DEFAULT 'normal',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_custom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raids_active_sort
ON raids(is_active, sort_order, id);

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

ensureColumn("raids", "img", "img TEXT NOT NULL DEFAULT ''");
ensureColumn("raids", "default_buffer_slots", "default_buffer_slots INTEGER NOT NULL DEFAULT 3");
ensureColumn("raids", "default_dealer_slots", "default_dealer_slots INTEGER NOT NULL DEFAULT 9");
ensureColumn("raids", "raid_type", "raid_type TEXT NOT NULL DEFAULT 'normal'");
ensureColumn("raids", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0");
ensureColumn("raids", "is_active", "is_active INTEGER NOT NULL DEFAULT 1");
ensureColumn("raids", "is_custom", "is_custom INTEGER NOT NULL DEFAULT 0");
ensureColumn("raids", "created_at", "created_at TEXT NOT NULL DEFAULT ''");


// =====================
// Duncle Admin Shortcut
// =====================
// 던클리 평균 드랍률 관리자 페이지에서 서약별 통계 페이지로 바로 이동할 수 있는 버튼을 주입합니다.
// 기존 duncleDropRateFeature.js 파일을 수정하지 않고 server.js 한 파일만 교체해도 동작하도록 res.send를 감싸는 방식입니다.
const DUNCLE_ADMIN_PATH_FOR_SHORTCUT = (
  process.env.DUNCLE_ADMIN_PATH || "duncle_hidden"
).replace(/^\/+|\/+$/g, "");

function injectDuncleOathStatsShortcut(html) {
  const raw = String(html || "");
  if (!raw || raw.includes('data-duncle-oath-stats-shortcut="1"')) return raw;

  const oathStatsHref = `/${DUNCLE_ADMIN_PATH_FOR_SHORTCUT}/duncle/oath-stats?weekKey=all&source=all`;
  const shortcutLink = `<a data-duncle-oath-stats-shortcut="1" href="${oathStatsHref}" style="
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-height:42px;
    padding:10px 16px;
    border-radius:10px;
    background:#111827;
    border:1px solid #334155;
    color:#e5e7eb;
    font-size:14px;
    font-weight:900;
    line-height:1;
    text-decoration:none;
    white-space:nowrap;
    box-shadow:none;
  ">서약별 통계 →</a>`;

  const titleRow = `<div data-duncle-oath-stats-shortcut-row="1" style="
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:16px;
    margin:0 0 8px;
    flex-wrap:wrap;
  ">
    <h1 style="margin:0;">던클리 평균 드랍율 관리자</h1>
    ${shortcutLink}
  </div>`;

  // 가장 자연스러운 위치: 평균 관리자 제목과 같은 줄 우측에 배치합니다.
  const h1Exact = /<h1[^>]*>\s*던클리 평균 드랍율 관리자\s*<\/h1>/i;
  if (h1Exact.test(raw)) {
    return raw.replace(h1Exact, titleRow);
  }

  // h1 태그가 아니거나 제목 주변 마크업이 바뀐 경우, 제목 텍스트 직전에 우측 정렬 버튼만 추가합니다.
  const titleText = "던클리 평균 드랍율 관리자";
  const titleIndex = raw.indexOf(titleText);
  if (titleIndex >= 0) {
    const buttonRow = `<div data-duncle-oath-stats-shortcut-row="1" style="display:flex;justify-content:flex-end;margin:0 0 12px;">${shortcutLink}</div>`;
    return raw.slice(0, titleIndex) + buttonRow + raw.slice(titleIndex);
  }

  // 최후 fallback: body 바로 아래에 붙이되, sticky/fixed가 아닌 일반 우측 정렬 행으로만 표시합니다.
  const fallbackRow = `<div data-duncle-oath-stats-shortcut-row="1" style="display:flex;justify-content:flex-end;max-width:1280px;margin:0 auto 14px;padding:0 8px;">${shortcutLink}</div>`;
  const bodyOpenMatch = raw.match(/<body[^>]*>/i);
  if (bodyOpenMatch && bodyOpenMatch.index != null) {
    const insertAt = bodyOpenMatch.index + bodyOpenMatch[0].length;
    return raw.slice(0, insertAt) + fallbackRow + raw.slice(insertAt);
  }

  return fallbackRow + raw;
}

app.use((req, res, next) => {
  const targetPath = `/${DUNCLE_ADMIN_PATH_FOR_SHORTCUT}/duncle`;
  const reqPath = String(req.path || "").replace(/\/+$/g, "");

  if (req.method !== "GET" || reqPath !== targetPath) {
    return next();
  }

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    try {
      if (typeof body === "string") {
        return originalSend(injectDuncleOathStatsShortcut(body));
      }
      if (Buffer.isBuffer(body)) {
        return originalSend(Buffer.from(injectDuncleOathStatsShortcut(body.toString("utf8")), "utf8"));
      }
    } catch (err) {
      console.error("[Duncle] Failed to inject oath stats shortcut:", err);
    }
    return originalSend(body);
  };

  return next();
});

registerDuncleDropRateFeature(app, db, {
  adminPath: process.env.DUNCLE_ADMIN_PATH || "duncle_hidden",
});

function seedDefaultRaids() {
  const insert = db.prepare(`
    INSERT INTO raids
      (raid_key, label, img, default_buffer_slots, default_dealer_slots, raid_type, sort_order, is_active, is_custom, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(raid_key) DO UPDATE SET
      label=excluded.label,
      img=excluded.img,
      default_buffer_slots=excluded.default_buffer_slots,
      default_dealer_slots=excluded.default_dealer_slots,
      raid_type=excluded.raid_type,
      sort_order=excluded.sort_order,
      is_active=1
  `);

  for (const r of DEFAULT_RAIDS) {
    insert.run(
      r.raid_key,
      r.label,
      r.img,
      r.default_buffer_slots,
      r.default_dealer_slots,
      r.raid_type,
      r.sort_order,
      r.is_custom,
      nowISO()
    );
  }
}

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

function getAdSensePublisherId() {
  if (!GOOGLE_ADSENSE_CLIENT) return "";
  const raw = GOOGLE_ADSENSE_CLIENT.trim();
  if (raw.startsWith("ca-pub-")) return raw.replace(/^ca-pub-/, "pub-");
  if (raw.startsWith("pub-")) return raw;
  return raw;
}

function getRaidOptions(includeInactive = false) {
  const sql = includeInactive
    ? `
      SELECT *
      FROM raids
      ORDER BY sort_order ASC, id ASC
    `
    : `
      SELECT *
      FROM raids
      WHERE is_active=1
      ORDER BY sort_order ASC, id ASC
    `;
  return db.prepare(sql).all();
}

function raidByKey(key, includeInactive = false) {
  if (!key) return null;
  const sql = includeInactive
    ? `SELECT * FROM raids WHERE raid_key=?`
    : `SELECT * FROM raids WHERE raid_key=? AND is_active=1`;
  return db.prepare(sql).get(key) || null;
}

function raidImage(key) {
  return raidByKey(key)?.img || "";
}

function raidDisplayType(raidKey) {
  return raidByKey(raidKey)?.raid_type || "normal";
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
  const raid = raidByKey(raidKey);
  if (!raid) return { buffersPerParty: 3, dealersPerParty: 9 };
  if (raid.raid_type === "updoong") return { buffersPerParty: 0, dealersPerParty: 0 };
  return {
    buffersPerParty: Math.max(0, Number(raid.default_buffer_slots || 0)),
    dealersPerParty: Math.max(0, Number(raid.default_dealer_slots || 0)),
  };
}

function cleanupCompletedNormalApplications(raidKey, dateKst) {
  const raid = raidByKey(raidKey, true);
  if (!raid || raid.raid_type === "updoong") return 0;

  const result = db
    .prepare(
      `
      DELETE FROM applications
      WHERE raid_key=?
        AND date_kst=?
        AND COALESCE(dealer_count, 0) <= 0
        AND COALESCE(buffer_count, 0) <= 0
    `
    )
    .run(raidKey, dateKst);

  return Number(result?.changes || 0);
}


function isPlaceholderLineupName(name) {
  const v = String(name || "").trim();
  return !v || v === "선착순" || v === "닉네임" || v === "비활성" || v === "-";
}

function findApplicationIdForManualSlot(raidKey, dateKst, nickname, role, usedByAppRole = new Map()) {
  const name = String(nickname || "").trim();
  if (isPlaceholderLineupName(name)) return null;
  if (role !== "buffer" && role !== "dealer") return null;

  const rows = db
    .prepare(
      `
      SELECT id, dealer_count, buffer_count
      FROM applications
      WHERE raid_key=?
        AND date_kst=?
        AND chzzk_nickname=?
        AND confirmed=1
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
        datetime(created_at) ASC,
        id ASC
    `
    )
    .all(raidKey, dateKst, name);

  for (const row of rows) {
    const appId = Number(row.id);
    const key = `${appId}:${role}`;
    const alreadyUsed = Number(usedByAppRole.get(key) || 0);
    const available = role === "buffer" ? Number(row.buffer_count || 0) : Number(row.dealer_count || 0);
    if (available > alreadyUsed) {
      usedByAppRole.set(key, alreadyUsed + 1);
      return appId;
    }
  }

  return null;
}

function countExistingAssignedSlots(raidKey, dateKst) {
  const rows = db
    .prepare(
      `
      SELECT application_id, role, COUNT(*) AS cnt
      FROM raid_lineups
      WHERE raid_key=?
        AND date_kst=?
        AND application_id IS NOT NULL
      GROUP BY application_id, role
    `
    )
    .all(raidKey, dateKst);

  const m = new Map();
  for (const r of rows) {
    const appId = Number(r.application_id || 0);
    if (!appId) continue;
    const role = String(r.role || "");
    if (role !== "buffer" && role !== "dealer") continue;
    m.set(`${appId}:${role}`, Number(r.cnt || 0));
  }
  return m;
}

function buildRaidCard(r, href) {
  const hasImg = String(r.img || "").trim() !== "";
  const cardInner = hasImg
    ? `
      <img src="${esc(r.img)}" alt="${esc(r.label)}"
           onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;raid-card-fallback&quot;>${esc(
             r.label
           )}</div>';">
      <div class="label">${esc(r.label)}</div>
    `
    : `
      <div class="raid-card-fallback">
        <div style="font-size:16px;font-weight:800;">${esc(r.label)}</div>
        <div style="font-size:12px;opacity:.85;margin-top:6px;">${
          r.raid_type === "updoong"
            ? "커스텀"
            : `${esc(r.default_buffer_slots)}버퍼 / ${esc(r.default_dealer_slots)}딜러`
        }</div>
      </div>
    `;

  return `
    <a class="raid-card ${hasImg ? "" : "raid-card-text"}" href="${esc(href)}">
      ${cardInner}
    </a>
  `;
}

// =====================
// Layout
// =====================
function buildSidebar(activeRaid = "", isAdmin = false) {
  const thumbImg = activeRaid ? raidImage(activeRaid) : "/images/streamer_profile.gif";

  if (!isAdmin) {
    return `
      <aside class="sidebar">
        <div class="thumbnail">
          ${
            thumbImg
              ? `<img src="${esc(thumbImg)}" alt="썸네일"
                   onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>${
                     activeRaid ? esc(raidByKey(activeRaid)?.label || "이미지 준비중") : "이미지 준비중"
                   }</div>';">`
              : `<div class="thumb-fallback">${activeRaid ? esc(raidByKey(activeRaid)?.label || "커스텀") : "이미지 준비중"}</div>`
          }
        </div>
        <a href="/" class="side-btn">메인 로비</a>
        <a href="/lineup" class="side-btn">공대 편성표</a>
        <a href="/check" class="side-btn">예약 확인</a>
        <a href="/observer" class="side-btn">데본베일 관측기</a>
        <a href="/observer/homework" class="side-btn">숙제현황</a>
      </aside>
    `;
  }

  const isAdminLobby = !activeRaid || activeRaid === "admin_lobby";

  if (isAdminLobby) {
    return `
      <aside class="sidebar">
        <div class="thumbnail">
          <img src="/images/streamer_profile.gif" alt="관리자 썸네일"
               onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>관리자 패널</div>';">
        </div>
        <button type="button" class="side-btn" onclick="openModal('modal-auth')">인증키 설정</button>
        <button type="button" class="side-btn" onclick="openModal('modal-streamer')">스트리머 예약</button>
        <button type="button" class="side-btn" onclick="openModal('modal-custom-raid')">커스텀 레이드 추가</button>
        <a href="/observer" class="side-btn">데본베일 관측기</a>
        <a href="/observer/homework" class="side-btn">숙제현황</a>
        <a href="${esc(ADMIN_BASE)}/observer/cleanup" class="side-btn">관측기 정리</a>
        <a href="${esc(ADMIN_BASE)}/raid" class="side-btn">레이드 선택</a>
        <a href="${esc(ADMIN_BASE)}/logout" class="side-btn side-btn-danger">로그아웃</a>
      </aside>
    `;
  }

  return `
    <aside class="sidebar">
      <div class="thumbnail">
        ${
          thumbImg
            ? `<img src="${esc(thumbImg)}" alt="썸네일"
                 onerror="this.style.display='none'; this.parentNode.innerHTML='<div class=&quot;thumb-fallback&quot;>${esc(
                   raidByKey(activeRaid)?.label || "관리자 패널"
                 )}</div>';">`
            : `<div class="thumb-fallback">${esc(raidByKey(activeRaid)?.label || "커스텀 레이드")}</div>`
        }
      </div>
      <a href="${esc(ADMIN_BASE)}/raid" class="side-btn">관리자 로비</a>
      <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(activeRaid)}&sort=grade" class="side-btn">신청 목록</a>
      <a href="${esc(ADMIN_BASE)}/lineup?raid=${encodeURIComponent(activeRaid)}" class="side-btn">편성표 관리</a>
      <a href="/observer" class="side-btn">데본베일 관측기</a>
      <a href="/observer/homework" class="side-btn">숙제현황</a>
      <a href="${esc(ADMIN_BASE)}/observer/cleanup" class="side-btn">관측기 정리</a>
      <a href="${esc(ADMIN_BASE)}/logout" class="side-btn side-btn-danger">로그아웃</a>
    </aside>
  `;
}

function layout(body, title = "레이드 예약 사이트", options = {}) {
  const isAdmin = !!options.isAdmin;
  const activeRaid = String(options.activeRaid || "");
  const hideSidebar = !!options.hideSidebar;
  const autoRefresh = !!options.autoRefresh;
  const autoRefreshMs = Number(options.autoRefreshMs || 60000);
  const sidebarContent = hideSidebar ? "" : buildSidebar(activeRaid, isAdmin);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  ${GOOGLE_ADSENSE_CLIENT ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(GOOGLE_ADSENSE_CLIENT)}" crossorigin="anonymous"></script>` : ""}
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
      --danger:#ef4444;
      --success:#10b981;
      --chip-bg:rgba(107,114,255,.12);
      --reserve-card:#535791;
      --reserve-input:#a7a9be;
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
      padding:20px 18px;
    }
    a{ text-decoration:none; color:inherit; }
    img{ display:block; }

    .app-container{
      width:100%;
      max-width:1320px;
      margin:0 auto;
      display:flex;
      flex-direction:column;
      gap:20px;
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
      color:var(--text-main);
    }
    .made-by{
      border:1px solid var(--border-glow);
      padding:9px 14px;
      border-radius:10px;
      font-size:13px;
      color:var(--text-main);
      background:rgba(38,40,77,.75);
      white-space:nowrap;
    }
    .header-links{
      display:flex;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    .header-link{
      border:1px solid var(--border-glow);
      padding:9px 14px;
      border-radius:10px;
      font-size:13px;
      font-weight:700;
      color:var(--text-main);
      background:rgba(38,40,77,.75);
      white-space:nowrap;
      transition:.15s ease;
    }
    .header-link:hover{
      background:var(--border-glow);
      border-color:var(--accent);
    }

    .content-wrapper{
      display:flex;
      gap:22px;
      align-items:flex-start;
    }

    .sidebar{
      width:240px;
      flex-shrink:0;
      border:1px solid var(--border-glow);
      border-radius:16px;
      padding:18px;
      background:linear-gradient(180deg, rgba(27,28,59,.96), rgba(24,25,52,.96));
      display:flex;
      flex-direction:column;
      gap:12px;
      min-height:560px;
    }

    .thumbnail{
      background:var(--bg-box);
      border-radius:12px;
      height:180px;
      display:flex;
      align-items:center;
      justify-content:center;
      color:var(--text-muted);
      font-size:14px;
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
      font-weight:700;
      color:#dbe4ff;
    }

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
      cursor:pointer;
      box-shadow:none !important;
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
    .main-area.full{ width:100%; }

    .box{
      background:rgba(38,40,77,.72);
      border-radius:12px;
      padding:18px 20px;
      border:1px solid rgba(148,163,255,.15);
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
    }
    .btn:hover{
      background:var(--border-glow);
      border-color:var(--accent);
      transform:translateY(-1px);
    }
    .btnGhost{ background:rgba(255,255,255,.02); }
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
    }
    input::placeholder, textarea::placeholder{ color:#d7dae7; }
    input:focus, textarea:focus, select:focus{
      border-color:var(--accent);
      background:#3d4173;
    }
    textarea{ resize:vertical; min-height:42px; }
    select option{ color:#111827; background:white; }

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
    .adminConfirm input[type="checkbox"]{ width:20px; height:20px; margin:0; }

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
    .raid-card-text{
      display:flex;
      align-items:center;
      justify-content:center;
      padding:16px;
      background:linear-gradient(180deg, rgba(60,65,120,.9), rgba(38,40,77,.95));
    }
    .raid-card-fallback{
      width:100%;
      height:100%;
      min-height:210px;
      display:flex;
      align-items:center;
      justify-content:center;
      flex-direction:column;
      text-align:center;
      color:#dbe4ff;
      padding:20px;
      line-height:1.5;
    }

    .partyGrid{
      display:flex;
      flex-wrap:wrap;
      gap:14px;
    }
    .partyCard{
      width:120px;
      flex:0 0 120px;
      max-width:120px;
      background:rgba(2,6,23,.56);
      border-radius:14px;
      border:1px solid rgba(148,163,255,.22);
      padding:12px 12px 10px;
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
      font-size:16px;
      font-weight:800;
      line-height:1.1;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
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
      color:rgba(255,255,255,.45);
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
      font-size:15px;
      border-radius:999px;
      background:#141833;
      color:var(--text-main);
    }
    .slotInput{ border:1px solid rgba(71,85,105,.95); }
    .slotInput[disabled]{ opacity:.45; cursor:not-allowed; }

    /* 일반 공대 편성표 - 관리자 화면 빈 슬롯 '선착순' 글자 초록색 */
    .partyCard .slotInput::placeholder{
      color:#22c55e !important;
      opacity:1 !important;
      font-weight:800 !important;
    }

    /* 크롬/엣지/사파리 대응 */
    .partyCard .slotInput::-webkit-input-placeholder{
      color:#22c55e !important;
      opacity:1 !important;
      font-weight:800 !important;
    }

    /* 파이어폭스 대응 */
    .partyCard .slotInput::-moz-placeholder{
      color:#22c55e !important;
      opacity:1 !important;
      font-weight:800 !important;
    }

    .slotStatic{
      border:1px solid rgba(59,130,246,.55);
      text-align:center;
    }
    .slotStatic.slotEmpty{
      opacity:1 !important;
      color:#22c55e !important;
      background:rgba(34,197,94,.10) !important;
      border-color:rgba(34,197,94,.65) !important;
      font-weight:800 !important;
    }

    .partyCard .slotStatic.slotEmpty{
      opacity:1 !important;
      color:#22c55e !important;
      background:rgba(34,197,94,.10) !important;
      border-color:rgba(34,197,94,.65) !important;
      font-weight:800 !important;
    }

    .upPartyGrid{
      display:flex;
      flex-wrap:wrap;
      gap:14px;
      align-items:flex-start;
    }
    .upPartyCard{
      width:120px;
      flex:0 0 120px;
      max-width:120px;
      background:rgba(2,6,23,.56);
      border-radius:18px;
      border:1px solid rgba(148,163,255,.22);
      padding:12px;
    }
    .upPartyCard.disabled{ opacity:.5; }
    .upPartyHeader{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      margin-bottom:10px;
      gap:8px;
    }
    .upPartyTitle{
      font-size:18px;
      font-weight:900;
      line-height:1.05;
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
    }
    .upPartyDeleteBtn:hover{ background:rgba(239,68,68,.3); }
    .upPartySlots{
      display:flex;
      flex-direction:column;
      gap:12px;
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
      font-size:15px;
      border-radius:999px;
      background:#141833;
      color:var(--text-main);
    }
    .upPartyCard .slotInput{ border:1px solid rgba(71,85,105,.95); }
    .upPartyCard .slotStatic{
      border:1px solid rgba(59,130,246,.55);
      text-align:center;
    }
    .upPartyCard .slotStatic.slotEmpty{
      opacity:1;
      color:#86efac;
      background:rgba(34,197,94,.16);
      border-color:rgba(34,197,94,.65);
      font-weight:800;
    }
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
    .modal-overlay.active{ display:flex; }
    .modal-content{
      width:min(760px, calc(100vw - 32px));
      max-height:calc(100vh - 40px);
      overflow:auto;
      background:linear-gradient(180deg, rgba(27,28,59,.98), rgba(24,25,52,.98));
      border:1px solid var(--accent);
      border-radius:14px;
      padding:22px 20px 18px;
      position:relative;
    }
    .modal-header{ margin-bottom:16px; }
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

    .reserve-shell{
      width:100%;
      border:1px solid var(--border-glow);
      border-radius:16px;
      padding:20px 22px 22px;
      background:rgba(18,20,90,.38);
    }

    .reserve-form{
      display:flex;
      flex-direction:column;
      gap:18px;
      width:100%;
    }

    .reserve-card{
      background:var(--reserve-card);
      border-radius:14px;
      padding:18px 22px;
      width:100%;
    }

    .reserve-auth-row{
      display:flex;
      align-items:center;
      gap:18px;
    }

    .reserve-auth-label{
      width:160px;
      flex-shrink:0;
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:8px;
      font-weight:700;
      color:#fff;
      white-space:nowrap;
      font-size:15px;
    }

    .reserve-line{
      display:flex;
      align-items:center;
      gap:18px;
    }

    .reserve-line + .reserve-line{
      margin-top:16px;
    }

    .reserve-label{
      width:160px;
      flex-shrink:0;
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:8px;
      font-weight:700;
      color:#fff;
      white-space:nowrap;
      font-size:15px;
    }

    .reserve-field{
      flex:1;
      min-width:0;
    }

    .reserve-input,
    .reserve-select{
      background:var(--reserve-input) !important;
      color:#fff !important;
      border-radius:8px !important;
      border:none !important;
      height:42px;
      width:100%;
    }

    .reserve-mini{
      background:var(--reserve-input) !important;
      color:#fff !important;
      border-radius:4px !important;
      border:none !important;
      width:42px;
      min-width:42px;
      height:28px;
      text-align:center;
      padding:0 6px !important;
    }

    .reserve-start{
      width:92px;
      min-width:92px;
    }

    .reserve-input::placeholder,
    .reserve-mini::placeholder{
      color:#ececf3 !important;
    }

    .reserve-meta-row{
      display:flex;
      align-items:center;
      justify-content:center;
      gap:18px;
      flex-wrap:wrap;
      margin-top:18px;
      width:100%;
    }

    .reserve-meta-item{
      display:flex;
      align-items:center;
      gap:8px;
      color:#fff;
      font-size:15px;
      white-space:nowrap;
    }

    .reserve-submit-wrap{
      display:flex;
      justify-content:center;
      margin-top:2px;
    }

    .reserve-submit{
      min-width:180px;
      min-height:44px;
      background:#4f5591;
      border:1px solid rgba(148,163,255,.18);
      border-radius:10px;
      color:#fff;
      font-size:16px;
      font-weight:700;
      cursor:pointer;
    }

    .reserve-submit:hover{
      background:#6067ab;
      border-color:var(--accent);
    }

    .reserve-foot{
      color:#c6c9db;
      font-size:14px;
      line-height:1.7;
      margin-top:6px;
    }

    @media (max-width:1120px){
      .content-wrapper{ flex-direction:column; }
      .sidebar{ width:100%; min-height:auto; }
      .thumbnail{ height:160px; }
    }

    @media (max-width:900px){
      .reserve-auth-row,
      .reserve-line{
        flex-direction:column;
        align-items:flex-start;
        gap:10px;
      }

      .reserve-auth-label,
      .reserve-label{
        width:auto;
        justify-content:flex-start;
      }

      .reserve-field{
        width:100%;
      }

      .reserve-meta-row{
        justify-content:flex-start;
      }

      .reserve-shell{
        padding:16px;
      }

      .reserve-card{
        padding:16px;
      }
    }

    @media (max-width:640px){
      body{ padding:14px 10px; }
      .header{
        padding:18px;
        flex-direction:column;
        align-items:flex-start;
      }
      .header h1{ font-size:24px; }
      .main-area{ padding:16px; min-height:auto; }
      .raid-grid{ grid-template-columns:1fr; }
      .modal-content{ width:calc(100vw - 20px); padding:18px 14px; }
    }

    table{
      width:100%;
      border-collapse:separate;
      border-spacing:0 12px;
    }
    th, td{
      padding:0 14px;
      text-align:left;
      vertical-align:middle;
      white-space:nowrap;
    }
    th{
      font-size:14px;
      font-weight:800;
      color:#ffffff;
    }
    td{
      font-size:14px;
      color:var(--text-main);
    }
    td.center, th.center{
      text-align:center;
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

    (function(){
      const AUTO_REFRESH = ${autoRefresh ? "true" : "false"};
      const AUTO_REFRESH_MS = ${Number.isFinite(autoRefreshMs) ? autoRefreshMs : 180000};

      if (!AUTO_REFRESH) return;

      let hasUserInputFocus = false;
      let isDirty = false;

      document.addEventListener("focusin", function(e){
        const tag = (e.target && e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
          hasUserInputFocus = true;
        }
      });

      document.addEventListener("focusout", function(){
        setTimeout(() => {
          const el = document.activeElement;
          const tag = (el && el.tagName || "").toLowerCase();
          hasUserInputFocus = (tag === "input" || tag === "textarea" || tag === "select");
        }, 0);
      });

      document.addEventListener("input", function(e){
        const tag = (e.target && e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
          isDirty = true;
        }
      });

      setInterval(function(){
        const modalOpen = !!document.querySelector(".modal-overlay.active");
        if (hasUserInputFocus || isDirty || modalOpen) return;
        window.location.reload();
      }, AUTO_REFRESH_MS);
    })();
  </script>
</head>
<body>
  <div class="app-container">
    <header class="header">
      <div>
        <h1>DevonVail RAID</h1>
        <p>레이드 예약 사이트 ${isAdmin ? '<span style="color:#fca5a5;font-weight:700;">[관리자 모드]</span>' : ''}</p>
      </div>
      <div class="header-links">
        <a class="header-link" href="/privacy">개인정보처리방침</a>
        <div class="made-by">Made by 🧭</div>
      </div>
    </header>

    <div class="content-wrapper">
      ${hideSidebar ? "" : sidebarContent}
      <main class="main-area ${hideSidebar ? "full" : ""}">
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
        "오류",
        { isAdmin: true }
      )
    );
  }
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  return res.status(404).send("Not Found");
});

// =====================
// Public policy pages for AdSense
// =====================
app.get("/privacy", (req, res) => {
  res.send(
    layout(
      `
      <div class="box">
        <div style="font-weight:900;font-size:22px;margin-bottom:10px;">개인정보처리방침</div>
        <div class="muted" style="line-height:1.8;">
          본 사이트는 레이드 예약, 공대 편성표, 데본베일 관측기 기능 제공을 위해 사용자가 입력한 예약 정보와 접속 로그, 쿠키 정보를 처리할 수 있습니다.<br/><br/>

          사용자가 입력한 치지직 닉네임, 모험단 이름, 레이드 신청 정보는 예약 확인과 공대 편성표 제공을 위해 사용됩니다.<br/><br/>

          본 사이트는 Google AdSense 등 제3자 광고 서비스를 사용할 수 있습니다. 이 과정에서 Google 및 제3자 광고 사업자는 쿠키를 사용하여 사용자의 이전 방문 기록을 기반으로 광고를 게재할 수 있습니다.<br/><br/>

          사용자는 브라우저 설정을 통해 쿠키 저장을 거부하거나 삭제할 수 있습니다.<br/><br/>

          본 사이트는 개인이 제작한 비공식 편의성 사이트이며, NEXON 및 NEOPLE과 직접적인 관련이 없습니다.<br/><br/>

          문의: ${esc(CONTACT_EMAIL)}
        </div>
      </div>
      `,
      "개인정보처리방침"
    )
  );
});

app.get("/ads.txt", (req, res) => {
  const publisherId = getAdSensePublisherId();
  res.type("text/plain; charset=utf-8");

  if (!publisherId) {
    return res.send(
      "# GOOGLE_ADSENSE_CLIENT 환경변수를 설정하면 ads.txt가 자동으로 생성됩니다.\n"
    );
  }

  return res.send(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
});


// =====================
// Observer Character Cleanup
// =====================
// 관측기 갱신에 남아 있는 예전 캐릭터를 DB에서 삭제하기 위한 관리자 도구입니다.
// timelineFeature.js 내부 테이블명이 바뀌어도 동작하도록 server_id / character_name 계열 컬럼을 가진 테이블을 자동 탐색합니다.
function sqlQuoteIdent(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}

function splitCleanupNames(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,]+/g)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

function getObserverCharacterTables() {
  const tableRows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`)
    .all();

  const characterColumnCandidates = ["character_name", "characterName", "char_name", "charName", "name"];
  const serverColumnCandidates = ["server_id", "serverId", "server", "server_name", "serverName"];
  const result = [];

  for (const t of tableRows) {
    const tableName = String(t.name || "");
    const cols = db.prepare(`PRAGMA table_info(${sqlQuoteIdent(tableName)})`).all();
    const colNames = cols.map((c) => String(c.name || ""));
    const characterColumn = characterColumnCandidates.find((c) => colNames.includes(c));
    const serverColumn = serverColumnCandidates.find((c) => colNames.includes(c));

    if (!tableName || !characterColumn || !serverColumn) continue;

    result.push({
      tableName,
      serverColumn,
      characterColumn,
    });
  }

  return result;
}

function getObserverCleanupRows({ serverId = "cain", names = [] } = {}) {
  const tables = getObserverCharacterTables();
  const rows = [];

  for (const t of tables) {
    const where = [];
    const params = [];

    if (serverId) {
      where.push(`${sqlQuoteIdent(t.serverColumn)} = ?`);
      params.push(serverId);
    }

    if (names.length) {
      where.push(`${sqlQuoteIdent(t.characterColumn)} IN (${names.map(() => "?").join(",")})`);
      params.push(...names);
    } else {
      where.push("1=0");
    }

    const sql = `
      SELECT
        ${sqlQuoteIdent(t.serverColumn)} AS server_id,
        ${sqlQuoteIdent(t.characterColumn)} AS character_name
      FROM ${sqlQuoteIdent(t.tableName)}
      WHERE ${where.join(" AND ")}
      ORDER BY ${sqlQuoteIdent(t.characterColumn)} ASC
      LIMIT 200
    `;

    const found = db.prepare(sql).all(...params);
    for (const r of found) {
      rows.push({
        tableName: t.tableName,
        serverId: r.server_id,
        characterName: r.character_name,
      });
    }
  }

  return { tables, rows };
}

function deleteObserverCleanupRows({ serverId = "cain", names = [] } = {}) {
  const tables = getObserverCharacterTables();
  const deleted = [];
  let total = 0;

  if (!names.length) return { total, deleted, tables };

  for (const t of tables) {
    const where = [];
    const params = [];

    if (serverId) {
      where.push(`${sqlQuoteIdent(t.serverColumn)} = ?`);
      params.push(serverId);
    }

    where.push(`${sqlQuoteIdent(t.characterColumn)} IN (${names.map(() => "?").join(",")})`);
    params.push(...names);

    const sql = `DELETE FROM ${sqlQuoteIdent(t.tableName)} WHERE ${where.join(" AND ")}`;
    const result = db.prepare(sql).run(...params);
    const changes = Number(result?.changes || 0);
    total += changes;
    if (changes > 0) deleted.push({ tableName: t.tableName, changes });
  }

  return { total, deleted, tables };
}


function observerInsertDefaultValue(col) {
  const name = String(col.name || "");
  const type = String(col.type || "").toUpperCase();
  const now = nowISO();

  if (/created_at|createdAt|updated_at|updatedAt|checked_at|checkedAt|registered_at|registeredAt/i.test(name)) return now;
  if (/memo|comment|note|request_note/i.test(name)) return "";
  if (/character_id|characterId|char_id|charId/i.test(name)) return "";
  if (/count|cnt|total|cleared|active|enabled|is_/i.test(name)) return 0;
  if (type.includes("INT") || type.includes("REAL") || type.includes("NUM")) return 0;
  return "";
}

function addObserverCleanupRows({ serverId = "cain", names = [], memo = "" } = {}) {
  const tables = getObserverCharacterTables();
  if (!tables.length) return { total: 0, skipped: 0, added: [], tables, error: "추가 가능한 관측기 테이블을 찾지 못했습니다." };
  if (!names.length) return { total: 0, skipped: 0, added: [], tables, error: "추가할 캐릭터명을 입력해 주세요." };

  const added = [];
  let skipped = 0;

  for (const target of tables) {
    const cols = db.prepare(`PRAGMA table_info(${sqlQuoteIdent(target.tableName)})`).all();
    const colNames = cols.map((c) => String(c.name || ""));

    const hasMemo = colNames.includes("memo");
    const hasCreatedAt = colNames.includes("created_at");
    const hasUpdatedAt = colNames.includes("updated_at");

    for (const characterName of names) {
      const exists = db.prepare(
        `SELECT COUNT(*) AS cnt FROM ${sqlQuoteIdent(target.tableName)} WHERE ${sqlQuoteIdent(target.serverColumn)}=? AND ${sqlQuoteIdent(target.characterColumn)}=?`
      ).get(serverId, characterName);

      if (Number(exists?.cnt || 0) > 0) {
        skipped += 1;
        continue;
      }

      const insertCols = [];
      const values = [];

      function setCol(colName, value) {
        if (!colNames.includes(colName)) return;
        if (insertCols.includes(colName)) return;
        insertCols.push(colName);
        values.push(value);
      }

      setCol(target.serverColumn, serverId);
      setCol(target.characterColumn, characterName);
      if (hasMemo) setCol("memo", memo);
      if (hasCreatedAt) setCol("created_at", nowISO());
      if (hasUpdatedAt) setCol("updated_at", nowISO());

      for (const col of cols) {
        const colName = String(col.name || "");
        if (!colName || insertCols.includes(colName)) continue;
        if (Number(col.pk || 0) === 1) continue;
        if (col.dflt_value !== null && col.dflt_value !== undefined) continue;
        if (Number(col.notnull || 0) !== 1) continue;
        setCol(colName, observerInsertDefaultValue(col));
      }

      if (!insertCols.length) {
        skipped += 1;
        continue;
      }

      const sql = `INSERT INTO ${sqlQuoteIdent(target.tableName)} (${insertCols.map(sqlQuoteIdent).join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`;
      db.prepare(sql).run(...values);
      added.push({ tableName: target.tableName, serverId, characterName });
    }
  }

  return { total: added.length, skipped, added, tables, tableNames: tables.map((t) => t.tableName) };
}

function renderObserverCleanupPage({ serverId = "cain", namesText = "", message = "" } = {}) {
  const names = splitCleanupNames(namesText);
  const preview = getObserverCleanupRows({ serverId, names });
  const rowHtml = preview.rows.length
    ? preview.rows.map((r) => `
        <tr>
          <td>${esc(r.tableName)}</td>
          <td>${esc(r.serverId)}</td>
          <td>${esc(r.characterName)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="3" class="center muted">입력한 캐릭터와 일치하는 관측기 DB 데이터가 없습니다.</td></tr>`;


  return layout(
    `
    <div class="box">
      <div class="row sp">
        <div>
          <div style="font-weight:900;font-size:22px;margin-bottom:6px;">관측기 캐릭터 정리</div>
          <div class="muted">trackedcharacters.json과 관측기 DB 사이의 캐릭터를 추가하거나 삭제합니다.</div>
        </div>
        <div class="row">
          <a class="btn btnGhost" href="/observer">관측기</a>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/raid">관리자 로비</a>
        </div>
      </div>

      ${message ? `<div class="divider"></div><div class="ok">${esc(message)}</div>` : ""}

      <div class="divider"></div>
      <form method="GET" action="${esc(ADMIN_BASE)}/observer/cleanup" class="box" style="background:rgba(2,6,23,.26);">
        <div class="muted" style="margin-bottom:8px;">삭제 전 확인할 캐릭터명을 줄바꿈 또는 쉼표로 입력하세요.</div>
        <div class="row" style="align-items:flex-start;">
          <div style="width:160px;max-width:100%;">
            <label class="muted">서버</label>
            <input name="server_id" value="${esc(serverId)}" placeholder="cain" />
          </div>
          <div style="flex:1;min-width:260px;">
            <label class="muted">캐릭터명</label>
            <textarea name="names" rows="5" placeholder="닉네임 변경 또는 삭제된 캐릭터의 닉네임을 적어주세요.\n데본베일\n암종호">${esc(namesText)}</textarea>
          </div>
        </div>
        <div class="row" style="margin-top:12px;">
          <button class="btn btnPrimary" type="submit">조회</button>
        </div>
      </form>

      <div class="divider"></div>
      <form method="POST" action="${esc(ADMIN_BASE)}/observer/cleanup/add" class="box" style="background:rgba(2,6,23,.26);" onsubmit="return confirm('입력한 캐릭터를 관측기 DB에 추가하시겠습니까?');">
        <div style="font-weight:900;font-size:18px;margin-bottom:6px;">관측기 캐릭터 추가</div>
        <div class="muted" style="margin-bottom:10px;">trackedcharacters.json에 추가한 캐릭터를 관측기 DB에도 수동으로 등록합니다. 자동 탐색된 모든 관측기 대상 테이블에 함께 추가됩니다.</div>
        <div class="row" style="align-items:flex-start;">
          <div style="width:160px;max-width:100%;">
            <label class="muted">서버</label>
            <input name="server_id" value="${esc(serverId)}" placeholder="cain" />
          </div>
          <div style="flex:1;min-width:260px;">
            <label class="muted">추가할 캐릭터명</label>
            <textarea name="names" rows="5" placeholder="추가할 캐릭터의 닉네임을 작성해주세요.
데본베일
암종호"></textarea>
          </div>
        </div>
        <div class="row" style="margin-top:12px;">
          <button class="btn btnPrimary" type="submit" ${preview.tables.length ? "" : "disabled"}>입력 캐릭터 DB 전체 추가</button>
          <span class="muted">중복 캐릭터는 건너뜁니다. 추가 후 관측기 갱신을 다시 실행하세요.</span>
        </div>
      </form>

      <div class="divider"></div>
      <table>
        <tr>
          <th>테이블</th>
          <th>서버</th>
          <th>캐릭터명</th>
        </tr>
        ${rowHtml}
      </table>

      <div class="divider"></div>
      <form method="POST" action="${esc(ADMIN_BASE)}/observer/cleanup/delete" onsubmit="return confirm('조회된 관측기 DB 캐릭터 데이터를 삭제하시겠습니까?');">
        <input type="hidden" name="server_id" value="${esc(serverId)}" />
        <textarea name="names" style="display:none;">${esc(namesText)}</textarea>
        <button class="btn btnDanger" type="submit" ${names.length ? "" : "disabled"}>입력 캐릭터 DB 삭제</button>
        <span class="muted"> 삭제 후 관측기 갱신을 다시 실행하세요.</span>
      </form>
    </div>
    `,
    "관측기 캐릭터 정리",
    { isAdmin: true, activeRaid: "admin_lobby" }
  );
}

app.get(`${ADMIN_BASE}/observer/cleanup`, requireAdmin, (req, res) => {
  const serverId = String(req.query.server_id || "cain").trim() || "cain";
  const namesText = String(req.query.names || "");
  const message = String(req.query.message || "");
  res.send(renderObserverCleanupPage({ serverId, namesText, message }));
});

app.post(`${ADMIN_BASE}/observer/cleanup/delete`, requireAdmin, (req, res) => {
  const serverId = String(req.body.server_id || "cain").trim() || "cain";
  const namesText = String(req.body.names || "");
  const names = splitCleanupNames(namesText);
  const result = deleteObserverCleanupRows({ serverId, names });
  const message = `삭제 완료: 총 ${result.total}건 삭제됨`;
  return res.redirect(`${ADMIN_BASE}/observer/cleanup?server_id=${encodeURIComponent(serverId)}&names=${encodeURIComponent(namesText)}&message=${encodeURIComponent(message)}`);
});

app.post(`${ADMIN_BASE}/observer/cleanup/add`, requireAdmin, (req, res) => {
  const serverId = String(req.body.server_id || "cain").trim() || "cain";
  const namesText = String(req.body.names || "");
  const names = splitCleanupNames(namesText);
  const result = addObserverCleanupRows({ serverId, names });
  const message = result.error
    ? `추가 실패: ${result.error}`
    : `추가 완료: 총 ${result.total}건 추가됨${result.skipped ? ` / 중복 ${result.skipped}건 건너뜀` : ""}`;
  return res.redirect(`${ADMIN_BASE}/observer/cleanup?server_id=${encodeURIComponent(serverId)}&names=${encodeURIComponent(namesText)}&message=${encodeURIComponent(message)}`);
});

// =====================
// Viewer: main
// =====================
app.get("/", (req, res) => {
  const raids = getRaidOptions();
  const cardsHtml = raids.map((r) => buildRaidCard(r, `/reserve?raid=${encodeURIComponent(r.raid_key)}`)).join("");

  res.send(
    layout(
      `
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:700;font-size:20px;margin-bottom:6px;">진행할 레이드를 선택하세요</div>
            <div class="muted">레이드를 선택하면 바로 예약 화면으로 이동합니다.</div>
          </div>
          <div class="row">
            <a class="btn btnPrimary" href="/lineup">공대편성표 보기</a>
            <a class="btn btnGhost" href="/check">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>
        <div class="raid-grid">${cardsHtml}</div>

        <div class="muted" style="margin-top:14px;">
          - 일반 레이드는 각 레이드의 기본 딜러/버퍼 수 기준으로 편성됩니다.<br/>
          - 업둥교환은 12명 = 1세트로 표시됩니다.<br/>
          - 이미지가 없는 커스텀 레이드는 텍스트 카드로 표시됩니다.
        </div>
      </div>
    `,
      "메인"
    )
  );
});

// =====================
// Viewer: reserve form
// =====================
app.get("/reserve", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raidObj.raid_type === "updoong";
  const err = String(req.query.err || "");
  const activeDay = getActiveDay(raid);

  res.send(
    layout(
      `
      <div class="reserve-shell">
        <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약 정보 입력</div>
        <div class="muted" style="margin-bottom:16px;">
          레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(activeDay)}</b>
        </div>

        <form class="reserve-form" method="POST" action="/reserve">
          <input type="hidden" name="raid" value="${esc(raid)}"/>

          <div class="reserve-card">
            <div class="reserve-auth-row">
              <div class="reserve-auth-label">🔐 인증키 입력</div>
              <div class="reserve-field">
                <input
                  name="code"
                  class="reserve-input"
                  placeholder="스트리머가 공지한 인증키 입력"
                  required />
              </div>
            </div>
          </div>

          <div class="reserve-card">
            <div class="reserve-line">
              <div class="reserve-label">🧀 치즈 색깔</div>
              <div class="reserve-field">
                <select name="viewer_grade" class="reserve-select" required>
                  ${GRADE_OPTIONS.map(
                    (g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`
                  ).join("")}
                </select>
              </div>
            </div>

            <div class="reserve-line">
              <div class="reserve-label">🟩 치지직 닉네임</div>
              <div class="reserve-field">
                <input
                  name="chzzk_nickname"
                  class="reserve-input"
                  required
                  maxlength="40"/>
              </div>
            </div>
          </div>

          <div class="reserve-card">
            <div class="reserve-line">
              <div class="reserve-label">🎮 모험단 이름</div>
              <div class="reserve-field">
                <input
                  name="adventure_name"
                  class="reserve-input"
                  required
                  maxlength="60"/>
              </div>
            </div>

            ${
              isUp
                ? `
                <div class="reserve-meta-row">
                  <label class="reserve-meta-item">
                    <span>1세트</span>
                    <input type="checkbox" name="up2" style="width:22px; min-width:22px; height:22px;" />
                  </label>

                  <label class="reserve-meta-item">
                    <span>2세트</span>
                    <input type="checkbox" name="up22" style="width:22px; min-width:22px; height:22px;" />
                  </label>

                  <label class="reserve-meta-item">
                    <span>원하는 시작 기수</span>
                    <input
                      name="start_party"
                      class="reserve-mini reserve-start"
                      inputmode="numeric"
                      placeholder="선택 사항" />
                  </label>
                </div>
              `
                : `
                <div class="reserve-meta-row">
                  <label class="reserve-meta-item">
                    <span>딜러</span>
                    <input
                      name="dealer_count"
                      class="reserve-mini"
                      inputmode="numeric"
                      required />
                  </label>

                  <label class="reserve-meta-item">
                    <span>버퍼</span>
                    <input
                      name="buffer_count"
                      class="reserve-mini"
                      inputmode="numeric"
                      required />
                  </label>

                  <label class="reserve-meta-item">
                    <span>원하는 시작 기수</span>
                    <input
                      name="start_party"
                      class="reserve-mini reserve-start"
                      inputmode="numeric"
                      placeholder="선택 사항" />
                  </label>
                </div>
              `
            }
          </div>

          <div class="reserve-submit-wrap">
            <button class="reserve-submit" type="submit">등록 완료</button>
          </div>

          ${err ? `<div class="bad"><b>${esc(err)}</b></div>` : ``}

          <div class="reserve-foot">
            ${
              isUp
                ? "업둥교환는 1세트 또는 2세트 중 하나를 반드시 체크해야 합니다."
                : "원하는 시작 기수는 선택 항목이며, 비우면 1기수부터 참여하는 것으로 처리됩니다."
            }
          </div>
        </form>
      </div>
    `,
      "예약 신청",
      { activeRaid: raid, hideSidebar: false }
    )
  );
});

// =====================
// Viewer: reserve save
// =====================
app.post("/reserve", (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const isUp = raidObj.raid_type === "updoong";

  const activeRow = getActiveCodeRow(raid);
  const code = String(req.body.code || "").trim();

  if (!activeRow || !activeRow.code) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "스트리머가 아직 인증키를 설정하지 않았습니다."
      )}`
    );
  }

  if (code !== String(activeRow.code)) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "인증키가 올바르지 않습니다."
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
          "업둥교환는 1세트 또는 2세트 중 하나를 반드시 체크해야 합니다."
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
    const cards = getRaidOptions()
      .map((r) => buildRaidCard(r, `/check?raid=${encodeURIComponent(r.raid_key)}`))
      .join("");

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
          <div class="raid-grid">${cards}</div>
        </div>
      `,
        "예약확인"
      )
    );
  }

  const isUp = raidObj.raid_type === "updoong";
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
              <span class="chip">${apps.filter((a) => a.confirmed === 1).length}/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/">메인</a>
            <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">예약하기</a>
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
                ? `<th class="center">1세트</th><th class="center">2세트</th>`
                : `<th class="center">딜러</th><th class="center">버퍼</th>`
            }
            <th class="center">상태</th>
          </tr>
          ${
            apps.length
              ? apps.map((a) => {
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
                }).join("")
              : `<tr><td colspan="6" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;">
          - “등록완료”는 스트리머가 확인 체크한 상태입니다.
        </div>
      </div>
    `,
      "예약확인",
      { activeRaid: raid, autoRefresh: true }
    )
  );
});

// =====================
// Lineup utils
// =====================
function buildPartyMap(lineups) {
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
        else html += `<input class="slotInput" name="b_${p}_${b}" value="${esc(bName)}" placeholder="선착순"/>`;
      } else {
        html += bName ? `<div class="slotStatic">${esc(bName)}</div>` : `<div class="slotStatic slotEmpty">선착순</div>`;
      }
    }
    html += `</div><div class="slotDivider"></div>`;

    html += `<div class="slotSection"><div class="slotSectionTitle">딜러</div>`;
    for (let d = 1; d <= dealersPerParty; d++) {
      const dName = data.dealers[d] || "";
      if (editable && adminMode) {
        if (disableInputs) html += `<input class="slotInput" value="${esc(dName)}" placeholder="비활성" disabled/>`;
        else html += `<input class="slotInput" name="d_${p}_${d}" value="${esc(dName)}" placeholder="선착순"/>`;
      } else {
        html += dName ? `<div class="slotStatic">${esc(dName)}</div>` : `<div class="slotStatic slotEmpty">선착순</div>`;
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
  const maxSlot = Math.max(
    12 * minPartyCount,
    getMaxUpSlot(dateKst),
    ...Array.from(valuesMap.keys(), (k) => Number(k) || 0)
  );
  const partyCount = Math.max(
    minPartyCount,
    Math.ceil(maxSlot / 12),
    ...Array.from(disabledSet, (p) => Number(p) || 0)
  );

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

  const allIndices = Array.from(
    new Set([
      ...Array.from({ length: partyCount }, (_, i) => i + 1),
      ...Array.from(disabledSet),
    ])
  ).sort((a, b) => a - b);

  const activeIndices = allIndices.filter((i) => !disabledSet.has(i));
  const disabledIndicesArr = allIndices.filter((i) => disabledSet.has(i));
  const viewOrder = [...activeIndices, ...disabledIndicesArr];

  let html = `
    <div class="muted" style="margin-bottom:10px;">
      - 업둥교환는 <b>12명=1세트</b>이며, <b>4명 단위</b>로 구분 표시됩니다.<br/>
      - 공대 내 같은 닉네임은 1번만 들어갑니다. (2세트 체크는 다음 세트로 넘어가서 배치)
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
// Updoong auto lineup
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

  function getUsed(p) { return usedCount.get(p) || 0; }
  function getNames(p) {
    if (!nameSet.has(p)) nameSet.set(p, new Set());
    return nameSet.get(p);
  }
  function isFull(p) { return getUsed(p) >= SLOTS_PER_PARTY; }
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

  if (raidDisplayType(raidKey) === "updoong") {
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
// Admin routes
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
    secure: IS_PROD,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.get(`${ADMIN_BASE}/logout`, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect(`${ADMIN_BASE}/login`);
});

app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  const raids = getRaidOptions();
  const cardsHtml = raids
    .map((r) => buildRaidCard(r, `${ADMIN_BASE}/list?raid=${encodeURIComponent(r.raid_key)}&sort=grade`))
    .join("");

  const customRaidRows = getRaidOptions(true);

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
              ${raids.map((r) => `<option value="${esc(r.raid_key)}">${esc(r.label)}</option>`).join("")}
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
              ${raids
                .filter((r) => r.raid_type !== "updoong")
                .map((r) => `<option value="${esc(r.raid_key)}">${esc(r.label)}</option>`)
                .join("")}
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

    <div class="modal-overlay" id="modal-custom-raid">
      <div class="modal-content">
        <button type="button" class="modal-close" onclick="closeModal('modal-custom-raid')">✕</button>
        <div class="modal-header">
          <h3>커스텀 레이드 추가</h3>
          <p>이미지 없이 텍스트 카드로 표시되는 새 레이드를 추가할 수 있습니다.</p>
        </div>

        <form method="POST" action="${esc(ADMIN_BASE)}/raid/add" class="modal-form">
          <div class="modal-row">
            <div>
              <div class="muted" style="margin-bottom:6px;">레이드 이름</div>
              <input name="label" placeholder="예) 커스텀 레이드" required />
            </div>
            <div>
              <div class="muted" style="margin-bottom:6px;">레이드 key</div>
              <input name="raid_key" placeholder="예) custom-raid-1" required />
            </div>
          </div>

          <div class="modal-row">
            <div>
              <div class="muted" style="margin-bottom:6px;">기본 버퍼 수</div>
              <input name="default_buffer_slots" inputmode="numeric" placeholder="예) 1" required />
            </div>
            <div>
              <div class="muted" style="margin-bottom:6px;">기본 딜러 수</div>
              <input name="default_dealer_slots" inputmode="numeric" placeholder="예) 7" required />
            </div>
          </div>

          <div class="row" style="justify-content:flex-end; margin-top:4px;">
            <button type="button" class="btn btnGhost" onclick="closeModal('modal-custom-raid')">닫기</button>
            <button type="submit" class="btn btnPrimary">추가</button>
          </div>
        </form>

        <div class="divider"></div>
        <div style="font-weight:700;margin-bottom:8px;">현재 레이드 목록</div>

        <table>
          <tr>
            <th>레이드 이름</th>
            <th>key</th>
            <th class="center">형태</th>
            <th class="center">버퍼</th>
            <th class="center">딜러</th>
            <th class="center">상태</th>
            <th class="center">삭제</th>
          </tr>
          ${customRaidRows
            .map((r) => {
              const canDelete = Number(r.is_custom) === 1;
              return `
                <tr>
                  <td>${esc(r.label)}</td>
                  <td>${esc(r.raid_key)}</td>
                  <td class="center">${r.raid_type === "updoong" ? "업둥형" : "일반형"}</td>
                  <td class="center">${r.raid_type === "updoong" ? "-" : esc(r.default_buffer_slots)}</td>
                  <td class="center">${r.raid_type === "updoong" ? "-" : esc(r.default_dealer_slots)}</td>
                  <td class="center">${Number(r.is_active) === 1 ? "활성" : "비활성"}</td>
                  <td class="center">
                    ${
                      canDelete
                        ? `
                          <form method="POST" action="${esc(ADMIN_BASE)}/raid/delete" style="margin:0;"
                                onsubmit="return confirm('정말 ${esc(r.label)} 레이드를 삭제할까요?');">
                            <input type="hidden" name="raid_key" value="${esc(r.raid_key)}"/>
                            <button class="btn btnDanger" type="submit">삭제</button>
                          </form>
                        `
                        : `<span class="muted">기본</span>`
                    }
                  </td>
                </tr>
              `;
            })
            .join("")}
        </table>
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
            <div class="muted">좌측 메뉴에서 인증키 설정, 스트리머 예약, 커스텀 레이드 추가를 열 수 있습니다.</div>
          </div>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/logout">로그아웃</a>
        </div>

        <div class="divider"></div>

        <div style="font-weight:700;margin-bottom:10px;">레이드 선택</div>
        <div class="raid-grid">${cardsHtml}</div>

        <div class="divider"></div>

        <div class="muted">
          - 커스텀 레이드는 이미지 없이 텍스트 카드로 표시됩니다.<br/>
          - 업둥교환 외 모든 커스텀 레이드는 일반 공대 편성 구조를 따릅니다.<br/>
          - 커스텀 레이드 삭제 시 관련 신청/편성/인증키도 함께 삭제됩니다.
        </div>
      </div>

      ${modalHtml}
    `,
      "관리자",
      { isAdmin: true, activeRaid: "admin_lobby" }
    )
  );
});

app.post(`${ADMIN_BASE}/raid/add`, requireAdmin, (req, res) => {
  const label = String(req.body.label || "").trim();
  const raid_key = String(req.body.raid_key || "").trim().toLowerCase();
  const default_buffer_slots = Math.floor(Number(req.body.default_buffer_slots || 0));
  const default_dealer_slots = Math.floor(Number(req.body.default_dealer_slots || 0));

  if (!label || !raid_key) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  if (!/^[a-z0-9_-]{2,40}$/.test(raid_key)) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  if (
    !Number.isInteger(default_buffer_slots) ||
    !Number.isInteger(default_dealer_slots) ||
    default_buffer_slots < 0 ||
    default_buffer_slots > 12 ||
    default_dealer_slots < 0 ||
    default_dealer_slots > 20
  ) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  const exists = raidByKey(raid_key, true);
  if (exists) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  const maxSort = db.prepare(`SELECT MAX(sort_order) AS mx FROM raids`).get()?.mx || 0;

  db.prepare(`
    INSERT INTO raids
      (raid_key, label, img, default_buffer_slots, default_dealer_slots, raid_type, sort_order, is_active, is_custom, created_at)
    VALUES (?, ?, '', ?, ?, 'normal', ?, 1, 1, ?)
  `).run(raid_key, label, default_buffer_slots, default_dealer_slots, Number(maxSort) + 1, nowISO());

  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.post(`${ADMIN_BASE}/raid/delete`, requireAdmin, (req, res) => {
  const raid_key = String(req.body.raid_key || "").trim();
  const raid = raidByKey(raid_key, true);

  if (!raid || Number(raid.is_custom) !== 1) {
    return res.redirect(`${ADMIN_BASE}/raid`);
  }

  db.prepare(`DELETE FROM raids WHERE raid_key=?`).run(raid_key);
  db.prepare(`DELETE FROM day_codes WHERE raid_key=?`).run(raid_key);
  db.prepare(`DELETE FROM applications WHERE raid_key=?`).run(raid_key);
  db.prepare(`DELETE FROM raid_lineups WHERE raid_key=?`).run(raid_key);
  db.prepare(`DELETE FROM raid_disabled_parties WHERE raid_key=?`).run(raid_key);
  db.prepare(`DELETE FROM up_lineups WHERE raid_key=?`).run(raid_key);

  return res.redirect(`${ADMIN_BASE}/raid`);
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
  if (!raidObj || raidObj.raid_type === "updoong") return res.redirect(`${ADMIN_BASE}/raid`);

  let dealer_count = Number(req.body.dealer_count || "0");
  let buffer_count = Number(req.body.buffer_count || "0");

  if (!Number.isFinite(dealer_count)) dealer_count = 0;
  if (!Number.isFinite(buffer_count)) buffer_count = 0;

  dealer_count = Math.max(0, Math.min(999, Math.floor(dealer_count)));
  buffer_count = Math.max(0, Math.min(999, Math.floor(buffer_count)));

  if (dealer_count === 0 && buffer_count === 0) return res.redirect(`${ADMIN_BASE}/raid`);

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
  ).run(nowISO(), dateKst, raid, "streamer", "박종민", "박종민", dealer_count, buffer_count);

  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.post(`${ADMIN_BASE}/bulk-confirm`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");
  const up = String(req.body.up || "");
  const group = String(req.body.group || "");

  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

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

  // 일괄 등록완료 시 편성표에도 즉시 배치합니다.
  // 단, 신청목록의 dealer_count/buffer_count는 차감하지 않습니다.
  // 신청자가 삭제되는 시점은 공대 삭제/진행 완료 처리 후 남은 수량이 0/0이 되었을 때입니다.
  if (raidDisplayType(raid) === "updoong") {
    rebuildUpdoongLineup(dateKst);
  } else {
    for (const r of targetRows) applyLineupForApplication(Number(r.id), true);
  }

  const upQS = up === "1" || up === "2" ? `&up=${encodeURIComponent(up)}` : "";
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}${upQS}`);
});

app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "grade");
  const upFilter = req.query.up === "1" ? "1" : req.query.up === "2" ? "2" : "";
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const isUp = raidObj.raid_type === "updoong";
  const activeDay = getActiveDay(raid);

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=time${isUp && upFilter ? `&up=${encodeURIComponent(upFilter)}` : ""}`
      : `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=grade${isUp && upFilter ? `&up=${encodeURIComponent(upFilter)}` : ""}`;

  let apps = db.prepare(`SELECT * FROM applications WHERE date_kst=? AND raid_key=?`).all(activeDay, raid);

  if (isUp) {
    if (upFilter === "1") apps = apps.filter((a) => a.up2 === 1 || a.up22 === 1);
    else if (upFilter === "2") apps = apps.filter((a) => a.up22 === 1);
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

  const bulkUpHidden =
    isUp && (upFilter === "1" || upFilter === "2")
      ? `<input type="hidden" name="up" value="${esc(upFilter)}"/>`
      : "";

  const bulkButtonsHtml = `
    <div class="divider"></div>
    <div style="font-weight:900;margin-bottom:8px;">치즈 등급별 일괄등록</div>
    <div class="muted" style="margin-bottom:10px;">
      - 버튼을 누르면 해당 치즈 등급 인원이 <b>등록완료 체크</b>되고, <b>편성표에 즉시 일괄 배치</b>됩니다.
    </div>
    <div class="row" style="gap:8px;">
      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('불타는 치즈 인원을 일괄 등록할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="burning"/>
        <button class="btn btnGhost" type="submit">불타는 치즈 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('분홍색 치즈 인원을 일괄 등록할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="pink"/>
        <button class="btn btnGhost" type="submit">분홍색 치즈 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('노란색 치즈 & 통나무 인원을 일괄 등록할까요?');">
        <input type="hidden" name="raid" value="${esc(raid)}"/>
        <input type="hidden" name="sort" value="${esc(sort)}"/>
        ${bulkUpHidden}
        <input type="hidden" name="group" value="yellowlog"/>
        <button class="btn btnGhost" type="submit">노란색 치즈&통나무 일괄 등록</button>
      </form>

      <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
            onsubmit="return confirm('시청자 인원을 일괄 등록할까요?');">
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
              <span class="chip">등록완료 ${apps.filter((a) => a.confirmed === 1).length}/${apps.length}</span>
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
              ? apps.map((a) => {
                  const formId = `confirmForm_${a.id}`;
                  const checked = a.confirmed === 1 ? "checked" : "";
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
                }).join("")
              : `<tr><td colspan="8" class="center muted">예약 신청이 없습니다.</td></tr>`
          }
        </table>
      </div>
    `,
      "신청목록",
      { isAdmin: true, activeRaid: raid, autoRefresh: true }
    )
  );
});

app.post(`${ADMIN_BASE}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    const appRow = db.prepare("SELECT raid_key, date_kst FROM applications WHERE id=?").get(id);
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);

    // 등록완료를 누르면 편성표에 즉시 배치합니다.
    // 단, 이 단계에서는 신청목록의 dealer_count/buffer_count를 차감하거나 신청자를 삭제하지 않습니다.
    // 신청자가 삭제되는 시점은 공대 삭제/진행 완료 처리 후 남은 수량이 0/0이 되었을 때입니다.
    if (appRow && raidDisplayType(appRow.raid_key) === "updoong") {
      rebuildUpdoongLineup(appRow.date_kst);
    } else if (confirmed === 1) {
      applyLineupForApplication(id, true);
    } else {
      db.prepare("DELETE FROM raid_lineups WHERE application_id=?").run(id);
    }
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
  if (raidDisplayType(raid) === "updoong") rebuildUpdoongLineup(getActiveDay("updoong"));
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "grade");

  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const activeDay = getActiveDay(raid);

  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(activeDay, raid);
  db.prepare(`DELETE FROM raid_lineups WHERE date_kst=? AND raid_key=? AND application_id IS NOT NULL`).run(activeDay, raid);
  db.prepare(`DELETE FROM up_lineups WHERE date_kst=? AND raid_key=?`).run(activeDay, raid);
  db.prepare(`DELETE FROM raid_disabled_parties WHERE date_kst=? AND raid_key=?`).run(activeDay, raid);

  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

app.get(`${ADMIN_BASE}/lineup`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);

  if (raidObj.raid_type === "updoong") {
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

    return res.send(
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
                  onclick="return confirm('업둥교환 편성표/세트 비활성 상태를 초기화합니다.');">
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
        </div>
      `,
        "업둥교환 편성표",
        { isAdmin: true, activeRaid: raid, autoRefresh: true }
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
  const partyMap = buildPartyMap(lineups);
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
              <span class="chip">${esc(cfg.buffersPerParty)}버퍼 / ${esc(cfg.dealersPerParty)}딜러</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=grade">신청목록</a>
            <form method="POST" action="${esc(ADMIN_BASE)}/lineup/reset" style="margin:0;display:inline;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <button class="btn btnDanger" type="submit"
                onclick="return confirm('현재 레이드의 공대 진행도를 모두 초기화합니다.');">
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
      </div>
    `,
      "공대 편성표",
      { isAdmin: true, activeRaid: raid, autoRefresh: true }
    )
  );
});

app.post(`${ADMIN_BASE}/lineup/reset`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);

  if (raidDisplayType(raid) === "updoong") {
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
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  const dateKst = getActiveDay(raid);
  const cfg = getRaidConfig(raid);
  const partyCount = Number(req.body.party_count || 0) || 0;
  const disabledSet = getDisabledPartySet(raid, dateKst);

  const existingRows = db
    .prepare(
      `
      SELECT party_index, role, slot_index, nickname, application_id
      FROM raid_lineups
      WHERE raid_key=? AND date_kst=?
    `
    )
    .all(raid, dateKst);

  const existingSlotMap = new Map();
  for (const row of existingRows) {
    const key = `${row.party_index}:${row.role}:${row.slot_index}`;
    existingSlotMap.set(key, {
      nickname: String(row.nickname || "").trim(),
      application_id: row.application_id == null ? null : Number(row.application_id),
    });
  }

  db.prepare("DELETE FROM raid_lineups WHERE raid_key=? AND date_kst=?").run(raid, dateKst);

  const usedByAppRole = countExistingAssignedSlots(raid, dateKst);
  usedByAppRole.clear();

  const insert = db.prepare(
    `
    INSERT INTO raid_lineups
      (date_kst, raid_key, party_index, role, slot_index, nickname, application_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  );

  function saveManualSlot(partyIndex, role, slotIndex, rawName) {
    const name = String(rawName || "").trim();
    if (isPlaceholderLineupName(name)) return;

    const slotKey = `${partyIndex}:${role}:${slotIndex}`;
    const prev = existingSlotMap.get(slotKey);
    let appId = null;

    if (prev && prev.nickname === name && prev.application_id) {
      appId = Number(prev.application_id);
      const usedKey = `${appId}:${role}`;
      usedByAppRole.set(usedKey, Number(usedByAppRole.get(usedKey) || 0) + 1);
    } else {
      appId = findApplicationIdForManualSlot(raid, dateKst, name, role, usedByAppRole);
    }

    insert.run(dateKst, raid, partyIndex, role, slotIndex, name, appId, nowISO());
  }

  for (let p = 1; p <= partyCount; p++) {
    if (disabledSet.has(p)) continue;

    for (let b = 1; b <= cfg.buffersPerParty; b++) {
      saveManualSlot(p, "buffer", b, req.body[`b_${p}_${b}`]);
    }
    for (let d = 1; d <= cfg.dealersPerParty; d++) {
      saveManualSlot(p, "dealer", d, req.body[`d_${p}_${d}`]);
    }
  }

  // 수동 저장은 위치 저장만 수행합니다.
  // 신청자의 딜러/버퍼 수량 차감과 0/0 삭제는 공대 삭제/진행 완료 처리에서만 수행합니다.
  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

app.post(`${ADMIN_BASE}/lineup/save-up`, requireAdmin, (req, res) => {
  if (String(req.body.raid || "") !== "updoong") return res.redirect(`${ADMIN_BASE}/raid`);

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
    const name = String(req.body[`u_${i}`] || "").trim();
    if (!name) continue;
    insert.run(dateKst, i, name, nowISO());
  }

  return res.redirect(`${ADMIN_BASE}/lineup?raid=updoong`);
});

app.post(`${ADMIN_BASE}/lineup/delete-party`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

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

  // 공대 삭제/진행 처리 후 남은 딜러/버퍼 수가 모두 0이 된 신청자는 관리자/시청자 목록에서 실제 삭제합니다.
  cleanupCompletedNormalApplications(raid, dateKst);

  return res.redirect(`${ADMIN_BASE}/lineup?raid=${encodeURIComponent(raid)}`);
});

app.post(`${ADMIN_BASE}/lineup/delete-up-party`, requireAdmin, (req, res) => {
  if (String(req.body.raid || "") !== "updoong") return res.redirect(`${ADMIN_BASE}/raid`);

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
  const raidObj = raidByKey(raid);

  if (!raidObj) {
    const cards = getRaidOptions()
      .map((r) => buildRaidCard(r, `/lineup?raid=${encodeURIComponent(r.raid_key)}`))
      .join("");

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
          <div class="raid-grid">${cards}</div>
        </div>
      `,
        "공대 편성표"
      )
    );
  }

  const dateKst = getActiveDay(raid);

  if (raidObj.raid_type === "updoong") {
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
        </div>
      `,
        "업둥교환 편성표",
        { activeRaid: raid, autoRefresh: true }
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
  const partyMap = buildPartyMap(lineups);
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
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(dateKst)}</b>
              <span class="chip">${esc(cfg.buffersPerParty)}버퍼 / ${esc(cfg.dealersPerParty)}딜러</span>
            </div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>
        ${partyCardsHtml}
      </div>
    `,
      "공대 편성표",
      { activeRaid: raid, autoRefresh: true }
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
// Duncle Oath Stats Feature - inline
// =====================
// 던클리 1.6.5+ 서버 패치 v3
// 확장 프로그램이 전송한 /api/duncle/oath-drop-logs 값을 저장하고,
// 비밀 관리자 페이지에서 "요일별로 어떤 서약이 가장 많이 나왔는지"와
// "시간대별로 어떤 서약이 가장 많이 나왔는지"를 12개 서약 기준으로 확인합니다.
const MAX_LOGS_PER_REQUEST = 3000;
const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

const DUNCLE_OATH_ITEM_NAMES = [
  "태동하는 울림의 무리 서약",
  "찬란한 신념의 정화 서약",
  "태초에 고동치는 마력 서약",
  "근원에 닿은 자연 서약",
  "초월하는 한계 서약",
  "세계를 태우는 용투 서약",
  "현실이 된 이상 속 황금 서약",
  "태초로 인도하는 페어리 서약",
  "태초에서 현신한 발키리 서약",
  "태초의 어둠 속 그림자 서약",
  "강림한 여우 서약",
  "영원불변의 행운 서약"
];

function normalizeOathItemKey(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\[\]\(\){}:：,，.·\-_\'"“”‘’]/g, "")
    .trim();
}

const DUNCLE_OATH_ITEM_KEYS = DUNCLE_OATH_ITEM_NAMES.map((name) => ({ name, key: normalizeOathItemKey(name) }));

function normalizeKnownOathItemName(value) {
  const key = normalizeOathItemKey(value);
  if (!key) return "";

  // 과거 오표기 데이터도 정확한 명칭으로 묶어서 집계합니다.
  const legacyAliases = new Map([
    [normalizeOathItemKey("근원에 닿는 자연 서약"), "근원에 닿은 자연 서약"],
  ]);
  if (legacyAliases.has(key)) return legacyAliases.get(key);

  const exact = DUNCLE_OATH_ITEM_KEYS.find((row) => row.key === key);
  if (exact) return exact.name;
  const included = DUNCLE_OATH_ITEM_KEYS.find((row) => key.includes(row.key) || row.key.includes(key));
  return included ? included.name : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clampText(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function getSource(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "nexon") return "nexon";
  if (text === "naver") return "naver";
  return "unknown";
}

function nowKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function getCurrentWeekKeyKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const hour = kst.getUTCHours();

  let daysSinceThursday = (day - 4 + 7) % 7;
  if (daysSinceThursday === 0 && hour < 10) daysSinceThursday = 7;

  const start = new Date(kst.getTime() - daysSinceThursday * 24 * 60 * 60 * 1000);
  start.setUTCHours(10, 0, 0, 0);
  return start.toISOString().slice(0, 10);
}

function getWeekKey(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return getCurrentWeekKeyKST();
}

function isValidDateTimeText(value) {
  const text = String(value || "").trim();
  return /^\d{4}[-.]\d{2}[-.]\d{2}[ T]\d{1,2}:\d{2}/.test(text);
}

function normalizeDroppedAt(value) {
  const text = String(value || "").trim().replaceAll(".", "-");
  if (!text) return "";
  return text.replace("T", " ").slice(0, 19);
}

function normalizeWeekday(value) {
  const n = toInt(value, -1);
  return n >= 0 && n <= 6 ? n : -1;
}

function normalizeHour(value) {
  const n = toInt(value, -1);
  return n >= 0 && n <= 23 ? n : -1;
}

function setApiCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function initDuncleOathStatsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS duncle_oath_drop_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT NOT NULL,
      source TEXT DEFAULT 'unknown',
      week_key TEXT NOT NULL,
      log_id INTEGER DEFAULT 0,
      item_name TEXT NOT NULL,
      grade TEXT DEFAULT '',
      content_name TEXT DEFAULT '',
      dropped_at TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(anonymous_id, source, dropped_at, item_name, content_name)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_duncle_oath_logs_anon_logid
      ON duncle_oath_drop_logs(anonymous_id, source, log_id)
      WHERE log_id IS NOT NULL AND log_id > 0;

    CREATE INDEX IF NOT EXISTS idx_duncle_oath_logs_week ON duncle_oath_drop_logs(week_key);
    CREATE INDEX IF NOT EXISTS idx_duncle_oath_logs_weekday ON duncle_oath_drop_logs(weekday);
    CREATE INDEX IF NOT EXISTS idx_duncle_oath_logs_hour ON duncle_oath_drop_logs(hour);
    CREATE INDEX IF NOT EXISTS idx_duncle_oath_logs_item ON duncle_oath_drop_logs(item_name);
    CREATE INDEX IF NOT EXISTS idx_duncle_oath_logs_source ON duncle_oath_drop_logs(source);
  `);
}

function sanitizeOathLog(raw, fallbackWeekKey) {
  const itemName = normalizeKnownOathItemName(raw?.itemName || raw?.item_name);
  const droppedAt = normalizeDroppedAt(raw?.droppedAt || raw?.dropped_at);
  const weekday = normalizeWeekday(raw?.weekday);
  const hour = normalizeHour(raw?.hour);

  // 정확한 12종 서약명으로 판별되지 않는 값은 저장하지 않습니다.
  // "이름 미확인 서약" 같은 fallback 데이터도 여기서 제외됩니다.
  if (!itemName) return null;
  if (!droppedAt || !isValidDateTimeText(droppedAt)) return null;
  if (weekday < 0 || hour < 0) return null;

  return {
    logId: Math.max(0, toInt(raw?.logId || raw?.log_id, 0)),
    itemName,
    grade: clampText(raw?.grade, 40),
    contentName: clampText(raw?.contentName || raw?.content_name, 120),
    droppedAt,
    weekday,
    hour,
    weekKey: getWeekKey(raw?.weekKey || raw?.week_key || fallbackWeekKey),
  };
}

function saveOathDropLogs(db, { anonymousId, source, weekKey, logs }) {
  const safeAnonymousId = clampText(anonymousId, 120);
  const safeSource = getSource(source);
  const safeWeekKey = getWeekKey(weekKey);
  const now = nowKST();

  if (!safeAnonymousId) {
    return { ok: false, status: 400, message: "익명 식별자가 없습니다." };
  }

  const rawLogs = Array.isArray(logs) ? logs.slice(0, MAX_LOGS_PER_REQUEST) : [];
  const sanitizedLogs = rawLogs.map((row) => sanitizeOathLog(row, safeWeekKey)).filter(Boolean);

  if (!sanitizedLogs.length) {
    return { ok: true, insertedCount: 0, receivedCount: rawLogs.length, validCount: 0, ignored: true };
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO duncle_oath_drop_logs (
      anonymous_id, source, week_key, log_id, item_name, grade, content_name,
      dropped_at, weekday, hour, created_at, updated_at
    )
    VALUES (
      @anonymous_id, @source, @week_key, @log_id, @item_name, @grade, @content_name,
      @dropped_at, @weekday, @hour, @now, @now
    )
  `);

  let insertedCount = 0;
  const tx = db.transaction(() => {
    for (const row of sanitizedLogs) {
      const result = insertStmt.run({
        anonymous_id: safeAnonymousId,
        source: safeSource,
        week_key: row.weekKey,
        log_id: row.logId,
        item_name: row.itemName,
        grade: row.grade,
        content_name: row.contentName,
        dropped_at: row.droppedAt,
        weekday: row.weekday,
        hour: row.hour,
        now,
      });
      insertedCount += Number(result?.changes || 0);
    }
  });

  tx();

  return {
    ok: true,
    insertedCount,
    receivedCount: rawLogs.length,
    validCount: sanitizedLogs.length,
    weekKey: safeWeekKey,
  };
}

function getFilterWhere(filter = {}) {
  const where = [];
  const params = {};

  if (filter.weekKey && filter.weekKey !== "all") {
    where.push("week_key = @weekKey");
    params.weekKey = getWeekKey(filter.weekKey);
  }

  if (filter.source && ["nexon", "naver", "unknown"].includes(filter.source)) {
    where.push("source = @source");
    params.source = filter.source;
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function getTopRows(db, sql, params = {}) {
  return db.prepare(sql).all(params).map((row) => ({ ...row, count: Number(row.count || 0) }));
}

function makeItemNames(rows, max = 30) {
  const present = new Set((Array.isArray(rows) ? rows : [])
    .map((row) => normalizeKnownOathItemName(row.itemName || row.item_name || ""))
    .filter(Boolean));
  return DUNCLE_OATH_ITEM_NAMES.filter((name) => present.has(name)).slice(0, max);
}

function buildAxisItemStats({ axisValues, axisLabel, itemNames, pairRows }) {
  const byAxis = new Map();

  for (const axis of axisValues) {
    byAxis.set(axis.value, {
      [axisLabel]: axis.value,
      label: axis.label,
      total: 0,
      topItem: "",
      topCount: 0,
      topItems: [],
      counts: Object.fromEntries(itemNames.map((name) => [name, 0])),
    });
  }

  for (const row of pairRows) {
    const axisValue = Number(row[axisLabel]);
    const itemName = String(row.itemName || row.item_name || "").trim();
    const count = Number(row.count || 0);
    if (!byAxis.has(axisValue) || !itemName) continue;

    const bucket = byAxis.get(axisValue);
    bucket.total += count;
    bucket.counts[itemName] = (bucket.counts[itemName] || 0) + count;
  }

  for (const bucket of byAxis.values()) {
    const topItems = Object.entries(bucket.counts)
      .map(([itemName, count]) => ({ itemName, count: Number(count || 0) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName, "ko"));

    bucket.topItems = topItems;
    bucket.topItem = topItems[0]?.itemName || "-";
    bucket.topCount = Number(topItems[0]?.count || 0);
  }

  return Array.from(byAxis.values());
}

function getOathStats(db, filter = {}) {
  const { clause, params } = getFilterWhere(filter);

  const total = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COUNT(DISTINCT anonymous_id) AS user_count,
      SUM(CASE WHEN source = 'nexon' THEN 1 ELSE 0 END) AS nexon_count,
      SUM(CASE WHEN source = 'naver' THEN 1 ELSE 0 END) AS naver_count,
      MAX(updated_at) AS last_updated_at
    FROM duncle_oath_drop_logs
    ${clause}
  `).get(params);

  const rawItemRows = getTopRows(db, `
    SELECT item_name AS itemName, COUNT(*) AS count
    FROM duncle_oath_drop_logs
    ${clause}
    GROUP BY item_name
    ORDER BY count DESC, item_name ASC
  `, params);

  const mergedItemCounts = new Map();
  for (const row of rawItemRows) {
    const itemName = normalizeKnownOathItemName(row.itemName);
    if (!itemName) continue;
    mergedItemCounts.set(itemName, (mergedItemCounts.get(itemName) || 0) + Number(row.count || 0));
  }
  const itemRows = Array.from(mergedItemCounts.entries())
    .map(([itemName, count]) => ({ itemName, count }))
    .sort((a, b) => b.count - a.count || DUNCLE_OATH_ITEM_NAMES.indexOf(a.itemName) - DUNCLE_OATH_ITEM_NAMES.indexOf(b.itemName));

  const itemNames = makeItemNames(itemRows, 30);

  const weekdayPairRowsRaw = getTopRows(db, `
    SELECT weekday, item_name AS itemName, COUNT(*) AS count
    FROM duncle_oath_drop_logs
    ${clause}
    GROUP BY weekday, item_name
    ORDER BY weekday ASC, count DESC, item_name ASC
  `, params);

  const hourPairRowsRaw = getTopRows(db, `
    SELECT hour, item_name AS itemName, COUNT(*) AS count
    FROM duncle_oath_drop_logs
    ${clause}
    GROUP BY hour, item_name
    ORDER BY hour ASC, count DESC, item_name ASC
  `, params);

  const normalizePairRows = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const itemName = normalizeKnownOathItemName(row.itemName);
      if (!itemName) continue;
      const axisKey = row.weekday !== undefined ? `weekday:${Number(row.weekday)}` : `hour:${Number(row.hour)}`;
      const key = `${axisKey}::${itemName}`;
      const prev = map.get(key) || { ...row, itemName, count: 0 };
      prev.count += Number(row.count || 0);
      map.set(key, prev);
    }
    return Array.from(map.values());
  };

  const weekdayPairRows = normalizePairRows(weekdayPairRowsRaw);
  const hourPairRows = normalizePairRows(hourPairRowsRaw);

  const weekdayItemLeaders = buildAxisItemStats({
    axisValues: WEEKDAY_LABELS.map((label, value) => ({ value, label })),
    axisLabel: "weekday",
    itemNames,
    pairRows: weekdayPairRows,
  });

  const hourItemLeaders = buildAxisItemStats({
    axisValues: Array.from({ length: 24 }, (_, value) => ({ value, label: `${String(value).padStart(2, "0")}시` })),
    axisLabel: "hour",
    itemNames,
    pairRows: hourPairRows,
  });

  const recent = db.prepare(`
    SELECT item_name, grade, content_name, dropped_at, weekday, hour, source, anonymous_id
    FROM duncle_oath_drop_logs
    ${clause}
    ORDER BY datetime(dropped_at) DESC, id DESC
    LIMIT 200
  `).all(params)
    .map((row) => ({
      itemName: normalizeKnownOathItemName(row.item_name),
      grade: row.grade,
      contentName: row.content_name,
      droppedAt: row.dropped_at,
      weekday: Number(row.weekday),
      hour: Number(row.hour),
      source: row.source,
      anonymousId: row.anonymous_id,
    }))
    .filter((row) => row.itemName)
    .slice(0, 100);

  return {
    totalCount: itemRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    userCount: Number(total?.user_count || 0),
    nexonCount: Number(total?.nexon_count || 0),
    naverCount: Number(total?.naver_count || 0),
    lastUpdatedAt: total?.last_updated_at || "",
    itemNames,
    items: itemRows,
    weekdayItemLeaders,
    hourItemLeaders,
    recent,
  };
}

function renderTopItems(row, limit = 3) {
  const topItems = Array.isArray(row.topItems) ? row.topItems.slice(0, limit) : [];
  if (!topItems.length) return "-";
  return topItems.map((item, index) => `${index + 1}. ${escapeHtml(item.itemName)} ${Number(item.count || 0).toLocaleString()}개`).join("<br>");
}

function renderLeaderTable(rows, axisHeader) {
  const body = rows.map((row) => `
    <tr>
      <td class="axis">${escapeHtml(row.label)}</td>
      <td class="leader">${escapeHtml(row.topItem || "-")}</td>
      <td class="num">${Number(row.topCount || 0).toLocaleString()}개</td>
      <td class="num">${Number(row.total || 0).toLocaleString()}개</td>
      <td>${renderTopItems(row, 3)}</td>
    </tr>
  `).join("");

  return `
    <table class="compactTable">
      <thead>
        <tr>
          <th>${escapeHtml(axisHeader)}</th>
          <th>가장 많이 집계된 서약</th>
          <th>해당 서약 수</th>
          <th>전체 서약 수</th>
          <th>TOP 3</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderMatrixTable(rows, itemNames, axisHeader) {
  if (!itemNames.length) {
    return `<div class="emptyBox">집계된 서약명이 없습니다.</div>`;
  }

  const headItems = itemNames.map((name) => `<th class="itemHead">${escapeHtml(name)}</th>`).join("");
  const body = rows.map((row) => {
    const max = Math.max(0, ...itemNames.map((name) => Number(row.counts?.[name] || 0)));
    const cells = itemNames.map((name) => {
      const count = Number(row.counts?.[name] || 0);
      const cls = count > 0 && count === max ? " class=\"maxCell\"" : "";
      return `<td${cls}>${count ? count.toLocaleString() : "-"}</td>`;
    }).join("");
    return `<tr><td class="axis">${escapeHtml(row.label)}</td><td class="num totalCell">${Number(row.total || 0).toLocaleString()}</td>${cells}</tr>`;
  }).join("");

  return `
    <table class="matrixTable">
      <thead>
        <tr>
          <th>${escapeHtml(axisHeader)}</th>
          <th>전체</th>
          ${headItems}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function maskAnonymousId(value) {
  const text = String(value || "");
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function renderOathStatsAdminPage(db, options = {}) {
  const adminPath = options.adminPath || "duncle_hidden";
  const requestedWeekKey = String(options.weekKey || "all");
  const requestedSource = String(options.source || "all");
  const weekKey = requestedWeekKey === "all" ? "all" : getWeekKey(requestedWeekKey);
  const source = ["nexon", "naver", "unknown"].includes(requestedSource) ? requestedSource : "all";

  const stats = getOathStats(db, { weekKey, source });
  const currentWeekKey = getCurrentWeekKeyKST();
  const itemCountLabel = stats.itemNames.length ? `${stats.itemNames.length}종` : "-";

  const recentRows = stats.recent.map((row) => `
    <tr>
      <td>${escapeHtml(row.droppedAt)}</td>
      <td>${escapeHtml(WEEKDAY_LABELS[row.weekday] || "-")}</td>
      <td>${String(row.hour).padStart(2, "0")}시</td>
      <td>${escapeHtml(row.itemName)}</td>
      <td>${escapeHtml(row.grade || "-")}</td>
      <td>${escapeHtml(row.contentName || "-")}</td>
      <td>${escapeHtml(row.source)}</td>
      <td>${escapeHtml(maskAnonymousId(row.anonymousId))}</td>
    </tr>
  `).join("");

  const detectedItems = stats.itemNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("") || `<span>집계 전</span>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>던클리 서약별 요일/시간 통계</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #080b12; color: #f4f4f5; font-family: Arial, "Noto Sans KR", sans-serif; }
    .wrap { max-width: 1480px; margin: 0 auto; padding: 24px; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .desc { margin: 0; color: #a1a1aa; font-size: 14px; line-height: 1.6; }
    .nav a, .linkButton { display:inline-flex; color:#dbeafe; text-decoration:none; border:1px solid #334155; border-radius:10px; padding:8px 10px; background:#111827; font-weight:800; }
    .notice { border:1px solid #854d0e; background:#1c1917; color:#fde68a; padding:12px 14px; border-radius:14px; margin:14px 0 18px; line-height:1.55; font-size:13px; }
    .filters { display:flex; gap:8px; flex-wrap:wrap; align-items:end; margin-bottom:16px; border:1px solid #272b3a; background:#111827; border-radius:16px; padding:14px; }
    label { display:flex; flex-direction:column; gap:6px; color:#a1a1aa; font-size:12px; font-weight:800; }
    input, select { min-width:160px; border:1px solid #334155; background:#0f172a; color:#fff; border-radius:9px; padding:9px 10px; }
    button { border:0; border-radius:9px; padding:10px 12px; background:#4f46e5; color:#fff; font-weight:900; cursor:pointer; }
    .stats { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
    .stat { border:1px solid #272b3a; border-radius:14px; padding:14px; background:#111827; }
    .stat span { display:block; color:#a1a1aa; font-size:12px; margin-bottom:6px; }
    .stat strong { display:block; font-size:20px; }
    .card { border:1px solid #272b3a; border-radius:16px; background:#111827; padding:16px; overflow:hidden; margin-bottom:14px; }
    .card h2 { margin:0 0 6px; font-size:18px; }
    .cardDesc { margin:0 0 12px; color:#a1a1aa; font-size:13px; line-height:1.5; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .tableWrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { border-bottom:1px solid #272b3a; padding:10px 8px; text-align:left; vertical-align:middle; }
    th { color:#a1a1aa; font-size:12px; white-space:nowrap; }
    td.axis { font-weight:900; color:#bfdbfe; white-space:nowrap; }
    td.leader { font-weight:900; color:#fef3c7; }
    td.num { text-align:right; white-space:nowrap; }
    .compactTable { min-width: 620px; }
    .matrixTable { min-width: 1180px; }
    .matrixTable td, .matrixTable th { text-align:center; }
    .matrixTable td.axis, .matrixTable th:first-child { text-align:left; position:sticky; left:0; background:#111827; z-index:1; }
    .matrixTable .itemHead { min-width: 120px; white-space:normal; line-height:1.35; }
    .maxCell { background:#312e81; color:#fff; font-weight:900; border-left:1px solid #6366f1; border-right:1px solid #6366f1; }
    .totalCell { color:#e5e7eb; font-weight:900; }
    .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .chips span { display:inline-flex; border:1px solid #334155; background:#0f172a; color:#dbeafe; border-radius:999px; padding:6px 9px; font-size:12px; }
    .emptyBox { border:1px dashed #334155; color:#9ca3af; border-radius:12px; padding:18px; text-align:center; }
    @media (max-width:1000px) { .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } .grid { grid-template-columns:1fr; } .top { flex-direction:column; } }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="top">
      <div>
        <h1>던클리 서약별 요일/시간 통계</h1>
        <p class="desc">
          12개 서약을 기준으로 <b>무슨 요일에 어떤 서약이 가장 많이 집계됐는지</b>, <b>어떤 시간대에 어떤 서약이 가장 많이 집계됐는지</b> 확인하는 관리자 페이지입니다.<br>
          현재 필터: ${weekKey === "all" ? "전체 기간" : escapeHtml(weekKey)} / ${source === "all" ? "전체 소스" : escapeHtml(source)}
        </p>
      </div>
      <div class="nav"><a href="/${escapeHtml(adminPath)}/duncle">← 평균 관리자</a></div>
    </div>

    <div class="notice">
      이 통계는 던클리에 등록된 유저의 타임라인 기록을 기반으로 한 단순 집계입니다.
      실제 게임 내 드랍 확률이 요일이나 시간대에 따라 달라진다는 의미가 아닙니다.
    </div>

    <form class="filters" method="get" action="/${escapeHtml(adminPath)}/duncle/oath-stats">
      <label>주차 필터
        <input name="weekKey" value="${weekKey === "all" ? "all" : escapeHtml(weekKey)}" placeholder="all 또는 YYYY-MM-DD" />
      </label>
      <label>소스
        <select name="source">
          <option value="all" ${source === "all" ? "selected" : ""}>전체</option>
          <option value="nexon" ${source === "nexon" ? "selected" : ""}>넥슨</option>
          <option value="naver" ${source === "naver" ? "selected" : ""}>네이버</option>
          <option value="unknown" ${source === "unknown" ? "selected" : ""}>unknown</option>
        </select>
      </label>
      <button type="submit">조회</button>
      <a class="linkButton" href="/${escapeHtml(adminPath)}/duncle/oath-stats?weekKey=${escapeHtml(currentWeekKey)}">이번 주 보기</a>
      <a class="linkButton" href="/${escapeHtml(adminPath)}/duncle/oath-stats?weekKey=all">전체 보기</a>
    </form>

    <section class="stats">
      <div class="stat"><span>서약 로그</span><strong>${stats.totalCount.toLocaleString()}개</strong></div>
      <div class="stat"><span>참여 유저</span><strong>${stats.userCount.toLocaleString()}명</strong></div>
      <div class="stat"><span>감지된 서약 종류</span><strong>${escapeHtml(itemCountLabel)}</strong></div>
      <div class="stat"><span>넥슨 / 네이버</span><strong>${stats.nexonCount.toLocaleString()} / ${stats.naverCount.toLocaleString()}</strong></div>
      <div class="stat"><span>최근 갱신</span><strong>${escapeHtml(stats.lastUpdatedAt || "-")}</strong></div>
    </section>

    <section class="card">
      <h2>감지된 서약 목록</h2>
      <p class="cardDesc">DB에 저장된 서약명을 기준으로 자동 구성됩니다. 정상적으로 쌓이면 12종이 표시됩니다.</p>
      <div class="chips">${detectedItems}</div>
    </section>

    <section class="grid">
      <div class="card tableWrap">
        <h2>요일별 가장 많이 집계된 서약</h2>
        <p class="cardDesc">각 요일마다 12개 서약 중 가장 많이 나온 서약을 보여줍니다.</p>
        ${renderLeaderTable(stats.weekdayItemLeaders, "요일")}
      </div>
      <div class="card tableWrap">
        <h2>시간대별 가장 많이 집계된 서약</h2>
        <p class="cardDesc">00시부터 23시까지, 각 시간대마다 가장 많이 나온 서약을 보여줍니다.</p>
        ${renderLeaderTable(stats.hourItemLeaders, "시간대")}
      </div>
    </section>

    <section class="card tableWrap">
      <h2>요일 × 서약 상세표</h2>
      <p class="cardDesc">행마다 가장 많이 나온 서약은 강조 표시됩니다.</p>
      ${renderMatrixTable(stats.weekdayItemLeaders, stats.itemNames, "요일")}
    </section>

    <section class="card tableWrap">
      <h2>시간대 × 서약 상세표</h2>
      <p class="cardDesc">행마다 가장 많이 나온 서약은 강조 표시됩니다.</p>
      ${renderMatrixTable(stats.hourItemLeaders, stats.itemNames, "시간대")}
    </section>

    <section class="card tableWrap">
      <h2>최근 서약 로그</h2>
      <table style="min-width:1050px">
        <thead>
          <tr>
            <th>획득 시간</th>
            <th>요일</th>
            <th>시간대</th>
            <th>서약명</th>
            <th>등급</th>
            <th>콘텐츠</th>
            <th>소스</th>
            <th>익명 ID</th>
          </tr>
        </thead>
        <tbody>${recentRows || `<tr><td colspan="8">등록된 서약 로그가 없습니다.</td></tr>`}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function registerDuncleOathStatsFeature(app, db, options = {}) {
  initDuncleOathStatsTables(db);

  const adminPath = clampText(options.adminPath || process.env.DUNCLE_ADMIN_PATH || "duncle_hidden", 120);

  app.options("/api/duncle/oath-drop-logs", (req, res) => {
    setApiCors(req, res);
    res.status(204).end();
  });

  app.get("/api/duncle/oath-stats", (req, res) => {
    setApiCors(req, res);
    const weekKeyRaw = String(req.query.weekKey || req.query.week_key || "all");
    const sourceRaw = String(req.query.source || "all");
    const weekKey = weekKeyRaw === "all" ? "all" : getWeekKey(weekKeyRaw);
    const source = ["nexon", "naver", "unknown"].includes(sourceRaw) ? sourceRaw : "all";
    res.json({ ok: true, weekKey, source, stats: getOathStats(db, { weekKey, source }) });
  });

  app.post("/api/duncle/oath-drop-logs", (req, res) => {
    setApiCors(req, res);

    try {
      const result = saveOathDropLogs(db, {
        anonymousId: req.body?.anonymousId || req.body?.anonymous_id,
        source: req.body?.source,
        weekKey: req.body?.weekKey || req.body?.week_key,
        logs: req.body?.logs,
      });

      if (!result.ok) return res.status(result.status || 400).json(result);

      return res.json({
        ...result,
        stats: getOathStats(db, { weekKey: result.weekKey || getCurrentWeekKeyKST() }),
      });
    } catch (error) {
      console.error("[Duncle Oath Stats API]", error);
      return res.status(500).json({ ok: false, message: "서약 드랍 로그 저장 중 서버 오류가 발생했습니다." });
    }
  });

  app.get(`/${adminPath}/duncle/oath-stats`, (req, res) => {
    res.send(renderOathStatsAdminPage(db, {
      adminPath,
      weekKey: req.query.weekKey || req.query.week_key || "all",
      source: req.query.source || "all",
    }));
  });

  console.log(`[Duncle] Oath item stats feature enabled. Admin: /${adminPath}/duncle/oath-stats`);
}



// =====================
// Start
// =====================
seedDefaultRaids();

// =====================
// Duncle Oath Stats Feature
// =====================
registerDuncleOathStatsFeature(app, db, {
  adminPath: process.env.DUNCLE_ADMIN_PATH || "duncle_hidden",
});

// =====================
// Homework Feature
// =====================
registerHomeworkFeature(app);

// =====================
// Timeline Feature
// =====================
registerTimelineFeature(app, db, {
  ADMIN_BASE,
  requireAdmin,
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
