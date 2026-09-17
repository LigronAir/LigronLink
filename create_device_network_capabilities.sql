-- ### FIX — IPv6 / DUAL STACK
CREATE TABLE IF NOT EXISTS device_network_capabilities (
    device_uuid TEXT PRIMARY KEY,
    capabilities_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
