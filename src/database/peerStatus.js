// Estado de control por HTTPS independiente de la apertura del transporte SRT.
// La presencia no constituye un acuse de recibo ni acredita recepcion de video.
export async function findLinkedPiStatuses(db, userId, nativeUuid) {
    // La reserva es el contrato que comparten Pi y Native. No puede depender
    // de device_runtime_status, porque esa tabla es telemetría opcional y su
    // ausencia no debe ocultar al Native que una Pi le ha pedido una caja.
    const reservedSql = `
        SELECT p.uuid AS device_uuid, p.alias, p.public_ip,
               r.runtime_state, r.streaming, r.target_srt_url,
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
    try {
        return (await db.prepare(reservedSql).bind(userId, nativeUuid).all()).results;
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
