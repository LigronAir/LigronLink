# Activación de Pool

Pool no se activa con la interfaz sola. El orden seguro de despliegue es:

1. Actualizar LigronPi con el soporte de la orden `pool_claim`.
2. Aplicar `create_pool_switches.sql` a D1.
3. Desplegar el Worker.
4. Publicar la web con `pool.html`.

Si la tabla todavía no existe, el endpoint devuelve un error explícito y no
modifica ninguna vía. Una vía `BUSY` de origen externo tampoco se sustituye
desde Pool. Las operaciones pendientes caducan a los cinco minutos y sólo se
avanzan con el ACK HTTPS de la Pi correspondiente.
