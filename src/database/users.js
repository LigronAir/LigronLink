// ==========================================================
// LigronLink
// database/users.js
// Gestión de usuarios en D1
// ==========================================================

export async function createUser(db, user) {

    const query = `
        INSERT INTO usuarios
        (
            uuid,
            nombre,
            email,
            password_hash,
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
            'ACTIVO'
        );
    `;

    await db
        .prepare(query)
        .bind(

            user.uuid,

            user.nombre,

            user.email,

            user.passwordHash

        )
        .run();

}