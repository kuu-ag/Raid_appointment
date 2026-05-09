-- 던클리 합성 데이터 시간 재분포 SQL
-- 목적:
-- - 이전에 생성한 합성 데이터의 created_at / updated_at이 미래 시간처럼 잡혀
--   실제 조회 유저가 최상단에 오지 않는 문제를 해결합니다.
-- - 합성 데이터만 2026-05-02 13:00:00 ~ 2026-05-10 03:00:00 사이로 랜덤 분포시킵니다.
--
-- 대상:
-- - season_key='total'
-- - anonymous_id에 '_mix'가 포함된 데이터
-- - 또는 anonymous_id가 'syn_total_382_%' 형태인 데이터
--
-- 실행 전 백업 권장:
-- sqlite3 /var/data/data.sqlite ".backup '/var/data/data_before_spread_synthetic_time.sqlite'"
--
-- 적용:
-- sqlite3 /var/data/data.sqlite < duncle_spread_synthetic_time_20260502_20260510.sql
--
-- 확인:
-- sqlite3 /var/data/data.sqlite "SELECT COUNT(*), MIN(updated_at), MAX(updated_at) FROM duncle_drop_rates WHERE season_key='total' AND (anonymous_id LIKE '%_mix%' OR anonymous_id LIKE 'syn_total_382_%');"
-- sqlite3 /var/data/data.sqlite "SELECT id, anonymous_id, created_at, updated_at FROM duncle_drop_rates ORDER BY datetime(updated_at) DESC, id DESC LIMIT 20;"

BEGIN TRANSACTION;

WITH target AS (
  SELECT
    id,
    datetime(
      '2026-05-02 13:00:00',
      '+' || (
        abs(random()) % (
          strftime('%s', '2026-05-10 03:00:00') - strftime('%s', '2026-05-02 13:00:00') + 1
        )
      ) || ' seconds'
    ) AS random_time
  FROM duncle_drop_rates
  WHERE season_key = 'total'
    AND (
      anonymous_id LIKE '%_mix%'
      OR anonymous_id LIKE 'syn_total_382_%'
    )
)
UPDATE duncle_drop_rates
SET
  created_at = (
    SELECT random_time
    FROM target
    WHERE target.id = duncle_drop_rates.id
  ),
  updated_at = (
    SELECT random_time
    FROM target
    WHERE target.id = duncle_drop_rates.id
  )
WHERE id IN (
  SELECT id
  FROM target
);

COMMIT;
