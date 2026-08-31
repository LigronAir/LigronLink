// ==========================================================
// LigronLink
// database/srtDestinations.js
// Gestión de destinos/receptores SRT en D1
// ==========================================================

// ==========================================================
// Registrar o actualizar receptores SRT de un equipo.
// ==========================================================

export async function replaceSrtDestinations(db, device, receivers) {

    // ======================================================
    // ### FIX
    // La publicación se trata como una fotografía completa
    // de los receptores del equipo. Los anteriores se ponen
    // OFFLINE antes de actualizar los recibidos.
    // ======================================================

    await db
        .prepare(
            `
            UPDATE srt_destinos
            SET
                estado = 'OFFLINE',
                ultima_actualizacion = datetime('now')
            WHERE equipo_uuid = ?1
              AND usuario_id = ?2
            `
        )
        .bind(
            device.uuid,
            device.usuarioId
        )
        .run();

    const guardados = [];

    for (const receiver of receivers) {

        await db
            .prepare(
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
                    estado = excluded.estado,
                    reservado_por_uuid = NULL,
                    ultima_actualizacion = datetime('now')
                `
            )
            .bind(
                device.uuid,
                device.usuarioId,
                receiver.sourceId,
                receiver.nombre,
                receiver.host,
                receiver.port,
                receiver.mode,
                receiver.estado
            )
            .run();

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

// ==========================================================
// Obtener destinos SRT utilizables por un usuario.
// ==========================================================

export async function findAvailableSrtDestinations(db, usuarioId) {

    const resultado = await db
        .prepare(
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
              AND LOWER(TRIM(e.tipo)) IN (
                  'ligronair',
                  'ligronair native',
                  'ligronair_native'
              )
              AND s.host IS NOT NULL
              AND TRIM(s.host) <> ''
              AND s.port BETWEEN 1 AND 65535
            ORDER BY
                e.alias ASC,
                s.source_id ASC
            `
        )
        .bind(usuarioId)
        .all();

    return resultado.results;

}