// ==========================================================
// LigronLink · Pool
// Reclamación controlada de una vía Native por una LigronPi.
//
// El navegador no abre ni cierra SRT: sólo solicita una transacción. Link
// conserva la reserva y entrega órdenes que la Pi recoge desde su HTTPS.
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { allocateSrtDestination } from "../database/srtDestinations.js";
import { requireUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const PI_TYPES = new Set(["ligronpi", "ligronpi native", "ligronpi_native"]);
const NATIVE_TYPES = new Set(["ligronair", "ligronair native", "ligronair_native"]);

function response(payload, status = 200) {
    return Response.json(payload, { status, headers: corsHeaders });
}

function typeAllowed(device, allowedTypes) {
    return allowedTypes.has(String(device?.tipo || "").trim().toLowerCase());
}

function devicePresent(device) {
    if (String(device?.estado || "").trim().toUpperCase() !== "ONLINE") return false;
    const raw = String(device?.ultima_conexion || "").trim();
    if (!raw) return false;
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const seenAt = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
    return Number.isFinite(seenAt) && seenAt <= Date.now() && Date.now() - seenAt <= 75_000;
}

function isMissingPoolTable(error) {
    return String(error?.message || error).toLowerCase()
        .includes("no such table: pool_switches");
}

async function requirePoolSchema(db) {
    try {
        await db.prepare("SELECT id FROM pool_switches LIMIT 1").first();
        // Sólo al realizar una acción de Pool, no en los heartbeats: una
        // operación sin ACK durante cinco minutos deja de bloquear la vía,
        // pero su historial permanece visible como EXPIRED.
        await db.prepare(`
            UPDATE pool_switches
            SET state='EXPIRED', error_message=COALESCE(error_message, 'La Pi no confirmó la operación a tiempo.'),
                updated_at=datetime('now')
            WHERE state IN ('STOPPING', 'ARMING') AND datetime(expires_at) <= datetime('now')
        `).run();
        return true;
    } catch (error) {
        if (isMissingPoolTable(error)) return false;
        throw error;
    }
}

async function queuePiCommand(db, userId, nativeUuid, piUuid, command, payload) {
    const id = crypto.randomUUID();
    await db.prepare(`
        INSERT INTO device_remote_commands
            (id, usuario_id, sender_device_uuid, target_device_uuid, command, payload_json, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now','+90 seconds'))
    `).bind(
        id, userId, nativeUuid, piUuid, command, JSON.stringify(payload || {})
    ).run();
    return id;
}

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

async function activeSwitchForReceiver(db, userId, nativeUuid, sourceId) {
    return db.prepare(`
        SELECT state FROM pool_switches
        WHERE usuario_id=?1 AND native_device_uuid=?2 AND source_id=?3
          AND state IN ('STOPPING', 'ARMING')
        LIMIT 1
    `).bind(userId, nativeUuid, sourceId).first();
}

async function createArmingSwitch(db, values) {
    const id = crypto.randomUUID();
    await db.prepare(`
        INSERT INTO pool_switches
            (id, usuario_id, native_device_uuid, source_id, outgoing_pi_uuid,
             incoming_pi_uuid, start_command_id, state)
        VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, 'ARMING')
    `).bind(
        id, values.userId, values.nativeUuid, values.sourceId,
        values.incomingPiUuid, values.startCommandId
    ).run();
    return id;
}

async function claimFreeReceiver(db, user, native, pi, sourceId) {
    const assignment = await allocateSrtDestination(
        db, user.id, pi.uuid, native.uuid, sourceId
    );
    if (!assignment) {
        return { error: "La vía ya no está libre; actualiza Pool antes de reintentar.", status: 409 };
    }

    try {
        const startCommandId = await queuePiCommand(db, user.id, native.uuid, pi.uuid, "pool_claim", {
            native_uuid: native.uuid,
            native_alias: native.alias || "LigronAir",
            source_id: sourceId
        });
        const switchId = await createArmingSwitch(db, {
            userId: user.id,
            nativeUuid: native.uuid,
            sourceId,
            incomingPiUuid: pi.uuid,
            startCommandId
        });
        return { switchId, commandId: startCommandId };
    } catch (error) {
        // No dejar una vía tomada si Link no pudo entregar la orden a la Pi.
        await db.prepare(`
            UPDATE srt_destinos
            SET estado='FREE', reservado_por_uuid=NULL, ultima_actualizacion=datetime('now')
            WHERE usuario_id=?1 AND equipo_uuid=?2 AND source_id=?3
              AND estado='RESERVED' AND reservado_por_uuid=?4
        `).bind(user.id, native.uuid, sourceId, pi.uuid).run();
        throw error;
    }
}

// POST /api/v1/pool/claim
// replace=false: sólo ocupa una vía FREE.
// replace=true: sólo sustituye una reserva LigronPi conocida. Una fuente BUSY
// externa nunca se pisa desde web porque Link no puede detenerla con certeza.
export async function poolClaim(request, env) {
    try {
        if (request.method !== "POST") {
            return response({ success: false, error: "Método no permitido." }, 405);
        }
        if (!await requirePoolSchema(env.DB)) {
            return response({
                success: false,
                error: "Pool aún no está activado en Link: falta aplicar create_pool_switches.sql. No se ha cambiado ninguna vía."
            }, 503);
        }

        const body = await request.json();
        const piUuid = String(body.pi_uuid || "").trim();
        const nativeUuid = String(body.native_uuid || "").trim();
        const sourceId = Number(body.source_id);
        const replace = body.replace === true;
        if (!piUuid || !nativeUuid || !Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50) {
            return response({ success: false, error: "Solicitud Pool inválida." }, 400);
        }

        const user = await requireUserSession(request, env.DB);
        if (!user) return response({ success: false, error: "Sesión no válida o caducada. Inicie sesión de nuevo." }, 401);
        const [pi, native] = await Promise.all([
            findDeviceByUuid(env.DB, piUuid),
            findDeviceByUuid(env.DB, nativeUuid)
        ]);
        if (!pi || Number(pi.usuario_id) !== Number(user.id) || !typeAllowed(pi, PI_TYPES)) {
            return response({ success: false, error: "La fuente LigronPi no pertenece a esta cuenta." }, 403);
        }
        if (!native || Number(native.usuario_id) !== Number(user.id) || !typeAllowed(native, NATIVE_TYPES)) {
            return response({ success: false, error: "El receptor LigronAir no pertenece a esta cuenta." }, 403);
        }
        if (!devicePresent(pi)) return response({ success: false, error: "La LigronPi no está presente en Link." }, 409);
        if (!devicePresent(native)) return response({ success: false, error: "El LigronAir Native no está presente en Link." }, 409);

        const receiver = await receiverForUpdate(env.DB, user.id, native.uuid, sourceId);
        if (!receiver || !Number(receiver.port)) {
            return response({ success: false, error: "La vía solicitada no está publicada por ese Native." }, 404);
        }
        const activeSwitch = await activeSwitchForReceiver(env.DB, user.id, native.uuid, sourceId);
        if (activeSwitch) {
            return response({
                success: false,
                state: activeSwitch.state,
                error: "Pool ya está preparando un cambio para esta vía; espera su confirmación antes de solicitar otro."
            }, 409);
        }
        const currentState = String(receiver.estado || "OFFLINE").toUpperCase();
        if (currentState === "FREE") {
            const created = await claimFreeReceiver(env.DB, user, native, pi, sourceId);
            if (created.error) return response({ success: false, error: created.error }, created.status);
            return response({
                success: true,
                state: "ARMING",
                switch_id: created.switchId,
                message: `${pi.alias || "LigronPi"} ha sido reclamada para ${native.alias || "LigronAir"} · vía ${sourceId}. Esperando confirmación de la Pi.`
            }, 202);
        }

        if (currentState === "RESERVED" && receiver.reservado_por_uuid === pi.uuid) {
            return response({
                success: true,
                state: "ASSIGNED",
                message: "Esta LigronPi ya posee la reserva de la vía indicada."
            });
        }

        if (currentState === "BUSY" || currentState === "OFFLINE") {
            const reason = currentState === "BUSY"
                ? "La vía está ocupada por una señal externa o por un origen que Link no puede detener con seguridad."
                : "La vía no está operativa en este momento.";
            return response({ success: false, error: reason, state: currentState }, 409);
        }

        if (currentState !== "RESERVED" || !receiver.reservado_por_uuid) {
            return response({ success: false, error: "El estado de la vía no permite una asignación segura." }, 409);
        }
        if (!replace) {
            return response({
                success: false,
                approval_required: true,
                state: "RESERVED",
                current_owner_alias: receiver.reserved_by_alias || "LigronPi sin alias",
                error: `La vía está reservada por ${receiver.reserved_by_alias || "otra LigronPi"}. Confirma la sustitución para detener su emisión antes de reclamarla.`
            }, 409);
        }

        const outgoing = await findDeviceByUuid(env.DB, receiver.reservado_por_uuid);
        if (!outgoing || Number(outgoing.usuario_id) !== Number(user.id) || !typeAllowed(outgoing, PI_TYPES) || !devicePresent(outgoing)) {
            return response({
                success: false,
                error: "La vía está reservada por una Pi que ya no está presente; Pool no la sustituye automáticamente. Libera o revisa la reserva desde Link."
            }, 409);
        }
        const switchId = crypto.randomUUID();
        const stopCommandId = await queuePiCommand(env.DB, user.id, native.uuid, outgoing.uuid, "stream_stop", {});
        await env.DB.prepare(`
            INSERT INTO pool_switches
                (id, usuario_id, native_device_uuid, source_id, outgoing_pi_uuid,
                 incoming_pi_uuid, stop_command_id, state)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'STOPPING')
        `).bind(
            switchId, user.id, native.uuid, sourceId, outgoing.uuid, pi.uuid, stopCommandId
        ).run();
        return response({
            success: true,
            state: "STOPPING",
            switch_id: switchId,
            message: `Se ha solicitado detener ${outgoing.alias || "la Pi actual"}. La nueva fuente sólo se preparará tras su confirmación.`
        }, 202);
    } catch (error) {
        console.error("Pool claim:", error);
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}

// Avanza una sustitución exclusivamente después del ACK de la Pi. Se invoca
// desde /device/commands/result; nunca desde una actualización de pantalla.
export async function advancePoolSwitch(env, userId, commandId, commandState, resultMessage = "") {
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
    const fail = async (message) => env.DB.prepare(`
        UPDATE pool_switches
        SET state='FAILED', error_message=?1, updated_at=datetime('now')
        WHERE id=?2 AND usuario_id=?3
    `).bind(String(message || "No confirmado").slice(0, 500), switchRow.id, userId).run();

    if (switchRow.state === "STOPPING" && switchRow.stop_command_id === commandId) {
        if (!completed) {
            await fail(`La Pi saliente no confirmó la detención: ${resultMessage}`);
            return;
        }
        // El propietario no se cambia hasta que la salida confirmó el stop.
        const moved = await env.DB.prepare(`
            UPDATE srt_destinos
            SET reservado_por_uuid=?1, estado='RESERVED', ultima_actualizacion=datetime('now')
            WHERE usuario_id=?2 AND equipo_uuid=?3 AND source_id=?4
              AND estado='RESERVED' AND reservado_por_uuid=?5
        `).bind(
            switchRow.incoming_pi_uuid, userId, switchRow.native_device_uuid,
            switchRow.source_id, switchRow.outgoing_pi_uuid
        ).run();
        if (Number(moved.meta?.changes || 0) !== 1) {
            await fail("La vía cambió de estado mientras se detenía la fuente anterior.");
            return;
        }
        const native = await findDeviceByUuid(env.DB, switchRow.native_device_uuid);
        const startCommandId = await queuePiCommand(env.DB, userId, switchRow.native_device_uuid,
            switchRow.incoming_pi_uuid, "pool_claim", {
                native_uuid: switchRow.native_device_uuid,
                native_alias: native?.alias || "LigronAir",
                source_id: Number(switchRow.source_id)
            });
        await env.DB.prepare(`
            UPDATE pool_switches
            SET state='ARMING', start_command_id=?1, updated_at=datetime('now')
            WHERE id=?2 AND usuario_id=?3 AND state='STOPPING'
        `).bind(startCommandId, switchRow.id, userId).run();
        return;
    }

    if (switchRow.state === "ARMING" && switchRow.start_command_id === commandId) {
        if (!completed) {
            // No liberamos a ciegas: si la Pi llegó a abrir SRT antes de fallar,
            // otro origen no debe apropiarse de la vía. Pool queda explícitamente
            // FAILED para revisión del operador.
            await fail(`La Pi entrante no confirmó el arranque: ${resultMessage}`);
            return;
        }
        await env.DB.prepare(`
            UPDATE pool_switches
            SET state='ACTIVE', error_message=NULL, updated_at=datetime('now')
            WHERE id=?1 AND usuario_id=?2 AND state='ARMING'
        `).bind(switchRow.id, userId).run();
    }
}
