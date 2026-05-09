// duncleDropRateFeature.js
"use strict";

const MIN_ENDKEEPER_CLEAR = 500;
const MAX_REASONABLE_RATE = 10; // 10% 초과는 비정상 데이터로 간주

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

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function calcRate(count, clear) {
  const itemCount = Number(count || 0);
  const clearCount = Number(clear || 0);

  if (!clearCount || clearCount <= 0) {
    return 0;
  }

  return Number(((itemCount / clearCount) * 100).toFixed(4));
}

function formatRate(value) {
  const n = Number(value || 0);
  return `${n.toFixed(2)}%`;
}

function getSource(value) {
  const text = String(value || "").trim().toLowerCase();

  if (text === "nexon") return "nexon";
  if (text === "naver") return "naver";

  return "unknown";
}

function getSeasonKey(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "total";
  }

  return text.slice(0, 40);
}

function maskAnonymousId(value) {
  const text = String(value || "");

  if (text.length <= 12) {
    return text;
  }

  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

// 관리자 화면/DB 표시용 KST 문자열
// SQLite CURRENT_TIMESTAMP는 UTC라서 Render 환경에서 화면 시간이 어긋날 수 있으므로 직접 KST로 저장한다.
function nowKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function setApiCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function initDuncleDropRateTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS duncle_drop_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      anonymous_id TEXT NOT NULL,
      source TEXT DEFAULT 'unknown',

      endkeeper_clear INTEGER NOT NULL DEFAULT 0,

      primeval_oath_count INTEGER NOT NULL DEFAULT 0,
      primeval_crystal_count INTEGER NOT NULL DEFAULT 0,

      primeval_oath_rate REAL NOT NULL DEFAULT 0,
      primeval_crystal_rate REAL NOT NULL DEFAULT 0,

      season_key TEXT NOT NULL DEFAULT 'total',

      is_hidden INTEGER NOT NULL DEFAULT 0,

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

      UNIQUE(anonymous_id, season_key)
    );

    CREATE INDEX IF NOT EXISTS idx_duncle_drop_rates_season
      ON duncle_drop_rates(season_key);

    CREATE INDEX IF NOT EXISTS idx_duncle_drop_rates_hidden
      ON duncle_drop_rates(is_hidden);

    CREATE INDEX IF NOT EXISTS idx_duncle_drop_rates_updated
      ON duncle_drop_rates(updated_at);

    CREATE INDEX IF NOT EXISTS idx_duncle_drop_rates_season_updated
      ON duncle_drop_rates(season_key, updated_at, id);
  `);
}

// 수동 삭제/테스트 데이터 삭제 등으로 sqlite_sequence가 MAX(id)보다 커졌을 때만 낮춰준다.
// 기존 id를 바꾸지는 않는다. 새 등록이 현재 MAX(id)+1로 이어지게 하기 위한 안전장치다.
function normalizeDuncleSequence(db) {
  const row = db.prepare(`
    SELECT COALESCE(MAX(id), 0) AS max_id
    FROM duncle_drop_rates
  `).get();

  const maxId = Number(row?.max_id || 0);

  db.prepare(`
    DELETE FROM sqlite_sequence
    WHERE name = 'duncle_drop_rates'
      AND seq > ?
  `).run(maxId);

  if (maxId > 0) {
    db.prepare(`
      INSERT INTO sqlite_sequence(name, seq)
      VALUES ('duncle_drop_rates', ?)
      ON CONFLICT(name) DO UPDATE SET seq = excluded.seq
    `).run(maxId);
  }
}

function getAverage(db, seasonKey = "total") {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS registered_user_count,
      AVG(primeval_oath_rate) AS avg_primeval_oath_rate,
      AVG(primeval_crystal_rate) AS avg_primeval_crystal_rate
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND is_hidden = 0
      AND endkeeper_clear >= ?
  `).get(seasonKey, MIN_ENDKEEPER_CLEAR);

  return {
    registeredUserCount: Number(row?.registered_user_count || 0),
    primevalOathRate: Number(row?.avg_primeval_oath_rate || 0),
    primevalCrystalRate: Number(row?.avg_primeval_crystal_rate || 0),
  };
}

function getAdminStats(db, seasonKey = "total") {
  const avg = getAverage(db, seasonKey);

  const total = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN is_hidden = 1 THEN 1 ELSE 0 END) AS hidden_count,
      SUM(CASE WHEN source = 'nexon' THEN 1 ELSE 0 END) AS nexon_count,
      SUM(CASE WHEN source = 'naver' THEN 1 ELSE 0 END) AS naver_count
    FROM duncle_drop_rates
    WHERE season_key = ?
  `).get(seasonKey);

  return {
    ...avg,
    totalCount: Number(total?.total_count || 0),
    hiddenCount: Number(total?.hidden_count || 0),
    nexonCount: Number(total?.nexon_count || 0),
    naverCount: Number(total?.naver_count || 0),
  };
}

function renderAdminPage(db, options = {}) {
  const ADMIN_PATH = options.adminPath || "duncle_hidden";
  const seasonKey = "total";

  const stats = getAdminStats(db, seasonKey);

  // 중요:
  // - 낮은 ID는 최초 등록이 오래된 데이터이므로 기본적으로 아래쪽에 위치한다.
  // - 같은 anonymous_id + season_key가 재조회되면 id는 유지되고 updated_at만 갱신된다.
  // - 따라서 관리자 목록은 updated_at DESC 기준으로 보여줘야 재조회 유저가 맨 위로 올라온다.
  // - 기존 코드의 LIMIT 300 때문에 1~92 같은 오래된 데이터가 화면에 안 보였으므로 제한을 제거했다.
  const rows = db.prepare(`
    SELECT *
    FROM duncle_drop_rates
    WHERE season_key = ?
    ORDER BY datetime(updated_at) DESC, id DESC
  `).all(seasonKey);

  const rowHtml = rows.map((row) => {
    const hiddenBadge = row.is_hidden
      ? `<span class="badge danger">숨김</span>`
      : `<span class="badge ok">반영</span>`;

    return `
      <tr>
        <td>${row.id}</td>
        <td>${escapeHtml(maskAnonymousId(row.anonymous_id))}</td>
        <td>${escapeHtml(row.source)}</td>
        <td>${Number(row.endkeeper_clear || 0).toLocaleString()}회</td>
        <td>${Number(row.primeval_oath_count || 0).toLocaleString()}개</td>
        <td>${formatRate(row.primeval_oath_rate)}</td>
        <td>${Number(row.primeval_crystal_count || 0).toLocaleString()}개</td>
        <td>${formatRate(row.primeval_crystal_rate)}</td>
        <td>${hiddenBadge}</td>
        <td>${escapeHtml(row.updated_at)}</td>
        <td>
          ${
            row.is_hidden
              ? `
                <form method="post" action="/${escapeHtml(ADMIN_PATH)}/duncle/${row.id}/show">
                  <button type="submit">반영</button>
                </form>
              `
              : `
                <form method="post" action="/${escapeHtml(ADMIN_PATH)}/duncle/${row.id}/hide">
                  <button class="dangerBtn" type="submit">숨김</button>
                </form>
              `
          }
        </td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>던클리 평균 드랍율 관리자</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #080b12;
      color: #f4f4f5;
      font-family: Arial, "Noto Sans KR", sans-serif;
    }
    .wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .desc {
      margin: 0 0 20px;
      color: #a1a1aa;
      font-size: 14px;
      line-height: 1.5;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .stat {
      border: 1px solid #272b3a;
      border-radius: 14px;
      padding: 14px;
      background: #111827;
    }
    .stat span {
      display: block;
      color: #a1a1aa;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .stat strong {
      display: block;
      font-size: 20px;
    }
    .card {
      border: 1px solid #272b3a;
      border-radius: 16px;
      background: #111827;
      padding: 16px;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      min-width: 1100px;
    }
    th, td {
      border-bottom: 1px solid #272b3a;
      padding: 10px 8px;
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: #a1a1aa;
      font-size: 12px;
    }
    .badge {
      display: inline-flex;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
    }
    .ok {
      background: #064e3b;
      color: #a7f3d0;
    }
    .danger {
      background: #7f1d1d;
      color: #fecaca;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 7px 10px;
      background: #3f3f46;
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }
    .dangerBtn {
      background: #7f1d1d;
    }
    @media (max-width: 1000px) {
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>던클리 평균 드랍율 관리자</h1>
    <p class="desc">
      이 페이지는 공개 메뉴에 노출하지 않는 비밀 URL 관리자 화면입니다.<br>
      개별 유저 기록은 외부에 공개하지 않고, 확장프로그램에는 등록 유저 평균값만 반환합니다.
    </p>

    <section class="stats">
      <div class="stat">
        <span>평균 반영 유저</span>
        <strong>${stats.registeredUserCount.toLocaleString()}명</strong>
      </div>
      <div class="stat">
        <span>서약 평균</span>
        <strong>${formatRate(stats.primevalOathRate)}</strong>
      </div>
      <div class="stat">
        <span>결정 평균</span>
        <strong>${formatRate(stats.primevalCrystalRate)}</strong>
      </div>
      <div class="stat">
        <span>전체 등록</span>
        <strong>${stats.totalCount.toLocaleString()}건</strong>
      </div>
      <div class="stat">
        <span>넥슨</span>
        <strong>${stats.nexonCount.toLocaleString()}건</strong>
      </div>
      <div class="stat">
        <span>네이버</span>
        <strong>${stats.naverCount.toLocaleString()}건</strong>
      </div>
    </section>

    <section class="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>익명 ID</th>
            <th>소스</th>
            <th>조율자 클리어</th>
            <th>태초 서약</th>
            <th>서약 확률</th>
            <th>태초 결정</th>
            <th>결정 확률</th>
            <th>상태</th>
            <th>갱신일</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml || `<tr><td colspan="11">등록된 데이터가 없습니다.</td></tr>`}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function registerDuncleDropRateFeature(app, db, options = {}) {
  initDuncleDropRateTables(db);
  normalizeDuncleSequence(db);

  const adminPath = clampText(
    options.adminPath || process.env.DUNCLE_ADMIN_PATH || "duncle_hidden",
    120
  );

  app.options("/api/duncle/drop-rate", (req, res) => {
    setApiCors(req, res);
    res.status(204).end();
  });

  app.options("/api/duncle/drop-rate/average", (req, res) => {
    setApiCors(req, res);
    res.status(204).end();
  });

  app.get("/api/duncle/drop-rate/average", (req, res) => {
    setApiCors(req, res);

    const seasonKey = getSeasonKey(req.query.seasonKey || "total");
    const average = getAverage(db, seasonKey);

    res.json({
      ok: true,
      average,
      rule: {
        minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
      },
    });
  });

  app.post("/api/duncle/drop-rate", (req, res) => {
    setApiCors(req, res);

    try {
      const anonymousId = clampText(req.body.anonymousId || req.body.anonymous_id, 120);
      const source = getSource(req.body.source);
      const seasonKey = getSeasonKey(req.body.seasonKey || req.body.season_key || "total");

      const endkeeperClear = toInt(req.body.endkeeperClear || req.body.endkeeper_clear);
      const primevalOathCount = toInt(req.body.primevalOathCount || req.body.primeval_oath_count);
      const primevalCrystalCount = toInt(req.body.primevalCrystalCount || req.body.primeval_crystal_count);

      if (!anonymousId) {
        return res.status(400).json({
          ok: false,
          message: "익명 식별자가 없습니다.",
        });
      }

      if (endkeeperClear < MIN_ENDKEEPER_CLEAR) {
        return res.status(400).json({
          ok: false,
          message: `최후의 조율자 ${MIN_ENDKEEPER_CLEAR.toLocaleString()}회 이상부터 평균 비교 등록이 가능합니다.`,
          rule: {
            minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
          },
        });
      }

      if (primevalOathCount > endkeeperClear || primevalCrystalCount > endkeeperClear) {
        return res.status(400).json({
          ok: false,
          message: "획득 수가 클리어 수보다 많아 등록할 수 없습니다.",
        });
      }

      const primevalOathRate = calcRate(primevalOathCount, endkeeperClear);
      const primevalCrystalRate = calcRate(primevalCrystalCount, endkeeperClear);

      if (primevalOathRate > MAX_REASONABLE_RATE || primevalCrystalRate > MAX_REASONABLE_RATE) {
        return res.status(400).json({
          ok: false,
          message: "비정상적으로 높은 확률 데이터로 판단되어 등록할 수 없습니다.",
        });
      }

      const now = nowKST();

      // 핵심 동작:
      // - 신규 anonymous_id + season_key: 새 id 생성, created_at/updated_at 현재 시각 저장
      // - 기존 anonymous_id + season_key 재조회: id/created_at 유지, updated_at만 현재 시각으로 갱신
      // - 관리자 화면은 updated_at DESC라서 재조회 유저가 맨 위로 올라간다.
      db.prepare(`
        INSERT INTO duncle_drop_rates (
          anonymous_id,
          source,
          endkeeper_clear,
          primeval_oath_count,
          primeval_crystal_count,
          primeval_oath_rate,
          primeval_crystal_rate,
          season_key,
          is_hidden,
          created_at,
          updated_at
        )
        VALUES (
          @anonymous_id,
          @source,
          @endkeeper_clear,
          @primeval_oath_count,
          @primeval_crystal_count,
          @primeval_oath_rate,
          @primeval_crystal_rate,
          @season_key,
          0,
          @now,
          @now
        )
        ON CONFLICT(anonymous_id, season_key) DO UPDATE SET
          source = excluded.source,
          endkeeper_clear = excluded.endkeeper_clear,
          primeval_oath_count = excluded.primeval_oath_count,
          primeval_crystal_count = excluded.primeval_crystal_count,
          primeval_oath_rate = excluded.primeval_oath_rate,
          primeval_crystal_rate = excluded.primeval_crystal_rate,
          is_hidden = 0,
          updated_at = excluded.updated_at
      `).run({
        anonymous_id: anonymousId,
        source,
        endkeeper_clear: endkeeperClear,
        primeval_oath_count: primevalOathCount,
        primeval_crystal_count: primevalCrystalCount,
        primeval_oath_rate: primevalOathRate,
        primeval_crystal_rate: primevalCrystalRate,
        season_key: seasonKey,
        now,
      });

      normalizeDuncleSequence(db);

      const average = getAverage(db, seasonKey);

      res.json({
        ok: true,
        my: {
          endkeeperClear,
          primevalOathCount,
          primevalCrystalCount,
          primevalOathRate,
          primevalCrystalRate,
        },
        average,
        rule: {
          minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
        },
      });
    } catch (error) {
      console.error("[Duncle DropRate API]", error);

      res.status(500).json({
        ok: false,
        message: "평균 비교 등록 중 서버 오류가 발생했습니다.",
      });
    }
  });

  app.get(`/${adminPath}/duncle`, (req, res) => {
    res.send(renderAdminPage(db, { adminPath }));
  });

  app.post(`/${adminPath}/duncle/:id/hide`, (req, res) => {
    const id = Number(req.params.id);

    if (Number.isFinite(id)) {
      db.prepare(`
        UPDATE duncle_drop_rates
        SET is_hidden = 1,
            updated_at = ?
        WHERE id = ?
      `).run(nowKST(), id);
    }

    res.redirect(`/${adminPath}/duncle`);
  });

  app.post(`/${adminPath}/duncle/:id/show`, (req, res) => {
    const id = Number(req.params.id);

    if (Number.isFinite(id)) {
      db.prepare(`
        UPDATE duncle_drop_rates
        SET is_hidden = 0,
            updated_at = ?
        WHERE id = ?
      `).run(nowKST(), id);
    }

    res.redirect(`/${adminPath}/duncle`);
  });

  console.log(`[Duncle] Drop-rate feature enabled. Admin: /${adminPath}/duncle`);
}

export { registerDuncleDropRateFeature };
