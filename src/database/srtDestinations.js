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
                -- ### FIX
                -- Una reserva hecha por LigronLink no debe desaparecer
                -- simplemente porque Native publique un snapshot.
                estado = CASE
                    WHEN estado = 'RESERVED' THEN 'RESERVED'
                    ELSE 'OFFLINE'
                END,
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
                    -- ### FIX
                    -- Si el receptor está RESERVED en Link y Native lo
                    -- sigue publicando como FREE, se conserva la reserva.
                    -- Si Native lo publica BUSY/OFFLINE, se respeta Native.
                    estado = CASE
                        WHEN srt_destinos.estado = 'RESERVED'
                         AND excluded.estado = 'FREE'
                            THEN 'RESERVED'
                        ELSE excluded.estado
                    END,
                    reservado_por_uuid = CASE
                        WHEN srt_destinos.estado = 'RESERVED'
                         AND excluded.estado = 'FREE'
                            THEN srt_destinos.reservado_por_uuid
                        ELSE NULL
                    END,
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
// ### FIX
// Obtener equipos LigronAir con receptores libres agrupados.
// ==========================================================

export async function findAvailableSrtDevices(db, usuarioId) {

    const resultado = await db
        .prepare(
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
              AND LOWER(TRIM(e.tipo)) IN (
                  'ligronair',
                  'ligronair native',
                  'ligronair_native'
              )
              AND s.host IS NOT NULL
              AND TRIM(s.host) <> ''
              AND s.port BETWEEN 1 AND 65535
            GROUP BY
                s.equipo_uuid,
                e.alias
            HAVING COUNT(*) > 0
            ORDER BY
                e.alias ASC
            `
        )
        .bind(usuarioId)
        .all();

    return resultado.results;

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

// ==========================================================
// ### FIX
// Reservar atómicamente un receptor FREE de un LigronAir.
// ==========================================================

export async function allocateSrtDestination(db, usuarioId, piUuid, deviceUuid) {

    const resultado = await db
        .prepare(
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
        )
        .bind(
            usuarioId,
            piUuid,
            deviceUuid
        )
        .first();

    return resultado;

}

// ==========================================================
// ### FIX
// Liberar de forma idempotente las reservas de una Pi.
// ==========================================================

export async function releaseSrtDestination(db, usuarioId, piUuid, deviceUuid) {

    const resultado = await db
        .prepare(
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
        )
        .bind(
            usuarioId,
            piUuid,
            deviceUuid
        )
        .run();

    return resultado.meta?.changes || 0;

}
