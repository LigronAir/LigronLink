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