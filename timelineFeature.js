// timelineFeature.js
"use strict";

const NEOPLE_API_BASE = "https://api.neople.co.kr/df";

const SERVER_OPTIONS = [
  ["anton", "안톤"],
  ["bakal", "바칼"],
  ["cain", "카인"],
  ["casillas", "카시야스"],
  ["diregie", "디레지에"],
  ["hilder", "힐더"],
  ["prey", "프레이"],
  ["siroco", "시로코"]
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayKSTDate() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeNeopleDate(dateText, end = false) {
  // Neople 예시 형식: 2018-09-01 00:00
  return `${dateText} ${end ? "23:59" : "00:00"}`;
}

function getApiKey() {
  const key = (process.env.NEOPLE_API_KEY || "").trim();
  if (!key) {
    throw new Error("NEOPLE_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  return key;
}

async function neopleGet(path, params = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${NEOPLE_API_BASE}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Neople API 요청 실패: ${res.status} ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Neople API 응답을 JSON으로 해석하지 못했습니다.");
  }
}

async function searchCharacter(serverId, characterName) {
  const data = await neopleGet(`/servers/${serverId}/characters`, {
    characterName,
    wordType: "match",
    limit: 10
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];

  const exact = rows.find((row) => row.characterName === characterName);
  return exact || rows[0] || null;
}

async function fetchCharacterTimeline(serverId, characterId, startDate, endDate) {
  const rows = [];
  let next = "";
  let safety = 0;

  while (safety < 20) {
    safety += 1;

    const data = await neopleGet(`/servers/${serverId}/characters/${characterId}/timeline`, {
      startDate: normalizeNeopleDate(startDate, false),
      endDate: normalizeNeopleDate(endDate, true),
      limit: 100,
      next
    });

    const timeline = data.timeline || data;
    const pageRows = Array.isArray(timeline.rows) ? timeline.rows : [];

    rows.push(...pageRows);

    next = timeline.next || data.next || "";

    if (!next) {
      break;
    }
  }

  return rows;
}

function extractTimelineDate(row) {
  const dateText =
    row.date ||
    row.regDate ||
    row.time ||
    row.timelineDate ||
    row.createdDate ||
    "";

  if (!dateText) {
    return "";
  }

  const text = String(dateText);

  // 2026-05-03T12:34:56 / 2026-05-03 12:34 / 20260503T1234 대응
  const isoMatch = text.match(/(20\d{2})[-.](\d{2})[-.](\d{2})[T\s]?(\d{2})?:?(\d{2})?/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2];
    const dd = isoMatch[3];
    const hh = isoMatch[4] || "00";
    const mi = isoMatch[5] || "00";
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]} 00:00`;
  }

  return text;
}

function extractTimelineCode(row) {
  return String(row.code || row.type || row.name || "");
}

function extractTimelineMessage(row) {
  const data = row.data || {};

  const candidates = [
    row.name,
    row.message,
    row.htmlMessage,
    row.description,
    data.dungeonName,
    data.itemName,
    data.itemRarity,
    data.itemGradeName,
    data.channelName,
    data.raidName,
    data.result,
    JSON.stringify(data)
  ].filter(Boolean);

  return candidates.join(" ");
}

function classifyTimeline(row) {
  const text = extractTimelineMessage(row);

  let logType = "기타";
  if (text.includes("획득") || text.includes("itemName")) {
    logType = "아이템";
  }
  if (text.includes("클리어") || text.includes("처치") || text.includes("성공")) {
    logType = "클리어";
  }

  let rarity = "";
  if (text.includes("태초")) rarity = "태초";
  else if (text.includes("에픽")) rarity = "에픽";
  else if (text.includes("레전더리")) rarity = "레전더리";
  else if (text.includes("유니크")) rarity = "유니크";
  else if (text.includes("레어")) rarity = "레어";

  return { logType, rarity };
}

function initTimelineTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      character_id TEXT NOT NULL,
      character_name TEXT NOT NULL,
      memo TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      last_refreshed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, character_id)
    );

    CREATE TABLE IF NOT EXISTS character_timeline_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      character_id TEXT NOT NULL,
      character_name TEXT NOT NULL,
      log_key TEXT NOT NULL,
      timeline_date TEXT NOT NULL,
      log_type TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      message TEXT DEFAULT '',
      raw_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, character_id, log_key)
    );

    CREATE INDEX IF NOT EXISTS idx_timeline_logs_date
      ON character_timeline_logs(timeline_date);

    CREATE INDEX IF NOT EXISTS idx_timeline_logs_character
      ON character_timeline_logs(server_id, character_id);

    CREATE INDEX IF NOT EXISTS idx_timeline_logs_type
      ON character_timeline_logs(log_type, rarity);
  `);
}

function layout(title, body) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #080b12;
      color: #f4f4f5;
      font-family: Arial, "Noto Sans KR", sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
    }
    h1 { margin: 0; font-size: 26px; }
    .desc { margin: 8px 0 0; color: #a1a1aa; font-size: 14px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 16px; }
    .card {
      border: 1px solid #272b3a;
      border-radius: 16px;
      padding: 16px;
      background: #111827;
      margin-bottom: 16px;
    }
    .card h2 { margin: 0 0 12px; font-size: 17px; }
    label {
      display: block;
      margin: 12px 0 6px;
      color: #d4d4d8;
      font-size: 13px;
      font-weight: 800;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid #34394d;
      border-radius: 10px;
      padding: 10px;
      background: #080b12;
      color: #fff;
      outline: none;
    }
    textarea { min-height: 150px; resize: vertical; }
    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 10px;
      padding: 10px 12px;
      background: #7c3aed;
      color: #fff;
      font-weight: 900;
      cursor: pointer;
    }
    .btnSub { background: #27272a; }
    .btnDanger { background: #7f1d1d; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .muted { color: #a1a1aa; font-size: 12px; line-height: 1.45; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid #272b3a;
      padding: 10px 8px;
      vertical-align: top;
    }
    th { text-align: left; color: #a1a1aa; font-size: 12px; }
    .badge {
      display: inline-flex;
      padding: 4px 7px;
      border-radius: 999px;
      background: #27272a;
      color: #d4d4d8;
      font-size: 11px;
      font-weight: 800;
    }
    .badgeEpic { background: #312e81; color: #c7d2fe; }
    .badgeLegend { background: #78350f; color: #fde68a; }
    .badgePrimeval { background: #4c0519; color: #fda4af; }
    .log {
      border: 1px solid #272b3a;
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 10px;
      background: #0d111a;
    }
    .logTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .logMsg { color: #e4e4e7; line-height: 1.5; font-size: 13px; word-break: keep-all; }
    .pillbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .stat {
      flex: 1 1 120px;
      border: 1px solid #272b3a;
      border-radius: 12px;
      padding: 12px;
      background: #0d111a;
    }
    .stat span { display: block; color: #a1a1aa; font-size: 12px; }
    .stat strong { display: block; margin-top: 6px; font-size: 20px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .top { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="wrap">${body}</div>
</body>
</html>`;
}

function registerTimelineFeature(app, db, options = {}) {
  const ADMIN_BASE = options.ADMIN_BASE || "";
  initTimelineTables(db);

  const requireAdmin = options.requireAdmin || ((req, res, next) => next());

  app.get(`${ADMIN_BASE}/timeline`, requireAdmin, (req, res) => {
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "").trim();
    const rarity = String(req.query.rarity || "").trim();
    const character = String(req.query.character || "").trim();

    const characters = db.prepare(`
      SELECT *
      FROM tracked_characters
      ORDER BY enabled DESC, server_name, character_name
    `).all();

    const where = [];
    const params = {};

    if (q) {
      where.push(`message LIKE @q`);
      params.q = `%${q}%`;
    }

    if (type) {
      where.push(`log_type = @type`);
      params.type = type;
    }

    if (rarity) {
      where.push(`rarity = @rarity`);
      params.rarity = rarity;
    }

    if (character) {
      where.push(`character_name LIKE @character`);
      params.character = `%${character}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const logs = db.prepare(`
      SELECT *
      FROM character_timeline_logs
      ${whereSql}
      ORDER BY timeline_date DESC, id DESC
      LIMIT 300
    `).all(params);

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN log_type = '아이템' THEN 1 ELSE 0 END) AS itemCount,
        SUM(CASE WHEN log_type = '클리어' THEN 1 ELSE 0 END) AS clearCount,
        SUM(CASE WHEN rarity = '태초' THEN 1 ELSE 0 END) AS primevalCount,
        SUM(CASE WHEN rarity = '에픽' THEN 1 ELSE 0 END) AS epicCount,
        SUM(CASE WHEN rarity = '레전더리' THEN 1 ELSE 0 END) AS legendaryCount
      FROM character_timeline_logs
    `).get();

    const serverOptionsHtml = SERVER_OPTIONS.map(([id, name]) => {
      return `<option value="${escapeHtml(id)}">${escapeHtml(name)} (${escapeHtml(id)})</option>`;
    }).join("");

    const characterRows = characters.map((c) => `
      <tr>
        <td>${escapeHtml(c.server_name)}</td>
        <td><strong>${escapeHtml(c.character_name)}</strong><br><span class="muted">${escapeHtml(c.character_id)}</span></td>
        <td>${c.enabled ? `<span class="badge">ON</span>` : `<span class="badge">OFF</span>`}</td>
        <td><span class="muted">${escapeHtml(c.last_refreshed_at || "-")}</span></td>
        <td>
          <form method="post" action="${ADMIN_BASE}/timeline/characters/${c.id}/toggle" style="display:inline">
            <button class="btnSub" type="submit">${c.enabled ? "비활성" : "활성"}</button>
          </form>
          <form method="post" action="${ADMIN_BASE}/timeline/characters/${c.id}/delete" style="display:inline" onsubmit="return confirm('삭제할까요?')">
            <button class="btnDanger" type="submit">삭제</button>
          </form>
        </td>
      </tr>
    `).join("");

    const logRows = logs.map((log) => {
      const rarityClass =
        log.rarity === "태초" ? "badgePrimeval" :
        log.rarity === "에픽" ? "badgeEpic" :
        log.rarity === "레전더리" ? "badgeLegend" : "";

      return `
        <div class="log">
          <div class="logTop">
            <div>
              <strong>${escapeHtml(log.character_name)}</strong>
              <span class="muted"> · ${escapeHtml(log.server_name)} · ${escapeHtml(log.timeline_date)}</span>
            </div>
            <div class="row">
              ${log.log_type ? `<span class="badge">${escapeHtml(log.log_type)}</span>` : ""}
              ${log.rarity ? `<span class="badge ${rarityClass}">${escapeHtml(log.rarity)}</span>` : ""}
            </div>
          </div>
          <div class="logMsg">${escapeHtml(log.message)}</div>
        </div>
      `;
    }).join("");

    res.send(layout("캐릭터 통합 타임라인", `
      <div class="top">
        <div>
          <h1>캐릭터 통합 타임라인</h1>
          <p class="desc">관리자가 등록한 캐릭터들의 타임라인을 수집해 시간순으로 보여줍니다.</p>
        </div>
        <div class="row">
          <a class="btn btnSub" href="${ADMIN_BASE}">관리자 홈</a>
        </div>
      </div>

      <div class="pillbar">
        <div class="stat"><span>총 로그</span><strong>${Number(stats.total || 0).toLocaleString()}</strong></div>
        <div class="stat"><span>아이템</span><strong>${Number(stats.itemCount || 0).toLocaleString()}</strong></div>
        <div class="stat"><span>클리어</span><strong>${Number(stats.clearCount || 0).toLocaleString()}</strong></div>
        <div class="stat"><span>태초</span><strong>${Number(stats.primevalCount || 0).toLocaleString()}</strong></div>
        <div class="stat"><span>에픽</span><strong>${Number(stats.epicCount || 0).toLocaleString()}</strong></div>
        <div class="stat"><span>레전더리</span><strong>${Number(stats.legendaryCount || 0).toLocaleString()}</strong></div>
      </div>

      <div class="grid">
        <aside>
          <section class="card">
            <h2>캐릭터 1명 등록</h2>
            <form method="post" action="${ADMIN_BASE}/timeline/characters/add">
              <label>서버</label>
              <select name="server_id">${serverOptionsHtml}</select>

              <label>캐릭터명</label>
              <input name="character_name" placeholder="예: 마창까마귀" required />

              <label>메모</label>
              <input name="memo" placeholder="선택" />

              <div style="margin-top:12px">
                <button type="submit">검색 후 등록</button>
              </div>
            </form>
          </section>

          <section class="card">
            <h2>캐릭터 일괄 등록</h2>
            <p class="muted">한 줄에 하나씩 입력. 형식: 서버ID,캐릭터명<br>예: cain,마창까마귀</p>
            <form method="post" action="${ADMIN_BASE}/timeline/characters/bulk-add">
              <textarea name="bulk_text" placeholder="cain,마창까마귀&#10;cain,암월까마귀"></textarea>
              <div style="margin-top:12px">
                <button type="submit">일괄 등록</button>
              </div>
            </form>
          </section>

          <section class="card">
            <h2>타임라인 갱신</h2>
            <p class="muted">120캐릭터를 한 번에 갱신하면 오래 걸릴 수 있어 기본 20명씩 갱신합니다.</p>
            <form method="post" action="${ADMIN_BASE}/timeline/refresh">
              <label>조회 시작일</label>
              <input name="start_date" value="${escapeHtml(addDays(todayKSTDate(), -7))}" />

              <label>조회 종료일</label>
              <input name="end_date" value="${escapeHtml(todayKSTDate())}" />

              <label>이번에 갱신할 캐릭터 수</label>
              <input name="limit" type="number" min="1" max="120" value="20" />

              <div style="margin-top:12px">
                <button type="submit">오래된 캐릭터부터 갱신</button>
              </div>
            </form>
          </section>

          <section class="card">
            <h2>등록 캐릭터</h2>
            <table>
              <thead>
                <tr>
                  <th>서버</th>
                  <th>캐릭터</th>
                  <th>상태</th>
                  <th>갱신</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>${characterRows || `<tr><td colspan="5" class="muted">등록된 캐릭터가 없습니다.</td></tr>`}</tbody>
            </table>
          </section>
        </aside>

        <main>
          <section class="card">
            <h2>필터</h2>
            <form method="get" action="${ADMIN_BASE}/timeline" class="row">
              <input name="q" value="${escapeHtml(q)}" placeholder="검색어: 최후의 조율자, 디레지에, 아이템명 등" style="flex:2; min-width:220px" />
              <input name="character" value="${escapeHtml(character)}" placeholder="캐릭터명" style="flex:1; min-width:140px" />
              <select name="type" style="flex:0 0 120px">
                <option value="">전체 타입</option>
                <option value="아이템" ${type === "아이템" ? "selected" : ""}>아이템</option>
                <option value="클리어" ${type === "클리어" ? "selected" : ""}>클리어</option>
                <option value="기타" ${type === "기타" ? "selected" : ""}>기타</option>
              </select>
              <select name="rarity" style="flex:0 0 130px">
                <option value="">전체 등급</option>
                <option value="태초" ${rarity === "태초" ? "selected" : ""}>태초</option>
                <option value="에픽" ${rarity === "에픽" ? "selected" : ""}>에픽</option>
                <option value="레전더리" ${rarity === "레전더리" ? "selected" : ""}>레전더리</option>
              </select>
              <button type="submit">적용</button>
              <a class="btn btnSub" href="${ADMIN_BASE}/timeline">초기화</a>
            </form>
          </section>

          <section>
            ${logRows || `<div class="card muted">표시할 타임라인 로그가 없습니다.</div>`}
          </section>
        </main>
      </div>
    `));
  });

  app.post(`${ADMIN_BASE}/timeline/characters/add`, requireAdmin, async (req, res) => {
    try {
      const serverId = String(req.body.server_id || "").trim();
      const characterName = String(req.body.character_name || "").trim();
      const memo = String(req.body.memo || "").trim();

      if (!serverId || !characterName) {
        return res.status(400).send("server_id와 character_name이 필요합니다.");
      }

      const serverName = SERVER_OPTIONS.find(([id]) => id === serverId)?.[1] || serverId;
      const found = await searchCharacter(serverId, characterName);

      if (!found) {
        return res.status(404).send(`캐릭터를 찾지 못했습니다: ${escapeHtml(characterName)}`);
      }

      db.prepare(`
        INSERT OR IGNORE INTO tracked_characters
          (server_id, server_name, character_id, character_name, memo, enabled)
        VALUES
          (@server_id, @server_name, @character_id, @character_name, @memo, 1)
      `).run({
        server_id: serverId,
        server_name: serverName,
        character_id: found.characterId,
        character_name: found.characterName,
        memo
      });

      res.redirect(`${ADMIN_BASE}/timeline`);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  });

  app.post(`${ADMIN_BASE}/timeline/characters/bulk-add`, requireAdmin, async (req, res) => {
    const text = String(req.body.bulk_text || "");
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    const results = [];

    for (const line of lines) {
      try {
        const [serverIdRaw, ...nameParts] = line.split(",");
        const serverId = String(serverIdRaw || "").trim();
        const characterName = nameParts.join(",").trim();

        if (!serverId || !characterName) {
          results.push(`실패: ${line} - 형식 오류`);
          continue;
        }

        const serverName = SERVER_OPTIONS.find(([id]) => id === serverId)?.[1] || serverId;
        const found = await searchCharacter(serverId, characterName);

        if (!found) {
          results.push(`실패: ${line} - 캐릭터 없음`);
          continue;
        }

        db.prepare(`
          INSERT OR IGNORE INTO tracked_characters
            (server_id, server_name, character_id, character_name, memo, enabled)
          VALUES
            (@server_id, @server_name, @character_id, @character_name, '', 1)
        `).run({
          server_id: serverId,
          server_name: serverName,
          character_id: found.characterId,
          character_name: found.characterName
        });

        results.push(`성공: ${serverName} / ${found.characterName}`);
      } catch (error) {
        results.push(`실패: ${line} - ${error.message}`);
      }
    }

    res.send(layout("일괄 등록 결과", `
      <div class="top">
        <div>
          <h1>일괄 등록 결과</h1>
          <p class="desc">등록 결과입니다.</p>
        </div>
        <a class="btn" href="${ADMIN_BASE}/timeline">돌아가기</a>
      </div>
      <section class="card">
        <pre style="white-space:pre-wrap; line-height:1.6">${escapeHtml(results.join("\n"))}</pre>
      </section>
    `));
  });

  app.post(`${ADMIN_BASE}/timeline/characters/:id/toggle`, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM tracked_characters WHERE id = ?`).get(id);

    if (row) {
      db.prepare(`UPDATE tracked_characters SET enabled = ? WHERE id = ?`)
        .run(row.enabled ? 0 : 1, id);
    }

    res.redirect(`${ADMIN_BASE}/timeline`);
  });

  app.post(`${ADMIN_BASE}/timeline/characters/:id/delete`, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM tracked_characters WHERE id = ?`).get(id);

    if (row) {
      db.prepare(`DELETE FROM character_timeline_logs WHERE server_id = ? AND character_id = ?`)
        .run(row.server_id, row.character_id);
      db.prepare(`DELETE FROM tracked_characters WHERE id = ?`).run(id);
    }

    res.redirect(`${ADMIN_BASE}/timeline`);
  });

  app.post(`${ADMIN_BASE}/timeline/refresh`, requireAdmin, async (req, res) => {
    const startDate = String(req.body.start_date || addDays(todayKSTDate(), -7)).trim();
    const endDate = String(req.body.end_date || todayKSTDate()).trim();
    const limit = Math.min(Math.max(Number(req.body.limit || 20), 1), 120);

    const targets = db.prepare(`
      SELECT *
      FROM tracked_characters
      WHERE enabled = 1
      ORDER BY
        CASE WHEN last_refreshed_at IS NULL THEN 0 ELSE 1 END,
        last_refreshed_at ASC,
        id ASC
      LIMIT ?
    `).all(limit);

    const inserted = [];
    const failed = [];

    const insertLog = db.prepare(`
      INSERT OR IGNORE INTO character_timeline_logs
        (server_id, server_name, character_id, character_name, log_key, timeline_date, log_type, rarity, message, raw_json)
      VALUES
        (@server_id, @server_name, @character_id, @character_name, @log_key, @timeline_date, @log_type, @rarity, @message, @raw_json)
    `);

    const updateRefreshed = db.prepare(`
      UPDATE tracked_characters
      SET last_refreshed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const ch of targets) {
      try {
        const rows = await fetchCharacterTimeline(ch.server_id, ch.character_id, startDate, endDate);

        let count = 0;

        for (const row of rows) {
          const timelineDate = extractTimelineDate(row);
          if (!timelineDate) continue;

          const code = extractTimelineCode(row);
          const message = extractTimelineMessage(row);
          const { logType, rarity } = classifyTimeline(row);

          const logKey = String(row.logId || row.id || row.no || `${timelineDate}_${code}_${message}`).slice(0, 300);

          const result = insertLog.run({
            server_id: ch.server_id,
            server_name: ch.server_name,
            character_id: ch.character_id,
            character_name: ch.character_name,
            log_key: logKey,
            timeline_date: timelineDate,
            log_type: logType,
            rarity,
            message,
            raw_json: JSON.stringify(row)
          });

          if (result.changes > 0) {
            count += 1;
          }
        }

        updateRefreshed.run(ch.id);
        inserted.push(`${ch.character_name}: 신규 ${count}건 / 조회 ${rows.length}건`);
      } catch (error) {
        failed.push(`${ch.character_name}: ${error.message}`);
      }

      // 너무 빠른 연속 호출 방지
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    res.send(layout("타임라인 갱신 결과", `
      <div class="top">
        <div>
          <h1>타임라인 갱신 결과</h1>
          <p class="desc">${escapeHtml(startDate)} ~ ${escapeHtml(endDate)} / ${targets.length}캐릭터 갱신</p>
        </div>
        <a class="btn" href="${ADMIN_BASE}/timeline">돌아가기</a>
      </div>

      <section class="card">
        <h2>성공</h2>
        <pre style="white-space:pre-wrap; line-height:1.6">${escapeHtml(inserted.join("\n") || "없음")}</pre>
      </section>

      <section class="card">
        <h2>실패</h2>
        <pre style="white-space:pre-wrap; line-height:1.6">${escapeHtml(failed.join("\n") || "없음")}</pre>
      </section>
    `));
  });
}

export { registerTimelineFeature };
