ALTER TABLE mobile_devices ADD COLUMN app_version TEXT;
ALTER TABLE mobile_devices ADD COLUMN last_sync_attempt_at TEXT;
ALTER TABLE mobile_devices ADD COLUMN last_sync_success_at TEXT;
ALTER TABLE mobile_devices ADD COLUMN last_sync_status TEXT;
ALTER TABLE mobile_devices ADD COLUMN last_sync_error TEXT;
ALTER TABLE mobile_devices ADD COLUMN background_permission INTEGER;
ALTER TABLE mobile_devices ADD COLUMN last_sync_trigger TEXT;
