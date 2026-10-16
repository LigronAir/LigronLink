// Identidad persistente de un equipo. Los secretos nunca se guardan en D1:
// sólo se persisten hashes. Hay dos credenciales distintas:
//
// * Device: permite operar la Pi y pedir una auth-key de LigronTail.
// * Recovery: permanece en la Pi cuando Device se revoca. Por sí sola no
//   autoriza nada; sólo puede recoger una nueva Device después de que el
//   propietario la apruebe explícitamente desde Link.
//
// Separarlas impide el agujero anterior, donde conocer email + UUID volvía a
// activar una Pi que el propietario acababa de revocar.

function tokenBase64Url(bytes = 32) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

export async function credentialHash(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function credentialToken(request, scheme) {
    const value = String(request.headers.get("Authorization") || "");
    const match = new RegExp(`^${scheme}\\s+([A-Za-z0-9_-]{32,})$`, "i").exec(value);
    return match ? match[1] : "";
}

function deviceToken(request) {
    return credentialToken(request, "Device");
}

function recoveryToken(request) {
    return credentialToken(request, "Recovery");
}

export async function issueDeviceCredential(db, deviceUuid) {
    const token = tokenBase64Url();
    await db.prepare(`
        INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
        VALUES (?1, ?2, datetime('now'), NULL, NULL)
        ON CONFLICT(device_uuid) DO UPDATE SET
            token_hash=excluded.token_hash,
            created_at=datetime('now'),
            last_used_at=NULL,
            revoked_at=NULL
    `).bind(deviceUuid, await credentialHash(token)).run();
    return token;
}

export async function issueDeviceRecoveryCredential(db, deviceUuid) {
    const token = tokenBase64Url();
    await db.prepare(`
        INSERT INTO device_recovery_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
        VALUES (?1, ?2, datetime('now'), NULL, NULL)
        ON CONFLICT(device_uuid) DO UPDATE SET
            token_hash=excluded.token_hash,
            created_at=datetime('now'),
            last_used_at=NULL,
            revoked_at=NULL
    `).bind(deviceUuid, await credentialHash(token)).run();
    return token;
}

export async function issueDeviceIdentity(db, deviceUuid) {
    const deviceCredential = tokenBase64Url();
    const recoveryCredential = tokenBase64Url();
    await db.batch([
        db.prepare(`
            INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
            VALUES (?1, ?2, datetime('now'), NULL, NULL)
            ON CONFLICT(device_uuid) DO UPDATE SET
                token_hash=excluded.token_hash,
                created_at=datetime('now'),
                last_used_at=NULL,
                revoked_at=NULL
        `).bind(deviceUuid, await credentialHash(deviceCredential)),
        db.prepare(`
            INSERT INTO device_recovery_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
            VALUES (?1, ?2, datetime('now'), NULL, NULL)
            ON CONFLICT(device_uuid) DO UPDATE SET
                token_hash=excluded.token_hash,
                created_at=datetime('now'),
                last_used_at=NULL,
                revoked_at=NULL
        `).bind(deviceUuid, await credentialHash(recoveryCredential)),
        // Una sesión de operador que vuelve a vincular la Pi sustituye
        // cualquier autorización pendiente anterior de forma atómica.
        db.prepare(`DELETE FROM device_recovery_authorizations WHERE device_uuid=?1`)
            .bind(deviceUuid)
    ]);
    return { deviceCredential, recoveryCredential };
}

export async function revokeDeviceCredential(db, deviceUuid) {
    const results = await db.batch([
        db.prepare(`
            UPDATE device_credentials
            SET revoked_at=datetime('now')
            WHERE device_uuid=?1 AND revoked_at IS NULL
        `).bind(deviceUuid),
        // La identidad de recuperación queda intacta para que el propietario
        // pueda reautorizar la misma Pi sin copiar secretos. Lo que no queda
        // es una aprobación pendiente que un tercero pueda consumir.
        db.prepare(`DELETE FROM device_recovery_authorizations WHERE device_uuid=?1`)
            .bind(deviceUuid)
    ]);
    return Number(results[0]?.meta?.changes || 0) > 0;
}

export async function requireDeviceCredential(request, db, deviceUuid, { touch = false } = {}) {
    const token = deviceToken(request);
    if (!token || !deviceUuid) return null;
    const credential = await db.prepare(`
        SELECT device_uuid
        FROM device_credentials
        WHERE device_uuid=?1 AND token_hash=?2 AND revoked_at IS NULL
        LIMIT 1
    `).bind(deviceUuid, await credentialHash(token)).first();
    if (!credential) return null;
    // Nunca escribimos por heartbeats/polling. El llamador sólo pide touch
    // en bootstrap o enrolamiento, y aun entonces queda limitado a una vez
    // cada seis horas para que D1 no sea el reloj de la aplicación.
    if (touch) {
        await db.prepare(`
            UPDATE device_credentials
            SET last_used_at=datetime('now')
            WHERE device_uuid=?1
              AND (last_used_at IS NULL OR datetime(last_used_at) < datetime('now', '-6 hours'))
        `).bind(deviceUuid).run();
    }
    return credential;
}

export async function requireDeviceRecoveryCredential(request, db, deviceUuid, { touch = false } = {}) {
    const token = recoveryToken(request);
    if (!token || !deviceUuid) return null;
    const credential = await db.prepare(`
        SELECT device_uuid
        FROM device_recovery_credentials
        WHERE device_uuid=?1 AND token_hash=?2 AND revoked_at IS NULL
        LIMIT 1
    `).bind(deviceUuid, await credentialHash(token)).first();
    if (!credential) return null;
    if (touch) {
        await db.prepare(`
            UPDATE device_recovery_credentials
            SET last_used_at=datetime('now')
            WHERE device_uuid=?1
              AND (last_used_at IS NULL OR datetime(last_used_at) < datetime('now', '-6 hours'))
        `).bind(deviceUuid).run();
    }
    return credential;
}

export async function deviceCredentialStates(db, usuarioId) {
    const result = await db.prepare(`
        SELECT e.uuid AS device_uuid,
               CASE
                   WHEN d.device_uuid IS NULL THEN 'MIGRATION_REQUIRED'
                   WHEN d.revoked_at IS NOT NULL THEN 'REVOKED'
                   ELSE 'ACTIVE'
               END AS device_credential_state,
               CASE
                   WHEN r.device_uuid IS NULL THEN 'MISSING'
                   WHEN r.revoked_at IS NOT NULL THEN 'REVOKED'
                   ELSE 'READY'
               END AS recovery_credential_state,
               CASE
                   WHEN a.device_uuid IS NOT NULL AND datetime(a.expires_at) > datetime('now')
                        AND a.consumed_at IS NULL
                       THEN 'PENDING'
                   ELSE 'NONE'
               END AS recovery_authorization_state
        FROM equipos e
        LEFT JOIN device_credentials d ON d.device_uuid=e.uuid
        LEFT JOIN device_recovery_credentials r ON r.device_uuid=e.uuid
        LEFT JOIN device_recovery_authorizations a ON a.device_uuid=e.uuid
        WHERE e.usuario_id=?1
    `).bind(usuarioId).all();
    return result.results || [];
}
