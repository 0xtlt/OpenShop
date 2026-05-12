ALTER TABLE step_results ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;

WITH ranked_steps AS (
  SELECT id, row_number() OVER (
    PARTITION BY flow_run_id, step_name
    ORDER BY created_at ASC, id ASC
  ) AS attempt_no
  FROM step_results
)
UPDATE step_results
SET attempt = ranked_steps.attempt_no
FROM ranked_steps
WHERE step_results.id = ranked_steps.id;

WITH ranked_provider_configs AS (
  SELECT id, row_number() OVER (
    PARTITION BY shop, provider_name
    ORDER BY updated_at DESC, id DESC
  ) AS rn
  FROM provider_configs
)
DELETE FROM provider_configs
USING ranked_provider_configs
WHERE provider_configs.id = ranked_provider_configs.id
  AND ranked_provider_configs.rn > 1;

WITH ranked_cron_overrides AS (
  SELECT id, row_number() OVER (
    PARTITION BY shop, cron_key
    ORDER BY updated_at DESC, id DESC
  ) AS rn
  FROM cron_overrides
)
DELETE FROM cron_overrides
USING ranked_cron_overrides
WHERE cron_overrides.id = ranked_cron_overrides.id
  AND ranked_cron_overrides.rn > 1;

CREATE INDEX IF NOT EXISTS flow_runs_status_available_created_idx
  ON flow_runs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS flow_runs_shop_created_idx
  ON flow_runs (shop, created_at);
CREATE INDEX IF NOT EXISTS flow_runs_shop_flow_status_idx
  ON flow_runs (shop, flow_name, status);
CREATE INDEX IF NOT EXISTS step_results_flow_run_idx
  ON step_results (flow_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS step_results_flow_run_step_attempt_unique
  ON step_results (flow_run_id, step_name, attempt);
CREATE UNIQUE INDEX IF NOT EXISTS provider_configs_shop_provider_unique
  ON provider_configs (shop, provider_name);
CREATE UNIQUE INDEX IF NOT EXISTS cron_overrides_shop_cron_unique
  ON cron_overrides (shop, cron_key);
CREATE INDEX IF NOT EXISTS logs_flow_run_created_idx
  ON logs (flow_run_id, created_at);
