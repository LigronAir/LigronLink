// ==========================================================
// LigronLink
// database/devices.js
// Gestión de equipos en D1
// ==========================================================

// ==========================================================
// Registrar equipo
// ==========================================================

export async function createDevice(db, device) {

    // ======================================================
    // Comprobar si ya existe el UUID
    // ======================================================

    const existente = await db
        .prepare(
            `
            SELECT id
            FROM equipos
            WHERE uuid = ?1
            `
        )
        .bind(device.uuid)
        .first();

    if (existente) {

        throw new Error(
            "Ya existe un equipo registrado con ese UUID."
        );

    }

    // ======================================================
    // Insertar equipo
    // ======================================================

    await db
        .prepare(
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
        )
        .bind(
            device.uuid,
            device.usuarioId,
            device.tipo,
            device.alias,
            device.publicIp || null,
            device.ultimaConexion || null,
            device.estado || "OFFLINE"
        )
        .run();

}

// ==========================================================
// Registrar o actualizar un equipo existente.
// ==========================================================

export async function registerOrUpdateDevice(db, device) {

    const existente = await db
        .prepare(
            `
            SELECT
                id
            FROM equipos
            WHERE uuid = ?1
            `
        )
        .bind(device.uuid)
        .first();

    const ahora = new Date().toISOString();

    // ------------------------------------------------------
    // No existe -> crear
    // ------------------------------------------------------

    if (!existente) {

        await createDevice(db, {

            ...device,

            estado:
                device.estado || "ONLINE",

            ultimaConexion:
                device.ultimaConexion || ahora

        });

        return {

            created: true,
            updated: false

        };

    }

    // ------------------------------------------------------
    // Existe -> actualizar
    // ------------------------------------------------------

    await db
        .prepare(
            `
            UPDATE equipos
            SET
                usuario_id = ?2,
                tipo = ?3,
                alias = ?4,
                public_ip = COALESCE(?5, public_ip),
                ultima_conexion = COALESCE(?6, ultima_conexion),
                estado = ?7
            WHERE uuid = ?1
            `
        )
        .bind(
            device.uuid,
            device.usuarioId,
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
        )
        .run();

    return {

        created: false,
        updated: true

    };

}

// ==========================================================
// ### FIX
// Actualizar únicamente el estado de presencia del equipo.
// No modifica identidad, usuario, alias ni dirección IP.
// ==========================================================

export async function setDeviceStatus(db, uuid, estado) {

    await db
        .prepare(
            `
            UPDATE equipos
            SET
                estado = ?2
            WHERE uuid = ?1
            `
        )
        .bind(
            uuid,
            estado
        )
        .run();

}

// ==========================================================
// Refrescar la presencia de un equipo que ha contactado con Link.
// La fecha se usa como heartbeat: no se considera ONLINE un estado
// almacenado antiguo si la aplicación dejó de avisar al apagarse.
// ==========================================================

export async function touchDevicePresence(db, uuid, usuarioId) {

    await db
        .prepare(
            `
            UPDATE equipos
            SET
                ultima_conexion = datetime('now'),
                estado = 'ONLINE'
            WHERE uuid = ?1
              AND usuario_id = ?2
            `
        )
        .bind(uuid, usuarioId)
        .run();

}

// ==========================================================
// ### FIX
// Actualizar estado runtime operativo de un equipo.
// Se usa para que Link visualice qué está haciendo Pi/Native
// sin transportar vídeo.
// ==========================================================

export async function updateDeviceRuntimeStatus(db, device, runtime) {

    await db
        .prepare(
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
                ultima_actualizacion = datetime('now')
            `
        )
        .bind(
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
            runtime.audio_state || null
        )
        .run();

}

// ==========================================================
// ### FIX
// Obtener estados runtime por usuario.
// ==========================================================

export async function findRuntimeStatusByUser(db, usuarioId) {

    const resultado = await db
        .prepare(
            `
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
                ultima_actualizacion
            FROM device_runtime_status
            WHERE usuario_id = ?1
            `
        )
        .bind(usuarioId)
        .all();

    return resultado.results;

}

// ==========================================================
// Buscar equipo por UUID
// ==========================================================

export async function findDeviceByUuid(db, uuid) {

    return await db
        .prepare(
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
        )
        .bind(uuid)
        .first();

}

// ==========================================================
// Obtener equipos de un usuario
// ==========================================================

export async function findDevicesByUser(db, usuarioId) {

    const resultado = await db
        .prepare(
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
                    -- No se borra el equipo ni sus reservas: sólo deja
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
        )
        .bind(usuarioId)
        .all();

    return resultado.results;

}

// ==========================================================
// Eliminar equipo
// ==========================================================

export async function deleteDevice(db, deviceId, usuarioId) {

    const resultado = await db
        .prepare(
            `
            DELETE FROM equipos
            WHERE id = ?1
              AND usuario_id = ?2
            `
        )
        .bind(deviceId, usuarioId)
        .run();

    if (!resultado.meta || resultado.meta.changes === 0) {

        throw new Error(
            "No se pudo eliminar el equipo."
        );

    }

    return true;

}
