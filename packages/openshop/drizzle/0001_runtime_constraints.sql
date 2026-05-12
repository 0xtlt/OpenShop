CREATE TABLE IF NOT EXISTS installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop text NOT NULL UNIQUE,
  access_token text,
  scopes text,
  nonce text,
  installed_at timestamp with time zone NOT NULL DEFAULT now(),
  uninstalled_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop text NOT NULL,
  flow_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input json,
  error text,
  deadline_at timestamp with time zone,
  parent_run_id text,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamp with time zone,
  worker_id text,
  retry_policy json,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS step_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_name text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  output json,
  error text,
  duration_ms integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  flow_run_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop text NOT NULL,
  provider_name text NOT NULL,
  config json DEFAULT '{}'::json,
  last_checked_at timestamp with time zone,
  last_check_ok boolean,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cron_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop text NOT NULL,
  cron_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id text,
  level text NOT NULL DEFAULT 'info',
  message text,
  payload json,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

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
