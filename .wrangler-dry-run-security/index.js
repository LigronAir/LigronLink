var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/security/uuid.js
function generateUserUUID() {
  return crypto.randomUUID();
}
__name(generateUserUUID, "generateUserUUID");

// src/security/hash.js
var PBKDF2_PREFIX = "pbkdf2_sha256";
var PBKDF2_ITERATIONS = 1e5;
var SALT_BYTES = 16;
var HASH_BITS = 256;
var LEGACY_SHA256 = /^[a-f0-9]{64}$/i;
function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
__name(toBase64, "toBase64");
function fromBase64(value) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
__name(fromBase64, "fromBase64");
function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
__name(equalBytes, "equalBytes");
async function pbkdf2(password, salt, iterations) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    passwordKey,
    HASH_BITS
  );
  return new Uint8Array(bits);
}
__name(pbkdf2, "pbkdf2");
async function legacySha256(password) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(legacySha256, "legacySha256");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(digest)}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, storedHash) {
  const stored = String(storedHash || "");
  if (LEGACY_SHA256.test(stored)) {
    const candidate3 = await legacySha256(password);
    const valid = equalBytes(
      new TextEncoder().encode(candidate3),
      new TextEncoder().encode(stored.toLowerCase())
    );
    return {
      valid,
      needsRehash: valid
    };
  }
  const [prefix, iterationsText, saltText, digestText] = stored.split("$");
  const iterations = Number(iterationsText);
  const salt = fromBase64(saltText || "");
  const expected = fromBase64(digestText || "");
  if (prefix !== PBKDF2_PREFIX || !Number.isInteger(iterations) || iterations < 1e5 || iterations > PBKDF2_ITERATIONS || !salt || salt.length < SALT_BYTES || !expected || expected.length !== HASH_BITS / 8) {
    return { valid: false, needsRehash: false };
  }
  const candidate2 = await pbkdf2(password, salt, iterations);
  return {
    valid: equalBytes(candidate2, expected),
    needsRehash: iterations < PBKDF2_ITERATIONS
  };
}
__name(verifyPassword, "verifyPassword");

// src/database/users.js
async function createUser(db, user2) {
  const existente = await db.prepare(
    "SELECT id FROM usuarios WHERE email = ?1"
  ).bind(user2.email).first();
  if (existente) {
    throw new Error(
      "Ya existe una cuenta asociada a ese correo electr\xF3nico."
    );
  }
  await db.prepare(
    `
        INSERT INTO usuarios
        (
            uuid,
            nombre,
            email,
            password_hash,
            fecha_creacion,
            estado
        )
        VALUES
        (
            ?1,
            ?2,
            ?3,
            ?4,
            datetime('now'),
            'ACTIVO'
        )
        `
  ).bind(
    user2.uuid,
    user2.nombre,
    user2.email,
    user2.passwordHash
  ).run();
}
__name(createUser, "createUser");
async function findUserByEmail(db, email) {
  return await db.prepare(
    `
            SELECT
                id,
                uuid,
                nombre,
                email,
                password_hash,
                estado
            FROM usuarios
            WHERE email = ?1
            `
  ).bind(email.toLowerCase()).first();
}
__name(findUserByEmail, "findUserByEmail");
async function updateUserPasswordHash(db, userId, passwordHash) {
  await db.prepare(
    `UPDATE usuarios
         SET password_hash = ?2
         WHERE id = ?1`
  ).bind(userId, passwordHash).run();
}
__name(updateUserPasswordHash, "updateUserPasswordHash");

// src/api/register.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function register(request, env) {
  try {
    const body = await request.json();
    const nombre = body.nombre?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!nombre || !email || !password) {
      return Response.json(
        {
          success: false,
          error: "Faltan datos obligatorios."
        },
        {
          status: 400,
          headers: corsHeaders
        }
      );
    }
    const uuid = generateUserUUID();
    const passwordHash = await hashPassword(password);
    await createUser(env.DB, {
      uuid,
      nombre,
      email,
      passwordHash
    });
    console.info("LigronLink: cuenta creada.");
    return Response.json(
      {
        success: true,
        uuid,
        message: "Cuenta creada correctamente."
      },
      {
        headers: corsHeaders
      }
    );
  } catch (error) {
    console.error("ERROR EN REGISTER");
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders
      }
    );
  }
}
__name(register, "register");

// src/security/sessions.js
var SESSION_TTL_SECONDS = 12 * 60 * 60;
function tokenBase64Url(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(tokenBase64Url, "tokenBase64Url");
async function tokenHash(token2) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token2));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(tokenHash, "tokenHash");
function bearerToken(request) {
  const value = String(request.headers.get("Authorization") || "");
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/i.exec(value);
  return match ? match[1] : "";
}
__name(bearerToken, "bearerToken");
async function createUserSession(db, userId) {
  const token2 = tokenBase64Url();
  const id = `usr_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.prepare(`
        INSERT INTO auth_sessions (id, usuario_id, token_hash, expires_at)
        VALUES (?1, ?2, ?3, datetime('now', '+12 hours'))
    `).bind(id, userId, await tokenHash(token2)).run();
  return { token: token2, expiresIn: SESSION_TTL_SECONDS };
}
__name(createUserSession, "createUserSession");
async function requireUserSession(request, db) {
  const token2 = bearerToken(request);
  if (!token2) return null;
  return db.prepare(`
        SELECT session.id AS session_id, user.id, user.uuid, user.nombre, user.email, user.estado
        FROM auth_sessions AS session
        JOIN usuarios AS user ON user.id = session.usuario_id
        WHERE session.token_hash = ?1
          AND session.revoked_at IS NULL
          AND datetime(session.expires_at) > datetime('now')
          AND UPPER(COALESCE(user.estado, 'ACTIVO')) = 'ACTIVO'
        LIMIT 1
    `).bind(await tokenHash(token2)).first();
}
__name(requireUserSession, "requireUserSession");
async function revokeUserSession(request, db) {
  const token2 = bearerToken(request);
  if (!token2) return false;
  const result = await db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = datetime('now')
        WHERE token_hash = ?1 AND revoked_at IS NULL
    `).bind(await tokenHash(token2)).run();
  return Number(result.meta?.changes || 0) > 0;
}
__name(revokeUserSession, "revokeUserSession");

// src/api/login.js
var corsHeaders2 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function login(request, env) {
  try {
    const body = await request.json();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar el correo y la contrase\xF1a."
        },
        {
          status: 400,
          headers: corsHeaders2
        }
      );
    }
    const user2 = await findUserByEmail(env.DB, email);
    if (!user2) {
      return Response.json(
        {
          success: false,
          error: "Correo o contrase\xF1a incorrectos."
        },
        {
          status: 401,
          headers: corsHeaders2
        }
      );
    }
    const verification = await verifyPassword(password, user2.password_hash);
    if (!verification.valid) {
      return Response.json(
        {
          success: false,
          error: "Correo o contrase\xF1a incorrectos."
        },
        {
          status: 401,
          headers: corsHeaders2
        }
      );
    }
    if (verification.needsRehash) {
      await updateUserPasswordHash(env.DB, user2.id, await hashPassword(password));
    }
    const session = await createUserSession(env.DB, user2.id);
    return Response.json(
      {
        success: true,
        user: {
          uuid: user2.uuid,
          nombre: user2.nombre,
          email: user2.email
        },
        access_token: session.token,
        expires_in: session.expiresIn
      },
      {
        headers: corsHeaders2
      }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders2
      }
    );
  }
}
__name(login, "login");

// src/api/logout.js
var corsHeaders3 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
async function logout(request, env) {
  if (request.method !== "POST") {
    return Response.json({ success: false, error: "M\xE9todo no permitido." }, { status: 405, headers: corsHeaders3 });
  }
  try {
    await revokeUserSession(request, env.DB);
    return Response.json({ success: true }, { headers: corsHeaders3 });
  } catch {
    return Response.json({ success: false, error: "No se pudo cerrar la sesi\xF3n." }, { status: 500, headers: corsHeaders3 });
  }
}
__name(logout, "logout");

// src/database/devices.js
async function createDevice(db, device) {
  const existente = await db.prepare(
    `
            SELECT id
            FROM equipos
            WHERE uuid = ?1
            `
  ).bind(device.uuid).first();
  if (existente) {
    throw new Error(
      "Ya existe un equipo registrado con ese UUID."
    );
  }
  await db.prepare(
    `
            INSERT INTO equipos
            (
                uuid,
                usuario_id,
                tipo,
                alias,
                public_ip,
                ultima_conexion,
                fecha_creacion,
                estado
            )
            VALUES
            (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                datetime('now'),
                ?7
            )
            `
  ).bind(
    device.uuid,
    device.usuarioId,
    device.tipo,
    device.alias,
    device.publicIp || null,
    device.ultimaConexion || null,
    device.estado || "OFFLINE"
  ).run();
}
__name(createDevice, "createDevice");
async function registerOrUpdateDevice(db, device) {
  const existente = await db.prepare(
    `
            SELECT
                id
            FROM equipos
            WHERE uuid = ?1
            `
  ).bind(device.uuid).first();
  const ahora = (/* @__PURE__ */ new Date()).toISOString();
  if (!existente) {
    await createDevice(db, {
      ...device,
      estado: device.estado || "ONLINE",
      ultimaConexion: device.ultimaConexion || ahora
    });
    return {
      created: true,
      updated: false
    };
  }
  const propietario = await db.prepare(
    `SELECT usuario_id
             FROM equipos
             WHERE uuid = ?1`
  ).bind(device.uuid).first();
  if (Number(propietario?.usuario_id) !== Number(device.usuarioId)) {
    throw new Error(
      "No se permite reasignar un UUID existente a otra cuenta."
    );
  }
  await db.prepare(
    `
            UPDATE equipos
            SET
                tipo = ?2,
                alias = ?3,
                public_ip = COALESCE(?4, public_ip),
                ultima_conexion = COALESCE(?5, ultima_conexion),
                estado = ?6
            WHERE uuid = ?1
            `
  ).bind(
    device.uuid,
    device.tipo,
    device.alias,
    device.publicIp || null,
    // ==================================================
    // ### FIX
    // Si Native no envía la fecha, utilizamos el
    // momento actual del registro.
    // ==================================================
    device.ultimaConexion || ahora,
    device.estado || "ONLINE"
  ).run();
  return {
    created: false,
    updated: true
  };
}
__name(registerOrUpdateDevice, "registerOrUpdateDevice");
async function setDeviceStatus(db, uuid, estado) {
  await db.prepare(
    `
            UPDATE equipos
            SET
                estado = ?2
            WHERE uuid = ?1
            `
  ).bind(
    uuid,
    estado
  ).run();
}
__name(setDeviceStatus, "setDeviceStatus");
async function touchDevicePresence(db, uuid, usuarioId) {
  await db.prepare(
    `
            UPDATE equipos
            SET
                ultima_conexion = datetime('now'),
                estado = 'ONLINE'
            WHERE uuid = ?1
              AND usuario_id = ?2
              AND (
                  UPPER(COALESCE(estado, 'OFFLINE')) != 'ONLINE'
                  OR ultima_conexion IS NULL
                  OR datetime(ultima_conexion) < datetime('now', '-30 seconds')
              )
            `
  ).bind(uuid, usuarioId).run();
}
__name(touchDevicePresence, "touchDevicePresence");
async function updateDeviceRuntimeStatus(db, device, runtime, includeTelemetry = true) {
  const telemetryValue = includeTelemetry ? JSON.stringify(runtime.telemetry && typeof runtime.telemetry === "object" ? runtime.telemetry : {}) : null;
  await db.prepare(
    `
            INSERT INTO device_runtime_status
            (
                device_uuid,
                usuario_id,
                runtime_state,
                source_label,
                target_device_uuid,
                target_label,
                target_srt_url,
                streaming,
                pipeline_active,
                signal_available,
                audio_state,
                ${includeTelemetry ? "telemetry_json," : ""}
                ultima_actualizacion
            )
            VALUES
            (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ${includeTelemetry ? "?12," : ""}
                datetime('now')
            )
            ON CONFLICT(device_uuid)
            DO UPDATE SET
                usuario_id = excluded.usuario_id,
                runtime_state = excluded.runtime_state,
                source_label = excluded.source_label,
                target_device_uuid = excluded.target_device_uuid,
                target_label = excluded.target_label,
                target_srt_url = excluded.target_srt_url,
                streaming = excluded.streaming,
                pipeline_active = excluded.pipeline_active,
                signal_available = excluded.signal_available,
                audio_state = excluded.audio_state,
                ${includeTelemetry ? "telemetry_json = excluded.telemetry_json," : ""}
                ultima_actualizacion = datetime('now')
            WHERE
                device_runtime_status.runtime_state IS NOT excluded.runtime_state
                OR device_runtime_status.source_label IS NOT excluded.source_label
                OR device_runtime_status.target_device_uuid IS NOT excluded.target_device_uuid
                OR device_runtime_status.target_label IS NOT excluded.target_label
                OR device_runtime_status.target_srt_url IS NOT excluded.target_srt_url
                OR device_runtime_status.streaming IS NOT excluded.streaming
                OR device_runtime_status.pipeline_active IS NOT excluded.pipeline_active
                OR device_runtime_status.signal_available IS NOT excluded.signal_available
                OR device_runtime_status.audio_state IS NOT excluded.audio_state
                OR datetime(device_runtime_status.ultima_actualizacion) < datetime('now', '-30 seconds')
            `
  ).bind(
    device.uuid,
    device.usuario_id,
    runtime.runtime_state,
    runtime.source_label || null,
    runtime.target_device_uuid || null,
    runtime.target_label || null,
    runtime.target_srt_url || null,
    runtime.streaming ? 1 : 0,
    runtime.pipeline_active ? 1 : 0,
    runtime.signal_available ? 1 : 0,
    runtime.audio_state || null,
    ...includeTelemetry ? [telemetryValue] : []
  ).run();
}
__name(updateDeviceRuntimeStatus, "updateDeviceRuntimeStatus");
async function findRuntimeStatusByUser(db, usuarioId) {
  const query = /* @__PURE__ */ __name((withTelemetry) => `
            SELECT
                device_uuid,
                runtime_state,
                source_label,
                target_device_uuid,
                target_label,
                target_srt_url,
                streaming,
                pipeline_active,
                signal_available,
                audio_state,
                ${withTelemetry ? "telemetry_json," : ""}
                ultima_actualizacion
            FROM device_runtime_status
            WHERE usuario_id = ?1
            `, "query");
  try {
    const resultado = await db.prepare(query(true)).bind(usuarioId).all();
    return resultado.results;
  } catch (error) {
    if (!String(error?.message || error).toLowerCase().includes("telemetry_json")) throw error;
    const resultado = await db.prepare(query(false)).bind(usuarioId).all();
    return resultado.results;
  }
}
__name(findRuntimeStatusByUser, "findRuntimeStatusByUser");
async function findDeviceByUuid(db, uuid) {
  return await db.prepare(
    `
            SELECT
                id,
                uuid,
                usuario_id,
                tipo,
                alias,
                public_ip,
                ultima_conexion,
                estado,
                fecha_creacion
            FROM equipos
            WHERE uuid = ?1
            `
  ).bind(uuid).first();
}
__name(findDeviceByUuid, "findDeviceByUuid");
async function findDevicesByUser(db, usuarioId) {
  const resultado = await db.prepare(
    `
            SELECT
                id,
                uuid,
                tipo,
                alias,
                public_ip,
                ultima_conexion,
                CASE
                    -- La presencia expira si no se recibe heartbeat.
                    -- No se borra el equipo ni sus reservas: s\xF3lo deja
                    -- de mostrarse y de poder usarse como conectado.
                    WHEN UPPER(estado) = 'ONLINE'
                     AND datetime(ultima_conexion) >= datetime('now', '-75 seconds')
                        THEN 'ONLINE'
                    ELSE 'OFFLINE'
                END AS estado,
                fecha_creacion
            FROM equipos
            WHERE usuario_id = ?1
            ORDER BY alias ASC
            `
  ).bind(usuarioId).all();
  return resultado.results;
}
__name(findDevicesByUser, "findDevicesByUser");
async function deleteDevice(db, deviceId, usuarioId) {
  const device = await db.prepare(
    `
            SELECT uuid FROM equipos
            WHERE id = ?1
              AND usuario_id = ?2
            `
  ).bind(deviceId, usuarioId).first();
  if (!device?.uuid) {
    throw new Error(
      "No se pudo eliminar el equipo."
    );
  }
  try {
    await db.prepare(
      `DELETE FROM device_runtime_status
             WHERE device_uuid = ?1 OR target_device_uuid = ?1`
    ).bind(device.uuid).run();
  } catch (error) {
    if (!String(error?.message || error).includes("no such table")) {
      throw error;
    }
  }
  const resultados = await db.batch([
    db.prepare(
      `UPDATE srt_destinos
             SET reservado_por_uuid = NULL,
                 estado = CASE WHEN estado = 'RESERVED' THEN 'FREE' ELSE estado END
             WHERE reservado_por_uuid = ?1`
    ).bind(device.uuid),
    db.prepare(
      `DELETE FROM srt_destinos
             WHERE equipo_uuid = ?1 AND usuario_id = ?2`
    ).bind(device.uuid, usuarioId),
    db.prepare(
      `DELETE FROM equipos
             WHERE id = ?1 AND usuario_id = ?2`
    ).bind(deviceId, usuarioId)
  ]);
  const resultado = resultados.at(-1);
  if (!resultado?.meta || resultado.meta.changes === 0) {
    throw new Error("No se pudo eliminar el equipo.");
  }
  return true;
}
__name(deleteDevice, "deleteDevice");

// src/security/deviceCredentials.js
function tokenBase64Url2(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(tokenBase64Url2, "tokenBase64Url");
async function credentialHash(token2) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token2));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(credentialHash, "credentialHash");
function credentialToken(request, scheme) {
  const value = String(request.headers.get("Authorization") || "");
  const match = new RegExp(`^${scheme}\\s+([A-Za-z0-9_-]{32,})$`, "i").exec(value);
  return match ? match[1] : "";
}
__name(credentialToken, "credentialToken");
function deviceToken(request) {
  return credentialToken(request, "Device");
}
__name(deviceToken, "deviceToken");
function recoveryToken(request) {
  return credentialToken(request, "Recovery");
}
__name(recoveryToken, "recoveryToken");
async function issueDeviceCredential(db, deviceUuid) {
  const token2 = tokenBase64Url2();
  await db.prepare(`
        INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
        VALUES (?1, ?2, datetime('now'), NULL, NULL)
        ON CONFLICT(device_uuid) DO UPDATE SET
            token_hash=excluded.token_hash,
            created_at=datetime('now'),
            last_used_at=NULL,
            revoked_at=NULL
    `).bind(deviceUuid, await credentialHash(token2)).run();
  return token2;
}
__name(issueDeviceCredential, "issueDeviceCredential");
async function issueDeviceRecoveryCredential(db, deviceUuid) {
  const token2 = tokenBase64Url2();
  await db.prepare(`
        INSERT INTO device_recovery_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
        VALUES (?1, ?2, datetime('now'), NULL, NULL)
        ON CONFLICT(device_uuid) DO UPDATE SET
            token_hash=excluded.token_hash,
            created_at=datetime('now'),
            last_used_at=NULL,
            revoked_at=NULL
    `).bind(deviceUuid, await credentialHash(token2)).run();
  return token2;
}
__name(issueDeviceRecoveryCredential, "issueDeviceRecoveryCredential");
async function issueDeviceIdentity(db, deviceUuid) {
  const deviceCredential2 = tokenBase64Url2();
  const recoveryCredential = tokenBase64Url2();
  await db.batch([
    db.prepare(`
            INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
            VALUES (?1, ?2, datetime('now'), NULL, NULL)
            ON CONFLICT(device_uuid) DO UPDATE SET
                token_hash=excluded.token_hash,
                created_at=datetime('now'),
                last_used_at=NULL,
                revoked_at=NULL
        `).bind(deviceUuid, await credentialHash(deviceCredential2)),
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
    db.prepare(`DELETE FROM device_recovery_authorizations WHERE device_uuid=?1`).bind(deviceUuid)
  ]);
  return { deviceCredential: deviceCredential2, recoveryCredential };
}
__name(issueDeviceIdentity, "issueDeviceIdentity");
async function revokeDeviceCredential(db, deviceUuid) {
  const results = await db.batch([
    db.prepare(`
            UPDATE device_credentials
            SET revoked_at=datetime('now')
            WHERE device_uuid=?1 AND revoked_at IS NULL
        `).bind(deviceUuid),
    // La identidad de recuperación queda intacta para que el propietario
    // pueda reautorizar la misma Pi sin copiar secretos. Lo que no queda
    // es una aprobación pendiente que un tercero pueda consumir.
    db.prepare(`DELETE FROM device_recovery_authorizations WHERE device_uuid=?1`).bind(deviceUuid)
  ]);
  return Number(results[0]?.meta?.changes || 0) > 0;
}
__name(revokeDeviceCredential, "revokeDeviceCredential");
async function requireDeviceCredential(request, db, deviceUuid, { touch = false } = {}) {
  const token2 = deviceToken(request);
  if (!token2 || !deviceUuid) return null;
  const credential = await db.prepare(`
        SELECT device_uuid
        FROM device_credentials
        WHERE device_uuid=?1 AND token_hash=?2 AND revoked_at IS NULL
        LIMIT 1
    `).bind(deviceUuid, await credentialHash(token2)).first();
  if (!credential) return null;
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
__name(requireDeviceCredential, "requireDeviceCredential");
async function requireDeviceRecoveryCredential(request, db, deviceUuid, { touch = false } = {}) {
  const token2 = recoveryToken(request);
  if (!token2 || !deviceUuid) return null;
  const credential = await db.prepare(`
        SELECT device_uuid
        FROM device_recovery_credentials
        WHERE device_uuid=?1 AND token_hash=?2 AND revoked_at IS NULL
        LIMIT 1
    `).bind(deviceUuid, await credentialHash(token2)).first();
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
__name(requireDeviceRecoveryCredential, "requireDeviceRecoveryCredential");

// src/api/deviceRegister.js
var corsHeaders4 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function isLigronPi(device) {
  return ["ligronpi", "ligronpi native", "ligronpi_native"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isLigronPi, "isLigronPi");
function isLigronNative(device) {
  return String(device?.tipo || "").trim().toLowerCase().includes("ligronair");
}
__name(isLigronNative, "isLigronNative");
async function deviceRegister(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders4
        }
      );
    }
    const body = await request.json();
    const tipo = body.tipo?.trim();
    const alias = body.alias?.trim();
    const uuid = body.uuid?.trim() || "";
    const email = body.email?.trim().toLowerCase() || "";
    const networkCapabilities2 = body.network_capabilities && typeof body.network_capabilities === "object" ? body.network_capabilities : null;
    const publicIp = request.headers.get("CF-Connecting-IP") || "";
    if (!tipo) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar el tipo de equipo."
        },
        {
          status: 400,
          headers: corsHeaders4
        }
      );
    }
    if (!alias) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar un alias."
        },
        {
          status: 400,
          headers: corsHeaders4
        }
      );
    }
    if (!uuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar un UUID."
        },
        {
          status: 400,
          headers: corsHeaders4
        }
      );
    }
    const authenticatedUser = await requireUserSession(request, env.DB);
    const existente = await findDeviceByUuid(env.DB, uuid);
    const nativeDeviceCredential = !authenticatedUser && existente && isLigronNative(existente) && isLigronNative({ tipo }) ? await requireDeviceCredential(request, env.DB, uuid, { touch: true }) : null;
    if (!authenticatedUser && !nativeDeviceCredential) {
      return Response.json(
        { success: false, error: "Debe iniciar sesi\xF3n o usar la identidad ya sellada del Native." },
        { status: 401, headers: corsHeaders4 }
      );
    }
    if (authenticatedUser && email && email !== String(authenticatedUser.email || "").trim().toLowerCase()) {
      return Response.json(
        { success: false, error: "La sesi\xF3n no coincide con la cuenta del equipo." },
        { status: 403, headers: corsHeaders4 }
      );
    }
    const usuarioId = authenticatedUser ? authenticatedUser.id : existente.usuario_id;
    if (existente && Number(existente.usuario_id) !== Number(usuarioId)) {
      return Response.json(
        {
          success: false,
          code: "DEVICE_ACCOUNT_MEMBERSHIP_REQUIRED",
          error: "Este equipo pertenece a otra cuenta. Debe vincularse mediante una autorizaci\xF3n aprobada."
        },
        {
          status: 409,
          headers: corsHeaders4
        }
      );
    }
    const esNative = true;
    const resultado = await registerOrUpdateDevice(
      env.DB,
      {
        usuarioId,
        tipo,
        alias,
        uuid,
        // ### FIX
        publicIp: esNative ? publicIp : null,
        // ### FIX
        ultimaConexion: esNative ? (/* @__PURE__ */ new Date()).toISOString() : null,
        // ### FIX
        estado: esNative ? "ONLINE" : "OFFLINE"
      }
    );
    if (networkCapabilities2) {
      try {
        await env.DB.prepare(`INSERT INTO device_network_capabilities (device_uuid, capabilities_json, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(device_uuid) DO UPDATE SET capabilities_json=excluded.capabilities_json, updated_at=datetime('now') WHERE capabilities_json != excluded.capabilities_json`).bind(uuid, JSON.stringify(networkCapabilities2)).run();
      } catch (capabilityError) {
        console.warn("IPv6 capabilities not persisted:", capabilityError.message);
      }
    }
    const identity2 = authenticatedUser && isLigronPi({ tipo }) ? await issueDeviceIdentity(env.DB, uuid) : null;
    const nativeCredential = authenticatedUser && isLigronNative({ tipo }) ? await issueDeviceCredential(env.DB, uuid) : "";
    return Response.json(
      {
        success: true,
        // ### FIX
        connected: esNative,
        // ### FIX
        publicIp: esNative ? publicIp : null,
        created: resultado.created,
        updated: resultado.updated,
        device_credential: identity2?.deviceCredential || nativeCredential || void 0,
        recovery_credential: identity2?.recoveryCredential || void 0
      },
      {
        headers: corsHeaders4
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders4
      }
    );
  }
}
__name(deviceRegister, "deviceRegister");

// src/api/routePlanner.js
function privateLan(address) {
  const parts = String(address || "").split(".").map(Number);
  const valid = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  return valid && (parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168) ? parts : null;
}
__name(privateLan, "privateLan");
function samePrivateLan(left, right) {
  const a = privateLan(left);
  const b = privateLan(right);
  return Boolean(a && b && a.slice(0, 3).join(".") === b.slice(0, 3).join("."));
}
__name(samePrivateLan, "samePrivateLan");
function tailscaleEndpoint(capabilities2) {
  const address = String(capabilities2?.tailscale_ipv4_address || "").trim();
  return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ? address : "";
}
__name(tailscaleEndpoint, "tailscaleEndpoint");
function candidate(id, label, state, reason) {
  return { id, label, state, reason, selectable: state === "READY" };
}
__name(candidate, "candidate");
function publicRoutePlan(plan) {
  return {
    selected_transport: plan.selected?.id || null,
    selected_label: plan.selected?.label || "Sin ruta disponible",
    selected_reason: plan.selected?.reason || "No hay una ruta comprobada.",
    candidates: plan.candidates
  };
}
__name(publicRoutePlan, "publicRoutePlan");
function buildRoutePlan({ pi, native, piNetwork = {}, nativeNetwork = {}, relay = null }) {
  const bothOnline = String(pi?.estado || "").toUpperCase() === "ONLINE" && String(native?.estado || "").toUpperCase() === "ONLINE";
  const piTailnet = String(piNetwork.tailscale_tailnet || "").trim().toLowerCase();
  const nativeTailnet = String(nativeNetwork.tailscale_tailnet || "").trim().toLowerCase();
  const nativeTailAddress = tailscaleEndpoint(nativeNetwork);
  const tailReady = bothOnline && piNetwork.tailscale_available === true && nativeNetwork.tailscale_available === true && Boolean(piTailnet) && piTailnet === nativeTailnet && Boolean(nativeTailAddress);
  const lanReady = bothOnline && samePrivateLan(piNetwork.ipv4_address, nativeNetwork.ipv4_address);
  const offlineReason = "Pi y Native deben estar ONLINE en LigronLink.";
  const candidates = [
    // Las rutas privadas no consumen relay ni dependen de su plano de
    // control. Si están comprobadas, son la vía normal de producción.
    candidate("TAILSCALE_DIRECT_CALLER", "LigronTail directo", tailReady ? "READY" : "UNAVAILABLE", tailReady ? `Reserva privada comprobada: ${piNetwork.tailscale_ipv4_address} \u2192 ${nativeTailAddress}.` : !bothOnline ? offlineReason : "Requiere Pi y Native activos en el mismo tailnet. Una VPN de terceros puede bloquear el UDP de la aplicaci\xF3n."),
    candidate("LAN_DIRECT_CALLER", "LAN directa", lanReady ? "READY" : "UNAVAILABLE", lanReady ? `Ambos equipos est\xE1n en la misma LAN: ${piNetwork.ipv4_address} \u2192 ${nativeNetwork.ipv4_address}.` : !bothOnline ? offlineReason : "Solo se utiliza si Pi y Native comparten la misma subred privada."),
    candidate("IPV6_DIRECT_CALLER", "IPv6 directa", "UNAVAILABLE", "Reservada para una IP IPv6 global y un listener dedicado. No se activa con fe80:: ni con IPv6 de Tailscale."),
    candidate("UPNP_DIRECT_CALLER", "UPnP / puerto p\xFAblico", "UNAVAILABLE", "No se selecciona autom\xE1ticamente: necesita una comprobaci\xF3n real de accesibilidad y no resuelve VPN de escritorio o CGNAT."),
    relay ? candidate("LIGRONRELAY_SRT", "LigronRelay", bothOnline ? "READY" : "UNAVAILABLE", bothOnline ? "Ruta de respaldo: ambos equipos salen al relay; no requiere abrir puertos ni una IP p\xFAblica." : offlineReason) : candidate("LIGRONRELAY_SRT", "LigronRelay", "UNAVAILABLE", "Infraestructura relay todav\xEDa no desplegada. No se seleccionar\xE1 hasta estar configurada.")
  ];
  return { candidates, selected: candidates.find((item) => item.selectable) || null };
}
__name(buildRoutePlan, "buildRoutePlan");
function buildSrtCallerUrl(host, port) {
  const normalizedHost = String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
  return `srt://${normalizedHost}:${port}?mode=caller`;
}
__name(buildSrtCallerUrl, "buildSrtCallerUrl");

// src/api/ligronRelay.js
var RELAY_HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
function randomToken(bytes = 24) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(randomToken, "randomToken");
function validRelayHost(value) {
  const host = String(value || "").trim().toLowerCase();
  return RELAY_HOST_PATTERN.test(host) ? host : "";
}
__name(validRelayHost, "validRelayHost");
function relayConfiguration(env) {
  const host = validRelayHost(env.LIGRONRELAY_SRT_HOST);
  const port = Number(env.LIGRONRELAY_SRT_PORT || 8890);
  const passphrase = String(env.LIGRONRELAY_SRT_PASSPHRASE || "");
  const enabled = String(env.LIGRONRELAY_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled || !host || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{10,79}$/.test(passphrase)) {
    return null;
  }
  return { host, port, passphrase };
}
__name(relayConfiguration, "relayConfiguration");
function relayUrl(config, action, session) {
  const streamId = `${action}:${session.stream_name}:${action === "publish" ? "publisher" : "reader"}:${action === "publish" ? session.publish_token : session.read_token}`;
  const query = new URLSearchParams({
    mode: "caller",
    streamid: streamId,
    passphrase: config.passphrase,
    pbkeylen: "32",
    latency: "500000",
    pkt_size: "1316"
  });
  return `srt://${config.host}:${config.port}?${query.toString()}`;
}
__name(relayUrl, "relayUrl");
async function createRelaySession(db, config, accountId, piUuid, nativeUuid, sourceId) {
  const session = {
    session_id: `relay_${crypto.randomUUID().replace(/-/g, "")}`,
    stream_name: `ligron_${crypto.randomUUID().replace(/-/g, "")}`,
    publish_token: randomToken(),
    read_token: randomToken()
  };
  await db.prepare(`
        INSERT INTO relay_sessions
            (session_id, usuario_id, pi_device_uuid, native_device_uuid,
             source_id, relay_host, relay_port, stream_name,
             publish_token, read_token, state, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ACTIVE', datetime('now', '+12 hours'))
    `).bind(
    session.session_id,
    accountId,
    piUuid,
    nativeUuid,
    sourceId,
    config.host,
    config.port,
    session.stream_name,
    session.publish_token,
    session.read_token
  ).run();
  return {
    ...session,
    relay_host: config.host,
    relay_port: config.port,
    publish_url: relayUrl(config, "publish", session),
    read_url: relayUrl(config, "read", session)
  };
}
__name(createRelaySession, "createRelaySession");
async function findRelaySessionsForNative(db, accountId, nativeUuid, relay) {
  if (!relay) return [];
  let result;
  try {
    result = await db.prepare(`
            SELECT session_id, source_id, relay_host, relay_port, stream_name,
                   read_token
            FROM relay_sessions AS session
            JOIN equipos AS pi
              ON pi.uuid=session.pi_device_uuid
             AND pi.usuario_id=session.usuario_id
            WHERE session.usuario_id=?1
              AND session.native_device_uuid=?2
              AND session.state='ACTIVE'
              AND datetime(session.expires_at)>datetime('now')
              AND UPPER(pi.estado)='ONLINE'
              AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
            ORDER BY session.created_at ASC
        `).bind(accountId, nativeUuid).all();
  } catch (error) {
    if (String(error?.message || error).includes("no such table")) return [];
    throw error;
  }
  return (result.results || []).map((row) => {
    const config = {
      host: row.relay_host,
      port: Number(row.relay_port),
      passphrase: relay.passphrase
    };
    return {
      session_id: row.session_id,
      source_id: Number(row.source_id),
      host: config.host,
      port: config.port,
      read_url: relayUrl(config, "read", row)
    };
  });
}
__name(findRelaySessionsForNative, "findRelaySessionsForNative");
async function ligronRelayAuth(request, env) {
  const relaySecret = String(env.LIGRONRELAY_AUTH_SECRET || "");
  const supplied = new URL(request.url).searchParams.get("relay_secret") || "";
  if (!relaySecret || supplied !== relaySecret) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    const protocol = String(body.protocol || "").toLowerCase();
    const path = String(body.path || "");
    const user2 = String(body.user || "");
    const password = String(body.password || "");
    if (protocol !== "srt" || !["publish", "read"].includes(action) || !path) {
      return new Response("Forbidden", { status: 403 });
    }
    const session = await env.DB.prepare(`
            SELECT publish_token, read_token
            FROM relay_sessions
            WHERE stream_name=?1 AND state='ACTIVE'
              AND datetime(expires_at)>datetime('now')
        `).bind(path).first();
    const allowed = action === "publish" && user2 === "publisher" && password === String(session?.publish_token || "") || action === "read" && user2 === "reader" && password === String(session?.read_token || "");
    return new Response(allowed ? "OK" : "Forbidden", { status: allowed ? 204 : 403 });
  } catch (error) {
    console.error("LigronRelay auth failed:", error?.message || error);
    return new Response("Forbidden", { status: 403 });
  }
}
__name(ligronRelayAuth, "ligronRelayAuth");

// src/database/srtDestinations.js
async function replaceSrtDestinations(db, device, receivers) {
  await db.prepare(
    `
            UPDATE srt_destinos
            SET
                -- Una reserva se conserva s\xF3lo mientras el Pi que la
                -- solicit\xF3 siga presente. As\xED una reserva leg\xEDtima soporta
                -- un nuevo snapshot de Native, pero una reserva abandonada
                -- vuelve a quedar disponible al siguiente heartbeat.
                estado = CASE
                    WHEN estado = 'RESERVED'
                     AND ?3 != 'OFFLINE'
                     AND EXISTS (
                        SELECT 1
                        FROM equipos AS pi
                        WHERE pi.uuid = srt_destinos.reservado_por_uuid
                          AND pi.usuario_id = srt_destinos.usuario_id
                          AND UPPER(pi.estado) = 'ONLINE'
                          AND datetime(pi.ultima_conexion) >= datetime('now', '-75 seconds')
                     ) THEN 'RESERVED'
                    ELSE 'OFFLINE'
                END,
                ultima_actualizacion = datetime('now')
            WHERE equipo_uuid = ?1
              AND usuario_id = ?2
            `
  ).bind(
    device.uuid,
    device.usuarioId,
    receivers.some((receiver) => receiver.estado !== "OFFLINE") ? "FREE" : "OFFLINE"
  ).run();
  const guardados = [];
  for (const receiver of receivers) {
    await db.prepare(
      `
                INSERT INTO srt_destinos
                (
                    equipo_uuid,
                    usuario_id,
                    source_id,
                    nombre,
                    host,
                    port,
                    mode,
                    estado,
                    reservado_por_uuid,
                    ultima_actualizacion,
                    fecha_creacion
                )
                VALUES
                (
                    ?1,
                    ?2,
                    ?3,
                    ?4,
                    ?5,
                    ?6,
                    ?7,
                    ?8,
                    NULL,
                    datetime('now'),
                    datetime('now')
                )
                ON CONFLICT(equipo_uuid, source_id)
                DO UPDATE SET
                    usuario_id = excluded.usuario_id,
                    nombre = excluded.nombre,
                    host = excluded.host,
                    port = excluded.port,
                    mode = excluded.mode,
                    -- La reserva pertenece a Link, no al proceso FFmpeg.
                    -- Sobrevive al cambio listener/caller y a sus reintentos
                    -- mientras la Pi contin\xFAe con presencia reciente.
                    estado = CASE
                        WHEN srt_destinos.estado = 'RESERVED'
                         AND excluded.estado != 'OFFLINE'
                         AND EXISTS (
                            SELECT 1
                            FROM equipos AS pi
                            WHERE pi.uuid = srt_destinos.reservado_por_uuid
                              AND pi.usuario_id = srt_destinos.usuario_id
                              AND UPPER(pi.estado) = 'ONLINE'
                              AND datetime(pi.ultima_conexion) >= datetime('now', '-75 seconds')
                         )
                            THEN 'RESERVED'
                        ELSE excluded.estado
                    END,
                    reservado_por_uuid = CASE
                        WHEN srt_destinos.estado = 'RESERVED'
                         AND excluded.estado != 'OFFLINE'
                         AND EXISTS (
                            SELECT 1
                            FROM equipos AS pi
                            WHERE pi.uuid = srt_destinos.reservado_por_uuid
                              AND pi.usuario_id = srt_destinos.usuario_id
                              AND UPPER(pi.estado) = 'ONLINE'
                              AND datetime(pi.ultima_conexion) >= datetime('now', '-75 seconds')
                         )
                            THEN srt_destinos.reservado_por_uuid
                        ELSE NULL
                    END,
                    ultima_actualizacion = datetime('now')
                `
    ).bind(
      device.uuid,
      device.usuarioId,
      receiver.sourceId,
      receiver.nombre,
      receiver.host,
      receiver.port,
      receiver.mode,
      receiver.estado
    ).run();
    guardados.push({
      source_id: receiver.sourceId,
      name: receiver.nombre,
      host: receiver.host,
      port: receiver.port,
      mode: receiver.mode,
      state: receiver.estado
    });
  }
  return guardados;
}
__name(replaceSrtDestinations, "replaceSrtDestinations");
async function hasSameSrtReceiverSnapshot(db, device, receivers) {
  const current = await db.prepare(`
        SELECT source_id, nombre, host, port, mode, estado
        FROM srt_destinos
        WHERE equipo_uuid = ?1 AND usuario_id = ?2
        ORDER BY source_id
    `).bind(device.uuid, device.usuarioId).all();
  const rows = current.results || [];
  if (rows.length !== receivers.length) return false;
  const bySourceId = new Map(rows.map((row) => [Number(row.source_id), row]));
  return receivers.every((receiver) => {
    const row = bySourceId.get(Number(receiver.sourceId));
    if (!row) return false;
    const persistedState = String(row.estado || "").toUpperCase();
    const requestedState = String(receiver.estado || "").toUpperCase();
    const compatibleState = persistedState === requestedState || persistedState === "RESERVED" && requestedState === "FREE";
    return String(row.nombre) === String(receiver.nombre) && String(row.host) === String(receiver.host) && Number(row.port) === Number(receiver.port) && String(row.mode) === String(receiver.mode) && compatibleState;
  });
}
__name(hasSameSrtReceiverSnapshot, "hasSameSrtReceiverSnapshot");
async function findSrtReceiverSummaryByUser(db, usuarioId) {
  const resultado = await db.prepare(
    `
            SELECT
                equipo_uuid,
                COUNT(*) AS total,
                SUM(CASE WHEN estado = 'FREE' THEN 1 ELSE 0 END) AS free,
                SUM(CASE WHEN estado = 'BUSY' THEN 1 ELSE 0 END) AS busy,
                SUM(CASE WHEN estado = 'RESERVED' THEN 1 ELSE 0 END) AS reserved,
                SUM(CASE WHEN estado = 'OFFLINE' THEN 1 ELSE 0 END) AS offline,
                MAX(ultima_actualizacion) AS last_update
            FROM srt_destinos
            WHERE usuario_id = ?1
            GROUP BY equipo_uuid
            `
  ).bind(usuarioId).all();
  return resultado.results;
}
__name(findSrtReceiverSummaryByUser, "findSrtReceiverSummaryByUser");
async function findSrtReceiversByUser(db, usuarioId) {
  const resultado = await db.prepare(
    `
            SELECT
                s.id,
                s.equipo_uuid,
                s.source_id,
                s.nombre,
                s.host,
                s.port,
                s.mode,
                s.estado,
                s.reservado_por_uuid,
                pi.alias AS reserved_by_alias,
                s.ultima_actualizacion
            FROM srt_destinos AS s
            LEFT JOIN equipos AS pi
                ON pi.uuid = s.reservado_por_uuid
               AND pi.usuario_id = s.usuario_id
            WHERE s.usuario_id = ?1
            ORDER BY
                s.equipo_uuid ASC,
                s.source_id ASC
            `
  ).bind(usuarioId).all();
  return resultado.results;
}
__name(findSrtReceiversByUser, "findSrtReceiversByUser");
async function findAvailableSrtDevices(db, usuarioId) {
  const resultado = await db.prepare(
    `
            SELECT
                s.equipo_uuid,
                e.alias AS device_alias,
                COUNT(*) AS available_receivers
            FROM srt_destinos AS s
            INNER JOIN equipos AS e
                ON e.uuid = s.equipo_uuid
            WHERE s.usuario_id = ?1
              AND s.estado = 'FREE'
              AND e.usuario_id = ?1
              AND UPPER(e.estado) = 'ONLINE'
              AND datetime(e.ultima_conexion) >= datetime('now', '-75 seconds')
              AND LOWER(TRIM(e.tipo)) IN (
                  'ligronair',
                  'ligronair native',
                  'ligronair_native'
              )
              AND s.port BETWEEN 1 AND 65535
            GROUP BY
                s.equipo_uuid,
                e.alias
            HAVING COUNT(*) > 0
            ORDER BY
                e.alias ASC
            `
  ).bind(usuarioId).all();
  return resultado.results;
}
__name(findAvailableSrtDevices, "findAvailableSrtDevices");
async function findAvailableSrtDestinations(db, usuarioId) {
  const resultado = await db.prepare(
    `
            SELECT
                s.id,
                s.equipo_uuid,
                e.alias AS device_alias,
                s.source_id,
                s.nombre,
                s.host,
                s.port,
                s.mode,
                s.estado,
                s.reservado_por_uuid,
                s.ultima_actualizacion
            FROM srt_destinos AS s
            INNER JOIN equipos AS e
                ON e.uuid = s.equipo_uuid
            WHERE s.usuario_id = ?1
              AND s.estado = 'FREE'
              AND e.usuario_id = ?1
              AND UPPER(e.estado) = 'ONLINE'
              AND datetime(e.ultima_conexion) >= datetime('now', '-75 seconds')
              AND LOWER(TRIM(e.tipo)) IN (
                  'ligronair',
                  'ligronair native',
                  'ligronair_native'
              )
              AND s.port BETWEEN 1 AND 65535
            ORDER BY
                e.alias ASC,
                s.source_id ASC
            `
  ).bind(usuarioId).all();
  return resultado.results;
}
__name(findAvailableSrtDestinations, "findAvailableSrtDestinations");
async function allocateSrtDestination(db, usuarioId, piUuid, deviceUuid, sourceId = null) {
  if (sourceId !== null) {
    const existing = await db.prepare(`
            SELECT
                s.id, s.equipo_uuid, s.source_id, s.nombre, s.host, s.port,
                s.mode, s.estado, s.reservado_por_uuid
            FROM srt_destinos AS s
            INNER JOIN equipos AS e ON e.uuid = s.equipo_uuid
            WHERE s.usuario_id = ?1
              AND s.equipo_uuid = ?3
              AND s.source_id = ?4
              AND s.estado = 'RESERVED'
              AND s.reservado_por_uuid = ?2
              AND e.usuario_id = ?1
              AND UPPER(e.estado) = 'ONLINE'
              AND datetime(e.ultima_conexion) >= datetime('now', '-75 seconds')
              AND s.port BETWEEN 1 AND 65535
            LIMIT 1
        `).bind(usuarioId, piUuid, deviceUuid, sourceId).first();
    if (existing) return existing;
  }
  const resultado = await db.prepare(
    `
            UPDATE srt_destinos
            SET
                estado = 'RESERVED',
                reservado_por_uuid = ?2,
                ultima_actualizacion = datetime('now')
            WHERE id = (
                SELECT
                    s.id
                FROM srt_destinos AS s
                INNER JOIN equipos AS e
                    ON e.uuid = s.equipo_uuid
                WHERE s.usuario_id = ?1
                  AND s.equipo_uuid = ?3
                  AND (?4 IS NULL OR s.source_id = ?4)
                  AND s.estado = 'FREE'
                  AND e.usuario_id = ?1
                  AND UPPER(e.estado) = 'ONLINE'
                  AND datetime(e.ultima_conexion) >= datetime('now', '-75 seconds')
                  AND LOWER(TRIM(e.tipo)) IN (
                      'ligronair',
                      'ligronair native',
                      'ligronair_native'
                  )
                  AND s.port BETWEEN 1 AND 65535
                ORDER BY
                    s.source_id ASC
                LIMIT 1
            )
            AND estado = 'FREE'
            RETURNING
                id,
                equipo_uuid,
                source_id,
                nombre,
                host,
                port,
                mode,
                estado,
                reservado_por_uuid
            `
  ).bind(
    usuarioId,
    piUuid,
    deviceUuid,
    sourceId
  ).first();
  return resultado;
}
__name(allocateSrtDestination, "allocateSrtDestination");
async function releaseSrtDestination(db, usuarioId, piUuid, deviceUuid) {
  const resultado = await db.prepare(
    `
            UPDATE srt_destinos
            SET
                estado = 'FREE',
                reservado_por_uuid = NULL,
                ultima_actualizacion = datetime('now')
            WHERE usuario_id = ?1
              AND reservado_por_uuid = ?2
              AND equipo_uuid = ?3
              AND estado = 'RESERVED'
            `
  ).bind(
    usuarioId,
    piUuid,
    deviceUuid
  ).run();
  return resultado.meta?.changes || 0;
}
__name(releaseSrtDestination, "releaseSrtDestination");

// src/api/devicesGet.js
var corsHeaders5 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function isMissingRuntimeStatusTable(error) {
  return String(error?.message || error).toLowerCase().includes("no such table: device_runtime_status");
}
__name(isMissingRuntimeStatusTable, "isMissingRuntimeStatusTable");
function isMissingNetworkCapabilitiesTable(error) {
  return String(error?.message || error).toLowerCase().includes("no such table: device_network_capabilities");
}
__name(isMissingNetworkCapabilitiesTable, "isMissingNetworkCapabilitiesTable");
var PRESENCE_WINDOW_MS = 75 * 1e3;
function parseD1Timestamp(value) {
  if (!value) return Number.NaN;
  const text = String(value).trim();
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : normalized + "Z");
}
__name(parseD1Timestamp, "parseD1Timestamp");
function isDevicePresent(device, now = Date.now()) {
  if (String(device?.estado || "").toUpperCase() !== "ONLINE") {
    return false;
  }
  const lastSeen = parseD1Timestamp(device?.ultima_conexion);
  return Number.isFinite(lastSeen) && now - lastSeen >= 0 && now - lastSeen <= PRESENCE_WINDOW_MS;
}
__name(isDevicePresent, "isDevicePresent");
function summarizeReceivers(receivers, fallback) {
  if (!Array.isArray(receivers) || receivers.length === 0) {
    return fallback;
  }
  const totals = {
    total: receivers.length,
    free: 0,
    busy: 0,
    reserved: 0,
    offline: 0,
    last_update: fallback?.last_update || null
  };
  for (const receiver of receivers) {
    const state = String(receiver.state || "OFFLINE").toUpperCase();
    if (state === "FREE") totals.free += 1;
    else if (state === "BUSY") totals.busy += 1;
    else if (state === "RESERVED") totals.reserved += 1;
    else totals.offline += 1;
  }
  return totals;
}
__name(summarizeReceivers, "summarizeReceivers");
async function devicesGet(request, env) {
  try {
    const usuario = await requireUserSession(request, env.DB);
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Sesi\xF3n no v\xE1lida o caducada. Inicie sesi\xF3n de nuevo."
        },
        {
          status: 401,
          headers: corsHeaders5
        }
      );
    }
    const devicesRaw = await findDevicesByUser(
      env.DB,
      usuario.id
    );
    const srtRows = await findSrtReceiverSummaryByUser(
      env.DB,
      usuario.id
    );
    const receiverRows = await findSrtReceiversByUser(
      env.DB,
      usuario.id
    );
    const receiversByDevice = /* @__PURE__ */ new Map();
    for (const receiver of receiverRows) {
      const key = receiver.equipo_uuid;
      if (!receiversByDevice.has(key)) {
        receiversByDevice.set(key, []);
      }
      receiversByDevice.get(key).push({
        id: receiver.id,
        source_id: receiver.source_id,
        name: receiver.nombre,
        host: receiver.host,
        port: receiver.port,
        mode: receiver.mode,
        state: receiver.estado,
        reserved_by: receiver.reservado_por_uuid,
        reserved_by_alias: receiver.reserved_by_alias || "",
        last_update: receiver.ultima_actualizacion
      });
    }
    let runtimeRows = [];
    try {
      runtimeRows = await findRuntimeStatusByUser(
        env.DB,
        usuario.id
      );
    } catch (error) {
      if (!isMissingRuntimeStatusTable(error)) {
        throw error;
      }
      console.warn(
        "device_runtime_status a\xFAn no existe; se omite runtime_status."
      );
    }
    const runtimeByDevice = new Map(
      runtimeRows.map((row) => [
        row.device_uuid,
        {
          runtime_state: row.runtime_state,
          source_label: row.source_label,
          target_device_uuid: row.target_device_uuid,
          target_label: row.target_label,
          target_srt_url: row.target_srt_url,
          streaming: Boolean(row.streaming),
          pipeline_active: Boolean(row.pipeline_active),
          signal_available: Boolean(row.signal_available),
          audio_state: row.audio_state,
          telemetry: (() => {
            try {
              return JSON.parse(row.telemetry_json || "{}");
            } catch {
              return {};
            }
          })(),
          last_update: row.ultima_actualizacion
        }
      ])
    );
    let capabilityRows = [];
    try {
      capabilityRows = (await env.DB.prepare(`SELECT c.device_uuid, c.capabilities_json, c.updated_at FROM device_network_capabilities c INNER JOIN equipos e ON e.uuid=c.device_uuid WHERE e.usuario_id=?1`).bind(usuario.id).all()).results || [];
    } catch (error) {
      if (!isMissingNetworkCapabilitiesTable(error)) throw error;
    }
    const networkByDevice = new Map(capabilityRows.map((row) => {
      let capabilities2 = {};
      try {
        capabilities2 = JSON.parse(row.capabilities_json || "{}");
      } catch {
        capabilities2 = {};
      }
      return [row.device_uuid, {
        ipv4_address: String(capabilities2.ipv4_address || ""),
        ipv6_address: String(capabilities2.ipv6_address || ""),
        ipv6_global: capabilities2.ipv6_global === true,
        ipv6_internet: capabilities2.ipv6_internet === true,
        srt_ipv6: capabilities2.srt_ipv6 === true,
        tailscale_available: capabilities2.tailscale_available === true,
        tailscale_ipv4_address: String(capabilities2.tailscale_ipv4_address || ""),
        tailscale_tailnet: String(capabilities2.tailscale_tailnet || ""),
        tailscale_state: String(capabilities2.tailscale_state || "UNKNOWN").toUpperCase(),
        hardware_model: String(capabilities2.hardware_model || ""),
        hardware_memory_gb: Number(capabilities2.hardware_memory_gb || 0),
        device_role: String(capabilities2.device_role || "").toUpperCase(),
        tailscale_provisioning_state: String(capabilities2.tailscale_provisioning_state || "").toUpperCase(),
        tailscale_provisioning_error: String(capabilities2.tailscale_provisioning_error || ""),
        updated_at: row.updated_at || null
      }];
    }));
    const srtByDevice = new Map(
      srtRows.map((row) => [
        row.equipo_uuid,
        {
          total: Number(row.total || 0),
          free: Number(row.free || 0),
          busy: Number(row.busy || 0),
          reserved: Number(row.reserved || 0),
          offline: Number(row.offline || 0),
          last_update: row.last_update || null
        }
      ])
    );
    const presenceNow = Date.now();
    const devices = devicesRaw.map((device) => {
      const present = isDevicePresent(device, presenceNow);
      const nativeDevice = String(device.tipo || "").trim().toLowerCase().includes("ligronair");
      const rawReceivers = receiversByDevice.get(device.uuid) || [];
      const receivers = nativeDevice && !present ? rawReceivers.map((receiver) => ({
        ...receiver,
        reported_state: receiver.state,
        inactive_reservation_by_alias: receiver.reserved_by_alias || "",
        state: "OFFLINE"
      })) : rawReceivers;
      const rawSummary = srtByDevice.get(device.uuid) || {
        total: 0,
        free: 0,
        busy: 0,
        reserved: 0,
        offline: 0,
        last_update: null
      };
      const publishedNetwork = networkByDevice.get(device.uuid);
      const networkStatus = publishedNetwork ? {
        ...publishedNetwork,
        last_seen_at: device.ultima_conexion || null,
        sync_state: present ? "SYNCED" : "STALE"
      } : {
        tailscale_available: false,
        tailscale_state: "NO_REPORT",
        last_seen_at: device.ultima_conexion || null,
        sync_state: "NO_REPORT"
      };
      return {
        ...device,
        reported_state: String(device.estado || "OFFLINE").toUpperCase(),
        estado: present ? "ONLINE" : "OFFLINE",
        control_state: present ? "ONLINE" : "OFFLINE",
        srt_receivers: summarizeReceivers(receivers, rawSummary),
        srt_receiver_list: receivers,
        network_status: networkStatus,
        runtime_status: runtimeByDevice.get(device.uuid) || null
      };
    });
    const piDevices = devices.filter((device) => String(device.tipo || "").toLowerCase().includes("ligronpi"));
    const nativeDevices = devices.filter((device) => String(device.tipo || "").toLowerCase().includes("ligronair"));
    const routePlans = [];
    const relay = relayConfiguration(env);
    for (const pi of piDevices) {
      for (const native of nativeDevices) {
        routePlans.push({
          pi_uuid: pi.uuid,
          native_uuid: native.uuid,
          ...publicRoutePlan(buildRoutePlan({
            pi,
            native,
            piNetwork: pi.network_status || {},
            nativeNetwork: native.network_status || {},
            relay
          }))
        });
      }
    }
    return Response.json(
      {
        success: true,
        devices,
        route_plans: routePlans
      },
      {
        headers: corsHeaders5
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders5
      }
    );
  }
}
__name(devicesGet, "devicesGet");

// src/api/ip.js
var corsHeaders6 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function getPublicIp(request) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    return Response.json(
      {
        success: true,
        ip
      },
      {
        headers: corsHeaders6
      }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders6
      }
    );
  }
}
__name(getPublicIp, "getPublicIp");

// src/api/deviceDelete.js
var corsHeaders7 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
async function deviceDelete(request, env) {
  try {
    const url = new URL(request.url);
    const partes = url.pathname.split("/");
    const deviceId = Number(partes[4]);
    if (!deviceId) {
      return Response.json(
        {
          success: false,
          error: "ID de equipo no v\xE1lido."
        },
        {
          status: 400,
          headers: corsHeaders7
        }
      );
    }
    const usuario = await requireUserSession(request, env.DB);
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Sesi\xF3n no v\xE1lida o caducada. Inicie sesi\xF3n de nuevo."
        },
        {
          status: 401,
          headers: corsHeaders7
        }
      );
    }
    await deleteDevice(
      env.DB,
      deviceId,
      usuario.id
    );
    return Response.json(
      {
        success: true
      },
      {
        headers: corsHeaders7
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders7
      }
    );
  }
}
__name(deviceDelete, "deviceDelete");

// src/api/deviceOffline.js
var corsHeaders8 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function deviceOffline(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders8
        }
      );
    }
    const body = await request.json();
    const uuid = body.uuid?.trim() || "";
    if (!uuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar un UUID."
        },
        {
          status: 400,
          headers: corsHeaders8
        }
      );
    }
    await setDeviceStatus(
      env.DB,
      uuid,
      "OFFLINE"
    );
    return Response.json(
      {
        success: true,
        status: "OFFLINE"
      },
      {
        headers: corsHeaders8
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders8
      }
    );
  }
}
__name(deviceOffline, "deviceOffline");

// src/database/peerStatus.js
async function findLinkedPiStatuses(db, userId, nativeUuid) {
  const reservedSql = `
        SELECT p.uuid AS device_uuid, p.alias, p.public_ip,
               r.runtime_state, r.streaming, r.target_srt_url, r.telemetry_json,
               r.ultima_actualizacion,
               s.source_id, s.nombre AS receiver_name,
               s.estado AS reservation_state, s.host, s.port, s.mode,
               CASE WHEN UPPER(p.estado) = 'ONLINE'
                 AND datetime(p.ultima_conexion) >= datetime('now','-75 seconds')
                 THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state
        FROM srt_destinos s
        JOIN equipos p ON p.uuid=s.reservado_por_uuid AND p.usuario_id=s.usuario_id
        LEFT JOIN device_runtime_status r
          ON r.device_uuid=p.uuid AND r.usuario_id=p.usuario_id
        WHERE s.usuario_id=?1 AND s.equipo_uuid=?2
          AND s.estado='RESERVED'
        ORDER BY s.source_id
    `;
  const activeTailSql = /* @__PURE__ */ __name((withTelemetry) => `
        SELECT p.uuid AS device_uuid, p.alias, p.public_ip,
               r.runtime_state, r.streaming, r.target_srt_url,
               ${withTelemetry ? "r.telemetry_json" : "NULL AS telemetry_json"},
               r.ultima_actualizacion,
               COALESCE((
                   SELECT s.source_id
                   FROM srt_destinos AS s
                   WHERE s.usuario_id=r.usuario_id
                     AND s.equipo_uuid=?2
                     AND (
                        instr(LOWER(COALESCE(r.target_srt_url,'')),
                              ':' || CAST(s.port AS TEXT)) > 0
                        OR instr(LOWER(COALESCE(r.target_label,'')),
                                 'caja ' || printf('%02d', s.source_id)) > 0
                     )
                   ORDER BY s.source_id ASC
                   LIMIT 1
               ), 0) AS source_id,
               COALESCE((
                   SELECT s.nombre
                   FROM srt_destinos AS s
                   WHERE s.usuario_id=r.usuario_id
                     AND s.equipo_uuid=?2
                     AND (
                        instr(LOWER(COALESCE(r.target_srt_url,'')),
                              ':' || CAST(s.port AS TEXT)) > 0
                        OR instr(LOWER(COALESCE(r.target_label,'')),
                                 'caja ' || printf('%02d', s.source_id)) > 0
                     )
                   ORDER BY s.source_id ASC
                   LIMIT 1
               ), '') AS receiver_name,
               'BUSY' AS reservation_state,
               NULL AS host, NULL AS port, 'tailnet' AS mode,
               CASE WHEN UPPER(p.estado) = 'ONLINE'
                 AND datetime(p.ultima_conexion) >= datetime('now','-75 seconds')
                 THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state
        FROM device_runtime_status AS r
        JOIN equipos AS p ON p.uuid=r.device_uuid AND p.usuario_id=r.usuario_id
        WHERE r.usuario_id=?1
          AND r.target_device_uuid=?2
          AND r.streaming=1
          AND datetime(r.ultima_actualizacion)>=datetime('now','-75 seconds')
          AND NOT EXISTS (
              SELECT 1 FROM srt_destinos AS reserved
              WHERE reserved.usuario_id=r.usuario_id
                AND reserved.equipo_uuid=?2
                AND reserved.reservado_por_uuid=r.device_uuid
                AND reserved.estado='RESERVED'
          )
        ORDER BY source_id ASC
    `, "activeTailSql");
  try {
    let rows;
    try {
      rows = (await db.prepare(reservedSql).bind(userId, nativeUuid).all()).results;
    } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes("telemetry_json")) {
        throw error;
      }
      const legacyTelemetrySql = reservedSql.replace(
        "r.runtime_state, r.streaming, r.target_srt_url, r.telemetry_json,\n               r.ultima_actualizacion,",
        "r.runtime_state, r.streaming, r.target_srt_url, NULL AS telemetry_json,\n               r.ultima_actualizacion,"
      );
      rows = (await db.prepare(legacyTelemetrySql).bind(userId, nativeUuid).all()).results;
    }
    try {
      const activeRows = (await db.prepare(activeTailSql(true)).bind(userId, nativeUuid).all()).results || [];
      rows.push(...activeRows.filter((row) => Number(row.source_id || 0) > 0));
    } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes("telemetry_json")) {
        throw error;
      }
      const activeRows = (await db.prepare(activeTailSql(false)).bind(userId, nativeUuid).all()).results || [];
      rows.push(...activeRows.filter((row) => Number(row.source_id || 0) > 0));
    }
    try {
      await Promise.all(rows.map(async (row) => {
        const command = await db.prepare(`
                    SELECT command, state, result_message, completed_at
                    FROM device_remote_commands
                    WHERE usuario_id=?1 AND sender_device_uuid=?2
                      AND target_device_uuid=?3 AND state IN ('COMPLETED','FAILED')
                    ORDER BY completed_at DESC LIMIT 1
                `).bind(userId, nativeUuid, row.device_uuid).first();
        if (command) row.remote_command = command;
      }));
    } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes("no such table: device_remote_commands")) {
        throw error;
      }
    }
    return rows;
  } catch (error) {
    if (!String(error?.message || error).toLowerCase().includes("no such table: device_runtime_status")) {
      throw error;
    }
    const fallback = await db.prepare(`
            SELECT p.uuid AS device_uuid, p.alias, p.public_ip,
                   NULL AS runtime_state, 0 AS streaming,
                   NULL AS target_srt_url, NULL AS ultima_actualizacion,
                   s.source_id, s.nombre AS receiver_name,
                   s.estado AS reservation_state, s.host, s.port, s.mode,
                   CASE WHEN UPPER(p.estado) = 'ONLINE'
                     AND datetime(p.ultima_conexion) >= datetime('now','-75 seconds')
                     THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state
            FROM srt_destinos s
            JOIN equipos p ON p.uuid=s.reservado_por_uuid AND p.usuario_id=s.usuario_id
            WHERE s.usuario_id=?1 AND s.equipo_uuid=?2
              AND s.estado='RESERVED'
            ORDER BY s.source_id
        `).bind(userId, nativeUuid).all();
    return fallback.results;
  }
}
__name(findLinkedPiStatuses, "findLinkedPiStatuses");
async function findTargetPresence(db, userId, targetUuid, sourceUuid = "") {
  if (!targetUuid) return null;
  return await db.prepare(`
        SELECT uuid, alias,
          CASE WHEN UPPER(estado)='ONLINE'
            AND datetime(ultima_conexion)>=datetime('now','-75 seconds')
            THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state,
          (SELECT source_id FROM srt_destinos
             WHERE usuario_id=equipos.usuario_id
               AND equipo_uuid=equipos.uuid
               AND reservado_por_uuid=?3
               AND estado='RESERVED'
             ORDER BY source_id LIMIT 1) AS reserved_source_id,
          (SELECT nombre FROM srt_destinos
             WHERE usuario_id=equipos.usuario_id
               AND equipo_uuid=equipos.uuid
               AND reservado_por_uuid=?3
               AND estado='RESERVED'
             ORDER BY source_id LIMIT 1) AS reserved_receiver_name
        FROM equipos WHERE usuario_id=?1 AND uuid=?2
    `).bind(userId, targetUuid, sourceUuid).first();
}
__name(findTargetPresence, "findTargetPresence");

// src/api/deviceStatus.js
var corsHeaders9 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var VALID_STATES = [
  "OFFLINE",
  "MONITOR",
  "PREPARING",
  "CONNECTING",
  "RECONNECTING",
  "EMITTING",
  "ERROR"
];
var NATIVE_HEARTBEAT_DEDUP_MS = 20 * 1e3;
var nativeHeartbeatCache = /* @__PURE__ */ new Map();
function nativeHeartbeatKey(body, email, uuid) {
  const state = String(body.runtime_state || body.state || "").trim().toUpperCase();
  const source = String(body.source_label || "").trim().toLowerCase();
  const target = String(body.target_device_uuid || "").trim();
  if (state !== "MONITOR" || !source.includes("ligronair native") || target) {
    return "";
  }
  try {
    return `${email}:${uuid}:${JSON.stringify(body.network_capabilities || {})}`;
  } catch {
    return "";
  }
}
__name(nativeHeartbeatKey, "nativeHeartbeatKey");
function cachedNativeHeartbeat(key) {
  if (!key) return null;
  const entry = nativeHeartbeatCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) nativeHeartbeatCache.delete(key);
    return null;
  }
  return entry.payload;
}
__name(cachedNativeHeartbeat, "cachedNativeHeartbeat");
function cacheNativeHeartbeat(key, payload) {
  if (!key) return;
  nativeHeartbeatCache.set(key, {
    payload,
    expiresAt: Date.now() + NATIVE_HEARTBEAT_DEDUP_MS
  });
  if (nativeHeartbeatCache.size > 128) {
    const oldest = nativeHeartbeatCache.keys().next().value;
    if (oldest) nativeHeartbeatCache.delete(oldest);
  }
}
__name(cacheNativeHeartbeat, "cacheNativeHeartbeat");
function isMissingRuntimeStatusTable2(error) {
  return String(error?.message || error).toLowerCase().includes("no such table: device_runtime_status");
}
__name(isMissingRuntimeStatusTable2, "isMissingRuntimeStatusTable");
function isMissingNetworkCapabilitiesTable2(error) {
  return String(error?.message || error).toLowerCase().includes("no such table: device_network_capabilities");
}
__name(isMissingNetworkCapabilitiesTable2, "isMissingNetworkCapabilitiesTable");
function isMissingTelemetryColumn(error) {
  return String(error?.message || error).toLowerCase().includes("telemetry_json");
}
__name(isMissingTelemetryColumn, "isMissingTelemetryColumn");
function compactTelemetry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const normalized = JSON.parse(JSON.stringify(value));
    return JSON.stringify(normalized).length <= 4096 ? normalized : {};
  } catch {
    return {};
  }
}
__name(compactTelemetry, "compactTelemetry");
function parseSrtTarget(value) {
  const raw = String(value || "").trim();
  if (!/^srt:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    const host = String(url.hostname || "").trim().toLowerCase();
    const port = Number(url.port || 0);
    return host && Number.isInteger(port) && port > 0 ? { host, port } : null;
  } catch {
    return null;
  }
}
__name(parseSrtTarget, "parseSrtTarget");
async function resolveNativeTargetFromSrt(db, userId, targetUrl) {
  const target = parseSrtTarget(targetUrl);
  if (!target) return null;
  const selectWithCapabilities = `
        SELECT e.uuid AS device_uuid, e.alias AS device_alias,
               s.source_id, s.nombre AS receiver_name
        FROM equipos AS e
        JOIN srt_destinos AS s
          ON s.equipo_uuid=e.uuid AND s.usuario_id=e.usuario_id
        LEFT JOIN device_network_capabilities AS c
          ON c.device_uuid=e.uuid
        WHERE e.usuario_id=?1
          AND LOWER(TRIM(e.tipo)) IN ('ligronair','ligronair native','ligronair_native')
          AND UPPER(e.estado)='ONLINE'
          AND datetime(e.ultima_conexion)>=datetime('now','-75 seconds')
          AND s.port=?2
          AND s.estado IN ('FREE','BUSY','RESERVED')
          AND (
              LOWER(COALESCE(s.host,''))=?3
              OR LOWER(COALESCE(e.public_ip,''))=?3
              OR LOWER(COALESCE(json_extract(c.capabilities_json,'$.tailscale_ipv4_address'),''))=?3
              OR LOWER(COALESCE(json_extract(c.capabilities_json,'$.ipv4_address'),''))=?3
          )
        ORDER BY s.source_id ASC
        LIMIT 1
    `;
  try {
    return await db.prepare(selectWithCapabilities).bind(userId, target.port, target.host).first();
  } catch (error) {
    if (!isMissingNetworkCapabilitiesTable2(error)) throw error;
    return await db.prepare(`
            SELECT e.uuid AS device_uuid, e.alias AS device_alias,
                   s.source_id, s.nombre AS receiver_name
            FROM equipos AS e
            JOIN srt_destinos AS s
              ON s.equipo_uuid=e.uuid AND s.usuario_id=e.usuario_id
            WHERE e.usuario_id=?1
              AND LOWER(TRIM(e.tipo)) IN ('ligronair','ligronair native','ligronair_native')
              AND UPPER(e.estado)='ONLINE'
              AND datetime(e.ultima_conexion)>=datetime('now','-75 seconds')
              AND s.port=?2
              AND s.estado IN ('FREE','BUSY','RESERVED')
              AND (
                  LOWER(COALESCE(s.host,''))=?3
                  OR LOWER(COALESCE(e.public_ip,''))=?3
              )
            ORDER BY s.source_id ASC
            LIMIT 1
        `).bind(userId, target.port, target.host).first();
  }
}
__name(resolveNativeTargetFromSrt, "resolveNativeTargetFromSrt");
async function syncNetworkCapabilities(db, deviceUuid, capabilities2) {
  if (!capabilities2 || typeof capabilities2 !== "object") return false;
  try {
    await db.prepare(`
            INSERT INTO device_network_capabilities
                (device_uuid, capabilities_json, updated_at)
            VALUES (?1, ?2, datetime('now'))
            ON CONFLICT(device_uuid) DO UPDATE SET
                capabilities_json=excluded.capabilities_json,
                updated_at=datetime('now')
            WHERE capabilities_json != excluded.capabilities_json
        `).bind(deviceUuid, JSON.stringify(capabilities2)).run();
    return true;
  } catch (error) {
    if (!isMissingNetworkCapabilitiesTable2(error)) throw error;
    return false;
  }
}
__name(syncNetworkCapabilities, "syncNetworkCapabilities");
async function deviceStatus(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders9
        }
      );
    }
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const uuid = String(body.device_uuid || body.uuid || "").trim();
    if (!email || !uuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar email y UUID de equipo."
        },
        {
          status: 400,
          headers: corsHeaders9
        }
      );
    }
    const heartbeatKey = nativeHeartbeatKey(body, email, uuid);
    const cachedHeartbeat = cachedNativeHeartbeat(heartbeatKey);
    if (cachedHeartbeat) {
      return Response.json(
        { ...cachedHeartbeat, heartbeat_cached: true },
        { headers: corsHeaders9 }
      );
    }
    const usuario = await findUserByEmail(
      env.DB,
      email
    );
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Usuario no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders9
        }
      );
    }
    const device = await findDeviceByUuid(
      env.DB,
      uuid
    );
    if (!device || Number(device.usuario_id) !== Number(usuario.id)) {
      return Response.json(
        {
          success: false,
          error: "Equipo no encontrado para este usuario."
        },
        {
          status: 404,
          headers: corsHeaders9
        }
      );
    }
    const runtimeState = String(body.runtime_state || body.state || "OFFLINE").trim().toUpperCase();
    if (!VALID_STATES.includes(runtimeState)) {
      return Response.json(
        {
          success: false,
          error: "Estado runtime inv\xE1lido."
        },
        {
          status: 400,
          headers: corsHeaders9
        }
      );
    }
    const requestedTargetUuid = String(body.target_device_uuid || "").trim();
    const requestedTargetUrl = String(body.target_srt_url || "").trim();
    const resolvingStates = /* @__PURE__ */ new Set([
      "CONNECTING",
      "RECONNECTING",
      "EMITTING"
    ]);
    const resolvedTarget = !requestedTargetUuid && resolvingStates.has(runtimeState) ? await resolveNativeTargetFromSrt(
      env.DB,
      usuario.id,
      requestedTargetUrl
    ) : null;
    const effectiveTargetUuid = requestedTargetUuid || String(resolvedTarget?.device_uuid || "").trim();
    const effectiveTargetLabel = resolvedTarget ? `Native ${String(resolvedTarget.device_alias || "LigronAir").trim()} \xB7 Caja ${String(resolvedTarget.source_id).padStart(2, "0")}` : String(body.target_label || "").trim();
    if (runtimeState === "OFFLINE") {
      await setDeviceStatus(env.DB, device.uuid, "OFFLINE");
    } else {
      await touchDevicePresence(env.DB, device.uuid, usuario.id);
    }
    const networkStatusAvailable = await syncNetworkCapabilities(
      env.DB,
      device.uuid,
      body.network_capabilities
    );
    let runtimeStatusAvailable = true;
    let telemetryStatusAvailable = true;
    try {
      await updateDeviceRuntimeStatus(
        env.DB,
        device,
        {
          runtime_state: runtimeState,
          source_label: String(body.source_label || "").trim(),
          target_device_uuid: effectiveTargetUuid,
          target_label: effectiveTargetLabel,
          target_srt_url: requestedTargetUrl,
          streaming: Boolean(body.streaming),
          pipeline_active: Boolean(body.pipeline_active),
          signal_available: Boolean(body.signal_available),
          audio_state: String(body.audio_state || "").trim().toUpperCase(),
          telemetry: compactTelemetry(body.telemetry)
        }
      );
    } catch (error) {
      if (isMissingTelemetryColumn(error)) {
        telemetryStatusAvailable = false;
        await updateDeviceRuntimeStatus(
          env.DB,
          device,
          {
            runtime_state: runtimeState,
            source_label: String(body.source_label || "").trim(),
            target_device_uuid: effectiveTargetUuid,
            target_label: effectiveTargetLabel,
            target_srt_url: requestedTargetUrl,
            streaming: Boolean(body.streaming),
            pipeline_active: Boolean(body.pipeline_active),
            signal_available: Boolean(body.signal_available),
            audio_state: String(body.audio_state || "").trim().toUpperCase()
          },
          false
        );
      } else if (!isMissingRuntimeStatusTable2(error)) {
        throw error;
      } else {
        runtimeStatusAvailable = false;
        console.warn(
          "device_runtime_status a\xFAn no existe; presencia actualizada sin runtime."
        );
      }
    }
    const responsePayload = {
      success: true,
      runtime_status_available: runtimeStatusAvailable,
      telemetry_status_available: telemetryStatusAvailable,
      network_status_available: networkStatusAvailable,
      resolved_target: resolvedTarget || null,
      peer: await findTargetPresence(
        env.DB,
        usuario.id,
        effectiveTargetUuid,
        device.uuid
      )
    };
    cacheNativeHeartbeat(heartbeatKey, responsePayload);
    return Response.json(responsePayload, { headers: corsHeaders9 });
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders9
      }
    );
  }
}
__name(deviceStatus, "deviceStatus");

// src/api/srtReceivers.js
var corsHeaders10 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var HEARTBEAT_DEDUP_MS = 20 * 1e3;
var receiverHeartbeatCache = /* @__PURE__ */ new Map();
function heartbeatSignature(receivers, capabilities2) {
  try {
    return JSON.stringify({ receivers, capabilities: capabilities2 || null });
  } catch {
    return "";
  }
}
__name(heartbeatSignature, "heartbeatSignature");
function cachedReceiverHeartbeat(email, deviceUuid, signature) {
  if (!signature) return null;
  const key = `${email}:${deviceUuid}`;
  const entry = receiverHeartbeatCache.get(key);
  if (!entry || entry.expiresAt <= Date.now() || entry.signature !== signature) {
    if (entry && entry.expiresAt <= Date.now()) receiverHeartbeatCache.delete(key);
    return null;
  }
  return entry.payload;
}
__name(cachedReceiverHeartbeat, "cachedReceiverHeartbeat");
function cacheReceiverHeartbeat(email, deviceUuid, signature, payload) {
  if (!signature) return;
  const key = `${email}:${deviceUuid}`;
  receiverHeartbeatCache.set(key, {
    signature,
    payload,
    expiresAt: Date.now() + HEARTBEAT_DEDUP_MS
  });
  if (receiverHeartbeatCache.size > 128) {
    const oldest = receiverHeartbeatCache.keys().next().value;
    if (oldest) receiverHeartbeatCache.delete(oldest);
  }
}
__name(cacheReceiverHeartbeat, "cacheReceiverHeartbeat");
async function syncNetworkCapabilities2(db, deviceUuid, capabilities2) {
  if (!capabilities2 || typeof capabilities2 !== "object") return false;
  try {
    await db.prepare(`
            INSERT INTO device_network_capabilities
                (device_uuid, capabilities_json, updated_at)
            VALUES (?1, ?2, datetime('now'))
            ON CONFLICT(device_uuid) DO UPDATE SET
                capabilities_json=excluded.capabilities_json,
                updated_at=datetime('now')
            WHERE capabilities_json != excluded.capabilities_json
        `).bind(deviceUuid, JSON.stringify(capabilities2)).run();
    return true;
  } catch (error) {
    if (String(error?.message || error).toLowerCase().includes("no such table: device_network_capabilities")) {
      return false;
    }
    throw error;
  }
}
__name(syncNetworkCapabilities2, "syncNetworkCapabilities");
async function srtReceivers(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders10
        }
      );
    }
    const body = await request.json();
    const email = body.email?.trim().toLowerCase() || "";
    const deviceUuid = body.device_uuid?.trim() || "";
    const receivers = Array.isArray(body.receivers) ? body.receivers : null;
    const networkCapabilities2 = body.network_capabilities && typeof body.network_capabilities === "object" ? body.network_capabilities : null;
    if (!email) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar el correo."
        },
        {
          status: 400,
          headers: corsHeaders10
        }
      );
    }
    if (!deviceUuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar el UUID del equipo."
        },
        {
          status: 400,
          headers: corsHeaders10
        }
      );
    }
    if (!receivers) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar la lista de receptores."
        },
        {
          status: 400,
          headers: corsHeaders10
        }
      );
    }
    const heartbeatSnapshot = heartbeatSignature(
      receivers,
      networkCapabilities2
    );
    const cachedHeartbeat = cachedReceiverHeartbeat(
      email,
      deviceUuid,
      heartbeatSnapshot
    );
    if (cachedHeartbeat) {
      return Response.json(
        { ...cachedHeartbeat, heartbeat_cached: true },
        { headers: corsHeaders10 }
      );
    }
    const usuario = await findUserByEmail(
      env.DB,
      email
    );
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Usuario no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders10
        }
      );
    }
    const device = await findDeviceByUuid(
      env.DB,
      deviceUuid
    );
    if (!device) {
      return Response.json(
        {
          success: false,
          error: "Equipo no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders10
        }
      );
    }
    if (device.usuario_id !== usuario.id) {
      return Response.json(
        {
          success: false,
          error: "El equipo no pertenece al usuario indicado."
        },
        {
          status: 403,
          headers: corsHeaders10
        }
      );
    }
    const tipo = String(device.tipo || "").trim().toLowerCase();
    if (![
      "ligronair",
      "ligronair native",
      "ligronair_native"
    ].includes(tipo)) {
      return Response.json(
        {
          success: false,
          error: "El equipo no es un receptor LigronAir compatible."
        },
        {
          status: 400,
          headers: corsHeaders10
        }
      );
    }
    const normalizados = [];
    const sourceIds = /* @__PURE__ */ new Set();
    for (let index = 0; index < receivers.length; index += 1) {
      const receiver = receivers[index] || {};
      const sourceId = Number(receiver.source_id);
      const nombre = receiver.name?.trim() || `MOCHILA ${String(sourceId).padStart(2, "0")}`;
      const mode = receiver.mode?.trim().toLowerCase() || "listener";
      const estado = String(receiver.state || "FREE").trim().toUpperCase();
      const hostRecibido = receiver.host?.trim() || "";
      const host = hostRecibido;
      const port = Number(receiver.port);
      if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50) {
        return Response.json(
          {
            success: false,
            error: `source_id inv\xE1lido en el receptor ${index + 1}. Debe estar entre 1 y 50.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      if (sourceIds.has(sourceId)) {
        return Response.json(
          {
            success: false,
            error: `source_id duplicado: ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      sourceIds.add(sourceId);
      if (!nombre) {
        return Response.json(
          {
            success: false,
            error: `Debe indicar un nombre para el receptor ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      if (!["listener", "rendezvous"].includes(mode)) {
        return Response.json(
          {
            success: false,
            error: `Modo SRT no compatible para source_id ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      if (!["FREE", "BUSY", "RESERVED", "OFFLINE"].includes(estado)) {
        return Response.json(
          {
            success: false,
            error: `Estado SRT inv\xE1lido para source_id ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      const ipv4Parts = host.split(".");
      const validIpv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
      const validIpv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);
      if (host && !validIpv4 && !validIpv6) {
        return Response.json(
          {
            success: false,
            error: `Direcci\xF3n SRT exterior inv\xE1lida para source_id ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return Response.json(
          {
            success: false,
            error: `Puerto inv\xE1lido para source_id ${sourceId}.`
          },
          {
            status: 400,
            headers: corsHeaders10
          }
        );
      }
      normalizados.push({
        sourceId,
        nombre,
        host,
        port,
        mode,
        estado
      });
    }
    const snapshotDevice = {
      uuid: device.uuid,
      usuarioId: usuario.id
    };
    const unchanged = await hasSameSrtReceiverSnapshot(
      env.DB,
      snapshotDevice,
      normalizados
    );
    const guardados = unchanged ? normalizados.map((receiver) => ({
      source_id: receiver.sourceId,
      name: receiver.nombre,
      host: receiver.host,
      port: receiver.port,
      mode: receiver.mode,
      state: receiver.estado
    })) : await replaceSrtDestinations(env.DB, snapshotDevice, normalizados);
    await touchDevicePresence(
      env.DB,
      device.uuid,
      usuario.id
    );
    const networkStatusAvailable = await syncNetworkCapabilities2(
      env.DB,
      device.uuid,
      networkCapabilities2
    );
    await env.DB.prepare(`
            UPDATE srt_destinos
            SET estado='FREE', reservado_por_uuid=NULL,
                ultima_actualizacion=datetime('now')
            WHERE equipo_uuid=?1 AND usuario_id=?2 AND estado='RESERVED'
              AND NOT EXISTS (
                  SELECT 1 FROM equipos AS pi
                  WHERE pi.uuid=srt_destinos.reservado_por_uuid
                    AND pi.usuario_id=srt_destinos.usuario_id
                    AND UPPER(pi.estado)='ONLINE'
                    AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
              )
        `).bind(device.uuid, usuario.id).run();
    const responsePayload = {
      success: true,
      device_uuid: device.uuid,
      device_alias: device.alias,
      host_default: normalizados[0]?.host || null,
      receivers: guardados,
      count: guardados.length,
      network_status_available: networkStatusAvailable,
      snapshot_changed: !unchanged,
      linked_pis: await findLinkedPiStatuses(env.DB, usuario.id, device.uuid),
      // Native receives this response reliably on every snapshot.
      // Carry the control-plane request in the same authenticated
      // response instead of making Pi wait for a second poll path.
      connection_requests: (await env.DB.prepare(`
                    SELECT request.request_id, request.source_id, request.host, request.port, request.state
                    FROM connection_requests AS request
                    JOIN equipos AS pi
                      ON pi.uuid=request.pi_device_uuid
                     AND pi.usuario_id=request.usuario_id
                    WHERE request.usuario_id=?1 AND request.native_device_uuid=?2
                      AND datetime(request.expires_at)>datetime('now')
                      AND UPPER(pi.estado)='ONLINE'
                      AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
                      AND request.state IN ('PENDING','PI_READY','BOX_READY','CALLER_REQUIRED')
                    ORDER BY request.created_at ASC
                `).bind(usuario.id, device.uuid).all()).results || [],
      relay_sessions: await findRelaySessionsForNative(
        env.DB,
        usuario.id,
        device.uuid,
        relayConfiguration(env)
      )
    };
    cacheReceiverHeartbeat(
      email,
      deviceUuid,
      heartbeatSnapshot,
      responsePayload
    );
    return Response.json(responsePayload, { headers: corsHeaders10 });
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders10
      }
    );
  }
}
__name(srtReceivers, "srtReceivers");

// src/api/srtDestinations.js
var corsHeaders11 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function buildSrtUrl(host, port, mode) {
  const normalizedHost = String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
  const queryMode = mode === "listener" ? "caller" : "caller";
  return `srt://${normalizedHost}:${port}?mode=${queryMode}`;
}
__name(buildSrtUrl, "buildSrtUrl");
async function srtDestinations(request, env) {
  try {
    if (request.method !== "GET") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders11
        }
      );
    }
    const url = new URL(request.url);
    const email = url.searchParams.get("email")?.trim().toLowerCase();
    if (!email) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar el correo."
        },
        {
          status: 400,
          headers: corsHeaders11
        }
      );
    }
    const usuario = await findUserByEmail(
      env.DB,
      email
    );
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Usuario no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders11
        }
      );
    }
    const deviceRows = await findAvailableSrtDevices(
      env.DB,
      usuario.id
    );
    const devices = deviceRows.map((row) => ({
      device_uuid: row.equipo_uuid,
      device_alias: row.device_alias,
      available_receivers: Number(row.available_receivers || 0)
    }));
    const rows = await findAvailableSrtDestinations(
      env.DB,
      usuario.id
    );
    const destinations = rows.map((row) => ({
      id: row.id,
      device_uuid: row.equipo_uuid,
      device_alias: row.device_alias,
      source_id: row.source_id,
      name: row.nombre,
      host: row.host,
      port: row.port,
      mode: row.mode,
      state: row.estado,
      srt_url: buildSrtUrl(
        row.host,
        row.port,
        row.mode
      )
    }));
    return Response.json(
      {
        success: true,
        // ### FIX
        devices,
        destinations
      },
      {
        headers: corsHeaders11
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders11
      }
    );
  }
}
__name(srtDestinations, "srtDestinations");

// src/api/srtAllocate.js
var corsHeaders12 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function networkCapabilities(db, deviceUuid) {
  try {
    const row = await db.prepare(`SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1`).bind(deviceUuid).first();
    return JSON.parse(row?.capabilities_json || "{}");
  } catch (error) {
    return {};
  }
}
__name(networkCapabilities, "networkCapabilities");
async function srtAllocate(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders12
        }
      );
    }
    const body = await request.json();
    const email = body.email?.trim().toLowerCase() || "";
    const piUuid = body.pi_uuid?.trim() || "";
    const deviceUuid = body.device_uuid?.trim() || "";
    const sourceId = body.source_id === void 0 || body.source_id === null ? null : Number(body.source_id);
    if (!email || !piUuid || !deviceUuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar email, pi_uuid y device_uuid."
        },
        {
          status: 400,
          headers: corsHeaders12
        }
      );
    }
    if (sourceId !== null && (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50)) {
      return Response.json(
        { success: false, error: "source_id inv\xE1lido." },
        { status: 400, headers: corsHeaders12 }
      );
    }
    const usuario = await findUserByEmail(
      env.DB,
      email
    );
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Usuario no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders12
        }
      );
    }
    const pi = await findDeviceByUuid(
      env.DB,
      piUuid
    );
    if (!pi || Number(pi.usuario_id) !== Number(usuario.id) || !["ligronpi", "ligronpi native", "ligronpi_native"].includes(
      String(pi.tipo || "").trim().toLowerCase()
    )) {
      return Response.json(
        {
          success: false,
          error: "LigronPi no autorizado para este usuario."
        },
        {
          status: 403,
          headers: corsHeaders12
        }
      );
    }
    await touchDevicePresence(env.DB, piUuid, usuario.id);
    const device = await findDeviceByUuid(
      env.DB,
      deviceUuid
    );
    if (!device || Number(device.usuario_id) !== Number(usuario.id) || !["ligronair", "ligronair native", "ligronair_native"].includes(
      String(device.tipo || "").trim().toLowerCase()
    )) {
      return Response.json(
        {
          success: false,
          error: "LigronAir no autorizado para este usuario."
        },
        {
          status: 403,
          headers: corsHeaders12
        }
      );
    }
    if (String(device.estado || "").trim().toUpperCase() !== "ONLINE") {
      return Response.json(
        {
          success: false,
          error: "LigronAir no est\xE1 ONLINE."
        },
        {
          status: 409,
          headers: corsHeaders12
        }
      );
    }
    const relay = relayConfiguration(env);
    const [piNetwork, nativeNetwork] = await Promise.all([
      networkCapabilities(env.DB, pi.uuid),
      networkCapabilities(env.DB, device.uuid)
    ]);
    const routePlan = buildRoutePlan({
      pi,
      native: device,
      piNetwork,
      nativeNetwork,
      relay
    });
    let selectedRoute = routePlan.selected;
    const assignment = await allocateSrtDestination(
      env.DB,
      usuario.id,
      piUuid,
      deviceUuid,
      sourceId
    );
    if (!assignment) {
      return Response.json(
        { success: false, error: "No hay receptores SRT libres en ese LigronAir." },
        { status: 409, headers: corsHeaders12 }
      );
    }
    if (!Number(assignment.port)) {
      await releaseSrtDestination(env.DB, usuario.id, piUuid, deviceUuid);
      return Response.json(
        { success: false, error: "LigronAir public\xF3 una caja sin puerto SRT utilizable." },
        { status: 409, headers: corsHeaders12 }
      );
    }
    const publishedEndpoint = String(assignment.host || "").trim();
    let effectiveRoutePlan = routePlan;
    if (!selectedRoute && publishedEndpoint) {
      selectedRoute = {
        id: "NATIVE_PUBLISHED_DIRECT",
        label: "SRT directo publicado por Native (sin verificar)",
        // La publicación de host:puerto sólo confirma el listener
        // local de Native. No demuestra que el UDP atraviese el
        // router/CGNAT hasta una Pi en otra red.
        state: "CANDIDATE",
        selectable: true,
        reason: `Native public\xF3 ${publishedEndpoint}:${assignment.port}; se probar\xE1 como caller directo, pero la accesibilidad exterior a\xFAn no est\xE1 verificada.`
      };
      effectiveRoutePlan = {
        ...routePlan,
        selected: selectedRoute,
        candidates: [...routePlan.candidates, selectedRoute]
      };
    }
    if (!selectedRoute) {
      await releaseSrtDestination(env.DB, usuario.id, piUuid, deviceUuid);
      return Response.json(
        {
          success: false,
          error: "Native no public\xF3 un endpoint SRT directo y no hay una ruta privada/relay disponible.",
          route_plan: publicRoutePlan(routePlan)
        },
        { status: 409, headers: corsHeaders12 }
      );
    }
    if (selectedRoute.id === "LIGRONRELAY_SRT") {
      try {
        const session = await createRelaySession(
          env.DB,
          relay,
          usuario.id,
          piUuid,
          deviceUuid,
          assignment.source_id
        );
        return Response.json(
          {
            success: true,
            assignment: {
              device_uuid: assignment.equipo_uuid,
              // Pi only receives the publisher credential. The
              // reader credential is delivered separately to
              // the authenticated Native heartbeat.
              srt_url: session.publish_url,
              route: "RELAY",
              transport: "LIGRONRELAY_SRT",
              relay_session_id: session.session_id,
              source_id: assignment.source_id,
              receiver_name: assignment.nombre,
              port: relay.port,
              native_port: assignment.port,
              route_plan: publicRoutePlan(effectiveRoutePlan)
            }
          },
          { headers: corsHeaders12 }
        );
      } catch (error) {
        await releaseSrtDestination(env.DB, usuario.id, piUuid, deviceUuid);
        throw new Error("LigronRelay no pudo crear una sesi\xF3n segura: " + (error?.message || error));
      }
    }
    const host = selectedRoute.id === "TAILSCALE_DIRECT_CALLER" ? String(nativeNetwork.tailscale_ipv4_address || "").trim() : selectedRoute.id === "LAN_DIRECT_CALLER" ? String(nativeNetwork.ipv4_address || "").trim() : publishedEndpoint;
    return Response.json(
      {
        success: true,
        assignment: {
          device_uuid: assignment.equipo_uuid,
          srt_url: buildSrtCallerUrl(host, assignment.port),
          route: "DIRECT",
          transport: selectedRoute.id,
          source_id: assignment.source_id,
          receiver_name: assignment.nombre,
          port: assignment.port,
          route_plan: publicRoutePlan(effectiveRoutePlan)
        }
      },
      {
        headers: corsHeaders12
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders12
      }
    );
  }
}
__name(srtAllocate, "srtAllocate");

// src/api/srtRelease.js
var corsHeaders13 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
async function srtRelease(request, env) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          error: "M\xE9todo no permitido."
        },
        {
          status: 405,
          headers: corsHeaders13
        }
      );
    }
    const body = await request.json();
    const email = body.email?.trim().toLowerCase() || "";
    const piUuid = body.pi_uuid?.trim() || "";
    const deviceUuid = body.device_uuid?.trim() || "";
    if (!email || !piUuid || !deviceUuid) {
      return Response.json(
        {
          success: false,
          error: "Debe indicar email, pi_uuid y device_uuid."
        },
        {
          status: 400,
          headers: corsHeaders13
        }
      );
    }
    const usuario = await findUserByEmail(
      env.DB,
      email
    );
    if (!usuario) {
      return Response.json(
        {
          success: false,
          error: "Usuario no encontrado."
        },
        {
          status: 404,
          headers: corsHeaders13
        }
      );
    }
    const pi = await findDeviceByUuid(
      env.DB,
      piUuid
    );
    if (!pi || Number(pi.usuario_id) !== Number(usuario.id)) {
      return Response.json(
        {
          success: false,
          error: "LigronPi no autorizado para este usuario."
        },
        {
          status: 403,
          headers: corsHeaders13
        }
      );
    }
    const released = await releaseSrtDestination(
      env.DB,
      usuario.id,
      piUuid,
      deviceUuid
    );
    try {
      await env.DB.prepare(`
                UPDATE relay_sessions
                SET state='RELEASED', updated_at=datetime('now')
                WHERE usuario_id=?1 AND pi_device_uuid=?2 AND native_device_uuid=?3
                  AND state='ACTIVE'
            `).bind(usuario.id, piUuid, deviceUuid).run();
    } catch (relayError) {
      if (!String(relayError?.message || relayError).includes("no such table")) {
        throw relayError;
      }
    }
    return Response.json(
      {
        success: true,
        released
      },
      {
        headers: corsHeaders13
      }
    );
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        success: false,
        error: error.message
      },
      {
        status: 500,
        headers: corsHeaders13
      }
    );
  }
}
__name(srtRelease, "srtRelease");

// src/api/rendezvous.js
var corsHeaders14 = { "Access-Control-Allow-Origin": "https://ligronair.tv", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
var activeStates = ["CREATED", "WAITING_PI", "WAITING_NATIVE", "READY", "STARTING", "CONNECTING"];
async function user(request, env, body = null) {
  const url = new URL(request.url);
  const email = String(body?.email || url.searchParams.get("email") || "").trim().toLowerCase();
  const deviceUuid = String(body?.device_uuid || url.searchParams.get("device_uuid") || "").trim();
  const account = email && await findUserByEmail(env.DB, email);
  const device = account && deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
  if (!account || !device || Number(device.usuario_id) !== Number(account.id)) throw new Error("Dispositivo no autorizado.");
  return { account, deviceUuid };
}
__name(user, "user");
async function rendezvousPoll(request, env) {
  try {
    const { account, deviceUuid } = await user(request, env);
    const rows = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE usuario_id=?1 AND (source_device_uuid=?2 OR destination_device_uuid=?2) AND datetime(expires_at) > datetime('now') AND state NOT IN ('FAILED','CANCELLED','EXPIRED') ORDER BY created_at DESC`).bind(account.id, deviceUuid).all();
    return Response.json({ success: true, sessions: rows.results || [] }, { headers: corsHeaders14 });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 403, headers: corsHeaders14 });
  }
}
__name(rendezvousPoll, "rendezvousPoll");
async function rendezvousReady(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await user(request, env, body);
    const id = String(body.session_id || "").trim();
    const session = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE session_id=?1 AND usuario_id=?2`).bind(id, account.id).first();
    if (!session || !activeStates.includes(session.state)) throw new Error("Sesi\xF3n Rendezvous no disponible.");
    const pi = session.source_device_uuid === deviceUuid;
    const native = session.destination_device_uuid === deviceUuid;
    if (!pi && !native) throw new Error("Dispositivo ajeno a la sesi\xF3n.");
    await env.DB.prepare(`UPDATE rendezvous_sessions SET pi_ready=CASE WHEN ?2 THEN 1 ELSE pi_ready END, native_ready=CASE WHEN ?3 THEN 1 ELSE native_ready END, state=CASE WHEN (pi_ready=1 OR ?2) AND (native_ready=1 OR ?3) THEN 'STARTING' WHEN ?2 THEN 'WAITING_NATIVE' ELSE 'WAITING_PI' END, updated_at=datetime('now') WHERE session_id=?1`).bind(id, pi ? 1 : 0, native ? 1 : 0).run();
    const updated = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE session_id=?1`).bind(id).first();
    return Response.json({ success: true, session: updated }, { headers: corsHeaders14 });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 400, headers: corsHeaders14 });
  }
}
__name(rendezvousReady, "rendezvousReady");
async function rendezvousResult(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await user(request, env, body);
    const state = ["CONNECTED", "FAILED", "CANCELLED"].includes(String(body.state || "")) ? String(body.state) : "FAILED";
    await env.DB.prepare(`UPDATE rendezvous_sessions SET state=?3, updated_at=datetime('now') WHERE session_id=?1 AND usuario_id=?2 AND (?4=source_device_uuid OR ?4=destination_device_uuid)`).bind(String(body.session_id || ""), account.id, state, deviceUuid).run();
    return Response.json({ success: true }, { headers: corsHeaders14 });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 400, headers: corsHeaders14 });
  }
}
__name(rendezvousResult, "rendezvousResult");

// src/realtime/nativeControlHub.js
var NativeControlHub = class {
  static {
    __name(this, "NativeControlHub");
  }
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const nativeUuid = String(request.headers.get("X-Ligron-Native") || "").trim();
    if (!nativeUuid) return new Response("Missing Native identity", { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [nativeUuid]);
    server.send(JSON.stringify({ type: "control.connected", native_uuid: nativeUuid }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async notify(event) {
    const payload = JSON.stringify({
      type: String(event?.type || "control.sync"),
      data: event?.data && typeof event.data === "object" ? event.data : {},
      at: (/* @__PURE__ */ new Date()).toISOString()
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }
  webSocketMessage(socket, message) {
    if (String(message) === "ping") socket.send("pong");
  }
};
async function notifyNativeControl(env, nativeUuid, type, data = {}) {
  if (!env.NATIVE_CONTROL_HUB || !nativeUuid) return;
  try {
    await env.NATIVE_CONTROL_HUB.getByName(String(nativeUuid)).notify({ type, data });
  } catch (error) {
    console.warn("Native control notification deferred:", error?.message || error);
  }
}
__name(notifyNativeControl, "notifyNativeControl");

// src/api/connectionRequests.js
var headers = { "Access-Control-Allow-Origin": "https://ligronair.tv", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
async function identity(request, env, body = null) {
  const url = new URL(request.url);
  const email = String(body?.email || url.searchParams.get("email") || "").trim().toLowerCase();
  const deviceUuid = String(body?.device_uuid || url.searchParams.get("device_uuid") || "").trim();
  const account = email && await findUserByEmail(env.DB, email);
  const device = account && deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
  if (!account || !device || Number(device.usuario_id) !== Number(account.id)) throw new Error("Dispositivo no autorizado.");
  return { account, device, deviceUuid };
}
__name(identity, "identity");
function privateV4(value) {
  const octets = String(value || "").split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168;
}
__name(privateV4, "privateV4");
function sameLan(left, right) {
  return privateV4(left) && privateV4(right) && left.split(".").slice(0, 3).join(".") === right.split(".").slice(0, 3).join(".");
}
__name(sameLan, "sameLan");
async function capabilities(env, uuid) {
  const row = await env.DB.prepare("SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1").bind(uuid).first();
  try {
    return JSON.parse(row?.capabilities_json || "{}");
  } catch {
    return {};
  }
}
__name(capabilities, "capabilities");
async function directCallerRoute(env, pi, native) {
  const [piCaps, nativeCaps] = await Promise.all([capabilities(env, pi.uuid), capabilities(env, native.uuid)]);
  const nativeV6 = String(nativeCaps.ipv6_address || "").trim();
  let host = "";
  let transport = "";
  const piTailnet = String(piCaps.tailscale_tailnet || "").trim().toLowerCase();
  const nativeTailnet = String(nativeCaps.tailscale_tailnet || "").trim().toLowerCase();
  const nativeTailscale = String(nativeCaps.tailscale_ipv4_address || "").trim();
  if (piCaps.tailscale_available === true && nativeCaps.tailscale_available === true && piTailnet && piTailnet === nativeTailnet && /^100\.(6[4-9]|[7-9]\d|1\d\d|2[0-5]\d)\./.test(nativeTailscale)) {
    host = nativeTailscale;
    transport = "TAILSCALE_DIRECT_CALLER";
  } else if (piCaps.srt_ipv6 === true && nativeCaps.srt_ipv6 === true && piCaps.ipv6_internet === true && nativeCaps.ipv6_internet === true && nativeV6) {
    host = nativeV6;
    transport = "IPV6_DIRECT_CALLER";
  } else {
    const piLan = String(piCaps.ipv4_address || "").trim();
    const nativeLan = String(nativeCaps.ipv4_address || "").trim();
    if (sameLan(piLan, nativeLan)) {
      host = nativeLan;
      transport = "LAN_DIRECT_CALLER";
    }
  }
  if (!host) transport = "NATIVE_PUBLIC_DIRECT";
  return { host, transport };
}
__name(directCallerRoute, "directCallerRoute");
async function connectionRequest(request, env) {
  try {
    const body = await request.json();
    const { account, device: pi, deviceUuid } = await identity(request, env, body);
    const nativeUuid = String(body.native_device_uuid || "").trim();
    const native = await findDeviceByUuid(env.DB, nativeUuid);
    if (!native || Number(native.usuario_id) !== Number(account.id) || !String(native.tipo || "").toLowerCase().includes("ligronair")) throw new Error("Destino Native no disponible.");
    const requestId = `conn_${crypto.randomUUID()}`;
    const route = await directCallerRoute(env, pi, native);
    await env.DB.prepare(`UPDATE connection_requests SET state='CANCELLED', updated_at=datetime('now') WHERE usuario_id=?1 AND pi_device_uuid=?2 AND native_device_uuid=?3 AND state IN ('PENDING','PI_READY','BOX_READY','CALLER_REQUIRED')`).bind(account.id, deviceUuid, nativeUuid).run();
    await env.DB.prepare(`UPDATE srt_destinos SET estado='FREE', reservado_por_uuid=NULL, ultima_actualizacion=datetime('now') WHERE usuario_id=?1 AND equipo_uuid=?2 AND reservado_por_uuid=?3 AND estado='RESERVED'`).bind(account.id, nativeUuid, deviceUuid).run();
    await env.DB.prepare(`INSERT INTO connection_requests (request_id, usuario_id, pi_device_uuid, native_device_uuid, host, port, requested_transport, active_transport, state, expires_at) VALUES (?1,?2,?3,?4,?5,NULL,'DIRECT_CALLER',?6,'PENDING',datetime('now','+90 seconds'))`).bind(requestId, account.id, deviceUuid, nativeUuid, route.host, route.transport).run();
    await notifyNativeControl(env, nativeUuid, "connection.requested", {
      request_id: requestId,
      pi_uuid: deviceUuid,
      transport: route.transport
    });
    return Response.json({ success: true, request: { request_id: requestId, state: "PENDING", destination_device_uuid: nativeUuid, host: route.host, port: 0, route: "DIRECT_CALLER", transport: route.transport } }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 400, headers });
  }
}
__name(connectionRequest, "connectionRequest");
async function connectionPoll(request, env) {
  try {
    const { account, deviceUuid } = await identity(request, env);
    const rows = await env.DB.prepare(`SELECT * FROM connection_requests WHERE usuario_id=?1 AND native_device_uuid=?2 AND datetime(expires_at)>datetime('now') AND state IN ('PENDING','BOX_READY','PI_READY','CALLER_REQUIRED') ORDER BY created_at ASC`).bind(account.id, deviceUuid).all();
    return Response.json({ success: true, requests: rows.results || [] }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 403, headers });
  }
}
__name(connectionPoll, "connectionPoll");
async function connectionClaim(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await identity(request, env, body);
    const requestId = String(body.request_id || "").trim();
    const sourceId = Number(body.source_id);
    if (!requestId || !Number.isInteger(sourceId)) throw new Error("Solicitud o caja inv\xE1lida.");
    const pending = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND native_device_uuid=?3 AND state IN ('PENDING','PI_READY') AND datetime(expires_at)>datetime('now')`).bind(requestId, account.id, deviceUuid).first();
    if (!pending) throw new Error("La solicitud ya no est\xE1 pendiente.");
    const receiver = await env.DB.prepare(`UPDATE srt_destinos SET estado='RESERVED', reservado_por_uuid=?1, ultima_actualizacion=datetime('now') WHERE equipo_uuid=?2 AND usuario_id=?3 AND source_id=?4 AND estado='FREE' RETURNING host, port, source_id, nombre`).bind(pending.pi_device_uuid, deviceUuid, account.id, sourceId).first();
    if (!receiver) throw new Error("La caja seleccionada ya no est\xE1 libre.");
    const targetHost = String(pending.host || receiver.host || "").trim();
    if (!targetHost || !receiver.port) {
      await env.DB.prepare(`UPDATE srt_destinos SET estado='FREE', reservado_por_uuid=NULL, ultima_actualizacion=datetime('now') WHERE equipo_uuid=?1 AND usuario_id=?2 AND source_id=?3 AND reservado_por_uuid=?4`).bind(deviceUuid, account.id, receiver.source_id, pending.pi_device_uuid).run();
      throw new Error("Native no ha publicado un endpoint SRT exterior ni una ruta Tailscale/LAN utilizable.");
    }
    const state = pending.state === "PI_READY" ? "CALLER_REQUIRED" : "BOX_READY";
    await env.DB.prepare(`UPDATE connection_requests SET source_id=?2, host=?3, port=?4, state=?5, updated_at=datetime('now') WHERE request_id=?1`).bind(requestId, receiver.source_id, targetHost, receiver.port, state).run();
    return Response.json({ success: true, request_id: requestId, source_id: receiver.source_id, host: targetHost, port: receiver.port, state }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 409, headers });
  }
}
__name(connectionClaim, "connectionClaim");
async function connectionStatus(request, env) {
  try {
    const { account, deviceUuid } = await identity(request, env);
    const id = new URL(request.url).searchParams.get("request_id");
    const row = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND pi_device_uuid=?3`).bind(String(id || ""), account.id, deviceUuid).first();
    if (!row) throw new Error("Solicitud no encontrada.");
    return Response.json({ success: true, request: row }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 404, headers });
  }
}
__name(connectionStatus, "connectionStatus");
async function connectionActivate(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await identity(request, env, body);
    const id = String(body.request_id || "");
    const row = await env.DB.prepare(`UPDATE connection_requests SET activation_requested=1, state='ACTIVATION_REQUESTED', updated_at=datetime('now') WHERE request_id=?1 AND usuario_id=?2 AND (?3=pi_device_uuid OR ?3=native_device_uuid) AND state='PENDING' RETURNING request_id`).bind(id, account.id, deviceUuid).first();
    if (!row) throw new Error("La solicitud no se puede activar.");
    return Response.json({ success: true, request_id: id, state: "ACTIVATION_REQUESTED" }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 409, headers });
  }
}
__name(connectionActivate, "connectionActivate");
async function connectionReady(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await identity(request, env, body);
    const requestId = String(body.request_id || "").trim();
    const row = await env.DB.prepare(`UPDATE connection_requests SET state='CALLER_REQUIRED', expires_at=datetime('now','+12 hours'), updated_at=datetime('now') WHERE request_id=?1 AND usuario_id=?2 AND pi_device_uuid=?3 AND state='BOX_READY' AND datetime(expires_at)>datetime('now') RETURNING request_id, native_device_uuid, source_id, host, port, state`).bind(requestId, account.id, deviceUuid).first();
    if (!row) throw new Error("La solicitud no est\xE1 disponible para iniciar la llamada.");
    await notifyNativeControl(env, row.native_device_uuid, "connection.caller_required", {
      request_id: row.request_id,
      source_id: row.source_id,
      host: row.host,
      port: row.port
    });
    return Response.json({ success: true, request: row }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 409, headers });
  }
}
__name(connectionReady, "connectionReady");
async function connectionCancel(request, env) {
  try {
    const body = await request.json();
    const { account, deviceUuid } = await identity(request, env, body);
    const requestId = String(body.request_id || "").trim();
    const row = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND pi_device_uuid=?3`).bind(requestId, account.id, deviceUuid).first();
    if (!row) throw new Error("Solicitud no encontrada.");
    await env.DB.batch([
      env.DB.prepare(`UPDATE connection_requests SET state='CANCELLED', updated_at=datetime('now') WHERE request_id=?1`).bind(requestId),
      env.DB.prepare(`UPDATE srt_destinos SET estado='FREE', reservado_por_uuid=NULL, ultima_actualizacion=datetime('now') WHERE usuario_id=?1 AND equipo_uuid=?2 AND reservado_por_uuid=?3 AND estado='RESERVED'`).bind(account.id, row.native_device_uuid, deviceUuid)
    ]);
    return Response.json({ success: true, request_id: requestId, state: "CANCELLED" }, { headers });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 404, headers });
  }
}
__name(connectionCancel, "connectionCancel");

// src/api/ligronTailBootstrap.js
var corsHeaders15 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function response(payload, status = 200) {
  return Response.json(payload, { status, headers: corsHeaders15 });
}
__name(response, "response");
function configuredValue(env, name) {
  return String(env[name] || "").trim();
}
__name(configuredValue, "configuredValue");
async function tailscaleAccessToken(clientId, clientSecret) {
  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  const tokenResponse = await fetch("https://api.tailscale.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!tokenResponse.ok) {
    throw new Error("No se pudo obtener autorizaci\xF3n de LigronTail.");
  }
  const token2 = await tokenResponse.json();
  if (!String(token2.access_token || "").startsWith("tskey-")) {
    throw new Error("La autorizaci\xF3n de LigronTail recibida no es v\xE1lida.");
  }
  return token2.access_token;
}
__name(tailscaleAccessToken, "tailscaleAccessToken");
function piHostname(deviceUuid) {
  return `ligronpi-${String(deviceUuid || "").replaceAll("-", "").slice(0, 8).toLowerCase()}`;
}
__name(piHostname, "piHostname");
async function revokeLigronTailDevice(env, deviceUuid) {
  const clientId = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_ID");
  const clientSecret = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_SECRET");
  const tailnet = configuredValue(env, "LIGRONTAIL_TAILNET").toLowerCase();
  const tag = configuredValue(env, "LIGRONTAIL_DEVICE_TAG").toLowerCase();
  if (!clientId || !clientSecret || !tailnet || !tag.startsWith("tag:")) {
    return { state: "NOT_CONFIGURED", removed: false };
  }
  try {
    const accessToken = await tailscaleAccessToken(clientId, clientSecret);
    const listing = await fetch(
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    if (!listing.ok) {
      return { state: "LIST_DENIED", removed: false };
    }
    const payload = await listing.json();
    const hostname = piHostname(deviceUuid);
    const matchingNodes = (Array.isArray(payload?.devices) ? payload.devices : []).filter((node) => {
      const nodeHostname = String(node?.hostname || "").toLowerCase();
      const nodeTags = Array.isArray(node?.tags) ? node.tags.map((item) => String(item).toLowerCase()) : [];
      return nodeHostname === hostname && (nodeTags.length === 0 || nodeTags.includes(tag));
    });
    if (!matchingNodes.length) {
      return { state: "NOT_FOUND", removed: false };
    }
    let removed = 0;
    for (const node of matchingNodes) {
      const nodeId = String(node?.id || "").trim();
      if (!nodeId) continue;
      const deletion = await fetch(
        `https://api.tailscale.com/api/v2/device/${encodeURIComponent(nodeId)}`,
        {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${accessToken}` }
        }
      );
      if (deletion.ok || deletion.status === 404) removed += 1;
    }
    return {
      state: removed === matchingNodes.length ? "REMOVED" : "DELETE_DENIED",
      removed: removed === matchingNodes.length,
      nodes: matchingNodes.length
    };
  } catch (error) {
    console.error("LigronTail revoke failed:", error?.message || error);
    return { state: "PROVIDER_UNAVAILABLE", removed: false };
  }
}
__name(revokeLigronTailDevice, "revokeLigronTailDevice");
async function ligronTailBootstrap(request, env) {
  try {
    if (request.method !== "POST") {
      return response({ success: false, error: "M\xE9todo no permitido." }, 405);
    }
    const body = await request.json();
    const deviceUuid = String(body.device_uuid || "").trim();
    const usesDeviceCredential = /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
    let device = null;
    if (usesDeviceCredential) {
      if (!deviceUuid || !await requireDeviceCredential(request, env.DB, deviceUuid, { touch: true })) {
        return response({ success: false, code: "DEVICE_AUTH_FAILED", error: "La credencial de esta Pi no es v\xE1lida." }, 401);
      }
      device = await findDeviceByUuid(env.DB, deviceUuid);
      if (!device) {
        return response({ success: false, code: "DEVICE_OWNERSHIP_FAILED", error: "El equipo no est\xE1 registrado." }, 403);
      }
      if (!String(device.tipo || "").toLowerCase().includes("ligronpi")) {
        return response({ success: false, code: "DEVICE_TYPE_NOT_ALLOWED", error: "S\xF3lo una Pi puede usar el alta aut\xF3noma de LigronTail." }, 403);
      }
    } else {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password || !deviceUuid) {
        return response({
          success: false,
          code: "BOOTSTRAP_INPUT_MISSING",
          error: "Debe validar la cuenta y el equipo antes de activar LigronTail."
        }, 400);
      }
      const account = await findUserByEmail(env.DB, email);
      const verification = account ? await verifyPassword(password, account.password_hash) : { valid: false, needsRehash: false };
      if (!verification.valid) {
        return response({
          success: false,
          code: "ACCOUNT_VALIDATION_FAILED",
          error: "No se pudo validar la cuenta para activar LigronTail."
        }, 401);
      }
      if (verification.needsRehash) {
        await updateUserPasswordHash(env.DB, account.id, await hashPassword(password));
      }
      device = await findDeviceByUuid(env.DB, deviceUuid);
      if (!device || Number(device.usuario_id) !== Number(account.id)) {
        return response({
          success: false,
          code: "DEVICE_OWNERSHIP_FAILED",
          error: "El equipo no pertenece a la cuenta autenticada."
        }, 403);
      }
    }
    const clientId = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_ID");
    const clientSecret = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_SECRET");
    const tailnet = configuredValue(env, "LIGRONTAIL_TAILNET").toLowerCase();
    const tag = configuredValue(env, "LIGRONTAIL_DEVICE_TAG").toLowerCase();
    if (!clientId || !clientSecret || !tailnet || !tag.startsWith("tag:")) {
      return response({
        success: false,
        code: "LIGRONTAIL_NOT_CONFIGURED",
        error: "LigronTail todav\xEDa no est\xE1 provisionado en el servidor."
      }, 503);
    }
    const accessToken = await tailscaleAccessToken(clientId, clientSecret);
    const keyResponse = await fetch(
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/keys`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          capabilities: {
            devices: {
              create: {
                reusable: false,
                ephemeral: false,
                preauthorized: true,
                tags: [tag]
              }
            }
          },
          expirySeconds: 600,
          description: `LigronAir ${String(device.tipo || "device")} ${deviceUuid.slice(0, 12)}`
        })
      }
    );
    if (!keyResponse.ok) {
      throw new Error("LigronTail no pudo crear la identidad temporal del equipo.");
    }
    const key = await keyResponse.json();
    const authKey = String(key.key || "");
    if (!authKey.startsWith("tskey-auth-")) {
      throw new Error("LigronTail no devolvi\xF3 una clave de equipo v\xE1lida.");
    }
    return response({
      success: true,
      tailnet,
      auth_key: authKey,
      expires_at: key.expires || null
    });
  } catch (error) {
    console.error("LigronTail bootstrap failed:", error?.message || error);
    return response({
      success: false,
      code: "LIGRONTAIL_PROVIDER_FAILED",
      error: "No se pudo preparar LigronTail para este equipo."
    }, 502);
  }
}
__name(ligronTailBootstrap, "ligronTailBootstrap");

// src/api/poolClaim.js
var corsHeaders16 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var PI_TYPES = /* @__PURE__ */ new Set(["ligronpi", "ligronpi native", "ligronpi_native"]);
var NATIVE_TYPES = /* @__PURE__ */ new Set(["ligronair", "ligronair native", "ligronair_native"]);
function response2(payload, status = 200) {
  return Response.json(payload, { status, headers: corsHeaders16 });
}
__name(response2, "response");
function typeAllowed(device, allowedTypes) {
  return allowedTypes.has(String(device?.tipo || "").trim().toLowerCase());
}
__name(typeAllowed, "typeAllowed");
function devicePresent(device) {
  if (String(device?.estado || "").trim().toUpperCase() !== "ONLINE") return false;
  const raw = String(device?.ultima_conexion || "").trim();
  if (!raw) return false;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const seenAt = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(seenAt) && seenAt <= Date.now() && Date.now() - seenAt <= 75e3;
}
__name(devicePresent, "devicePresent");
function isMissingPoolTable(error) {
  return String(error?.message || error).toLowerCase().includes("no such table: pool_switches");
}
__name(isMissingPoolTable, "isMissingPoolTable");
async function requirePoolSchema(db) {
  try {
    await db.prepare("SELECT id FROM pool_switches LIMIT 1").first();
    await db.prepare(`
            UPDATE pool_switches
            SET state='EXPIRED', error_message=COALESCE(error_message, 'La Pi no confirm\xF3 la operaci\xF3n a tiempo.'),
                updated_at=datetime('now')
            WHERE state IN ('STOPPING', 'ARMING') AND datetime(expires_at) <= datetime('now')
        `).run();
    return true;
  } catch (error) {
    if (isMissingPoolTable(error)) return false;
    throw error;
  }
}
__name(requirePoolSchema, "requirePoolSchema");
async function queuePiCommand(db, userId, nativeUuid, piUuid, command, payload) {
  const id = crypto.randomUUID();
  await db.prepare(`
        INSERT INTO device_remote_commands
            (id, usuario_id, sender_device_uuid, target_device_uuid, command, payload_json, expires_at)
        -- La Pi consulta \xF3rdenes cada 20 s y puede estar terminando el
        -- enrolamiento de Tail. Noventa segundos permit\xEDan que Pool caducase
        -- antes de la primera entrega tras una reconexi\xF3n.
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now','+3 minutes'))
    `).bind(
    id,
    userId,
    nativeUuid,
    piUuid,
    command,
    JSON.stringify(payload || {})
  ).run();
  return id;
}
__name(queuePiCommand, "queuePiCommand");
async function receiverForUpdate(db, userId, nativeUuid, sourceId) {
  return db.prepare(`
        SELECT s.id, s.equipo_uuid, s.source_id, s.nombre, s.host, s.port,
               s.estado, s.reservado_por_uuid, pi.alias AS reserved_by_alias
        FROM srt_destinos AS s
        LEFT JOIN equipos AS pi
          ON pi.uuid=s.reservado_por_uuid AND pi.usuario_id=s.usuario_id
        WHERE s.usuario_id=?1 AND s.equipo_uuid=?2 AND s.source_id=?3
        LIMIT 1
    `).bind(userId, nativeUuid, sourceId).first();
}
__name(receiverForUpdate, "receiverForUpdate");
async function otherReservationForPi(db, userId, piUuid, nativeUuid, sourceId) {
  return db.prepare(`
        SELECT s.equipo_uuid, s.source_id, s.nombre, native.alias AS native_alias
        FROM srt_destinos AS s
        LEFT JOIN equipos AS native
          ON native.uuid=s.equipo_uuid AND native.usuario_id=s.usuario_id
        WHERE s.usuario_id=?1
          AND s.reservado_por_uuid=?2
          AND s.estado='RESERVED'
          AND NOT (s.equipo_uuid=?3 AND s.source_id=?4)
        LIMIT 1
    `).bind(userId, piUuid, nativeUuid, sourceId).first();
}
__name(otherReservationForPi, "otherReservationForPi");
async function activeSwitchForReceiver(db, userId, nativeUuid, sourceId) {
  return db.prepare(`
        SELECT state FROM pool_switches
        WHERE usuario_id=?1 AND native_device_uuid=?2 AND source_id=?3
          AND state IN ('STOPPING', 'ARMING')
        LIMIT 1
    `).bind(userId, nativeUuid, sourceId).first();
}
__name(activeSwitchForReceiver, "activeSwitchForReceiver");
async function createArmingSwitch(db, values) {
  const id = crypto.randomUUID();
  await db.prepare(`
        INSERT INTO pool_switches
            (id, usuario_id, native_device_uuid, source_id, outgoing_pi_uuid,
             incoming_pi_uuid, start_command_id, state)
        VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, 'ARMING')
    `).bind(
    id,
    values.userId,
    values.nativeUuid,
    values.sourceId,
    values.incomingPiUuid,
    values.startCommandId
  ).run();
  return id;
}
__name(createArmingSwitch, "createArmingSwitch");
async function claimFreeReceiver(db, user2, native, pi, sourceId) {
  const assignment = await allocateSrtDestination(
    db,
    user2.id,
    pi.uuid,
    native.uuid,
    sourceId
  );
  if (!assignment) {
    return { error: "La v\xEDa ya no est\xE1 libre; actualiza Pool antes de reintentar.", status: 409 };
  }
  try {
    const startCommandId = await queuePiCommand(db, user2.id, native.uuid, pi.uuid, "pool_claim", {
      native_uuid: native.uuid,
      native_alias: native.alias || "LigronAir",
      source_id: sourceId
    });
    const switchId = await createArmingSwitch(db, {
      userId: user2.id,
      nativeUuid: native.uuid,
      sourceId,
      incomingPiUuid: pi.uuid,
      startCommandId
    });
    return { switchId, commandId: startCommandId };
  } catch (error) {
    await db.prepare(`
            UPDATE srt_destinos
            SET estado='FREE', reservado_por_uuid=NULL, ultima_actualizacion=datetime('now')
            WHERE usuario_id=?1 AND equipo_uuid=?2 AND source_id=?3
              AND estado='RESERVED' AND reservado_por_uuid=?4
        `).bind(user2.id, native.uuid, sourceId, pi.uuid).run();
    throw error;
  }
}
__name(claimFreeReceiver, "claimFreeReceiver");
async function poolClaim(request, env) {
  try {
    if (request.method !== "POST") {
      return response2({ success: false, error: "M\xE9todo no permitido." }, 405);
    }
    if (!await requirePoolSchema(env.DB)) {
      return response2({
        success: false,
        error: "Pool a\xFAn no est\xE1 activado en Link: falta aplicar create_pool_switches.sql. No se ha cambiado ninguna v\xEDa."
      }, 503);
    }
    const body = await request.json();
    const piUuid = String(body.pi_uuid || "").trim();
    const nativeUuid = String(body.native_uuid || "").trim();
    const sourceId = Number(body.source_id);
    const replace = body.replace === true;
    if (!piUuid || !nativeUuid || !Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50) {
      return response2({ success: false, error: "Solicitud Pool inv\xE1lida." }, 400);
    }
    const user2 = await requireUserSession(request, env.DB);
    if (!user2) return response2({ success: false, error: "Sesi\xF3n no v\xE1lida o caducada. Inicie sesi\xF3n de nuevo." }, 401);
    const [pi, native] = await Promise.all([
      findDeviceByUuid(env.DB, piUuid),
      findDeviceByUuid(env.DB, nativeUuid)
    ]);
    if (!pi || Number(pi.usuario_id) !== Number(user2.id) || !typeAllowed(pi, PI_TYPES)) {
      return response2({ success: false, error: "La fuente LigronPi no pertenece a esta cuenta." }, 403);
    }
    if (!native || Number(native.usuario_id) !== Number(user2.id) || !typeAllowed(native, NATIVE_TYPES)) {
      return response2({ success: false, error: "El receptor LigronAir no pertenece a esta cuenta." }, 403);
    }
    if (!devicePresent(pi)) return response2({ success: false, error: "La LigronPi no est\xE1 presente en Link." }, 409);
    if (!devicePresent(native)) return response2({ success: false, error: "El LigronAir Native no est\xE1 presente en Link." }, 409);
    const otherReservation = await otherReservationForPi(
      env.DB,
      user2.id,
      pi.uuid,
      native.uuid,
      sourceId
    );
    if (otherReservation) {
      const assignedNative = otherReservation.native_alias || "otro LigronAir";
      const assignedReceiver = otherReservation.nombre || `v\xEDa ${otherReservation.source_id}`;
      return response2({
        success: false,
        error: `${pi.alias || "La LigronPi"} ya est\xE1 reservada en ${assignedNative} \xB7 ${assignedReceiver}. Libera o cambia esa asignaci\xF3n antes de reclamarla aqu\xED.`
      }, 409);
    }
    const receiver = await receiverForUpdate(env.DB, user2.id, native.uuid, sourceId);
    if (!receiver || !Number(receiver.port)) {
      return response2({ success: false, error: "La v\xEDa solicitada no est\xE1 publicada por ese Native." }, 404);
    }
    const activeSwitch = await activeSwitchForReceiver(env.DB, user2.id, native.uuid, sourceId);
    if (activeSwitch) {
      return response2({
        success: false,
        state: activeSwitch.state,
        error: "Pool ya est\xE1 preparando un cambio para esta v\xEDa; espera su confirmaci\xF3n antes de solicitar otro."
      }, 409);
    }
    const currentState = String(receiver.estado || "OFFLINE").toUpperCase();
    if (currentState === "FREE") {
      const created = await claimFreeReceiver(env.DB, user2, native, pi, sourceId);
      if (created.error) return response2({ success: false, error: created.error }, created.status);
      return response2({
        success: true,
        state: "ARMING",
        switch_id: created.switchId,
        message: `${pi.alias || "LigronPi"} ha sido reclamada para ${native.alias || "LigronAir"} \xB7 v\xEDa ${sourceId}. Esperando confirmaci\xF3n de la Pi.`
      }, 202);
    }
    if (currentState === "RESERVED" && receiver.reservado_por_uuid === pi.uuid) {
      const startCommandId = await queuePiCommand(
        env.DB,
        user2.id,
        native.uuid,
        pi.uuid,
        "pool_claim",
        {
          native_uuid: native.uuid,
          native_alias: native.alias || "LigronAir",
          source_id: sourceId
        }
      );
      const switchId2 = await createArmingSwitch(env.DB, {
        userId: user2.id,
        nativeUuid: native.uuid,
        sourceId,
        incomingPiUuid: pi.uuid,
        startCommandId
      });
      return response2({
        success: true,
        state: "ARMING",
        switch_id: switchId2,
        message: "La v\xEDa ya pertenec\xEDa a esta LigronPi; se ha reenviado la confirmaci\xF3n de arranque."
      }, 202);
    }
    if (currentState === "BUSY" || currentState === "OFFLINE") {
      const reason = currentState === "BUSY" ? "La v\xEDa est\xE1 ocupada por una se\xF1al externa o por un origen que Link no puede detener con seguridad." : "La v\xEDa no est\xE1 operativa en este momento.";
      return response2({ success: false, error: reason, state: currentState }, 409);
    }
    if (currentState !== "RESERVED" || !receiver.reservado_por_uuid) {
      return response2({ success: false, error: "El estado de la v\xEDa no permite una asignaci\xF3n segura." }, 409);
    }
    if (!replace) {
      return response2({
        success: false,
        approval_required: true,
        state: "RESERVED",
        current_owner_alias: receiver.reserved_by_alias || "LigronPi sin alias",
        error: `La v\xEDa est\xE1 reservada por ${receiver.reserved_by_alias || "otra LigronPi"}. Confirma la sustituci\xF3n para detener su emisi\xF3n antes de reclamarla.`
      }, 409);
    }
    const outgoing = await findDeviceByUuid(env.DB, receiver.reservado_por_uuid);
    if (!outgoing || Number(outgoing.usuario_id) !== Number(user2.id) || !typeAllowed(outgoing, PI_TYPES) || !devicePresent(outgoing)) {
      return response2({
        success: false,
        error: "La v\xEDa est\xE1 reservada por una Pi que ya no est\xE1 presente; Pool no la sustituye autom\xE1ticamente. Libera o revisa la reserva desde Link."
      }, 409);
    }
    const switchId = crypto.randomUUID();
    const stopCommandId = await queuePiCommand(env.DB, user2.id, native.uuid, outgoing.uuid, "stream_stop", {});
    await env.DB.prepare(`
            INSERT INTO pool_switches
                (id, usuario_id, native_device_uuid, source_id, outgoing_pi_uuid,
                 incoming_pi_uuid, stop_command_id, state)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'STOPPING')
        `).bind(
      switchId,
      user2.id,
      native.uuid,
      sourceId,
      outgoing.uuid,
      pi.uuid,
      stopCommandId
    ).run();
    return response2({
      success: true,
      state: "STOPPING",
      switch_id: switchId,
      message: `Se ha solicitado detener ${outgoing.alias || "la Pi actual"}. La nueva fuente s\xF3lo se preparar\xE1 tras su confirmaci\xF3n.`
    }, 202);
  } catch (error) {
    console.error("Pool claim:", error);
    return response2({ success: false, error: String(error?.message || error) }, 500);
  }
}
__name(poolClaim, "poolClaim");
async function advancePoolSwitch(env, userId, commandId, commandState, resultMessage = "") {
  let switchRow;
  try {
    switchRow = await env.DB.prepare(`
            SELECT * FROM pool_switches
            WHERE usuario_id=?1
              AND (stop_command_id=?2 OR start_command_id=?2)
              AND state IN ('STOPPING', 'ARMING')
            LIMIT 1
        `).bind(userId, commandId).first();
  } catch (error) {
    if (isMissingPoolTable(error)) return;
    throw error;
  }
  if (!switchRow) return;
  const completed = String(commandState || "").toUpperCase() === "COMPLETED";
  const fail = /* @__PURE__ */ __name(async (message) => env.DB.prepare(`
        UPDATE pool_switches
        SET state='FAILED', error_message=?1, updated_at=datetime('now')
        WHERE id=?2 AND usuario_id=?3
    `).bind(String(message || "No confirmado").slice(0, 500), switchRow.id, userId).run(), "fail");
  if (switchRow.state === "STOPPING" && switchRow.stop_command_id === commandId) {
    if (!completed) {
      await fail(`La Pi saliente no confirm\xF3 la detenci\xF3n: ${resultMessage}`);
      return;
    }
    const moved = await env.DB.prepare(`
            UPDATE srt_destinos
            SET reservado_por_uuid=?1, estado='RESERVED', ultima_actualizacion=datetime('now')
            WHERE usuario_id=?2 AND equipo_uuid=?3 AND source_id=?4
              AND estado='RESERVED' AND reservado_por_uuid=?5
        `).bind(
      switchRow.incoming_pi_uuid,
      userId,
      switchRow.native_device_uuid,
      switchRow.source_id,
      switchRow.outgoing_pi_uuid
    ).run();
    if (Number(moved.meta?.changes || 0) !== 1) {
      await fail("La v\xEDa cambi\xF3 de estado mientras se deten\xEDa la fuente anterior.");
      return;
    }
    const native = await findDeviceByUuid(env.DB, switchRow.native_device_uuid);
    const startCommandId = await queuePiCommand(
      env.DB,
      userId,
      switchRow.native_device_uuid,
      switchRow.incoming_pi_uuid,
      "pool_claim",
      {
        native_uuid: switchRow.native_device_uuid,
        native_alias: native?.alias || "LigronAir",
        source_id: Number(switchRow.source_id)
      }
    );
    await env.DB.prepare(`
            UPDATE pool_switches
            SET state='ARMING', start_command_id=?1, updated_at=datetime('now')
            WHERE id=?2 AND usuario_id=?3 AND state='STOPPING'
        `).bind(startCommandId, switchRow.id, userId).run();
    return;
  }
  if (switchRow.state === "ARMING" && switchRow.start_command_id === commandId) {
    if (!completed) {
      await fail(`La Pi entrante no confirm\xF3 el arranque: ${resultMessage}`);
      return;
    }
    await env.DB.prepare(`
            UPDATE pool_switches
            SET state='ACTIVE', error_message=NULL, updated_at=datetime('now')
            WHERE id=?1 AND usuario_id=?2 AND state='ARMING'
        `).bind(switchRow.id, userId).run();
  }
}
__name(advancePoolSwitch, "advancePoolSwitch");

// src/api/deviceCommands.js
var corsHeaders17 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var ALLOWED_COMMANDS = /* @__PURE__ */ new Set([
  "stream_start",
  "stream_stop",
  "pipeline_restart",
  "wifi_scan",
  "status_refresh",
  "bond_set",
  "stream_tune",
  "pool_claim",
  // Soporte remoto con acciones cerradas. La Pi inicia siempre la conexión
  // HTTPS; no se expone SSH, shell ni parámetros de sistema por Link.
  "support_tail_retry",
  "support_diagnostics"
]);
function response3(payload, status = 200) {
  return Response.json(payload, { status, headers: corsHeaders17 });
}
__name(response3, "response");
async function credentialDevice(env, request, uuidValue) {
  const uuid = String(uuidValue || "").trim();
  if (!uuid) return { error: "Debe indicar el UUID de equipo.", status: 400 };
  const credential = await requireDeviceCredential(request, env.DB, uuid);
  if (!credential) return { error: "Credencial de equipo no v\xE1lida.", status: 401 };
  const device = await findDeviceByUuid(env.DB, uuid);
  if (!device) return { error: "Equipo no encontrado.", status: 404 };
  const user2 = await env.DB.prepare(`
        SELECT id, email, nombre, estado FROM usuarios
        WHERE id=?1 AND UPPER(COALESCE(estado, 'ACTIVO'))='ACTIVO'
        LIMIT 1
    `).bind(device.usuario_id).first();
  if (!user2) return { error: "La cuenta operativa del equipo no est\xE1 disponible.", status: 403 };
  return { user: user2, device, uuid };
}
__name(credentialDevice, "credentialDevice");
function hasDeviceAuthorization(request) {
  return /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
}
__name(hasDeviceAuthorization, "hasDeviceAuthorization");
async function authenticatedDevice(env, request, uuidValue) {
  const uuid = String(uuidValue || "").trim();
  if (!uuid) return { error: "Debe indicar el UUID de equipo.", status: 400 };
  if (hasDeviceAuthorization(request)) {
    return credentialDevice(env, request, uuid);
  }
  const user2 = await requireUserSession(request, env.DB);
  if (!user2) return { error: "Se necesita una sesi\xF3n o credencial de equipo v\xE1lida.", status: 401 };
  const device = await findDeviceByUuid(env.DB, uuid);
  if (!device || Number(device.usuario_id) !== Number(user2.id)) {
    return { error: "Equipo no disponible para esta sesi\xF3n.", status: 403 };
  }
  return { user: user2, device, uuid };
}
__name(authenticatedDevice, "authenticatedDevice");
function isNative(device) {
  return ["ligronair", "ligronair native", "ligronair_native"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isNative, "isNative");
async function deviceCommands(request, env) {
  try {
    if (request.method === "POST") {
      const body = await request.json();
      const sender = await authenticatedDevice(env, request, body.device_uuid);
      if (sender.error) return response3({ success: false, error: sender.error }, sender.status);
      if (!isNative(sender.device)) {
        return response3({ success: false, error: "S\xF3lo un LigronAir Native puede enviar \xF3rdenes remotas." }, 403);
      }
      const targetUuid = String(body.target_device_uuid || "").trim();
      const command = String(body.command || "").trim().toLowerCase();
      if (!targetUuid || !ALLOWED_COMMANDS.has(command)) {
        return response3({ success: false, error: "Orden remota no permitida." }, 400);
      }
      const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
      if (command === "bond_set" && (!/^[A-Za-z0-9_.:-]{1,64}$/.test(String(payload.interface_key || "")) || typeof payload.enabled !== "boolean")) {
        return response3({ success: false, error: "Cambio de bonding inv\xE1lido." }, 400);
      }
      if (command === "stream_tune" && (!Number.isInteger(payload.bitrate_kbps) || payload.bitrate_kbps < 500 || payload.bitrate_kbps > 12e3 || !Number.isInteger(payload.latency_ms) || payload.latency_ms < 50 || payload.latency_ms > 2e3)) {
        return response3({ success: false, error: "Bitrate o latencia fuera del rango operativo." }, 400);
      }
      const target = await findDeviceByUuid(env.DB, targetUuid);
      if (!target || Number(target.usuario_id) !== Number(sender.user.id)) {
        return response3({ success: false, error: "Pi remota no disponible para esta cuenta." }, 404);
      }
      const pair = await env.DB.prepare(`
                SELECT 'RESERVATION' AS proof
                WHERE EXISTS (
                    SELECT 1 FROM srt_destinos
                    WHERE usuario_id=?1 AND equipo_uuid=?2
                      AND reservado_por_uuid=?3 AND estado='RESERVED'
                )
                UNION ALL
                SELECT 'ACTIVE_TAIL_SESSION' AS proof
                WHERE EXISTS (
                    SELECT 1
                    FROM device_runtime_status AS r
                    JOIN equipos AS pi
                      ON pi.uuid=r.device_uuid AND pi.usuario_id=r.usuario_id
                    WHERE r.usuario_id=?1
                      AND r.device_uuid=?3
                      AND r.target_device_uuid=?2
                      AND r.streaming=1
                      AND UPPER(pi.estado)='ONLINE'
                      AND datetime(pi.ultima_conexion)>=datetime('now','-75 seconds')
                      AND datetime(r.ultima_actualizacion)>=datetime('now','-75 seconds')
                )
                LIMIT 1
            `).bind(sender.user.id, sender.uuid, targetUuid).first();
      const isSupportCommand = command === "support_tail_retry" || command === "support_diagnostics";
      if (!pair && !isSupportCommand) {
        return response3({ success: false, error: "La Pi no est\xE1 asociada a una caja de este Native." }, 409);
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(`
                INSERT INTO device_remote_commands
                    (id, usuario_id, sender_device_uuid, target_device_uuid, command, payload_json, expires_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now','+3 minutes'))
            `).bind(id, sender.user.id, sender.uuid, targetUuid, command, JSON.stringify(payload)).run();
      return response3({ success: true, command_id: id, state: "PENDING" });
    }
    if (request.method === "GET") {
      const url = new URL(request.url);
      const receiver = await authenticatedDevice(env, request, url.searchParams.get("device_uuid"));
      if (receiver.error) return response3({ success: false, error: receiver.error }, receiver.status);
      const rows = await env.DB.prepare(`
                SELECT id, command, payload_json, created_at FROM device_remote_commands
                WHERE usuario_id=?1 AND target_device_uuid=?2 AND state='PENDING'
                  AND datetime(expires_at) > datetime('now')
                ORDER BY created_at ASC LIMIT 4
            `).bind(receiver.user.id, receiver.uuid).all();
      return response3({ success: true, commands: rows.results || [] });
    }
    return response3({ success: false, error: "M\xE9todo no permitido." }, 405);
  } catch (error) {
    return response3({ success: false, error: String(error?.message || error) }, 500);
  }
}
__name(deviceCommands, "deviceCommands");
async function deviceCommandResult(request, env) {
  try {
    if (request.method !== "POST") return response3({ success: false, error: "M\xE9todo no permitido." }, 405);
    const body = await request.json();
    const receiver = await authenticatedDevice(env, request, body.device_uuid);
    if (receiver.error) return response3({ success: false, error: receiver.error }, receiver.status);
    const id = String(body.command_id || "").trim();
    const state = String(body.state || "").trim().toUpperCase();
    const result = String(body.result || "").trim().slice(0, 500);
    if (!id || !["COMPLETED", "FAILED"].includes(state)) {
      return response3({ success: false, error: "Resultado remoto inv\xE1lido." }, 400);
    }
    const updated = await env.DB.prepare(`
            UPDATE device_remote_commands
            SET state=?1, result_message=?2, completed_at=datetime('now')
            WHERE id=?3 AND usuario_id=?4 AND target_device_uuid=?5 AND state='PENDING'
        `).bind(state, result, id, receiver.user.id, receiver.uuid).run();
    const changed = Number(updated.meta?.changes || 0) > 0;
    if (changed) {
      await advancePoolSwitch(env, receiver.user.id, id, state, result);
    }
    return response3({ success: true, updated: changed });
  } catch (error) {
    return response3({ success: false, error: String(error?.message || error) }, 500);
  }
}
__name(deviceCommandResult, "deviceCommandResult");

// src/api/deviceCredential.js
var headers2 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
function isLigronPi2(device) {
  return ["ligronpi", "ligronpi native", "ligronpi_native"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isLigronPi2, "isLigronPi");
async function deviceCredential(request, env) {
  try {
    const user2 = await requireUserSession(request, env.DB);
    if (!user2) {
      return Response.json({ success: false, error: "Sesi\xF3n no v\xE1lida o caducada." }, { status: 401, headers: headers2 });
    }
    const body = await request.json();
    const deviceUuid = String(body.device_uuid || "").trim();
    const device = deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
    if (!device || Number(device.usuario_id) !== Number(user2.id) || !isLigronPi2(device)) {
      return Response.json({ success: false, error: "LigronPi no autorizada para esta cuenta." }, { status: 403, headers: headers2 });
    }
    if (request.method === "DELETE") {
      const revoked = await revokeDeviceCredential(env.DB, deviceUuid);
      const ligronTail = await revokeLigronTailDevice(env, deviceUuid);
      return Response.json({ success: true, revoked, ligron_tail: ligronTail }, { headers: headers2 });
    }
    return Response.json({
      success: false,
      error: "La credencial de LigronPi se renueva autom\xE1ticamente desde la Pi; ya no se puede copiar desde el panel."
    }, { status: 410, headers: headers2 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers2 });
  }
}
__name(deviceCredential, "deviceCredential");

// src/api/deviceBootstrap.js
var headers3 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
async function deviceBootstrap(request, env) {
  try {
    const url = new URL(request.url);
    const deviceUuid = String(url.searchParams.get("device_uuid") || "").trim();
    const credential = await requireDeviceCredential(request, env.DB, deviceUuid, { touch: true });
    const device = credential && await findDeviceByUuid(env.DB, deviceUuid);
    if (!device || !String(device.tipo || "").trim().toLowerCase().includes("ligronpi")) {
      return Response.json({ success: false, error: "Credencial de LigronPi no v\xE1lida." }, { status: 401, headers: headers3 });
    }
    const owner = await env.DB.prepare(`
            SELECT id, email, nombre, estado FROM usuarios WHERE id=?1 LIMIT 1
        `).bind(device.usuario_id).first();
    if (!owner || String(owner.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
      return Response.json({ success: false, error: "La cuenta operativa de la Pi no est\xE1 disponible." }, { status: 403, headers: headers3 });
    }
    return Response.json({
      success: true,
      device: { uuid: device.uuid, alias: device.alias, tipo: device.tipo },
      account: { email: owner.email, nombre: owner.nombre }
    }, { headers: headers3 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers3 });
  }
}
__name(deviceBootstrap, "deviceBootstrap");

// src/api/deviceAuthorization.js
var headers4 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
function isLigronPi3(device) {
  return ["ligronpi", "ligronpi native", "ligronpi_native"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isLigronPi3, "isLigronPi");
async function deviceAuthorization(request, env) {
  try {
    const user2 = await requireUserSession(request, env.DB);
    if (!user2) {
      return Response.json({ success: false, error: "Sesi\xF3n no v\xE1lida o caducada." }, { status: 401, headers: headers4 });
    }
    const body = await request.json();
    const deviceUuid = String(body.device_uuid || "").trim();
    const device = deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
    if (!device || Number(device.usuario_id) !== Number(user2.id) || !isLigronPi3(device)) {
      return Response.json({ success: false, error: "LigronPi no autorizada para esta cuenta." }, { status: 403, headers: headers4 });
    }
    const recovery = await env.DB.prepare(`
            SELECT device_uuid FROM device_recovery_credentials
            WHERE device_uuid=?1 AND revoked_at IS NULL
            LIMIT 1
        `).bind(deviceUuid).first();
    if (!recovery) {
      return Response.json({
        success: false,
        code: "RECOVERY_IDENTITY_MISSING",
        error: "Esta Pi necesita completar una vinculaci\xF3n de Link una sola vez antes de poder autorizar recuperaciones autom\xE1ticas."
      }, { status: 409, headers: headers4 });
    }
    await env.DB.prepare(`
            INSERT INTO device_recovery_authorizations
                (device_uuid, authorized_by_user_id, created_at, expires_at)
            VALUES (?1, ?2, datetime('now'), datetime('now', '+10 minutes'))
            ON CONFLICT(device_uuid) DO UPDATE SET
                authorized_by_user_id=excluded.authorized_by_user_id,
                created_at=datetime('now'),
                expires_at=datetime('now', '+10 minutes'),
                consumed_at=NULL
        `).bind(deviceUuid, user2.id).run();
    return Response.json({
      success: true,
      state: "AUTHORIZED",
      expires_in_seconds: 600
    }, { headers: headers4 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers4 });
  }
}
__name(deviceAuthorization, "deviceAuthorization");

// src/api/deviceRecovery.js
var headers5 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
function isLigronPi4(device) {
  return ["ligronpi", "ligronpi native", "ligronpi_native"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isLigronPi4, "isLigronPi");
function newToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(newToken, "newToken");
async function deviceRecovery(request, env) {
  try {
    const body = await request.json();
    const deviceUuid = String(body.device_uuid || "").trim();
    const recovery = await requireDeviceRecoveryCredential(request, env.DB, deviceUuid);
    const device = recovery && await findDeviceByUuid(env.DB, deviceUuid);
    if (!device || !isLigronPi4(device)) {
      return Response.json({
        success: false,
        code: "RECOVERY_AUTH_FAILED",
        error: "La identidad de recuperaci\xF3n de esta Pi no es v\xE1lida."
      }, { status: 401, headers: headers5 });
    }
    const claim = await env.DB.prepare(`
            UPDATE device_recovery_authorizations
            SET consumed_at=datetime('now')
            WHERE device_uuid=?1
              AND consumed_at IS NULL
              AND datetime(expires_at) > datetime('now')
        `).bind(deviceUuid).run();
    if (Number(claim.meta?.changes || 0) !== 1) {
      return Response.json({
        success: false,
        code: "OWNER_AUTHORIZATION_REQUIRED",
        error: "Esta Pi espera la autorizaci\xF3n del propietario en LigronLink."
      }, { status: 403, headers: headers5 });
    }
    const deviceCredential2 = newToken();
    await env.DB.batch([
      env.DB.prepare(`
                INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
                VALUES (?1, ?2, datetime('now'), datetime('now'), NULL)
                ON CONFLICT(device_uuid) DO UPDATE SET
                    token_hash=excluded.token_hash,
                    created_at=datetime('now'),
                    last_used_at=datetime('now'),
                    revoked_at=NULL
            `).bind(deviceUuid, await credentialHash(deviceCredential2)),
      env.DB.prepare(`
                UPDATE device_recovery_credentials
                SET last_used_at=datetime('now')
                WHERE device_uuid=?1
            `).bind(deviceUuid)
      // Conservamos la autorización consumida como auditoría breve.
      // `consumed_at` ya bloqueó cualquier segundo canje.
    ]);
    return Response.json({ success: true, device_credential: deviceCredential2 }, { headers: headers5 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers5 });
  }
}
__name(deviceRecovery, "deviceRecovery");
async function deviceRecoveryIdentity(request, env) {
  try {
    const body = await request.json();
    const deviceUuid = String(body.device_uuid || "").trim();
    const credential = await requireDeviceCredential(request, env.DB, deviceUuid, { touch: true });
    const device = credential && await findDeviceByUuid(env.DB, deviceUuid);
    if (!device || !isLigronPi4(device)) {
      return Response.json({
        success: false,
        code: "DEVICE_AUTH_FAILED",
        error: "La credencial de esta Pi no es v\xE1lida."
      }, { status: 401, headers: headers5 });
    }
    const recoveryCredential = await issueDeviceRecoveryCredential(env.DB, deviceUuid);
    return Response.json({ success: true, recovery_credential: recoveryCredential }, { headers: headers5 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers5 });
  }
}
__name(deviceRecoveryIdentity, "deviceRecoveryIdentity");

// src/api/devicePairing.js
var headers6 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
function token(bytes = 24) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(token, "token");
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
__name(isUuid, "isUuid");
function isSecret(value) {
  return /^[A-Za-z0-9_-]{32,}$/.test(value);
}
__name(isSecret, "isSecret");
function isLigronPi5(type) {
  return ["ligronpi", "ligronpi native", "ligronpi_native"].includes(String(type || "").trim().toLowerCase());
}
__name(isLigronPi5, "isLigronPi");
async function pairingOwner(request, env) {
  const user2 = await requireUserSession(request, env.DB);
  if (!user2) {
    return { error: Response.json({ success: false, error: "Sesi\xF3n no v\xE1lida o caducada." }, { status: 401, headers: headers6 }) };
  }
  return { user: user2 };
}
__name(pairingOwner, "pairingOwner");
async function pairingRequest(request, env) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const deviceUuid = String(body.device_uuid || "").trim();
    const alias = String(body.alias || "LigronPi").trim().slice(0, 120) || "LigronPi";
    const deviceType = String(body.tipo || "LigronPi").trim();
    const secret = String(body.pairing_secret || "").trim();
    if (!email || !isUuid(deviceUuid) || !isLigronPi5(deviceType) || !isSecret(secret)) {
      return Response.json({ success: false, error: "Solicitud de vinculaci\xF3n de Pi inv\xE1lida." }, { status: 400, headers: headers6 });
    }
    const owner = await findUserByEmail(env.DB, email);
    if (!owner || String(owner.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
      return Response.json({ success: false, error: "La cuenta indicada no puede vincular esta Pi." }, { status: 404, headers: headers6 });
    }
    const existingDevice = await findDeviceByUuid(env.DB, deviceUuid);
    if (existingDevice && Number(existingDevice.usuario_id) !== Number(owner.id)) {
      return Response.json({ success: false, error: "Esta Pi pertenece a otra cuenta." }, { status: 409, headers: headers6 });
    }
    const secretHash = await credentialHash(secret);
    const existing = await env.DB.prepare(`
            SELECT pairing_id, state, expires_at, consumed_at
            FROM device_pairings
            WHERE device_uuid=?1 AND owner_user_id=?2 AND pairing_hash=?3
            LIMIT 1
        `).bind(deviceUuid, owner.id, secretHash).first();
    if (existing && !existing.consumed_at && String(existing.expires_at) > (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")) {
      return Response.json({ success: true, pairing_id: existing.pairing_id, state: existing.state, expires_at: existing.expires_at }, { headers: headers6 });
    }
    const pairingId = `pair_${token()}`;
    const capabilities2 = body.network_capabilities && typeof body.network_capabilities === "object" ? JSON.stringify(body.network_capabilities) : null;
    await env.DB.prepare(`
            INSERT INTO device_pairings
                (pairing_id, device_uuid, owner_user_id, device_type, device_alias, pairing_hash, capabilities_json, state, created_at, expires_at, approved_at, consumed_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'PENDING', datetime('now'), datetime('now', '+15 minutes'), NULL, NULL)
            ON CONFLICT(device_uuid) DO UPDATE SET
                pairing_id=excluded.pairing_id,
                owner_user_id=excluded.owner_user_id,
                device_type=excluded.device_type,
                device_alias=excluded.device_alias,
                pairing_hash=excluded.pairing_hash,
                capabilities_json=excluded.capabilities_json,
                state='PENDING',
                created_at=datetime('now'),
                expires_at=datetime('now', '+15 minutes'),
                approved_at=NULL,
                consumed_at=NULL
        `).bind(pairingId, deviceUuid, owner.id, deviceType, alias, secretHash, capabilities2).run();
    return Response.json({ success: true, pairing_id: pairingId, state: "PENDING", expires_in_seconds: 900 }, { headers: headers6 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers6 });
  }
}
__name(pairingRequest, "pairingRequest");
async function pairingList(request, env) {
  const auth = await pairingOwner(request, env);
  if (auth.error) return auth.error;
  try {
    const rows = await env.DB.prepare(`
            SELECT pairing_id, device_uuid, device_alias, created_at, expires_at, state
            FROM device_pairings
            WHERE owner_user_id=?1 AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
            ORDER BY created_at DESC
        `).bind(auth.user.id).all();
    return Response.json({ success: true, pairings: rows.results || [] }, { headers: headers6 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers6 });
  }
}
__name(pairingList, "pairingList");
async function pairingApprove(request, env, pairingId) {
  const auth = await pairingOwner(request, env);
  if (auth.error) return auth.error;
  try {
    const pairing = await env.DB.prepare(`
            SELECT * FROM device_pairings
            WHERE pairing_id=?1 AND owner_user_id=?2 AND state='PENDING'
              AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
            LIMIT 1
        `).bind(pairingId, auth.user.id).first();
    if (!pairing) {
      return Response.json({ success: false, error: "La solicitud de vinculaci\xF3n ya no est\xE1 disponible." }, { status: 404, headers: headers6 });
    }
    const existingDevice = await findDeviceByUuid(env.DB, pairing.device_uuid);
    if (existingDevice && Number(existingDevice.usuario_id) !== Number(auth.user.id)) {
      return Response.json({ success: false, error: "Esta Pi pertenece a otra cuenta." }, { status: 409, headers: headers6 });
    }
    await registerOrUpdateDevice(env.DB, {
      usuarioId: auth.user.id,
      tipo: pairing.device_type,
      alias: pairing.device_alias,
      uuid: pairing.device_uuid,
      publicIp: null,
      ultimaConexion: (/* @__PURE__ */ new Date()).toISOString(),
      estado: "ONLINE"
    });
    if (pairing.capabilities_json) {
      try {
        await env.DB.prepare(`INSERT INTO device_network_capabilities (device_uuid, capabilities_json, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(device_uuid) DO UPDATE SET capabilities_json=excluded.capabilities_json, updated_at=datetime('now')`).bind(pairing.device_uuid, pairing.capabilities_json).run();
      } catch (_) {
      }
    }
    await env.DB.prepare(`
            UPDATE device_pairings
            SET state='APPROVED', approved_at=datetime('now')
            WHERE pairing_id=?1 AND state='PENDING' AND consumed_at IS NULL
        `).bind(pairingId).run();
    return Response.json({ success: true, state: "APPROVED" }, { headers: headers6 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers6 });
  }
}
__name(pairingApprove, "pairingApprove");
async function pairingComplete(request, env) {
  try {
    const body = await request.json();
    const pairingId = String(body.pairing_id || "").trim();
    const deviceUuid = String(body.device_uuid || "").trim();
    const secret = String(body.pairing_secret || "").trim();
    if (!/^pair_[A-Za-z0-9_-]{24,}$/.test(pairingId) || !isUuid(deviceUuid) || !isSecret(secret)) {
      return Response.json({ success: false, error: "Confirmaci\xF3n de vinculaci\xF3n inv\xE1lida." }, { status: 400, headers: headers6 });
    }
    const pairing = await env.DB.prepare(`
            SELECT state, expires_at, consumed_at
            FROM device_pairings
            WHERE pairing_id=?1 AND device_uuid=?2 AND pairing_hash=?3
            LIMIT 1
        `).bind(pairingId, deviceUuid, await credentialHash(secret)).first();
    if (!pairing) {
      return Response.json({ success: false, error: "La solicitud de vinculaci\xF3n no es v\xE1lida." }, { status: 401, headers: headers6 });
    }
    if (pairing.consumed_at || String(pairing.state) === "CONSUMED") {
      return Response.json({ success: false, code: "PAIRING_ALREADY_CONSUMED", error: "La vinculaci\xF3n ya fue consumida; solicita una nueva si la Pi no termin\xF3 de configurarse." }, { status: 409, headers: headers6 });
    }
    if (String(pairing.expires_at) <= (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")) {
      return Response.json({ success: false, code: "PAIRING_EXPIRED", error: "La solicitud de vinculaci\xF3n ha caducado." }, { status: 410, headers: headers6 });
    }
    if (String(pairing.state) !== "APPROVED") {
      return Response.json({ success: true, state: "PENDING" }, { headers: headers6 });
    }
    const claim = await env.DB.prepare(`
            UPDATE device_pairings
            SET state='CONSUMED', consumed_at=datetime('now')
            WHERE pairing_id=?1 AND state='APPROVED' AND consumed_at IS NULL
              AND datetime(expires_at) > datetime('now')
        `).bind(pairingId).run();
    if (Number(claim.meta?.changes || 0) !== 1) {
      return Response.json({ success: true, state: "PENDING" }, { headers: headers6 });
    }
    const identity2 = await issueDeviceIdentity(env.DB, deviceUuid);
    return Response.json({
      success: true,
      state: "ACTIVE",
      device_credential: identity2.deviceCredential,
      recovery_credential: identity2.recoveryCredential
    }, { headers: headers6 });
  } catch (error) {
    return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers: headers6 });
  }
}
__name(pairingComplete, "pairingComplete");

// src/api/deviceUpdates.js
var corsHeaders18 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LigronPi-Version, X-LigronPi-Channel, X-LigronPi-Sha256, X-LigronPi-Package-Size"
};
var SHA256 = /^[a-f0-9]{64}$/i;
var VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var CHANNEL = /^[a-z][a-z0-9_-]{0,31}$/;
var MAX_PACKAGE_BYTES = 95 * 1024 * 1024;
var RETAIN_INACTIVE_RELEASES = 2;
function response4(payload, status = 200) {
  return Response.json(payload, { status, headers: corsHeaders18 });
}
__name(response4, "response");
function isPi(device) {
  return ["ligronpi", "ligronpi v2", "ligron_pi"].includes(String(device?.tipo || "").trim().toLowerCase());
}
__name(isPi, "isPi");
async function authenticatedPi(env, request, uuidValue) {
  const uuid = String(uuidValue || "").trim();
  if (!uuid) return { error: "Debe indicar el UUID de LigronPi.", status: 400 };
  const credential = await requireDeviceCredential(request, env.DB, uuid);
  if (!credential) return { error: "Credencial de LigronPi no v\xE1lida.", status: 401 };
  const device = await findDeviceByUuid(env.DB, uuid);
  if (!device || !isPi(device)) return { error: "LigronPi no encontrada.", status: 404 };
  return { uuid, device };
}
__name(authenticatedPi, "authenticatedPi");
function validReleaseInput(version, channel, packageHash, packageSize) {
  return VERSION.test(version) && CHANNEL.test(channel) && channel === "development" && SHA256.test(packageHash) && Number.isSafeInteger(packageSize) && packageSize > 0 && packageSize <= MAX_PACKAGE_BYTES;
}
__name(validReleaseInput, "validReleaseInput");
function releaseObjectKey(userId, packageHash) {
  return `ligronpi/${Number(userId)}/sha256/${packageHash.toLowerCase()}.zip`;
}
__name(releaseObjectKey, "releaseObjectKey");
function packageUrl(request, releaseId, deviceUuid) {
  const url = new URL(request.url);
  url.pathname = `/api/v1/device/update/package/${encodeURIComponent(releaseId)}`;
  url.search = new URLSearchParams({ device_uuid: deviceUuid }).toString();
  return url.toString();
}
__name(packageUrl, "packageUrl");
async function pruneInactiveReleaseObjects(env, userId, channel) {
  const retired = await env.DB.prepare(`
        SELECT package_url
        FROM device_update_releases
        WHERE usuario_id=?1
          AND channel=?2
          AND source_kind='r2-private'
          AND active=0
          AND package_url NOT IN (
              SELECT package_url
              FROM device_update_releases
              WHERE usuario_id=?1 AND channel=?2 AND active=1 AND source_kind='r2-private'
          )
        ORDER BY datetime(created_at) DESC
        LIMIT -1 OFFSET ?3
    `).bind(userId, channel, RETAIN_INACTIVE_RELEASES).all();
  const objectKeys = [...new Set((retired.results || []).map((row) => String(row.package_url || "")))].filter(Boolean);
  if (!objectKeys.length) return;
  const deleted = await Promise.allSettled(objectKeys.map((key) => env.LIGRONPI_RELEASES.delete(key)));
  const failed = deleted.filter((result) => result.status === "rejected");
  if (failed.length) {
    console.warn(`LigronPi: no se pudieron purgar ${failed.length} paquete(s) retirado(s).`);
  }
}
__name(pruneInactiveReleaseObjects, "pruneInactiveReleaseObjects");
async function deviceUpdatePackage(request, env, releaseId) {
  try {
    if (request.method === "POST") {
      const user2 = await requireUserSession(request, env.DB);
      if (!user2) return response4({ success: false, error: "Sesi\xF3n de Link no v\xE1lida o caducada." }, 401);
      if (!env.LIGRONPI_RELEASES) {
        return response4({ success: false, error: "El almacenamiento privado de actualizaciones a\xFAn no est\xE1 activo." }, 503);
      }
      const version = String(request.headers.get("X-LigronPi-Version") || "").trim();
      const channel = String(request.headers.get("X-LigronPi-Channel") || "development").trim().toLowerCase();
      const packageHash = String(request.headers.get("X-LigronPi-Sha256") || "").trim().toLowerCase();
      const packageSize = Number(request.headers.get("X-LigronPi-Package-Size") || 0);
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (!validReleaseInput(version, channel, packageHash, packageSize) || !Number.isSafeInteger(contentLength) || contentLength !== packageSize || !request.body) {
        return response4({ success: false, error: "Paquete de desarrollo inv\xE1lido." }, 400);
      }
      const objectKey = releaseObjectKey(user2.id, packageHash);
      const object2 = await env.LIGRONPI_RELEASES.put(objectKey, request.body, {
        httpMetadata: {
          contentType: "application/zip",
          contentDisposition: `attachment; filename="ligronpi-${version}.zip"`
        },
        customMetadata: {
          sha256: packageHash,
          version,
          owner_user_id: String(user2.id)
        }
      });
      if (!object2 || object2.size !== packageSize) {
        return response4({ success: false, error: "R2 no confirm\xF3 el tama\xF1o del paquete recibido." }, 502);
      }
      const id = `upd_${crypto.randomUUID().replaceAll("-", "")}`;
      await env.DB.batch([
        env.DB.prepare(`
                    UPDATE device_update_releases SET active=0
                    WHERE usuario_id=?1 AND channel=?2 AND active=1
                `).bind(user2.id, channel),
        env.DB.prepare(`
                    INSERT INTO device_update_releases
                        (id, usuario_id, channel, version, source_kind, package_url, package_sha256, package_size, published_by_usuario_id)
                    VALUES (?1, ?2, ?3, ?4, 'r2-private', ?5, ?6, ?7, ?2)
                `).bind(id, user2.id, channel, version, objectKey, packageHash, packageSize)
      ]);
      await pruneInactiveReleaseObjects(env, user2.id, channel);
      return response4({ success: true, update_id: id, version, channel, package_size: packageSize });
    }
    if (request.method !== "GET") {
      return response4({ success: false, error: "M\xE9todo no permitido." }, 405);
    }
    const url = new URL(request.url);
    const receiver = await authenticatedPi(env, request, url.searchParams.get("device_uuid"));
    if (receiver.error) return response4({ success: false, error: receiver.error }, receiver.status);
    const release = await env.DB.prepare(`
            SELECT id, package_url, package_sha256, package_size
            FROM device_update_releases
            WHERE id=?1 AND usuario_id=?2 AND active=1 AND source_kind='r2-private'
            LIMIT 1
        `).bind(releaseId, receiver.device.usuario_id).first();
    if (!release || !env.LIGRONPI_RELEASES) {
      return response4({ success: false, error: "La actualizaci\xF3n solicitada no est\xE1 disponible." }, 404);
    }
    const object = await env.LIGRONPI_RELEASES.get(release.package_url);
    if (!object || object.size !== Number(release.package_size) || object.customMetadata?.sha256?.toLowerCase() !== release.package_sha256.toLowerCase()) {
      return response4({ success: false, error: "El paquete privado no supera la verificaci\xF3n de Link." }, 503);
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(object.size),
        "Content-Disposition": object.httpMetadata?.contentDisposition || "attachment; filename=ligronpi.zip",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return response4({ success: false, error: String(error?.message || error) }, 500);
  }
}
__name(deviceUpdatePackage, "deviceUpdatePackage");
async function deviceUpdates(request, env) {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const receiver = await authenticatedPi(env, request, url.searchParams.get("device_uuid"));
      if (receiver.error) return response4({ success: false, error: receiver.error }, receiver.status);
      const release = await env.DB.prepare(`
                SELECT id, version, source_kind, package_sha256, package_size, created_at
                FROM device_update_releases
                WHERE usuario_id=?1 AND channel='development' AND active=1 AND source_kind='r2-private'
                ORDER BY datetime(created_at) DESC
                LIMIT 1
            `).bind(receiver.device.usuario_id).first();
      if (!release) return response4({ success: true, update: null });
      return response4({
        success: true,
        update: {
          id: release.id,
          version: release.version,
          source_kind: release.source_kind,
          package_url: packageUrl(request, release.id, receiver.uuid),
          package_sha256: release.package_sha256,
          package_size: Number(release.package_size || 0),
          published_at: release.created_at
        }
      });
    }
    if (request.method === "POST") {
      return response4({
        success: false,
        error: "Suba el ZIP mediante /device/update/package; Link no acepta URLs externas de actualizaci\xF3n."
      }, 409);
    }
    return response4({ success: false, error: "M\xE9todo no permitido." }, 405);
  } catch (error) {
    return response4({ success: false, error: String(error?.message || error) }, 500);
  }
}
__name(deviceUpdates, "deviceUpdates");

// src/api/nativeControl.js
async function nativeControl(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return Response.json({ success: false, error: "Se requiere WebSocket." }, { status: 426 });
  }
  const nativeUuid = String(new URL(request.url).searchParams.get("device_uuid") || "").trim();
  const usesDeviceCredential = /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
  const credential = usesDeviceCredential && await requireDeviceCredential(request, env.DB, nativeUuid);
  const device = (credential || !usesDeviceCredential) && nativeUuid ? await findDeviceByUuid(env.DB, nativeUuid) : null;
  const user2 = credential && device ? await env.DB.prepare("SELECT id FROM usuarios WHERE id=?1 LIMIT 1").bind(device.usuario_id).first() : await requireUserSession(request, env.DB);
  const isNative2 = ["ligronair", "ligronair native", "ligronair_native"].includes(String(device?.tipo || "").trim().toLowerCase());
  if (!user2 || !device || Number(device.usuario_id) !== Number(user2.id) || !isNative2) {
    return Response.json({ success: false, error: "Canal Native no autorizado." }, { status: 401 });
  }
  const headers7 = new Headers(request.headers);
  headers7.set("X-Ligron-Native", nativeUuid);
  return env.NATIVE_CONTROL_HUB.getByName(nativeUuid).fetch(new Request(request, { headers: headers7 }));
}
__name(nativeControl, "nativeControl");

// src/index.js
var corsHeaders19 = {
  "Access-Control-Allow-Origin": "https://ligronair.tv",
  // ### FIX
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders19
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      return Response.json({
        service: "LigronLink Registry",
        version: "0.5.0",
        status: "ONLINE"
      }, {
        headers: corsHeaders19
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/ip") {
      return await getPublicIp(request);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/register") {
      return await register(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/login") {
      return await login(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/logout") {
      return await logout(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/register") {
      return await deviceRegister(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/native/control") {
      return await nativeControl(request, env);
    }
    if (request.method === "DELETE" && url.pathname === "/api/v1/device/credential") {
      return await deviceCredential(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/device/bootstrap") {
      return await deviceBootstrap(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/authorization") {
      return await deviceAuthorization(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/recovery") {
      return await deviceRecovery(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/recovery/identity") {
      return await deviceRecoveryIdentity(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/pairing/request") {
      return await pairingRequest(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/device/pairings") {
      return await pairingList(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/pairing/complete") {
      return await pairingComplete(request, env);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/v1/device/pairing/") && url.pathname.endsWith("/approve")) {
      const pairingId = decodeURIComponent(url.pathname.slice("/api/v1/device/pairing/".length, -"/approve".length));
      return await pairingApprove(request, env, pairingId);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/ligrontail/bootstrap") {
      return await ligronTailBootstrap(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/relay/auth") {
      return await ligronRelayAuth(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/offline") {
      return await deviceOffline(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/srt/receivers") {
      return await srtReceivers(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/srt/destinations") {
      return await srtDestinations(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/status") {
      return await deviceStatus(request, env);
    }
    if ((request.method === "POST" || request.method === "GET") && url.pathname === "/api/v1/device/commands") {
      return await deviceCommands(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/device/commands/result") {
      return await deviceCommandResult(request, env);
    }
    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/v1/device/update") {
      return await deviceUpdates(request, env);
    }
    if ((request.method === "GET" || request.method === "POST") && url.pathname.startsWith("/api/v1/device/update/package/")) {
      const releaseId = decodeURIComponent(url.pathname.slice("/api/v1/device/update/package/".length));
      return await deviceUpdatePackage(request, env, releaseId);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/pool/claim") {
      return await poolClaim(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/srt/allocate") {
      return await srtAllocate(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/srt/release") {
      return await srtRelease(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/rendezvous") {
      return await rendezvousPoll(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/rendezvous/ready") {
      return await rendezvousReady(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/rendezvous/result") {
      return await rendezvousResult(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/connection/request") return await connectionRequest(request, env);
    if (request.method === "GET" && url.pathname === "/api/v1/connection/poll") return await connectionPoll(request, env);
    if (request.method === "POST" && url.pathname === "/api/v1/connection/claim") return await connectionClaim(request, env);
    if (request.method === "GET" && url.pathname === "/api/v1/connection/status") return await connectionStatus(request, env);
    if (request.method === "POST" && url.pathname === "/api/v1/connection/activate") return await connectionActivate(request, env);
    if (request.method === "POST" && url.pathname === "/api/v1/connection/ready") return await connectionReady(request, env);
    if (request.method === "POST" && url.pathname === "/api/v1/connection/cancel") return await connectionCancel(request, env);
    if (request.method === "GET" && url.pathname === "/api/v1/devices") {
      return await devicesGet(request, env);
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/v1/device/")) {
      return await deviceDelete(request, env);
    }
    return Response.json({
      success: false,
      error: "Endpoint not found"
    }, {
      status: 404,
      headers: corsHeaders19
    });
  }
};
export {
  NativeControlHub,
  index_default as default
};
//# sourceMappingURL=index.js.map
