// server.js (ESM / "type": "module")
"use strict";

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
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

// =====================
// Options
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내황혼전" },
  { key: "nabel-hard", label: "나벨 - 하드모드" },
  { key: "updoong", label: "업둥교환" },
];

const GRADE_OPTIONS = [
  { key: "", label: "치즈 선택" },
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "log", label: "통나무" },
  { key: "normal", label: "일반 치즈" },
];

// 정렬 우선순위: 스트리머 > 불타는 > 분홍 > 노란/통나무 > 일반
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

  -- 업둥교환 전용 (2업둥 1개/2개)
  up2 INTEGER NOT NULL DEFAULT 0,
  up22 INTEGER NOT NULL DEFAULT 0,

  confirmed INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  request_note TEXT NOT NULL DEFAULT '',
  start_party INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_applications_date_raid
ON applications(date_kst, raid_key);

-- 레이드별 진행일 + 인증키
CREATE TABLE IF NOT EXISTS day_codes (
  raid_key TEXT PRIMARY KEY,
  date_kst TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/* 일반 레이드 편성표 */
CREATE TABLE IF NOT EXISTS raid_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL,
  role TEXT NOT NULL,           -- 'buffer' | 'dealer'
  slot_index INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  application_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lineups_key
ON raid_lineups(date_kst, raid_key, party_index);

/* 비활성 공대 (일반 레이드 + 업둥 세트도 같이 사용) */
CREATE TABLE IF NOT EXISTS raid_disabled_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  party_index INTEGER NOT NULL,
  UNIQUE(date_kst, raid_key, party_index)
);

/* 업둥 편성표 (slot_index 연속 저장, 12명=1세트) */
CREATE TABLE IF NOT EXISTS up_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  slot_index INTEGER NOT NULL, -- 1..N (12명=1세트)
  nickname TEXT NOT NULL,
  application_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(date_kst, raid_key, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_up_lineups_key
ON up_lineups(date_kst, raid_key, slot_index);
`);

// 컬럼 체크
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
function gradeLabel(key) {
  if (key === "streamer") return "스트리머";
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
    .prepare("SELECT party_index FROM raid_disabled_parties WHERE raid_key=? AND date_kst=?")
    .all(raidKey, dateKst);
  return new Set(rows.map((r) => r.party_index));
}

// 레이드별 공대 구성
function getRaidConfig(raidKey) {
  if (raidKey === "inhwagongjeon") return { buffersPerParty: 2, dealersPerParty: 6 };
  return { buffersPerParty: 3, dealersPerParty: 9 };
}

// =====================
// Static (NEW UI)
// =====================
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

function sendIndexHtml(res) {
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (!fs.existsSync(indexPath)) {
    // public/index.html 없으면 최소 안내 페이지
    return res.status(500).send(`
      <h2>public/index.html 이 없습니다.</h2>
      <p>새로 만든 사이트 디자인 파일을 <b>public/index.html</b> 로 넣어주세요.</p>
      <p>예: public/index.html, public/app.js, public/style.css</p>
    `);
  }
  res.sendFile(indexPath);
}

// =====================
// Auth middleware (Viewer cookie)
// =====================
function requireViewerOk(req, res, next) {
  const raid = String(req.query.raid || req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.status(400).json({ ok: false, error: "INVALID_RAID" });

  const activeDay = getActiveDay(raid);
  const cookieKey = `viewer_ok_${raid}_${activeDay}`;

  if (req.cookies[cookieKey] !== "1") {
    return res.status(401).json({ ok: false, error: "NEED_VERIFY", raid, date_kst: activeDay });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).send("ADMIN_KEY가 설정되지 않았습니다.");
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

// /admin 숨김 처리
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// SPA routes -> index.html
// (새 UI에서 /verify, /reserve 같은 경로를 프론트 라우팅으로 쓰고 싶을 때)
// =====================
app.get("/", (req, res) => sendIndexHtml(res));
app.get("/verify", (req, res) => sendIndexHtml(res));
app.get("/reserve", (req, res) => sendIndexHtml(res));
app.get("/check", (req, res) => sendIndexHtml(res));
app.get("/lineup", (req, res) => sendIndexHtml(res));

// =====================
// API: public meta
// =====================
app.get("/api/meta", (req, res) => {
  res.json({
    ok: true,
    kst: todayKST(),
    raids: RAID_OPTIONS,
    grades: GRADE_OPTIONS,
  });
});

// =====================
// API: verify (기능 연결)
// =====================
// 프론트에서: POST /api/verify { raid, code }
app.post("/api/verify", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.status(400).json({ ok: false, error: "INVALID_RAID" });

  const row = getActiveCodeRow(raid);
  if (!row || String(row.code) !== code) {
    return res.status(403).json({ ok: false, error: "BAD_CODE" });
  }

  const activeDay = row.date_kst;
  res.cookie(`viewer_ok_${raid}_${activeDay}`, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.json({ ok: true, raid, date_kst: activeDay, raid_label: raidObj.label });
});

// =====================
// API: reserve (기능 연결)
// =====================
// 프론트에서: POST /api/reserve (requireViewerOk)
// body:
//   raid, viewer_grade, chzzk_nickname, adventure_name,
//   dealer_count, buffer_count,
//   up2, up22,
//   start_party
app.post("/api/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.status(400).json({ ok: false, error: "INVALID_RAID" });

  const isUp = raid === "updoong";

  const activeRow = getActiveCodeRow(raid);
  if (!activeRow || !activeRow.code) {
    return res.status(400).json({ ok: false, error: "NO_ACTIVE_CODE" });
  }
  const activeDay = activeRow.date_kst;

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();

  let dealer_count = Number(req.body.dealer_count);
  let buffer_count = Number(req.body.buffer_count);

  const up2 = req.body.up2 ? 1 : 0;
  const up22 = req.body.up22 ? 1 : 0;

  // 원하는 시작 기수
  let start_party = parseInt(String(req.body.start_party || "").trim(), 10);
  if (!Number.isInteger(start_party) || start_party < 1) start_party = 1;
  if (start_party > 99) start_party = 99;

  const validGradeKeys = new Set(GRADE_OPTIONS.map((g) => g.key));
  if (!viewer_grade || !validGradeKeys.has(viewer_grade) || viewer_grade === "") {
    return res.status(400).json({ ok: false, error: "NEED_GRADE" });
  }
  if (!chzzk_nickname || !adventure_name) {
    return res.status(400).json({ ok: false, error: "NEED_NAME" });
  }

  if (isUp) {
    if (!up2 && !up22) return res.status(400).json({ ok: false, error: "NEED_UP2" });

    // 2개 체크하면 1개도 자동 포함처럼 (데이터는 둘 다 1)
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
    ).run(nowISO(), activeDay, raid, viewer_grade, chzzk_nickname, adventure_name, finalUp2, finalUp22, start_party);
  } else {
    if (!Number.isFinite(dealer_count)) dealer_count = 0;
    if (!Number.isFinite(buffer_count)) buffer_count = 0;

    dealer_count = Math.max(0, Math.min(999, Math.floor(dealer_count)));
    buffer_count = Math.max(0, Math.min(999, Math.floor(buffer_count)));

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
    ).run(nowISO(), activeDay, raid, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, start_party);
  }

  return res.json({ ok: true, raid, date_kst: activeDay, raid_label: raidObj.label });
});

// =====================
// API: check list (viewer)
// =====================
app.get("/api/check", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.status(400).json({ ok: false, error: "INVALID_RAID" });

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

  return res.json({
    ok: true,
    raid,
    raid_label: raidObj.label,
    date_kst: activeDay,
    isUp,
    total: apps.length,
    confirmed: apps.filter((a) => a.confirmed === 1).length,
    items: apps.map((a) => ({
      id: a.id,
      viewer_grade: a.viewer_grade,
      viewer_grade_label: gradeLabel(a.viewer_grade),
      chzzk_nickname: a.chzzk_nickname,
      adventure_name: a.adventure_name,
      dealer_count: a.dealer_count,
      buffer_count: a.buffer_count,
      up2: !!a.up2,
      up22: !!a.up22,
      confirmed: !!a.confirmed,
      comment: a.comment || "",
      start_party: Number(a.start_party || 1) || 1,
      created_at: a.created_at,
    })),
  });
});

// =====================
// Lineup helpers
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

// 업둥 helpers (12명=1세트)
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
    .prepare(`SELECT MAX(slot_index) AS mx FROM up_lineups WHERE raid_key='updoong' AND date_kst=?`)
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

// =====================
// 업둥교환 자동배치 (confirmed=1 기반)
// =====================
function rebuildUpdoongLineup(dateKst) {
  const MAX_PARTY = 2; // 업둥교환 최대 2세트
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

  const usedCount = new Map(); // party -> number
  const nameSet = new Map(); // party -> Set

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
// Apply lineup for single application (일반 레이드 + 업둥)
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
      SELECT party_index, role, slot_index, nickname
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
// API: lineup (viewer)
// =====================
app.get("/api/lineup", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.status(400).json({ ok: false, error: "INVALID_RAID" });

  const dateKst = getActiveDay(raid);

  if (raid === "updoong") {
    const map = getUpLineupMap(dateKst);
    const disabledSet = getDisabledPartySet("updoong", dateKst);

    const maxSlot = Math.max(12, getMaxUpSlot(dateKst));
    const partyCount = Math.max(1, Math.ceil(maxSlot / 12), ...Array.from(disabledSet, (p) => Number(p) || 0));

    const parties = [];
    for (let p = 1; p <= partyCount; p++) {
      const isDisabled = disabledSet.has(p);
      const base = (p - 1) * 12;
      const slots = [];
      for (let i = 1; i <= 12; i++) {
        const slotIndex = base + i;
        slots.push({ slot_index: slotIndex, nickname: map.get(slotIndex) || "" });
      }
      parties.push({ party_index: p, disabled: isDisabled, slots });
    }

    return res.json({
      ok: true,
      raid,
      raid_label: raidObj.label,
      date_kst: dateKst,
      type: "updoong",
      parties,
    });
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

  const partyIndices = new Set([...partyMap.keys(), ...disabledSet]);
  const all = Array.from(partyIndices).sort((a, b) => a - b);

  const parties = all.map((p) => {
    const data = partyMap.get(p) || { buffers: {}, dealers: {} };
    return {
      party_index: p,
      disabled: disabledSet.has(p),
      buffers: Array.from({ length: cfg.buffersPerParty }, (_, i) => data.buffers[i + 1] || ""),
      dealers: Array.from({ length: cfg.dealersPerParty }, (_, i) => data.dealers[i + 1] || ""),
    };
  });

  return res.json({
    ok: true,
    raid,
    raid_label: raidObj.label,
    date_kst: dateKst,
    type: "normal",
    cfg,
    parties,
  });
});

// =====================
// Admin (기존 운영 방식 유지: 로그인/신청목록/확정/코멘트/자동배치/편성표)
// =====================

app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

app.get(`${ADMIN_BASE}/login`, (req, res) => {
  res.send(`
    <html><body style="font-family:system-ui;padding:24px;">
      <h2>관리자 로그인</h2>
      <form method="POST" action="${esc(ADMIN_BASE)}/login">
        <input name="key" placeholder="ADMIN_KEY" required />
        <button type="submit">입장</button>
      </form>
      <p style="opacity:.7;margin-top:12px;">(새 UI는 public/index.html에서 서비스됩니다)</p>
    </body></html>
  `);
});

app.post(`${ADMIN_BASE}/login`, (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(403).send("키가 올바르지 않습니다.");

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

// 관리자 대시보드(간단 유지)
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  res.send(`
    <html><body style="font-family:system-ui;padding:24px;">
      <h2>관리자</h2>
      <p>진행일/인증키 설정, 스트리머 예약, 신청목록/편성표 관리</p>
      <p><a href="${esc(ADMIN_BASE)}/logout">로그아웃</a></p>

      <h3>진행일 + 인증키 설정</h3>
      <form method="POST" action="${esc(ADMIN_BASE)}/code">
        <select name="raid" required>
          <option value="">레이드 선택</option>
          ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
        </select>
        <input name="date_kst" value="${esc(todayKST())}" placeholder="YYYY-MM-DD" required />
        <input name="code" placeholder="인증키" required />
        <button type="submit">저장</button>
      </form>

      <h3 style="margin-top:18px;">스트리머 예약(암종호)</h3>
      <form method="POST" action="${esc(ADMIN_BASE)}/streamer-reserve">
        <select name="raid" required>
          <option value="">레이드 선택</option>
          ${RAID_OPTIONS.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
        </select>
        <input name="dealer_count" inputmode="numeric" placeholder="딜러 수" required />
        <input name="buffer_count" inputmode="numeric" placeholder="버퍼 수" required />
        <button type="submit">추가</button>
      </form>

      <h3 style="margin-top:18px;">신청목록 바로가기</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${RAID_OPTIONS.map(
          (r) =>
            `<a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(r.key)}&sort=grade"
              style="padding:8px 10px;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:#111;">
              ${esc(r.label)}
            </a>`
        ).join("")}
      </div>
    </body></html>
  `);
});

app.post(`${ADMIN_BASE}/code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const date_kst = String(req.body.date_kst || "").trim();

  if (!raidByKey(raid) || !code || !isValidKstDate(date_kst)) return res.redirect(`${ADMIN_BASE}/raid`);

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
  ).run(nowISO(), dateKst, raid, "streamer", "암종호", "암종호", dealer_count, buffer_count);

  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 관리자: 신청목록(최소 기능형)
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "grade");
  const upFilter = req.query.up === "1" ? "1" : req.query.up === "2" ? "2" : "";
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const isUp = raid === "updoong";
  const activeDay = getActiveDay(raid);

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

  res.send(`
    <html><body style="font-family:system-ui;padding:24px;">
      <h2>신청목록 - ${esc(raidObj.label)} (${esc(activeDay)})</h2>
      <p>
        <a href="${esc(ADMIN_BASE)}/raid">← 관리자</a>
        &nbsp;|&nbsp;
        <a href="${esc(ADMIN_BASE)}/lineup?raid=${encodeURIComponent(raid)}">편성표</a>
      </p>

      ${isUp ? `
        <p>
          필터:
          <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}">전체</a> /
          <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}&up=1">1세트</a> /
          <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}&up=2">2세트</a>
        </p>
      ` : ""}

      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1200px;">
        <tr>
          <th>완료</th><th>치즈</th><th>닉네임</th><th>모험단</th>
          ${isUp ? "<th>1세트</th><th>2세트</th>" : "<th>딜러</th><th>버퍼</th>"}
          <th>시작기수</th><th>코멘트</th><th>삭제</th>
        </tr>
        ${
          apps.map((a) => {
            const checked = a.confirmed === 1 ? "checked" : "";
            const startPartyNum = Number(a.start_party || 1) || 1;
            return `
              <tr>
                <td>
                  <form method="POST" action="${esc(ADMIN_BASE)}/confirm" style="margin:0;">
                    <input type="hidden" name="id" value="${esc(a.id)}"/>
                    <input type="hidden" name="raid" value="${esc(raid)}"/>
                    <input type="hidden" name="sort" value="${esc(sort)}"/>
                    <input type="hidden" name="confirmed" value="${a.confirmed === 1 ? "0" : "1"}"/>
                    <input type="checkbox" ${checked} onchange="this.form.submit()"/>
                  </form>
                </td>
                <td>${esc(gradeLabel(a.viewer_grade))}</td>
                <td>${esc(a.chzzk_nickname)}</td>
                <td>${esc(a.adventure_name)}</td>
                ${
                  isUp
                    ? `<td style="text-align:center;">${a.up2 ? "✔" : "-"}</td><td style="text-align:center;">${a.up22 ? "✔" : "-"}</td>`
                    : `<td style="text-align:center;">${esc(a.dealer_count)}</td><td style="text-align:center;">${esc(a.buffer_count)}</td>`
                }
                <td style="text-align:center;">${startPartyNum}</td>
                <td>
                  <form method="POST" action="${esc(ADMIN_BASE)}/comment" style="margin:0;display:flex;gap:6px;">
                    <input type="hidden" name="id" value="${esc(a.id)}"/>
                    <input type="hidden" name="raid" value="${esc(raid)}"/>
                    <input type="hidden" name="sort" value="${esc(sort)}"/>
                    <input name="comment" value="${esc(String(a.comment || "").slice(0, 12))}" maxlength="12"/>
                    <button type="submit">저장</button>
                  </form>
                </td>
                <td>
                  <form method="POST" action="${esc(ADMIN_BASE)}/delete" style="margin:0;"
                        onsubmit="return confirm('삭제할까요?');">
                    <input type="hidden" name="id" value="${esc(a.id)}"/>
                    <input type="hidden" name="raid" value="${esc(raid)}"/>
                    <input type="hidden" name="sort" value="${esc(sort)}"/>
                    <button type="submit">삭제</button>
                  </form>
                </td>
              </tr>
            `;
          }).join("")
        }
      </table>

      <h3 style="margin-top:18px;">치즈 등급별 일괄등록</h3>
      <p style="opacity:.75;">누르면 해당 그룹이 등록완료 처리되고 편성표에 반영됩니다.</p>

      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${["burning","pink","yellowlog","normal"].map((g) => `
          <form method="POST" action="${esc(ADMIN_BASE)}/bulk-confirm" style="margin:0;"
                onsubmit="return confirm('일괄 등록+배치 할까요?');">
            <input type="hidden" name="raid" value="${esc(raid)}"/>
            <input type="hidden" name="sort" value="${esc(sort)}"/>
            ${isUp && upFilter ? `<input type="hidden" name="up" value="${esc(upFilter)}"/>` : ""}
            <input type="hidden" name="group" value="${esc(g)}"/>
            <button type="submit">${esc(g)}</button>
          </form>
        `).join("")}
      </div>
    </body></html>
  `);
});

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
      WHERE date_kst=? AND raid_key=? AND viewer_grade IN (${placeholders})
      ORDER BY datetime(created_at) ASC, id ASC
    `
    )
    .all(dateKst, raid, ...gradeKeys);

  db.prepare(
    `
    UPDATE applications
    SET confirmed=1
    WHERE date_kst=? AND raid_key=? AND viewer_grade IN (${placeholders})
  `
  ).run(dateKst, raid, ...gradeKeys);

  if (raid === "updoong") {
    rebuildUpdoongLineup(dateKst);
  } else {
    for (const r of targetRows) applyLineupForApplication(Number(r.id), true);
  }

  const upQS = up === "1" || up === "2" ? `&up=${encodeURIComponent(up)}` : "";
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}${upQS}`);
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

  if (Number.isInteger(id)) db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, id);
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

// 관리자: 편성표(데이터만 필요하면 프론트에서 /api/lineup 쓰면 됨)
app.get(`${ADMIN_BASE}/lineup`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  res.send(`
    <html><body style="font-family:system-ui;padding:24px;">
      <h2>편성표 (데이터는 /api/lineup 로 제공)</h2>
      <p>레이드: <b>${esc(raidObj.label)}</b> / 진행일: <b>${esc(getActiveDay(raid))}</b></p>
      <p>
        <a href="${esc(ADMIN_BASE)}/list?raid=${encodeURIComponent(raid)}&sort=grade">← 신청목록</a>
      </p>
      <pre style="background:#111;color:#0f0;padding:12px;border-radius:8px;overflow:auto;">GET /api/lineup?raid=${esc(raid)}</pre>
      <p style="opacity:.75;">(새 UI에서 이 API로 편성표를 렌더링하면 됨)</p>
    </body></html>
  `);
});

// =====================
// Health
// =====================
app.get("/health", (req, res) => res.json({ ok: true, kst: todayKST(), admin: ADMIN_BASE }));

// =====================
// Start
// =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
