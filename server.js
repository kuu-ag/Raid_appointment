// server.js (ESM / "type":"module" 환경용)
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
app.set("trust proxy", 1); // Render/프록시 환경에서 secure cookie 위해 필요

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// =====================
// ENV
// =====================
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();

// ✅ 기존 관리자 비밀 URL 유지
// 기존: https://www.devonraid.xyz/devon_path_f23d12
const ADMIN_PATH = (process.env.ADMIN_PATH || "devon_path_f23d12").trim();
const ADMIN_BASE = "/" + ADMIN_PATH;

// =====================
// Options
// =====================
const RAID_OPTIONS = [
  { key: "dirige", label: "디레지에" },
  { key: "dirige-hard", label: "디레지에-악연" },
  { key: "inhwagongjeon", label: "이내향혼전" },
  { key: "nabel", label: "인공신 : 나벨" },
  { key: "nabel-hard", label: "나벨 - 하드모드" },
];

// ✅ 등급: 기본값 "등급 선택"(빈 값) 추가
const GRADE_OPTIONS = [
  { key: "", label: "등급 선택" }, // ✅ 기본값
  { key: "burning", label: "불타는 치즈" },
  { key: "pink", label: "분홍색 치즈" },
  { key: "yellow", label: "노란색 치즈" },
  { key: "normal", label: "일반 등급" },
];

// 등급 정렬 우선순위
const GRADE_SORT = { burning: 1, pink: 2, yellow: 3, normal: 4 };

// =====================
// DB
// =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render 디스크 영속성은 플랜/설정에 따라 다를 수 있음(재배포/재시작 시 초기화 가능)
const db = new Database(path.join(__dirname, "data.sqlite"));

// 테이블 생성
db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,

  viewer_grade TEXT NOT NULL,       -- ✅ 필수
  chzzk_nickname TEXT NOT NULL,
  adventure_name TEXT NOT NULL,

  dealer_count INTEGER NOT NULL,
  buffer_count INTEGER NOT NULL,

  confirmed INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_applications_date_raid
ON applications(date_kst, raid_key);

CREATE TABLE IF NOT EXISTS day_codes (
  date_kst TEXT NOT NULL,
  raid_key TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (date_kst, raid_key)
);
`);

// =====================
// Utils
// =====================
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
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

// =====================
// Layout / CSS (입력칸 겹침 방지 포함)
// =====================
function layout(body, title = "데본베일 레이드 예약 사이트") {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    :root{
      --bg:#070a12;
      --panel:#0b1226;
      --panel2: rgba(18,26,42,.9);
      --line:rgba(255,255,255,.14);
      --text:#e9eefc;
      --muted:rgba(233,238,252,.72);
      --btn:#1c2a52;
      --btn2:#263a75;
      --danger:#7a1d2a;
      --chip:rgba(255,255,255,.06);
      --shadow:0 10px 26px rgba(0,0,0,.35);
      --radius:16px;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans KR", sans-serif;
      background: radial-gradient(1100px 600px at 20% 10%, #13244a 0%, var(--bg) 60%, #05070f 100%);
      color: var(--text);
    }
    a{ color:inherit; text-decoration:none; }
    .wrap{ max-width:1100px; margin:0 auto; padding:22px 14px 60px; }
    .title{
      border:2px solid rgba(255,255,255,.20);
      background: rgba(11,18,38,.95);
      border-radius: 12px;
      text-align:center;
      font-weight:900;
      font-size: clamp(20px, 3.2vw, 34px);
      padding: 16px 10px;
      box-shadow: var(--shadow);
      margin-bottom: 14px;
    }
    .box{
      background: var(--panel2);
      border:1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .sp{ justify-content:space-between; }
    .btn{
      border:1px solid var(--line);
      background: var(--btn);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 12px;
      cursor:pointer;
      font-weight:800;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
    }
    .btn:hover{ background: var(--btn2); }
    .btnGhost{ background: transparent; }
    .btnDanger{ background: var(--danger); }
    .chip{
      display:inline-flex;
      gap:6px;
      align-items:center;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--chip);
      border:1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    .muted{ color: var(--muted); font-size: 14px; }
    .divider{ height:1px; background: rgba(255,255,255,.10); margin: 14px 0; }
    .ok{ color:#b6ffcf; }
    .wait{ color:#ffd7a6; }
    .bad{ color:#ffb6c2; }

    input, select{
      width: 100%;
      background: #0b1226;
      border:1px solid rgba(255,255,255,.18);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 12px;
      outline:none;
      min-width: 0;
    }
    input::placeholder{ color: rgba(233,238,252,.45); }

    /* ✅ 겹침 방지: 폼을 grid로 */
    .formGrid{
      display:grid;
      grid-template-columns: 160px minmax(160px, 1fr) minmax(160px, 1fr) 140px 140px;
      gap: 10px;
      align-items:end;
    }
    .field label{
      display:block;
      font-size: 12px;
      color: var(--muted);
      margin: 0 0 6px 2px;
    }

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
      overflow:hidden;
      border-radius: 14px;
      border:1px solid rgba(255,255,255,.12);
      background:#0b1226;
    }
    th, td{
      border-bottom:1px solid rgba(255,255,255,.10);
      padding:10px 10px;
      text-align:left;
      font-size: 13px;
      vertical-align: middle;
    }
    th{
      background:#0e1731;
      font-weight:900;
      font-size:12px;
      letter-spacing:.2px;
      color: rgba(233,238,252,.9);
    }
    tr:last-child td{ border-bottom:0; }
    .center{ text-align:center; }

    .commentBox{ width: min(360px, 42vw); }
    @media (max-width: 520px){ .commentBox{ width:100%; } }

  </style>
  <script>
    function submitOnChange(formId){
      const f = document.getElementById(formId);
      if(f) f.submit();
    }
  </script>
</head>
<body>
  <div class="wrap">
    <div class="title">데본베일 레이드 예약 사이트</div>
    ${body}
  </div>
</body>
</html>`;
}

// =====================
// Auth Guards
// =====================
function requireViewerOk(req, res, next) {
  const raid = String(req.query.raid || req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const cookieKey = `viewer_ok_${raid}_${todayKST()}`;
  if (req.cookies[cookieKey] !== "1") {
    return res.redirect(`/verify?raid=${encodeURIComponent(raid)}`);
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(500).send(
      layout(`
        <div class="box">
          <div class="bad"><b>ADMIN_KEY가 설정되지 않았습니다.</b></div>
          <div class="muted">Render Environment Variables에 ADMIN_KEY를 추가하세요.</div>
        </div>
      `, "오류")
    );
  }
  const key = String(req.cookies.admin_key || "");
  if (key !== ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/login`);
  return next();
}

// =====================
// Hide /admin (404)
// =====================
app.get("/admin", (req, res) => res.status(404).send("Not Found"));
app.get("/admin/*", (req, res) => res.status(404).send("Not Found"));

// =====================
// Viewer routes
// =====================
app.get("/", (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">메인</div>
            <div class="muted">레이드를 선택 → 인증키 입력 → 예약 신청</div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="/check">예약확인</a>
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="gap:12px;">
          ${RAID_OPTIONS.map(
            (r) =>
              `<a class="btn" href="/verify?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`
          ).join("")}
        </div>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 한 회차 정원: 3버퍼/9딜러(총 12명), 하루 최대 20회차(수기 배치)<br/>
          - 신청 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>
    `)
  );
});

// 인증키 입력 화면
app.get("/verify", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">인증키 입력</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        <form method="POST" action="/verify" class="row" style="align-items:flex-end;">
          <input type="hidden" name="raid" value="${esc(raid)}"/>
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">오늘 인증키</div>
            <input name="code" placeholder="스트리머가 공지한 인증키" required />
          </div>
          <button class="btn" type="submit">확인</button>
        </form>
      </div>
    `, "인증키")
  );
});

// 인증키 검증 → 예약 페이지
app.post("/verify", (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const row = db
    .prepare("SELECT code FROM day_codes WHERE date_kst=? AND raid_key=?")
    .get(todayKST(), raid);

  if (!row || String(row.code) !== code) {
    return res.send(
      layout(`
        <div class="box">
          <div class="bad"><b>인증키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="/verify?raid=${encodeURIComponent(raid)}">다시 입력</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      `, "인증 실패")
    );
  }

  res.cookie(`viewer_ok_${raid}_${todayKST()}`, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
  });

  return res.redirect(`/reserve?raid=${encodeURIComponent(raid)}`);
});

// 예약 화면
app.get("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  const err = String(req.query.err || "");

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약 신청</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
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

          <!-- ✅ 겹침 방지: grid -->
          <div class="formGrid">
            <div class="field">
              <label>시청자 등급</label>
              <select name="viewer_grade" required>
                ${GRADE_OPTIONS.map(g => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("")}
              </select>
            </div>

            <div class="field">
              <label>치지직 닉네임</label>
              <input name="chzzk_nickname" placeholder="예) 토엔" required maxlength="40"/>
            </div>

            <div class="field">
              <label>모험단 이름</label>
              <input name="adventure_name" placeholder="예) 흑조군단" required maxlength="60"/>
            </div>

            <div class="field">
              <label>딜러 갯수</label>
              <input name="dealer_count" inputmode="numeric" placeholder="정수" required />
            </div>

            <div class="field">
              <label>버퍼 갯수</label>
              <input name="buffer_count" inputmode="numeric" placeholder="정수" required />
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <button class="btn" type="submit">등록</button>
          </div>
        </form>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 등급을 “등급 선택” 그대로 두면 등록이 안 됩니다.<br/>
          - 등록 후 “예약확인”에서 등록완료/대기중 및 스트리머 코멘트를 확인할 수 있습니다.
        </div>
      </div>
    `, "예약 신청")
  );
});

// 예약 등록 처리
app.post("/reserve", requireViewerOk, (req, res) => {
  const raid = String(req.body.raid || "");
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect("/");

  // ✅ 서버 검증: 등급 선택 필수(빈 값이면 거부)
  const viewer_grade = String(req.body.viewer_grade || "");
  const chzzk_nickname = String(req.body.chzzk_nickname || "").trim();
  const adventure_name = String(req.body.adventure_name || "").trim();
  const dealer_count = Number(req.body.dealer_count);
  const buffer_count = Number(req.body.buffer_count);

  // 등급 유효성: 빈값 금지 + 목록에 있는 값만
  const validGradeKeys = new Set(GRADE_OPTIONS.map(g => g.key));
  if (!viewer_grade || !validGradeKeys.has(viewer_grade) || viewer_grade === "") {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("시청자 등급을 선택해야 예약이 가능합니다.")}`
    );
  }

  if (!chzzk_nickname || !adventure_name) {
    return res.redirect(
      `/reserve?raid=${encodeURIComponent(raid)}&err=${encodeURIComponent("닉네임/모험단 이름을 입력해 주세요.")}`
    );
  }

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

  db.prepare(`
    INSERT INTO applications
    (created_at, date_kst, raid_key, viewer_grade, chzzk_nickname, adventure_name, dealer_count, buffer_count, confirmed, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '')
  `).run(
    nowISO(),
    todayKST(),
    raid,
    viewer_grade,
    chzzk_nickname,
    adventure_name,
    dealer_count,
    buffer_count
  );

  return res.send(
    layout(`
      <div class="box">
        <div style="font-weight:900;font-size:20px;margin-bottom:6px;">등록 완료</div>
        <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b></div>
        <div class="divider"></div>
        <div class="row">
          <a class="btn" href="/reserve?raid=${encodeURIComponent(raid)}">추가 등록</a>
          <a class="btn btnGhost" href="/check?raid=${encodeURIComponent(raid)}">예약확인</a>
          <a class="btn btnGhost" href="/">메인</a>
        </div>
      </div>
    `, "완료")
  );
});

// 예약확인(레이드 미선택 시 선택 화면)
app.get("/check", (req, res) => {
  const raid = String(req.query.raid || "");
  const raidObj = raidByKey(raid);

  if (!raidObj) {
    return res.send(
      layout(`
        <div class="box">
          <div class="row sp">
            <div>
              <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약확인</div>
              <div class="muted">확인할 레이드를 선택하세요. (오늘 신청 목록만 표시)</div>
            </div>
            <a class="btn btnGhost" href="/">메인</a>
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:12px;">
            ${RAID_OPTIONS.map(r => `<a class="btn" href="/check?raid=${encodeURIComponent(r.key)}">${esc(r.label)}</a>`).join("")}
          </div>
        </div>
      `, "예약확인")
    );
  }

  // (원하면 여기에도 requireViewerOk 걸 수 있지만, 현재 흐름은 공개 목록 형태로 유지)
  const apps = db.prepare(`
    SELECT * FROM applications
    WHERE date_kst=? AND raid_key=?
    ORDER BY datetime(created_at) ASC
  `).all(todayKST(), raid);

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">예약확인</div>
            <div class="muted">레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b>
              <span class="chip">등록완료 ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
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
            <th>시청자 등급</th>
            <th>치지직 닉네임</th>
            <th>모험단 이름</th>
            <th class="center">딜러</th>
            <th class="center">버퍼</th>
            <th class="center">상태</th>
            <th>스트리머 코멘트</th>
          </tr>
          ${
            apps.length
              ? apps.map(a => {
                  const status = a.confirmed === 1
                    ? `<span class="ok">✅ 등록완료</span>`
                    : `<span class="wait">⏳ 대기중</span>`;
                  return `
                    <tr>
                      <td>${esc(gradeLabel(a.viewer_grade))}</td>
                      <td>${esc(a.chzzk_nickname)}</td>
                      <td>${esc(a.adventure_name)}</td>
                      <td class="center">${esc(a.dealer_count)}</td>
                      <td class="center">${esc(a.buffer_count)}</td>
                      <td class="center">${status}</td>
                      <td>${a.comment ? esc(a.comment) : `<span class="muted">-</span>`}</td>
                    </tr>
                  `;
                }).join("")
              : `<tr><td colspan="7" class="center muted">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - “등록완료”는 스트리머가 확인 체크한 상태입니다.<br/>
          - 코멘트는 스트리머가 남기는 안내/요청사항입니다.
        </div>
      </div>
    `, "예약확인")
  );
});

// =====================
// Admin routes (Secret URL)
// =====================
app.get(ADMIN_BASE, (req, res) => {
  const key = String(req.cookies.admin_key || "");
  if (ADMIN_KEY && key === ADMIN_KEY) return res.redirect(`${ADMIN_BASE}/raid`);
  return res.redirect(`${ADMIN_BASE}/login`);
});

// 로그인 화면
app.get(`${ADMIN_BASE}/login`, (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">스트리머 로그인</div>
            <div class="muted">비밀 주소로만 접속됩니다: <b>${esc(ADMIN_BASE)}</b></div>
          </div>
          <a class="btn btnGhost" href="/">메인</a>
        </div>

        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/login" class="row" style="align-items:flex-end;">
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">ADMIN_KEY</div>
            <input name="key" placeholder="Render 환경변수 ADMIN_KEY" required />
          </div>
          <button class="btn" type="submit">입장</button>
        </form>

        <div class="muted" style="margin-top:12px;">
          - /admin 은 404로 숨겨집니다.<br/>
          - 접속 주소: https://www.devonraid.xyz${esc(ADMIN_BASE)}
        </div>
      </div>
    `, "스트리머 로그인")
  );
});

app.post(`${ADMIN_BASE}/login`, (req, res) => {
  const key = String(req.body.key || "").trim();
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.send(
      layout(`
        <div class="box">
          <div class="bad"><b>키가 올바르지 않습니다.</b></div>
          <div class="divider"></div>
          <a class="btn" href="${esc(ADMIN_BASE)}/login">다시 시도</a>
        </div>
      `, "실패")
    );
  }

  res.cookie("admin_key", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return res.redirect(`${ADMIN_BASE}/raid`);
});

app.get(`${ADMIN_BASE}/logout`, (req, res) => {
  res.clearCookie("admin_key");
  res.redirect(`${ADMIN_BASE}/login`);
});

// 관리자: 레이드 선택 + 인증키 설정
app.get(`${ADMIN_BASE}/raid`, requireAdmin, (req, res) => {
  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">관리자</div>
            <div class="muted">레이드별 신청목록 확인 / 오늘 인증키 설정</div>
          </div>
          <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/logout">로그아웃</a>
        </div>

        <div class="divider"></div>

        <div style="font-weight:900;margin-bottom:8px;">신청목록 보기</div>
        <form method="GET" action="${esc(ADMIN_BASE)}/list" class="row">
          <select name="raid" required style="max-width:260px;">
            <option value="">레이드 선택</option>
            ${RAID_OPTIONS.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
          </select>
          <input type="hidden" name="sort" value="time"/>
          <button class="btn" type="submit">확인</button>
        </form>

        <div class="divider"></div>

        <div style="font-weight:900;margin-bottom:8px;">오늘 인증키 설정</div>
        <div class="muted">시청자가 신청하려면 레이드별 “오늘 인증키”가 필요합니다.</div>

        <div class="divider"></div>

        <form method="POST" action="${esc(ADMIN_BASE)}/code" class="row" style="align-items:flex-end;">
          <div style="min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">레이드</div>
            <select name="raid" required style="max-width:260px;">
              <option value="">레이드 선택</option>
              ${RAID_OPTIONS.map(r => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join("")}
            </select>
          </div>
          <div style="flex:1; min-width:240px;">
            <div class="muted" style="margin-bottom:6px;">오늘 인증키</div>
            <input name="code" placeholder="예) 1234ABCD" required />
          </div>
          <button class="btn" type="submit">저장</button>
        </form>

        <div class="muted" style="margin-top:12px;">
          - 날짜는 KST 기준: <b>${esc(todayKST())}</b><br/>
          - 인증키를 변경하면 시청자는 새 키로만 신청 가능
        </div>
      </div>
    `, "관리자")
  );
});

// 인증키 저장
app.post(`${ADMIN_BASE}/code`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const code = String(req.body.code || "").trim();
  if (!raidByKey(raid) || !code) return res.redirect(`${ADMIN_BASE}/raid`);

  db.prepare(`
    INSERT INTO day_codes(date_kst, raid_key, code)
    VALUES(?, ?, ?)
    ON CONFLICT(date_kst, raid_key) DO UPDATE SET code=excluded.code
  `).run(todayKST(), raid, code);

  return res.redirect(`${ADMIN_BASE}/raid`);
});

// 신청목록
app.get(`${ADMIN_BASE}/list`, requireAdmin, (req, res) => {
  const raid = String(req.query.raid || "");
  const sort = String(req.query.sort || "time"); // time | grade
  const raidObj = raidByKey(raid);
  if (!raidObj) return res.redirect(`${ADMIN_BASE}/raid`);

  const gradeHeaderLink =
    sort === "grade"
      ? `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=time`
      : `${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=grade`;

  let apps = db.prepare(`
    SELECT * FROM applications
    WHERE date_kst=? AND raid_key=?
  `).all(todayKST(), raid);

  if (sort === "grade") {
    apps.sort((a, b) => {
      const aa = GRADE_SORT[a.viewer_grade] ?? 999;
      const bb = GRADE_SORT[b.viewer_grade] ?? 999;
      if (aa !== bb) return aa - bb;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
  } else {
    apps.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  res.send(
    layout(`
      <div class="box">
        <div class="row sp">
          <div>
            <div style="font-weight:900;font-size:20px;margin-bottom:6px;">신청목록</div>
            <div class="muted">
              레이드: <b>${esc(raidObj.label)}</b> / 날짜: <b>${esc(todayKST())}</b>
              <span class="chip">등록완료 ${apps.filter(a=>a.confirmed===1).length}/${apps.length}</span>
            </div>
          </div>
          <div class="row">
            <a class="btn btnGhost" href="${esc(ADMIN_BASE)}/raid">레이드 변경</a>
            <form method="POST" action="${esc(ADMIN_BASE)}/clear"
                  onsubmit="return confirm('정말 이 레이드의 오늘 신청목록을 전부 삭제할까요? (되돌릴 수 없음)');"
                  style="margin:0;">
              <input type="hidden" name="raid" value="${esc(raid)}"/>
              <input type="hidden" name="sort" value="${esc(sort)}"/>
              <button class="btn btnDanger" type="submit">오늘 신청 일괄삭제</button>
            </form>
          </div>
        </div>

        <div class="divider"></div>

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
              ? apps.map(a => {
                  const formId = `confirmForm_${a.id}`;
                  const checked = a.confirmed === 1 ? "checked" : "";
                  const commentVal = String(a.comment || "");
                  return `
                    <tr>
                      <td class="center">
                        <form id="${formId}" method="POST" action="${esc(ADMIN_BASE)}/confirm" style="margin:0;">
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
                        <form method="POST" action="${esc(ADMIN_BASE)}/comment" style="margin:0;" class="row">
                          <input type="hidden" name="id" value="${esc(a.id)}"/>
                          <input type="hidden" name="raid" value="${esc(raid)}"/>
                          <input type="hidden" name="sort" value="${esc(sort)}"/>
                          <input class="commentBox" name="comment"
                                 placeholder="예) 3회차 가능 / 디코 부탁 / 오늘 마감"
                                 value="${esc(commentVal)}"/>
                          <button class="btn" type="submit">저장</button>
                        </form>
                      </td>
                      <td class="center">
                        <form method="POST" action="${esc(ADMIN_BASE)}/delete"
                              onsubmit="return confirm('정말 삭제하시겠습니까?');"
                              style="margin:0;">
                          <input type="hidden" name="id" value="${esc(a.id)}"/>
                          <input type="hidden" name="raid" value="${esc(raid)}"/>
                          <input type="hidden" name="sort" value="${esc(sort)}"/>
                          <button class="btn btnDanger" type="submit">삭제</button>
                        </form>
                      </td>
                    </tr>
                  `;
                }).join("")
              : `<tr><td colspan="8" class="center muted">오늘 신청이 없습니다.</td></tr>`
          }
        </table>

        <div class="muted" style="margin-top:12px;line-height:1.5;">
          - 등록완료 체크는 시청자 화면에도 ✅ 등록완료/⏳ 대기중으로 표시됩니다.<br/>
          - 코멘트는 시청자 예약확인 화면에서도 보입니다.
        </div>
      </div>
    `, "신청목록")
  );
});

// 등록완료 토글
app.post(`${ADMIN_BASE}/confirm`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const confirmed = String(req.body.confirmed || "0") === "1" ? 1 : 0;

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET confirmed=? WHERE id=?").run(confirmed, id);
  }
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 코멘트 저장
app.post(`${ADMIN_BASE}/comment`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  const comment = String(req.body.comment || "").slice(0, 200);

  if (Number.isInteger(id)) {
    db.prepare("UPDATE applications SET comment=? WHERE id=?").run(comment, id);
  }
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 개별 삭제
app.post(`${ADMIN_BASE}/delete`, requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");

  if (Number.isInteger(id)) {
    db.prepare("DELETE FROM applications WHERE id=?").run(id);
  }
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// 오늘/선택 레이드 일괄삭제
app.post(`${ADMIN_BASE}/clear`, requireAdmin, (req, res) => {
  const raid = String(req.body.raid || "");
  const sort = String(req.body.sort || "time");
  if (!raidByKey(raid)) return res.redirect(`${ADMIN_BASE}/raid`);

  db.prepare("DELETE FROM applications WHERE date_kst=? AND raid_key=?").run(todayKST(), raid);
  return res.redirect(`${ADMIN_BASE}/list?raid=${encodeURIComponent(raid)}&sort=${encodeURIComponent(sort)}`);
});

// health
app.get("/health", (req, res) => res.json({ ok: true, kst: todayKST() }));

// start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin secret url: ${ADMIN_BASE}`);
});
