// Estado de control por HTTPS independiente de la apertura del transporte SRT.
// La presencia no constituye un acuse de recibo ni acredita recepcion de video.
export async function findLinkedPiStatuses(db, userId, nativeUuid) {
    const rows = await db.prepare(`
        SELECT r.device_uuid, p.alias, r.runtime_state, r.streaming,
               r.ultima_actualizacion,
               CASE WHEN UPPER(p.estado) = 'ONLINE'
                 AND datetime(p.ultima_conexion) >= datetime('now','-75 seconds')
                 AND datetime(r.ultima_actualizacion) >= datetime('now','-75 seconds')
                 THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state,
               s.source_id
        FROM device_runtime_status r
        JOIN equipos p ON p.uuid=r.device_uuid AND p.usuario_id=r.usuario_id
        LEFT JOIN srt_destinos s ON s.equipo_uuid=r.target_device_uuid
             AND s.usuario_id=r.usuario_id AND s.reservado_por_uuid=r.device_uuid
        WHERE r.usuario_id=?1 AND r.target_device_uuid=?2
        ORDER BY r.device_uuid, s.source_id
    `).bind(userId, nativeUuid).all();
    return rows.results;
}

export async function findTargetPresence(db, userId, targetUuid) {
    if (!targetUuid) return null;
    return await db.prepare(`
        SELECT uuid, alias,
          CASE WHEN UPPER(estado)='ONLINE'
            AND datetime(ultima_conexion)>=datetime('now','-75 seconds')
            THEN 'PEER_ONLINE' ELSE 'PEER_OFFLINE' END AS control_state
        FROM equipos WHERE usuario_id=?1 AND uuid=?2
    `).bind(userId, targetUuid).first();
}
