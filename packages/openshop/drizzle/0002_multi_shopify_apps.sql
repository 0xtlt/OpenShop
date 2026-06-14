ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS app_handle text NOT NULL DEFAULT 'default';

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS app_handle text NOT NULL DEFAULT 'default';

ALTER TABLE provider_configs
  ADD COLUMN IF NOT EXISTS app_handle text NOT NULL DEFAULT 'default';

ALTER TABLE cron_overrides
  ADD COLUMN IF NOT EXISTS app_handle text NOT NULL DEFAULT 'default';

ALTER TABLE installations
  DROP CONSTRAINT IF EXISTS installations_shop_unique;

DROP INDEX IF EXISTS flow_runs_shop_created_idx;
DROP INDEX IF EXISTS flow_runs_shop_flow_status_idx;
DROP INDEX IF EXISTS provider_configs_shop_provider_unique;
DROP INDEX IF EXISTS cron_overrides_shop_cron_unique;

CREATE UNIQUE INDEX IF NOT EXISTS installations_app_shop_unique
  ON installations (app_handle, shop);

CREATE INDEX IF NOT EXISTS flow_runs_app_shop_created_idx
  ON flow_runs (app_handle, shop, created_at);

CREATE INDEX IF NOT EXISTS flow_runs_app_shop_flow_status_idx
  ON flow_runs (app_handle, shop, flow_name, status);

CREATE UNIQUE INDEX IF NOT EXISTS provider_configs_app_shop_provider_unique
  ON provider_configs (app_handle, shop, provider_name);

CREATE UNIQUE INDEX IF NOT EXISTS cron_overrides_app_shop_cron_unique
  ON cron_overrides (app_handle, shop, cron_key);
