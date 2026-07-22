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
                'OFFLINE'
            )
            `
        )
        .bind(
            device.uuid,
            device.usuarioId,
            device.tipo,
            device.alias
        )
        .run();

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
                estado,
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
// ### FIX
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