// server.js (복붙용 / CommonJS)
const express = require("express");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ====== ENV ======
const PORT = process.env.PORT || 3000;

// 스트리머(어드민) 비밀 URL 경로 (예: /devonraid_admin_123)
// Render 환경변수에 ADMIN_PATH 로 넣어두는 걸 권장
const ADMIN_PATH = process.env.ADMIN_PATH || "/devonraid_admin_123";

// 스트리머 로그인 키 (Render 환경변수 ADMIN_KEY)
const ADMIN_KEY = process.env.ADMIN_KEY || "change_me";

// ====== DB ======
const dbFile = path.join(__dirname, "data.sqlite");
const db = new Database(dbFile);

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
  confirmed INTEGER NOT NULL DEFAULT 0,
  streamer_comment TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS raid_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  code TEXT NOT NULL,
  UNIQUE(date_kst, raid_key)
);
`);

// ====== CONSTANTS ======
const RAID_OPTIONS = [
  { key: "dirage", label: "디레지에" },
  { key: "dirage-hard", label: "디레지에-악연" },
  { key: "inner", label: "이내황혼전" },
  { key: "nabel", label: "인공신 : 나벨" },
  { key: "nabel-hard", label: "나벨-하드모드" },
];

// 등급 옵션: 기본값 "등급 선택" (빈 값)
const GRADE_OPTIONS = [
  { key: "", label: "등급 선택" }, // 기본값(선택 안 함)
  { key: "fire", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "normal", label: "일반 등급" },
];

// 정렬용(불타→분홍→노랑→일반)
const GRADE_SORT_ORDER = { fire: 1, pink: 2, yellow: 3, normal: 4 };

// ====== UTIL ======
function todayKST() {
  const now = new Date();
  // UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowISO() {
  return new Date().toISOString();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function raidByKey(key) {
  return RAID_OPTIONS.find((r) => r.key === key);
}

function gradeLabel(key) {
  return GRADE_OPTIONS.find((g) => g.key === key)?.label || key;
}

function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg1:#070a12;
      --bg2:#0b1222;
      --card:#0e1a33;
      --line:rgba(255,255,255,.12);
      --text:rgba(255,255,255,.92);
      --muted:rgba(255,255,255,.70);
      --btn:#152a55;
      --btn2:#0f2144;
      --danger:#8a2b2b;
      --ok:#1f6b3a;
      --warn:#7a5b12;
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial;
      background: radial-gradient(1200px 600px at 20% 10%, #13244a 0%, var(--bg1) 55%, #05070f 100%);
      color: var(--text);
      padding: 18px;
    }
    a { color: inherit; }
    .wrap { max-width: 1100px; margin: 0 auto; }
    .title {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: .2px;
      margin: 0 0 6px 0;
    }
    .sub {
      color: var(--muted);
      margin: 0 0 14px 0;
      font-size: 14px;
    }
    .card {
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 10px 24px rgba(0,0,0,.35);
      backdrop-filter: blur(6px);
    }
    .row { display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
    .row.space { justify-content: space-between; }
    .btn {
      background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.06));
      border: 1px solid var(--line);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 12px;
      text-decoration:none;
      display:inline-flex;
      align-items:center;
      gap: 8px;
      cursor:pointer;
    }
    .btn:hover { border-color: rgba(255,255,255,.22); }
    .btnDanger { background: rgba(138,43,43,.25); border-color: rgba(255,255,255,.14); }
    .btnOk { background: rgba(31,107,58,.28); border-color: rgba(255,255,255,.14); }
    .btnWarn { background: rgba(122,91,18,.28); border-color: rgba(255,255,255,.14); }
    .chip {
      display:inline-flex;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.06);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    hr { border:0; border-top:1px solid var(--line); margin: 14px 0; }

    /*  입력칸 겹침 방지: grid + 최소폭 + wrap */
    .formGrid{
      display:grid;
      grid-template-columns: 160px minmax(160px, 280px) minmax(160px, 280px) 140px 140px;
      gap: 12px;
      align-items:end;
    }
    .field label{
      display:block;
      font-size: 12px;
      color: var(--muted);
      margin: 0 0 6px 2px;
    }
    input, select, textarea{
      width:100%;
      background: rgba(0,0,0,.18);
      border: 1px solid rgba(255,255,255,.14);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 14px;
      outline: none;
    }
    textarea { min-height: 70px; resize: vertical; }
    input::placeholder { color: rgba(255,255,255,.35); }
    input:focus, select:focus, textarea:focus { border-color: rgba(255,255,255,.30); }

    @media (max-width: 980px){
      .formGrid{
        grid-template-columns: 1fr 1fr;
      }
    }
    @media (max-width: 520px){
      .formGrid{
        grid-template-columns: 1fr;
      }
    }

    table{
      width:100%;
      border-collapse: collapse;
      margin-top: 12px;
      overflow:hidden;
      border-radius: 14px;
      border: 1px solid var(--line);
    }
    th, td{
      border-bottom: 1px solid var(--line);
      padding: 10px 10px;
      text-align:left;
      font-size: 13px;
      vertical-align: top;
    }
    th{
      background: rgba(255,255,255,.06);
      color: rgba(255,255,255,.85);
      font-weight: 800;
      font-size: 12px;
      letter-spacing: .2px;
    }
    tr:last-child td { border-bottom: 0; }
    .center { text-align:center; }
    .statusOk { color: #a8f0c2; }
    .statusWait { color: #ffd48b; }
    .hint{
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
      margin-top: 10px;
    }
    .err{
      background: rgba(138,43,43,.18);
      border: 1px solid rgba(255,255,255,.14);
      padding: 10px 12px;
      border-radius: 14px;
      color: rgba(255,255,255,.92);
      margin: 12px 0;
    }
    .ok{
      background: rgba(31,107,58,.18);
      border: 1px solid rgba(255,255,255,.14);
      padding: 10px 12px;
      border-radius: 14px;
      color: rgba(255,255,255,.92);
      margin: 12px 0;
    }
  </style>
  <script>
    function submitOnChange(formId){ document.getElementById(formId).submit(); }
  </script>
</head>
<body>
  <div class="wrap">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function requireViewerAuth(raidKey, req, res) {
  const date = todayKST();
  const cookieName = `raid_code_${raidKey}_${date}`;
  const got = req.cookies[cookieName];

  const row = db
    .prepare("SELECT code FROM raid_codes WHERE date_kst=? AND raid_key=?")
    .get(date, raidKey);

  if (!row || !row.code) {
    return res.send(
      layout(
        "인증 필요",
        `<div class="card">
          <div class="title">인증키가 아직 등록되지 않았습니다</div>
          <div class="sub">스트리머가 오늘의 인증키를 등록해야 예약이 가능합니다.</div>
          <a class="btn" href="/">메인으로</a>
        </div>`
      )
    );
  }

  if (!got || got !== row.code) {
    return res.redirect(`/auth?raid=${encodeURIComponent(raidKey)}`);
  }
  return null;
}

function requireAdmin(req, res, next) {
  const ok = req.cookies.admin_ok === "1";
  if (!ok) return res.redirect(`${ADMIN_PATH}/login`);
  next();
}

// ====== ROUTES (Viewer) ======

// /admin 은 404로 숨김
app.all("/admin", (req, res) => res.status(404).send("Not Found"));
app.all("/admin/*", (req, res) => res.status(404).send("Not Found"));

app.get("/", (req, res) => {
  const buttons = RAID_OPTIONS.map(
    (r) =>
      `<a class="btn" href="/raid?raid=${encodeURIComponent(r.key)}">${esc(
        r.label
      )}</a>`
  ).join(" ");

  res.send(
    layout(
      "데본베일 레이드 예약",
      `<div class="card">
        <div class="title">데본베일 레이드 예약 사이트</div>
        <div class="sub">레이드를 선택하면 인증키 입력 → 예약 신청으로 진행됩니다.</div>
        <hr/>
        <div class="row">${buttons}</div>
        <div class="hint">- 하루 최대 20회차 / 회차 정원: 3버퍼 + 9딜러 (총 12명)<br/>- 신청자는 회차 선택 없이 정보만 입력하며, 배치는 스트리머가 수기로 진행합니다.</div>
      </div>`
    )
  );
});

app.get("/raid", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  // 바로 인증 화면으로 이동
  return res.redirect(`/auth?raid=${encodeURIComponent(raid)}`);
});

app.get("/auth", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  res.send(
    layout(
      "인증키 입력",
      `<div class="card">
        <div class="row space">
          <div>
            <div class="title">인증키 입력</div>
            <div class="sub">레이드: ${esc(raidObj.label)} / 날짜: ${esc(todayKST())}</div>
          </div>
          <div class="row">
            <a class="btn" href="/">메인</a>
          </div>
        </div>
        <hr/>
        <form method="POST" action="/auth" class="row" style="align-items:flex-end;">
          <input type="hidden" name="raid" value="${esc(raid)}"/>
          <div class="field" style="min-width:280px;flex:1;">
            <label>인증 번호</label>
            <input name="code" placeholder="스트리머가 안내한 인증키" required />
          </div>
          <button class="btn btnOk" type="submit">확인</button>
        </form>
        <div class="hint">- 인증 성공 시 오늘(${esc(todayKST())}) 예약이 가능합니다.</div>
      </div>`
    )
  );
});

app.post("/auth", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const date = todayKST();
  const row = db
    .prepare("SELECT code FROM raid_codes WHERE date_kst=? AND raid_key=?")
    .get(date, raid);

  if (!row || !row.code) {
    return res.send(
      layout(
        "인증 실패",
        `<div class="card">
          <div class="title">인증키가 아직 등록되지 않았습니다</div>
          <div class="sub">스트리머가 오늘의 인증키를 등록해야 합니다.</div>
          <a class="btn" href="/">메인</a>
        </div>`
      )
    );
  }

  if (code !== row.code) {
    return res.send(
      layout(
        "인증 실패",
        `<div class="card">
          <div class="title">인증키가 올바르지 않습니다</div>
          <div class="sub">다시 확인하고 입력해 주세요.</div>
          <a class="btn" href="/auth?raid=${encodeURIComponent(raid)}">다시 입력</a>
        </div>`
      )
    );
  }

  const cookieName = `raid_code_${raid}_${date}`;
  res.cookie(cookieName, row.code, {
    httpOnly: true,
    sameSite: "lax",
    secure: true, // Render는 https라서 OK
    maxAge: 1000 * 60 * 60 * 12, // 12h
  });
  return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
});

app.get("/reserve", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const blocked = requireViewerAuth(raid, req, res);
  if (blocked) return;

  const err = String(req.query.err || "");

  res.send(
    layout(
      "예약 신청",
      `<div class="card">
        <div class="row space">
          <div>
            <div class="title">예약 신청</div>
            <div class="sub">레이드: ${esc(raidObj.label)} / 날짜: ${esc(todayKST())}</div>
          </div>
          <div class="row">
            <a class="btn" href="/">메인</a>
            <a class="btn" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          </div>
        </div>

        ${err ? `<div class="err">${esc(err)}</div>` : ""}

        <hr/>

        <form method="POST" action="/reserve">
          <input type="hidden" name="raid" value="${esc(raid)}"/>

          <div class="formGrid">
            <div class="field">
              <label>시청자 등급</label>
              <select name="viewer_grade" required>
                ${GRADE_OPTIONS.map((g) => {
                  //  기본값은 "등급 선택"(value="")
                  return `<option value="${esc(g.key)}">${esc(g.label)}</option>`;
                }).join("")}
              </select>
            </div>

            <div class="field">
              <label>치지직 닉네임</label>
              <input name="chzzk_nickname" placeholder="예) 데본베일" required maxlength="40"/>
            </div>

            <div class="field">
              <label>모험단 이름</label>
              <input name="adventure_name" placeholder="예) 데본베일" required maxlength="60"/>
            </div>

            <div class="field">
              <label>딜러 갯수</label>
              <input name="dealer_count" placeholder="딜러 갯수" inputmode="numeric" required />
            </div>

            <div class="field">
              <label>버퍼 갯수</label>
              <input name="buffer_count" placeholder="버퍼 갯수" inputmode="numeric" required />
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <button class="btn btnOk" type="submit">등록</button>
          </div>
        </form>

        <div class="hint">
          - 한 회차 정원: 3버퍼/9딜러(총 12명), 배치는 수기배치로 진행됩니다..<br/>
          - 등록 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>`
    )
  );
});

app.post("/reserve", (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const blocked = requireViewerAuth(raid, req, res);
  if (blocked) return;

  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();
  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);

  //  등급 미선택(value="")이면 등록 불가
  if (!viewer_grade) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "시청자 등급을 선택해야 예약할 수 있습니다."
      )}`
    );
  }

  if (!GRADE_OPTIONS.some((g) => g.key === viewer_grade && g.key !== "")) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "시청자 등급 값이 올바르지 않습니다."
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

  if (!Number.isInteger(dealer_count) || dealer_count < 0 || dealer_count > 999) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "딜러 갯수는 0~999 사이의 정수여야 합니다."
      )}`
    );
  }

  if (!Number.isInteger(buffer_count) || buffer_count < 0 || buffer_count > 999) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent(
        "버퍼 갯수는 0~999 사이의 정수여야 합니다."
      )}`
    );
  }

  db.prepare(
    `INSERT INTO applications
      (created_at, date_kst, raid_key, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, confirmed, streamer_comment)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, 0, '')`
  ).run(nowISO(), todayKST(), raid, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count);

  return res.send(
    layout(
      "등록 완료",
      `<div class="card">
        <div class="title">등록이 완료되었습니다.</div>
        <div class="sub">레이드: ${esc(raidObj.label)} / 날짜: ${esc(todayKST())}</div>
        <hr/>
        <div class="row">
          <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">추가 등록</a>
          <a class="btn" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
        </div>
      </div>`
    )
  );
});

app.get("/check", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const blocked = requireViewerAuth(raid, req, res);
  if (blocked) return;

  const apps = db
    .prepare(
      `SELECT * FROM applications
       WHERE date_kst=? AND raid_key=?
       ORDER BY datetime(created_at) DESC`
    )
    .all(todayKST(), raid);

  res.send(
    layout(
      "예약 확인",
      `<div class="card">
        <div class="row space">
          <div>
            <div class="title">예약 확인</div>
            <div class="sub">레이드: ${esc(raidObj.label)} / 날짜: ${esc(todayKST())}</div>
          </div>
          <div class="row">
            <a class="btn" href="/">메인</a>
            <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">예약신청</a>
          </div>
        </div>

        <table>
          <tr>
            <th class="center">상태</th>
            <th>시청자 등급</th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            <th class="center">딜러</th>
            <th class="center">버퍼</th>
            <th>스트리머 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps
                  .map((a) => {
                    const status =
                      a.confirmed === 1
                        ? `<span class="statusOk">✅ 등록완료</span>`
                        : `<span class="statusWait">⏳ 대기중</span>`;
                    return `<tr>
                      <td class="center">${status}</td>
                      <td>${esc(gradeLabel(a.viewer_grade))}</td>
                      <td>${esc(a.chzzk_nickname)}</td>
                      <td>${esc(a.adventure_name)}</td>
                      <td class="center">${esc(a.dealer_count)}</td>
                      <td class="center">${esc(a.buffer_count)}</td>
                      <td>${a.streamer_comment ? esc(a.streamer_comment) : `<span style="color:rgba(255,255,255,.35)">-</span>`}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="center" style="color:#aaa;">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="hint">
          - 등록완료는 스트리머가 확인(수기 배치)했다는 표시입니다.<br/>
          - 코멘트는 스트리머가 예약확인 화면에서 남기면 여기에 표시됩니다.
        </div>
      </div>`
    )
  );
});

// ====== ROUTES (Admin / Secret URL) ======

// 로그인 화면
app.get(`${ADMIN_PATH}/login`, (req, res) => {
  res.send(
    layout(
      "스트리머 로그인",
      `<div class="card">
        <div class="title">스트리머 로그인</div>
        <div class="sub">비밀 URL로만 접근 가능합니다.</div>
        <hr/>
        <form method="POST" action="${ADMIN_PATH}/login" class="row" style="align-items:flex-end;">
          <div class="field" style="min-width:280px;flex:1;">
            <label>ADMIN_KEY</label>
            <input name="key" placeholder="환경변수 ADMIN_KEY" required />
          </div>
          <button class="btn btnOk" type="submit">로그인</button>
        </form>
      </div>`
    )
  );
});

app.post(`${ADMIN_PATH}/login`, (req, res) => {
  const key = String(req.body.key || "");
  if (key !== ADMIN_KEY) {
    return res.send(
      layout(
        "로그인 실패",
        `<div class="card">
          <div class="title">키가 올바르지 않습니다</div>
          <a class="btn" href="${ADMIN_PATH}/login">다시 시도</a>
        </div>`
      )
    );
  }
  res.cookie("admin_ok", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  return res.redirect(`${ADMIN_PATH}/raid`);
});

// 레이드 선택
app.get(`${ADMIN_PATH}/raid`, requireAdmin, (req, res) => {
  const buttons = RAID_OPTIONS.map(
    (r) =>
      `<a class="btn" href="${ADMIN_PATH}/list?raid=${encodeURIComponent(
        r.key
      )}&sort=time">${esc(r.label)}</a>`
  ).join(" ");

  res.send(
    layout(
      "스트리머 모드",
      `<div class="card">
        <div class="row space">
          <div>
            <div class="title">스트리머 모드</div>
            <div class="sub">레이드 선택 후 신청목록/인증키/코멘트/등록완료/삭제/일괄삭제를 관리합니다.</div>
          </div>
          <div class="row">
            <a class="btn" href="/">시청자 메인</a>
          </div>
        </div>
        <hr/>
        <div class="row">${buttons}</div>
      </div>`
    )
  );
});

// 신청목록 (정렬: time / grade)
app.get(`${ADMIN_PATH}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time"); // time | grade
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_PATH}/raid`);

  const date = todayKST();

  const codeRow = db
    .prepare("SELECT code FROM raid_codes WHERE date_kst=? AND raid_key=?")
    .get(date, raid);

  let apps = db
    .prepare("SELECT * FROM applications WHERE date_kst=? AND raid_key=?")
    .all(date, raid);

  if (sort === "grade") {
    apps.sort((a, b) => {
      const aa = GRADE_SORT_ORDER[a.viewer_grade] || 999;
      const bb = GRADE_SORT_ORDER[b.viewer_grade] || 999;
      if (aa !== bb) return aa - bb;
      // 같은 등급이면 시간순(빠른게 위)
      return new Date(a.created_at) - new Date(b.created_at);
    });
  } else {
    // 시간순(빠른게 위)
    apps.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  res.send(
    layout(
      "스트리머 예약 확인",
      `<div class="card">
        <div class="row space">
          <div>
            <div class="title">예약 확인</div>
            <div class="sub">레이드: ${esc(raidObj.label)} / 날짜: ${esc(date)}
              <span class="chip">등록완료: ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn" href="${ADMIN_PATH}/raid">레이드 변경</a>
          </div>
        </div>

        <hr/>

        <div class="row" style="align-items:flex-end;">
          <form method="POST" action="${ADMIN_PATH}/code" class="row" style="align-items:flex-end; flex:1; min-width: 320px;">
            <input type="hidden" name="raid" value="${esc(raid)}"/>
            <div class="field" style="min-width:240px; flex:1;">
              <label>오늘 인증키 (시청자 입력용)</label>
              <input name="code" value="${esc(codeRow?.code || "")}" placeholder="예) 1234ABCD" required />
            </div>
            <button class="btn btnWarn" type="submit">인증키 저장</button>
          </form>

          <form method="POST" action="${ADMIN_PATH}/bulk-delete"
                onsubmit="return confirm('정말로 이 레이드의 오늘 신청을 전부 삭제할까요?');">
            <input type="hidden" name="raid" value="${esc(raid)}"/>
            <button class="btn btnDanger" type="submit">오늘 신청 일괄삭제</button>
          </form>
        </div>

        <table>
          <tr>
            <th class="center">등록완료</th>
            <th>
              <a href="${esc(gradeHeaderLink)}" style="text-decoration:underline;">
                시청자 등급 ${sort === "grade" ? "▼" : ""}
              </a>
            </th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            <th class="center">딜러</th>
            <th class="center">버퍼</th>
            <th>코멘트</th>
            <th class="center">삭제</th>
          </tr>

          ${
            apps.length
              ? apps
                  .map((a) => {
                    const formId = `confirmForm_${a.id}`;
                    const checked = a.confirmed === 1 ? "checked" : "";
                    const commentFormId = `commentForm_${a.id}`;
                    return `
                    <tr>
                      <td class="center">
                        <form id="${formId}" method="POST" action="${ADMIN_PATH}/confirm" style="margin:0;">
                          <input type="hidden" name="id" value="${esc(a.id)}"/>
                          <input type="hidden" name="raid" value="${esc(raid)}"/>
                          <input type="hidden" name="sort" value="${esc(sort)}"/>
                          <input type="hidden" name="confirmed" value="${a.confirmed === 1 ? "0" : "1"}"/>
                          <input type="checkbox" ${checked} onchange="submitOnChange('${formId}')"/>
                        </form>
                      </td>
                      <td>${esc(gradeLabel(a.viewer_grade))}</td>
                      <td>${esc(a.chzzk_nickname)}</td>
                      <td>${esc(a.adventure_name)}</td>
                      <td class="center">${esc(a.dealer_count)}</td>
                      <td class="center">${esc(a.buffer_count)}</td>
                      <td>
                        <form id="${commentFormId}" method="POST" action="${ADMIN_PATH}/comment" style="margin:0;">
                          <input type="hidden" name="id" value="${esc(a.id)}"/>
                          <input type="hidden" name="raid" value="${esc(raid)}"/>
                          <input type="hidden" name="sort" value="${esc(sort)}"/>
                          <input name="comment" value="${esc(a.streamer_comment || "")}" placeholder="예약자에게 남길 코멘트" maxlength="140"
                                 style="min-width:220px;"/>
                          <button class="btn" type="submit">저장</button>
                        </form>
                      </td>
                      <td class="center">
                        <form method="POST" action="${ADMIN_PATH}/delete"
                              onsubmit="return confirm('정말 삭제하시겠습니까?');"
                              style="margin:0;">
                          <input type="hidden" name="id" value="${esc(a.id)}"/>
                          <input type="hidden" name="raid" value="${esc(raid)}"/>
                          <input type="hidden" name="sort" value="${esc(sort)}"/>
                          <button class="btn btnDanger" type="submit">삭제</button>
                        </form>
                      </td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="8" class="center" style="color:#aaa;">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="hint">
          - “시청자 등급” 클릭 시: 불타는 치즈 → 분홍색 치즈 → 노란색 치즈 → 일반 등급 정렬 (다시 클릭하면 시간순).<br/>
          - 등록완료 체크는 “확인했음” 표시이며 시청자 화면에도 ✅ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - 코멘트는 시청자 예약확인 화면에 바로 표시됩니다.
        </div>
      </div>`
    )
  );
});

// 인증키 저장
app.post(`${ADMIN_PATH}/code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_PATH}/raid`);
  if (!code) return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=time`);

  db.prepare(
    `INSERT INTO raid_codes (date_kst, raid_key, code)
     VALUES (?, ?, ?)
     ON CONFLICT(date_kst, raid_key) DO UPDATE SET code=excluded.code`
  ).run(todayKST(), raid, code);

  return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=time`);
});

// 등록완료 토글
app.post(`${ADMIN_PATH}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
  }
  return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 코멘트 저장
app.post(`${ADMIN_PATH}/comment`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const comment = String(req.body.comment || "").trim().slice(0, 140);

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET streamer_comment=? WHERE id=?").run(comment, id);
  }
  return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 개별 삭제
app.post(`${ADMIN_PATH}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
  }
  return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 오늘 신청 일괄삭제
app.post(`${ADMIN_PATH}/bulk-delete`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_PATH}/raid`);
  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(todayKST(), raid);
  return res.redirect(`${ADMIN_PATH}/list?raid=${encodeURIComponent(raid)}&sort=time`);
});

// ====== START ======
app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
  console.log("Admin secret path:", ADMIN_PATH);
});
