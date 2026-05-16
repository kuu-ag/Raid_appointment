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

    CREATE TABLE IF NOT EXISTS duncle_weekly_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      anonymous_id TEXT NOT NULL,
      source TEXT DEFAULT 'unknown',
      season_key TEXT NOT NULL DEFAULT 'total',

      week_key TEXT NOT NULL,

      weekly_endkeeper_clear INTEGER NOT NULL DEFAULT 0,
      weekly_primeval_oath_count INTEGER NOT NULL DEFAULT 0,
      weekly_primeval_crystal_count INTEGER NOT NULL DEFAULT 0,
      weekly_primeval_total_count INTEGER NOT NULL DEFAULT 0,

      weekly_oath_rate REAL NOT NULL DEFAULT 0,
      weekly_crystal_rate REAL NOT NULL DEFAULT 0,
      weekly_total_rate REAL NOT NULL DEFAULT 0,

      is_hidden INTEGER NOT NULL DEFAULT 0,

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

      UNIQUE(anonymous_id, season_key, week_key)
    );

    CREATE INDEX IF NOT EXISTS idx_duncle_weekly_rankings_week
      ON duncle_weekly_rankings(season_key, week_key);

    CREATE INDEX IF NOT EXISTS idx_duncle_weekly_rankings_hidden
      ON duncle_weekly_rankings(is_hidden);

    CREATE INDEX IF NOT EXISTS idx_duncle_weekly_rankings_anon
      ON duncle_weekly_rankings(anonymous_id, season_key, week_key);
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
  `).run();

  if (maxId > 0) {
    db.prepare(`
      INSERT INTO sqlite_sequence(name, seq)
      VALUES ('duncle_drop_rates', ?)
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


function roundNumber(value, digit = 2) {
  const n = Number(value || 0);
  const pow = Math.pow(10, digit);
  return Math.round(n * pow) / pow;
}

function getRankBandText(rank, total) {
  const r = Number(rank || 0);
  const t = Number(total || 0);

  if (!r || !t) return "순위 없음";

  const topPercent = (r / t) * 100;

  if (topPercent <= 50) {
    return `상위 ${roundNumber(topPercent, 1)}%`;
  }

  const bottomPercent = ((t - r + 1) / t) * 100;
  return `하위 ${roundNumber(bottomPercent, 1)}%`;
}

function getLuckTier(rank, total) {
  const r = Number(rank || 0);
  const t = Number(total || 0);

  if (!r || !t) {
    return {
      key: "none",
      label: "순위 없음",
      description: "기록을 확인할 수 없습니다.",
    };
  }

  if (r === 1) {
    return {
      key: "rank_1",
      label: "아라드의 유일신",
      description: "경배하십시오. 아라드의 모든 운이 이곳에 모였습니다.",
    };
  }

  if (r === t) {
    return {
      key: "rank_last",
      label: "통계학적 기적",
      description: "참... 고생한다... 힘내라는 말 밖에 할 수 없네.",
    };
  }

  const topPercent = (r / t) * 100;

  if (topPercent <= 5) {
    return {
      key: "top_5",
      label: "조율자가 편애하는 사람",
      description: "헬 도는 게 매일 기다려지겠는데?",
    };
  }

  if (topPercent <= 10) {
    return {
      key: "top_10",
      label: "선택받은 모험가",
      description: "헬 도는 게 지루하진 않겠는데?",
    };
  }

  if (topPercent <= 30) {
    return {
      key: "top_30",
      label: "평균 이상",
      description: "아직은 헬 도는 게 지루하진 않겠다.",
    };
  }

  if (topPercent <= 60) {
    return {
      key: "middle",
      label: "평균권",
      description: "헬 도는 게 지루하고 재미없겠네.",
    };
  }

  if (topPercent <= 80) {
    return {
      key: "bottom_40",
      label: "기약 없는 기다림",
      description: "아직도 헬을 돌아? 응원한다...",
    };
  }

  return {
    key: "bottom_20",
    label: "조율자에게 버림받은 자",
    description: "그냥... 그렇게 됐다... 힘내라...",
  };
}


// 운빨 문구는 서버 응답의 tier.label / tier.description을 기준으로 관리한다.
// 확장프로그램은 종합 운빨에 한해 이 값을 그대로 표시하면 된다.
function buildRankResult({ rank, total, value, tieCount = 1 }) {
  const safeRank = Number(rank || 0);
  const safeTotal = Number(total || 0);
  const topPercent = safeTotal > 0 ? (safeRank / safeTotal) * 100 : 0;

  return {
    rank: safeRank,
    total: safeTotal,
    value: Number(value || 0),
    tieCount: Number(tieCount || 1),
    topPercent: roundNumber(topPercent, 2),
    bandText: getRankBandText(safeRank, safeTotal),
    tier: getLuckTier(safeRank, safeTotal),
  };
}

function getFieldRank(db, seasonKey, fieldName, myValue) {
  const allowedFields = new Set(["primeval_oath_rate", "primeval_crystal_rate"]);
  if (!allowedFields.has(fieldName)) {
    return buildRankResult({ rank: 0, total: 0, value: myValue, tieCount: 0 });
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND is_hidden = 0
      AND endkeeper_clear >= ?
  `).get(seasonKey, MIN_ENDKEEPER_CLEAR);

  const total = Number(totalRow?.cnt || 0);

  const rankRow = db.prepare(`
    SELECT
      SUM(CASE WHEN ${fieldName} > ? THEN 1 ELSE 0 END) AS higher_count,
      SUM(CASE WHEN ${fieldName} = ? THEN 1 ELSE 0 END) AS tie_count
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND is_hidden = 0
      AND endkeeper_clear >= ?
  `).get(myValue, myValue, seasonKey, MIN_ENDKEEPER_CLEAR);

  const rank = Number(rankRow?.higher_count || 0) + 1;
  const tieCount = Number(rankRow?.tie_count || 1);

  return buildRankResult({
    rank,
    total,
    value: myValue,
    tieCount,
  });
}

function getOverallLuckRank(db, seasonKey, myRow) {
  const rows = db.prepare(`
    SELECT
      id,
      primeval_oath_rate,
      primeval_crystal_rate
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND is_hidden = 0
      AND endkeeper_clear >= ?
  `).all(seasonKey, MIN_ENDKEEPER_CLEAR);

  const total = rows.length;

  if (!total || !myRow) {
    return buildRankResult({ rank: 0, total: 0, value: 0, tieCount: 0 });
  }

  const oathValues = rows.map((row) => Number(row.primeval_oath_rate || 0));
  const crystalValues = rows.map((row) => Number(row.primeval_crystal_rate || 0));

  const avg = (arr) => arr.reduce((sum, n) => sum + n, 0) / Math.max(1, arr.length);
  const std = (arr, mean) => {
    const variance = arr.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / Math.max(1, arr.length);
    const result = Math.sqrt(variance);
    return result > 0 ? result : 1;
  };

  const oathAvg = avg(oathValues);
  const crystalAvg = avg(crystalValues);
  const oathStd = std(oathValues, oathAvg);
  const crystalStd = std(crystalValues, crystalAvg);

  const calcScore = (row) => {
    const oathZ = (Number(row.primeval_oath_rate || 0) - oathAvg) / oathStd;
    const crystalZ = (Number(row.primeval_crystal_rate || 0) - crystalAvg) / crystalStd;

    // 태초 서약은 체감 가치가 더 크므로 65%, 태초 결정은 35% 반영
    return oathZ * 0.65 + crystalZ * 0.35;
  };

  const myScore = calcScore(myRow);
  const higherCount = rows.filter((row) => calcScore(row) > myScore).length;
  const tieCount = rows.filter((row) => Math.abs(calcScore(row) - myScore) < 0.000001).length;

  return buildRankResult({
    rank: higherCount + 1,
    total,
    value: roundNumber(myScore, 4),
    tieCount,
  });
}

function getMyLuckRanking(db, seasonKey, anonymousId) {
  const myRow = db.prepare(`
    SELECT *
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND anonymous_id = ?
      AND is_hidden = 0
    LIMIT 1
  `).get(seasonKey, anonymousId);

  if (!myRow) {
    return {
      eligible: false,
      reason: "등록된 기록이 없습니다.",
      minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
    };
  }

  if (Number(myRow.endkeeper_clear || 0) < MIN_ENDKEEPER_CLEAR) {
    return {
      eligible: false,
      reason: `최후의 조율자 ${MIN_ENDKEEPER_CLEAR.toLocaleString()}회 이상부터 운빨 순위에 반영됩니다.`,
      minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
      myEndkeeperClear: Number(myRow.endkeeper_clear || 0),
    };
  }

  return {
    eligible: true,
    minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
    myId: Number(myRow.id || 0),
    myEndkeeperClear: Number(myRow.endkeeper_clear || 0),
    oath: getFieldRank(db, seasonKey, "primeval_oath_rate", Number(myRow.primeval_oath_rate || 0)),
    crystal: getFieldRank(db, seasonKey, "primeval_crystal_rate", Number(myRow.primeval_crystal_rate || 0)),
    overall: getOverallLuckRank(db, seasonKey, myRow),
  };
}


function getCurrentWeekKeyKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);

  // KST 기준 목요일 10:00 리셋.
  // JS getUTCDay: 0=일, 4=목. kst는 이미 +9 적용된 UTC 객체로 다룬다.
  const day = kst.getUTCDay();
  const hour = kst.getUTCHours();

  let daysSinceThursday = (day - 4 + 7) % 7;

  if (daysSinceThursday === 0 && hour < 10) {
    daysSinceThursday = 7;
  }

  const start = new Date(kst.getTime() - daysSinceThursday * 24 * 60 * 60 * 1000);
  start.setUTCHours(10, 0, 0, 0);

  return start.toISOString().slice(0, 10);
}

function getWeekKey(value) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  return getCurrentWeekKeyKST();
}

function getRankResultBySql(db, { totalSql, higherSql, tieSql, params, value }) {
  const totalRow = db.prepare(totalSql).get(...params);
  const total = Number(totalRow?.cnt || 0);

  if (!total) {
    return buildRankResult({ rank: 0, total: 0, value, tieCount: 0 });
  }

  const higherRow = db.prepare(higherSql).get(value, ...params);
  const tieRow = db.prepare(tieSql).get(value, ...params);

  return buildRankResult({
    rank: Number(higherRow?.cnt || 0) + 1,
    total,
    value,
    tieCount: Number(tieRow?.cnt || 1),
  });
}

function getTotalPrimevalRank(db, seasonKey, myRow, kind) {
  const expressionMap = {
    oath: "primeval_oath_count",
    crystal: "primeval_crystal_count",
    total: "(primeval_oath_count + primeval_crystal_count)",
  };

  const expression = expressionMap[kind];

  if (!expression || !myRow) {
    return buildRankResult({ rank: 0, total: 0, value: 0, tieCount: 0 });
  }

  const myValue =
    kind === "oath"
      ? Number(myRow.primeval_oath_count || 0)
      : kind === "crystal"
        ? Number(myRow.primeval_crystal_count || 0)
        : Number(myRow.primeval_oath_count || 0) + Number(myRow.primeval_crystal_count || 0);

  return getRankResultBySql(db, {
    value: myValue,
    params: [seasonKey],
    totalSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_drop_rates
      WHERE season_key = ?
        AND is_hidden = 0
        AND endkeeper_clear >= ${MIN_ENDKEEPER_CLEAR}
    `,
    higherSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_drop_rates
      WHERE ${expression} > ?
        AND season_key = ?
        AND is_hidden = 0
        AND endkeeper_clear >= ${MIN_ENDKEEPER_CLEAR}
    `,
    tieSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_drop_rates
      WHERE ${expression} = ?
        AND season_key = ?
        AND is_hidden = 0
        AND endkeeper_clear >= ${MIN_ENDKEEPER_CLEAR}
    `,
  });
}

function getWeeklyPrimevalRank(db, seasonKey, weekKey, myWeekRow, kind) {
  const expressionMap = {
    oath: "weekly_primeval_oath_count",
    crystal: "weekly_primeval_crystal_count",
    total: "weekly_primeval_total_count",
  };

  const expression = expressionMap[kind];

  if (!expression || !myWeekRow) {
    return buildRankResult({ rank: 0, total: 0, value: 0, tieCount: 0 });
  }

  const myValue =
    kind === "oath"
      ? Number(myWeekRow.weekly_primeval_oath_count || 0)
      : kind === "crystal"
        ? Number(myWeekRow.weekly_primeval_crystal_count || 0)
        : Number(myWeekRow.weekly_primeval_total_count || 0);

  return getRankResultBySql(db, {
    value: myValue,
    params: [seasonKey, weekKey],
    totalSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE season_key = ?
        AND week_key = ?
        AND is_hidden = 0
    `,
    higherSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE ${expression} > ?
        AND season_key = ?
        AND week_key = ?
        AND is_hidden = 0
    `,
    tieSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE ${expression} = ?
        AND season_key = ?
        AND week_key = ?
        AND is_hidden = 0
    `,
  });
}

function getWeeklyTunerRank(db, seasonKey, weekKey, myWeekRow, kind) {
  const expressionMap = {
    oath: "weekly_oath_rate",
    crystal: "weekly_crystal_rate",
    total: "weekly_total_rate",
  };

  const expression = expressionMap[kind];

  if (!expression || !myWeekRow) {
    return buildRankResult({ rank: 0, total: 0, value: 0, tieCount: 0 });
  }

  const myValue =
    kind === "oath"
      ? Number(myWeekRow.weekly_oath_rate || 0)
      : kind === "crystal"
        ? Number(myWeekRow.weekly_crystal_rate || 0)
        : Number(myWeekRow.weekly_total_rate || 0);

  return getRankResultBySql(db, {
    value: myValue,
    params: [seasonKey, weekKey],
    totalSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE season_key = ?
        AND week_key = ?
        AND is_hidden = 0
        AND weekly_endkeeper_clear > 0
    `,
    higherSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE ${expression} > ?
        AND season_key = ?
        AND week_key = ?
        AND is_hidden = 0
        AND weekly_endkeeper_clear > 0
    `,
    tieSql: `
      SELECT COUNT(*) AS cnt
      FROM duncle_weekly_rankings
      WHERE ${expression} = ?
        AND season_key = ?
        AND week_key = ?
        AND is_hidden = 0
        AND weekly_endkeeper_clear > 0
    `,
  });
}

function getDuncleRankingSummary(db, seasonKey, anonymousId, weekKeyInput = "") {
  const weekKey = getWeekKey(weekKeyInput);

  const myRow = db.prepare(`
    SELECT *
    FROM duncle_drop_rates
    WHERE season_key = ?
      AND anonymous_id = ?
      AND is_hidden = 0
    LIMIT 1
  `).get(seasonKey, anonymousId);

  if (!myRow) {
    return {
      eligible: false,
      reason: "등록된 기록이 없습니다.",
      weekKey,
    };
  }

  const myWeekRow = db.prepare(`
    SELECT *
    FROM duncle_weekly_rankings
    WHERE season_key = ?
      AND week_key = ?
      AND anonymous_id = ?
      AND is_hidden = 0
    LIMIT 1
  `).get(seasonKey, weekKey, anonymousId);

  return {
    eligible: true,
    weekKey,
    resetRule: "KST_THURSDAY_10",
    totalPrimeval: {
      oath: getTotalPrimevalRank(db, seasonKey, myRow, "oath"),
      crystal: getTotalPrimevalRank(db, seasonKey, myRow, "crystal"),
      total: getTotalPrimevalRank(db, seasonKey, myRow, "total"),
    },
    weeklyPrimeval: {
      eligible: !!myWeekRow,
      oath: getWeeklyPrimevalRank(db, seasonKey, weekKey, myWeekRow, "oath"),
      crystal: getWeeklyPrimevalRank(db, seasonKey, weekKey, myWeekRow, "crystal"),
      total: getWeeklyPrimevalRank(db, seasonKey, weekKey, myWeekRow, "total"),
    },
    weeklyTuner: {
      eligible: !!myWeekRow && Number(myWeekRow.weekly_endkeeper_clear || 0) > 0,
      weeklyEndkeeperClear: Number(myWeekRow?.weekly_endkeeper_clear || 0),
      oath: getWeeklyTunerRank(db, seasonKey, weekKey, myWeekRow, "oath"),
      crystal: getWeeklyTunerRank(db, seasonKey, weekKey, myWeekRow, "crystal"),
      total: getWeeklyTunerRank(db, seasonKey, weekKey, myWeekRow, "total"),
    },
  };
}

function saveWeeklyRanking(db, {
  anonymousId,
  source,
  seasonKey,
  weekKey,
  weeklyEndkeeperClear,
  weeklyPrimevalOathCount,
  weeklyPrimevalCrystalCount,
  now,
}) {
  const safeWeekKey = getWeekKey(weekKey);
  const safeWeeklyEndkeeperClear = toInt(weeklyEndkeeperClear);
  const safeWeeklyPrimevalOathCount = toInt(weeklyPrimevalOathCount);
  const safeWeeklyPrimevalCrystalCount = toInt(weeklyPrimevalCrystalCount);
  const weeklyPrimevalTotalCount = safeWeeklyPrimevalOathCount + safeWeeklyPrimevalCrystalCount;

  const weeklyOathRate = calcRate(safeWeeklyPrimevalOathCount, safeWeeklyEndkeeperClear);
  const weeklyCrystalRate = calcRate(safeWeeklyPrimevalCrystalCount, safeWeeklyEndkeeperClear);
  const weeklyTotalRate = calcRate(weeklyPrimevalTotalCount, safeWeeklyEndkeeperClear);

  db.prepare(`
    INSERT INTO duncle_weekly_rankings (
      anonymous_id,
      source,
      season_key,
      week_key,
      weekly_endkeeper_clear,
      weekly_primeval_oath_count,
      weekly_primeval_crystal_count,
      weekly_primeval_total_count,
      weekly_oath_rate,
      weekly_crystal_rate,
      weekly_total_rate,
      is_hidden,
      created_at,
      updated_at
    )
    VALUES (
      @anonymous_id,
      @source,
      @season_key,
      @week_key,
      @weekly_endkeeper_clear,
      @weekly_primeval_oath_count,
      @weekly_primeval_crystal_count,
      @weekly_primeval_total_count,
      @weekly_oath_rate,
      @weekly_crystal_rate,
      @weekly_total_rate,
      0,
      @now,
      @now
    )
    ON CONFLICT(anonymous_id, season_key, week_key) DO UPDATE SET
      source = excluded.source,
      weekly_endkeeper_clear = excluded.weekly_endkeeper_clear,
      weekly_primeval_oath_count = excluded.weekly_primeval_oath_count,
      weekly_primeval_crystal_count = excluded.weekly_primeval_crystal_count,
      weekly_primeval_total_count = excluded.weekly_primeval_total_count,
      weekly_oath_rate = excluded.weekly_oath_rate,
      weekly_crystal_rate = excluded.weekly_crystal_rate,
      weekly_total_rate = excluded.weekly_total_rate,
      is_hidden = 0,
      updated_at = excluded.updated_at
  `).run({
    anonymous_id: anonymousId,
    source,
    season_key: seasonKey,
    week_key: safeWeekKey,
    weekly_endkeeper_clear: safeWeeklyEndkeeperClear,
    weekly_primeval_oath_count: safeWeeklyPrimevalOathCount,
    weekly_primeval_crystal_count: safeWeeklyPrimevalCrystalCount,
    weekly_primeval_total_count: weeklyPrimevalTotalCount,
    weekly_oath_rate: weeklyOathRate,
    weekly_crystal_rate: weeklyCrystalRate,
    weekly_total_rate: weeklyTotalRate,
    now,
  });

  return {
    weekKey: safeWeekKey,
    weeklyEndkeeperClear: safeWeeklyEndkeeperClear,
    weeklyPrimevalOathCount: safeWeeklyPrimevalOathCount,
    weeklyPrimevalCrystalCount: safeWeeklyPrimevalCrystalCount,
    weeklyPrimevalTotalCount,
    weeklyOathRate,
    weeklyCrystalRate,
    weeklyTotalRate,
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

  app.options("/api/duncle/drop-rate/rank", (req, res) => {
    setApiCors(req, res);
    res.status(204).end();
  });

  app.options("/api/duncle/ranking-summary", (req, res) => {
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

  app.get("/api/duncle/drop-rate/rank", (req, res) => {
    setApiCors(req, res);

    const anonymousId = clampText(req.query.anonymousId || req.query.anonymous_id, 120);
    const seasonKey = getSeasonKey(req.query.seasonKey || req.query.season_key || "total");

    if (!anonymousId) {
      return res.status(400).json({
        ok: false,
        message: "익명 식별자가 없습니다.",
      });
    }

    const ranking = getMyLuckRanking(db, seasonKey, anonymousId);

    res.json({
      ok: true,
      ranking,
      rule: {
        minEndkeeperClear: MIN_ENDKEEPER_CLEAR,
      },
    });
  });

  app.get("/api/duncle/ranking-summary", (req, res) => {
    setApiCors(req, res);

    const anonymousId = clampText(req.query.anonymousId || req.query.anonymous_id, 120);
    const seasonKey = getSeasonKey(req.query.seasonKey || req.query.season_key || "total");
    const weekKey = getWeekKey(req.query.weekKey || req.query.week_key || "");

    if (!anonymousId) {
      return res.status(400).json({
        ok: false,
        message: "익명 식별자가 없습니다.",
      });
    }

    res.json({
      ok: true,
      rankingSummary: getDuncleRankingSummary(db, seasonKey, anonymousId, weekKey),
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

      const weekKey = getWeekKey(req.body.weekKey || req.body.week_key || "");
      const weeklyEndkeeperClear = toInt(req.body.weeklyEndkeeperClear || req.body.weekly_endkeeper_clear);
      const weeklyPrimevalOathCount = toInt(req.body.weeklyPrimevalOathCount || req.body.weekly_primeval_oath_count);
      const weeklyPrimevalCrystalCount = toInt(req.body.weeklyPrimevalCrystalCount || req.body.weekly_primeval_crystal_count);

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

      const shouldSaveWeekly =
        weeklyEndkeeperClear > 0 ||
        weeklyPrimevalOathCount > 0 ||
        weeklyPrimevalCrystalCount > 0;

      const weekly = shouldSaveWeekly
        ? saveWeeklyRanking(db, {
            anonymousId,
            source,
            seasonKey,
            weekKey,
            weeklyEndkeeperClear,
            weeklyPrimevalOathCount,
            weeklyPrimevalCrystalCount,
            now,
          })
        : {
            weekKey,
            weeklyEndkeeperClear: 0,
            weeklyPrimevalOathCount: 0,
            weeklyPrimevalCrystalCount: 0,
            weeklyPrimevalTotalCount: 0,
            weeklyOathRate: 0,
            weeklyCrystalRate: 0,
            weeklyTotalRate: 0,
          };

      const average = getAverage(db, seasonKey);
      const ranking = getMyLuckRanking(db, seasonKey, anonymousId);
      const rankingSummary = getDuncleRankingSummary(db, seasonKey, anonymousId, weekKey);

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
        ranking,
        rankingSummary,
        weekly,
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
      const row = db.prepare(`
        SELECT anonymous_id, season_key
        FROM duncle_drop_rates
        WHERE id = ?
      `).get(id);

      db.prepare(`
        UPDATE duncle_drop_rates
        SET is_hidden = 1,
            updated_at = ?
        WHERE id = ?
      `).run(nowKST(), id);

      if (row?.anonymous_id) {
        db.prepare(`
          UPDATE duncle_weekly_rankings
          SET is_hidden = 1,
              updated_at = ?
          WHERE anonymous_id = ?
            AND season_key = ?
        `).run(nowKST(), row.anonymous_id, row.season_key || "total");
      }
    }

    res.redirect(`/${adminPath}/duncle`);
  });

  app.post(`/${adminPath}/duncle/:id/show`, (req, res) => {
    const id = Number(req.params.id);

    if (Number.isFinite(id)) {
      const row = db.prepare(`
        SELECT anonymous_id, season_key
        FROM duncle_drop_rates
        WHERE id = ?
      `).get(id);

      db.prepare(`
        UPDATE duncle_drop_rates
        SET is_hidden = 0,
            updated_at = ?
        WHERE id = ?
      `).run(nowKST(), id);

      if (row?.anonymous_id) {
        db.prepare(`
          UPDATE duncle_weekly_rankings
          SET is_hidden = 0,
              updated_at = ?
          WHERE anonymous_id = ?
            AND season_key = ?
        `).run(nowKST(), row.anonymous_id, row.season_key || "total");
      }
    }

    res.redirect(`/${adminPath}/duncle`);
  });

  console.log(`[Duncle] Drop-rate feature enabled. Admin: /${adminPath}/duncle`);
}

export { registerDuncleDropRateFeature };
