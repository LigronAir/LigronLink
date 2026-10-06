// ==========================================================
// LigronLink
// src/api/login.js
// Inicio de sesión
// ==========================================================

import { hashPassword, verifyPassword } from "../security/hash.js";
import { findUserByEmail, updateUserPasswordHash } from "../database/users.js";
import { createUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export async function login(request, env) {

    try {

        const body = await request.json();

        const email = body.email?.trim().toLowerCase();

        const password = body.password;

        if (!email || !password) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar el correo y la contraseña."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        const user = await findUserByEmail(env.DB, email);

        if (!user) {

            return Response.json(
                {
                    success: false,
                    error: "Correo o contraseña incorrectos."
                },
                {
                    status: 401,
                    headers: corsHeaders
                }
            );

        }

        const verification = await verifyPassword(password, user.password_hash);

        if (!verification.valid) {

            return Response.json(
                {
                    success: false,
                    error: "Correo o contraseña incorrectos."
                },
                {
                    status: 401,
                    headers: corsHeaders
                }
            );

        }

        // Las cuentas SHA-256 heredadas se migran sólo después de que la
        // contraseña haya sido validada. El cliente no cambia su contrato.
        if (verification.needsRehash) {
            await updateUserPasswordHash(env.DB, user.id, await hashPassword(password));
        }

        const session = await createUserSession(env.DB, user.id);

        return Response.json(
            {
                success: true,

                user: {

                    uuid: user.uuid,

                    nombre: user.nombre,

                    email: user.email

                },

                access_token: session.token,
                expires_in: session.expiresIn

            },
            {
                headers: corsHeaders
            }
        );

    }
    catch (error) {

        return Response.json(
            {
                success: false,
                error: error.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );

    }

}
