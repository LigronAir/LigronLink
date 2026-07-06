// ==========================================================
// LigronLink
// src/database/users.js
// Gestión de usuarios en D1
// ==========================================================

export async function createUser(db, user) {

    // ======================================================
    // Comprobar si ya existe el email
    // ======================================================

    const existente = await db
        .prepare(
            "SELECT id FROM usuarios WHERE email = ?1"
        )
        .bind(user.email)
        .first();

    if (existente) {

        throw new Error("Ya existe una cuenta asociada a ese correo electrónico.");

    }

    // ======================================================
    // Insertar usuario
    // ======================================================

    await db.prepare(

        `
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
        )
        `

    )
    .bind(

        user.uuid,
        user.nombre,
        user.email,
        user.passwordHash

    )
    .run();

}