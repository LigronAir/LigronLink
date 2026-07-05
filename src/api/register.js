// ==========================================================
// LigronLink
// api/register.js
// Registro de usuarios
// ==========================================================

import { generateUserUUID } from "../security/uuid.js";
import { hashPassword } from "../security/hash.js";
import { createUser } from "../database/users.js";

export async function register(request, env) {

    try {

        const body = await request.json();

        const nombre = body.nombre?.trim();

        const email = body.email?.trim().toLowerCase();

        const password = body.password;

        // ==================================================
        // Validación básica
        // ==================================================

        if (!nombre || !email || !password) {

            return Response.json({

                success: false,

                error: "Faltan datos obligatorios."

            }, {

                status: 400

            });

        }

        // ==================================================
        // Crear usuario
        // ==================================================

        const uuid = generateUserUUID();

        const passwordHash = await hashPassword(password);

        await createUser(env.DB, {

            uuid,

            nombre,

            email,

            passwordHash

        });

        // ==================================================
        // Respuesta
        // ==================================================

        return Response.json({

            success: true,

            uuid,

            message: "Cuenta creada correctamente."

        });

    }

    catch (error) {

        console.error(error);

        return Response.json({

            success: false,

            error: error.message

        }, {

            status: 500

        });

    }

}