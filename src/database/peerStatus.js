// Estado de control por HTTPS independiente de la apertura del transporte SRT.
// La presencia no constituye un acuse de recibo ni acredita recepcion de video.
export async function findLinkedPiStatuses(db, userId, nativeUuid) {
    // La reserva es el contrato que comparten Pi y Native. No puede depender
    // de device_runtime_status, porque esa tabla es telemetría opcional y su
    // ausencia no debe ocultar al Native que una Pi le ha pedido una caja.
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
    // Una Pi que entra directamente por Tailnet puede dejar la caja BUSY
    // antes de crear una reserva Link. device/status ya resolvió y guardó el
    // UUID Native; aquí reconstruimos su caja por el puerto de salida para
    // que Native tenga el mismo vínculo y pueda habilitar el remoto.
    const activeTailSql = (withTelemetry) => `
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
    `;
    try {
        let rows;
        try {
            rows = (await db.prepare(reservedSql).bind(userId, nativeUuid).all()).results;
        } catch (error) {
            // Una base anterior puede tener la tabla runtime sin la columna
            // de telemetría. La asociación Pi-caja sigue siendo válida: se
            // conserva la reserva y se entrega telemetría vacía hasta que la
            // migración aditiva se haya aplicado.
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
            const activeRows = (await db.prepare(activeTailSql(true))
                .bind(userId, nativeUuid).all()).results || [];
            rows.push(...activeRows.filter((row) => Number(row.source_id || 0) > 0));
        } catch (error) {
            if (!String(error?.message || error).toLowerCase().includes("telemetry_json")) {
                throw error;
            }
            const activeRows = (await db.prepare(activeTailSql(false))
                .bind(userId, nativeUuid).all()).results || [];
            rows.push(...activeRows.filter((row) => Number(row.source_id || 0) > 0));
        }
        // La cola puede no existir durante una actualización escalonada. El
        // estado de vídeo y la reserva no deben caerse por ese detalle.
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
        // Compatibilidad con instalaciones que todavía no han creado la
        // tabla de telemetría: la reserva y la presencia siguen siendo datos
        // suficientes para informar a ambos operadores.
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

export async function findTargetPresence(db, userId, targetUuid, sourceUuid = "") {
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
