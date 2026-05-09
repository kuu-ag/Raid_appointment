-- duncle_drop_rates ID 재정렬 SQL
-- 목적:
-- - 현재 746, 747처럼 뒤죽박죽 보이는 id를
-- - 최초 등록 순서(created_at ASC, 기존 id ASC) 기준으로 1부터 다시 정렬합니다.
--
-- 실행 전 백업 권장:
-- sqlite3 /var/data/data.sqlite ".backup '/var/data/data_before_reindex_duncle_ids.sqlite'"
--
-- 적용:
-- sqlite3 /var/data/data.sqlite < duncle_reindex_ids_by_created_at.sql
--
-- 확인:
-- sqlite3 /var/data/data.sqlite "SELECT id, anonymous_id, created_at, updated_at FROM duncle_drop_rates ORDER BY id ASC LIMIT 20;"
-- sqlite3 /var/data/data.sqlite "SELECT COUNT(*), MIN(id), MAX(id) FROM duncle_drop_rates;"

BEGIN TRANSACTION;

-- 1) 기존 id를 큰 값으로 임시 이동해서 UNIQUE/PRIMARY KEY 충돌 방지
UPDATE duncle_drop_rates
SET id = id + 1000000;

-- 2) 최초 등록 순서 기준으로 1부터 재부여
WITH ordered AS (
  SELECT
    id AS temp_id,
    ROW_NUMBER() OVER (
      ORDER BY
        datetime(created_at) ASC,
        id ASC
    ) AS new_id
  FROM duncle_drop_rates
)
UPDATE duncle_drop_rates
SET id = (
  SELECT new_id
  FROM ordered
  WHERE ordered.temp_id = duncle_drop_rates.id
);

-- 3) AUTOINCREMENT 다음 번호를 현재 최대 id 다음으로 맞춤
UPDATE sqlite_sequence
SET seq = (SELECT MAX(id) FROM duncle_drop_rates)
WHERE name = 'duncle_drop_rates';

COMMIT;
