-- LigronLink
-- Añade una fotografía compacta de telemetría Pi/Native al estado runtime.
-- Ejecutar una vez por base D1 ya creada, antes de desplegar este Worker.

ALTER TABLE device_runtime_status ADD COLUMN telemetry_json TEXT;
