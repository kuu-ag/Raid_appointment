// homeworkFeature.js (ESM / "type": "module")
// 데본베일 관측기 - 숙제현황 총합 기능
"use strict";

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://api.neople.co.kr";
const DEFAULT_TRACKED_PATH = path.join(__dirname, "trackedcharacters.json");
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CONCURRENCY = 5;

const CONTENTS = [
  {
    key: "dirige",
    label: "디레지에 레이드",
    contentKeywords: ["디레지에"],
    clearKeywords: ["클리어", "토벌", "공격대", "레이드"],
  },
  {
    key: "nabel",
    label: "나벨 레이드",
    contentKeywords: ["나벨", "인공신 나벨", "나벨 : 하드", "인공신 나벨 : 하드"],
    clearKeywords: ["클리어", "토벌", "공격대", "레이드", "완료"],
  },
  {
    key: "apocalypse",
    label: "아포칼립스 레기온",
    contentKeywords: ["아포칼립스"],
    clearKeywords: ["클리어", "토벌", "완료"],
  },
];

let summaryCache = null;
let characterIdCache = new Map();

export function registerHomeworkFeature(app, options = {}) {
  const trackedPath = process.env.TRACKED_CHARACTERS_PATH || options.trackedPath || DEFAULT_TRACKED_PATH;
  const concurrency = Math.max(1, Number(process.env.HOMEWORK_CONCURRENCY || options.concurrency || DEFAULT_CONCURRENCY));

  app.get("/api/duncle/homework-summary", async (req, res) => {
    try {
      const forceRefresh = String(req.query.refresh || "") === "1";
      const summary = await buildHomeworkSummary({ trackedPath, forceRefresh, concurrency });
      res.json(summary);
    } catch (error) {
      console.error("[Homework Summary API]", error);
      res.status(500).json({ ok: false, error: error.message || "숙제현황 조회 중 오류가 발생했습니다." });
    }
  });

  app.get("/observer/homework", async (req, res) => {
    try {
      const forceRefresh = String(req.query.refresh || "") === "1";
      const summary = await buildHomeworkSummary({ trackedPath, forceRefresh, concurrency });
      res.send(renderHomeworkPage(summary));
    } catch (error) {
      console.error("[Homework Page]", error);
      res.status(500).send(renderHomeworkErrorPage(error));
    }
  });
}

async function buildHomeworkSummary({ trackedPath, forceRefresh = false, concurrency = DEFAULT_CONCURRENCY }) {
  const now = Date.now();
  if (!forceRefresh && summaryCache && now - summaryCache.cachedAtMs < CACHE_TTL_MS) {
    return { ...summaryCache.data, cached: true };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("NEOPLE_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const trackedCharacters = await loadTrackedCharacters(trackedPath);
  const weekRange = getKstWeeklyRange();

  const initialCounts = Object.fromEntries(CONTENTS.map((c) => [c.key, 0]));
  const errors = [];

  const results = await mapLimit(trackedCharacters, concurrency, async (ch, index) => {
    try {
      const serverId = String(ch.server_id || ch.serverId || "").trim();
      const characterName = String(ch.character_name || ch.characterName || "").trim();
      if (!serverId || !characterName) {
        return { index, ok: false, reason: "server_id 또는 character_name 누락", clears: {} };
      }

      const characterId = await getCharacterId({ apiKey, serverId, characterName });
      if (!characterId) {
        return { index, ok: false, reason: "캐릭터 검색 실패", serverId, characterName, clears: {} };
      }

      const rows = await getTimelineRows({ apiKey, serverId, characterId, weekRange });
      const clears = detectClears(rows);
      return { index, ok: true, serverId, characterName, characterId, clears };
    } catch (error) {
      return {
        index,
        ok: false,
        reason: error.message || "조회 실패",
        serverId: ch.server_id || ch.serverId || "",
        characterName: ch.character_name || ch.characterName || "",
        clears: {},
      };
    }
  });

  const clearedCounts = { ...initialCounts };
  for (const r of results) {
    if (!r.ok) errors.push(r);
    for (const c of CONTENTS) {
      if (r.clears?.[c.key]) clearedCounts[c.key] += 1;
    }
  }

  const totalCharacters = trackedCharacters.length;
  const contents = CONTENTS.map((c) => {
    const clearedCount = clearedCounts[c.key] || 0;
    const remainingCount = Math.max(0, totalCharacters - clearedCount);
    const progressRate = totalCharacters > 0 ? Number(((clearedCount / totalCharacters) * 100).toFixed(1)) : 0;
    return {
      key: c.key,
      label: c.label,
      clearedCount,
      remainingCount,
      totalCount: totalCharacters,
      progressRate,
    };
  });

  const data = {
    ok: true,
    totalCharacters,
    contents,
    weekStartKst: weekRange.startText,
    weekEndKst: weekRange.endText,
    checkedAtKst: formatKstText(new Date()),
    trackedPath,
    errorCount: errors.length,
    // 화면에는 캐릭터별 상세를 노출하지 않지만, 문제 추적용으로 실패 요약만 제공합니다.
    errors: errors.slice(0, 20).map((e) => ({
      serverId: e.serverId,
      characterName: e.characterName,
      reason: e.reason,
    })),
    cached: false,
  };

  summaryCache = { cachedAtMs: now, data };
  return data;
}

function getApiKey() {
  return String(process.env.NEOPLE_API_KEY || process.env.DNF_API_KEY || process.env.NEOPLE_KEY || "").trim();
}

async function loadTrackedCharacters(trackedPath) {
  const raw = await fs.readFile(trackedPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("trackedcharacters.json은 배열 형태여야 합니다.");
  return parsed.filter((ch) => String(ch.server_id || ch.serverId || "").trim() && String(ch.character_name || ch.characterName || "").trim());
}

async function getCharacterId({ apiKey, serverId, characterName }) {
  const cacheKey = `${serverId}:${characterName}`;
  if (characterIdCache.has(cacheKey)) return characterIdCache.get(cacheKey);

  const url = new URL(`${API_BASE}/df/servers/${encodeURIComponent(serverId)}/characters`);
  url.searchParams.set("characterName", characterName);
  url.searchParams.set("wordType", "match");
  url.searchParams.set("limit", "10");
  url.searchParams.set("apikey", apiKey);

  const data = await fetchJson(url);
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  const exact = rows.find((r) => String(r.characterName || "") === characterName) || rows[0];
  const characterId = exact?.characterId || "";
  characterIdCache.set(cacheKey, characterId);
  return characterId;
}

async function getTimelineRows({ apiKey, serverId, characterId, weekRange }) {
  const url = new URL(`${API_BASE}/df/servers/${encodeURIComponent(serverId)}/characters/${encodeURIComponent(characterId)}/timeline`);
  url.searchParams.set("startDate", weekRange.startText);
  url.searchParams.set("endDate", weekRange.endText);
  url.searchParams.set("limit", "100");
  url.searchParams.set("apikey", apiKey);

  const data = await fetchJson(url);
  return Array.isArray(data?.timeline?.rows) ? data.timeline.rows : [];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Neople API 오류: ${response.status} ${text.slice(0, 120)}`);
  }

  return response.json();
}

function detectClears(rows) {
  const result = Object.fromEntries(CONTENTS.map((c) => [c.key, false]));

  for (const row of rows || []) {
    const text = flattenForSearch(row);
    for (const c of CONTENTS) {
      if (result[c.key]) continue;
      const hasContent = c.contentKeywords.some((kw) => text.includes(kw));
      const hasClear = c.clearKeywords.some((kw) => text.includes(kw));
      if (hasContent && hasClear) result[c.key] = true;
    }
  }

  return result;
}

function flattenForSearch(value) {
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function getKstWeeklyRange(nowUtc = new Date()) {
  const KST = 9 * 60 * 60 * 1000;
  const nowKstMs = nowUtc.getTime() + KST;
  const nowKst = new Date(nowKstMs);

  const y = nowKst.getUTCFullYear();
  const m = nowKst.getUTCMonth();
  const d = nowKst.getUTCDate();
  const day = nowKst.getUTCDay(); // 0=일, 4=목

  const daysSinceThursday = (day - 4 + 7) % 7;
  let startPseudoKstMs = Date.UTC(y, m, d - daysSinceThursday, 10, 0, 0, 0);

  // 목요일이지만 오전 10시 전이면 전주 목요일 10시를 기준으로 처리
  const currentThursdayStart = new Date(startPseudoKstMs);
  if (nowKstMs < currentThursdayStart.getTime()) {
    startPseudoKstMs -= 7 * 24 * 60 * 60 * 1000;
  }

  const endPseudoKstMs = nowKstMs;
  return {
    startText: formatPseudoKstDate(new Date(startPseudoKstMs)),
    endText: formatPseudoKstDate(new Date(endPseudoKstMs)),
  };
}

function formatKstText(dateUtc) {
  const KST = 9 * 60 * 60 * 1000;
  return formatPseudoKstDate(new Date(dateUtc.getTime() + KST));
}

function formatPseudoKstDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const mi = pad2(date.getUTCMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHomeworkPage(summary) {
  const cards = summary.contents
    .map((c) => {
      return `
        <section class="homework-card">
          <div class="homework-card-top">
            <div>
              <div class="homework-title">${esc(c.label)}</div>
              <div class="homework-sub">클리어 ${esc(c.clearedCount)} / ${esc(c.totalCount)}</div>
            </div>
            <div class="homework-percent">${esc(c.progressRate)}%</div>
          </div>
          <div class="homework-bar">
            <div class="homework-bar-fill" style="width:${Math.max(0, Math.min(100, Number(c.progressRate || 0)))}%"></div>
          </div>
        </section>
      `;
    })
    .join("");

  const errorNotice = summary.errorCount
  ? `
    <div class="homework-alert">
      일부 캐릭터 조회 실패: ${esc(summary.errorCount)}개<br/>
      ${summary.errors && summary.errors.length
        ? `
          <div style="margin-top:8px;line-height:1.7;">
            ${summary.errors.map((e) => `
              <div>
                - ${esc(e.serverId || "-")} / ${esc(e.characterName || "-")}
                <span style="color:#fcd34d;">(${esc(e.reason || "조회 실패")})</span>
              </div>
            `).join("")}
          </div>
        `
        : `API 응답/캐릭터명/서버명을 확인해 주세요.`
      }
    </div>
  `
  : "";

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>데본베일 관측기 - 숙제현황</title>
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
    *{box-sizing:border-box;font-family:Pretendard,sans-serif;}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at top left,rgba(107,114,255,.18),transparent 35%),linear-gradient(180deg,#0f1024,#13142b);color:#f8fafc;padding:22px;}
    a{color:inherit;text-decoration:none;}
    .wrap{max-width:980px;margin:0 auto;}
    .panel{border:1px solid rgba(107,114,255,.65);background:linear-gradient(180deg,rgba(27,28,59,.96),rgba(24,25,52,.96));border-radius:18px;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,.22);}
    .header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px;}
    h1{font-size:28px;margin:0 0 8px;font-weight:900;}
    .muted{color:#a5b4fc;font-size:14px;line-height:1.7;}
    .actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;}
    .btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(148,163,255,.35);background:rgba(38,40,77,.85);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:800;}
    .btn.primary{background:linear-gradient(135deg,#4f46e5,#6b72ff);border-color:#7c83ff;}
    .summary{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0;}
    .chip{border:1px solid rgba(148,163,255,.25);background:rgba(107,114,255,.12);border-radius:999px;padding:7px 11px;color:#dbe4ff;font-size:13px;font-weight:700;}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px;}
    .homework-card{background:rgba(38,40,77,.74);border:1px solid rgba(148,163,255,.18);border-radius:16px;padding:20px;}
    .homework-card-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;}
    .homework-title{font-size:20px;font-weight:900;margin-bottom:8px;}
    .homework-sub{font-size:15px;color:#c7d2fe;font-weight:800;}
    .homework-percent{font-size:28px;font-weight:900;color:#ffffff;}
    .homework-bar{height:12px;border-radius:999px;background:rgba(2,6,23,.45);border:1px solid rgba(148,163,255,.18);overflow:hidden;margin:18px 0 12px;}
    .homework-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#6366f1,#22c55e);}
    .homework-bottom{font-size:13px;color:#9ca3af;}
    .notice{margin-top:18px;border-top:1px solid rgba(148,163,255,.18);padding-top:16px;color:#9ca3af;font-size:13px;line-height:1.8;}
    .homework-alert{margin-top:14px;border:1px solid rgba(251,191,36,.35);background:rgba(251,191,36,.10);color:#fde68a;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6;}
    @media(max-width:720px){body{padding:14px}.header{flex-direction:column}.actions{justify-content:flex-start}.grid{grid-template-columns:1fr}.panel{padding:18px}h1{font-size:24px}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="header">
        <div>
          <h1>숙제현황</h1>
          <div class="muted">주간 숙제 종합입니다.</div>
        </div>
        <div class="actions">
          <a class="btn" href="/observer">관측기</a>
          <a class="btn primary" href="/observer/homework?refresh=1">새로고침</a>
        </div>
      </div>

      <div class="summary">
        <span class="chip">저장 캐릭터 ${esc(summary.totalCharacters)}개</span>
        <span class="chip">주간 기준 ${esc(summary.weekStartKst)} ~ ${esc(summary.weekEndKst)}</span>
        <span class="chip">마지막 갱신 ${esc(summary.checkedAtKst)}</span>
        ${summary.cached ? `<span class="chip">캐시 사용</span>` : ""}
      </div>

      <div class="grid">${cards}</div>
      ${errorNotice}

      <div class="notice">
        ※ 조회 기준은 KST 매주 목요일 오전 10시입니다.<br/>
        ※ 캐릭터별 상세 목록은 표시하지 않고, 레이드/레기온 총합만 제공합니다.<br/>
        ※ 조회가 느릴 수 있어 결과는 기본 10분간 캐시됩니다. 즉시 재조회하려면 새로고침 버튼을 누르세요.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderHomeworkErrorPage(error) {
  const message = error?.message || "숙제현황을 불러오지 못했습니다.";

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>숙제현황 오류</title>
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');

    *{
      box-sizing:border-box;
      font-family:Pretendard,sans-serif;
    }

    body{
      margin:0;
      min-height:100vh;
      background:linear-gradient(180deg,#0f1024,#13142b);
      color:#f8fafc;
      padding:24px;
    }

    .box{
      max-width:760px;
      margin:0 auto;
      border:1px solid rgba(107,114,255,.65);
      border-radius:16px;
      padding:22px;
      background:linear-gradient(180deg,rgba(27,28,59,.96),rgba(24,25,52,.96));
    }

    .bad{
      color:#fca5a5;
      font-weight:900;
      font-size:20px;
      margin-bottom:12px;
    }

    .muted{
      color:#9ca3af;
      line-height:1.7;
      font-size:14px;
    }

    .btn{
      display:inline-flex;
      margin-top:14px;
      align-items:center;
      justify-content:center;
      border:1px solid rgba(148,163,255,.35);
      background:rgba(38,40,77,.85);
      border-radius:10px;
      padding:10px 14px;
      color:#c7d2fe;
      text-decoration:none;
      font-size:13px;
      font-weight:800;
    }

    .btn:hover{
      background:rgba(63,66,128,.85);
      border-color:#6b72ff;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="bad">숙제현황 조회 오류</div>
    <p class="muted">${esc(message)}</p>
    <p class="muted">NEOPLE_API_KEY 환경변수와 trackedcharacters.json 파일 위치를 확인해 주세요.</p>
    <a class="btn" href="/observer">관측기로 돌아가기</a>
  </div>
</body>
</html>`;
}
