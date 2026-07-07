// ==========================================================
// LigronLink
// src/api/login.js
// Inicio de sesión
// ==========================================================

import { hashPassword } from "../security/hash.js";
import { findUserByEmail } from "../database/users.js";

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

        const passwordHash = await hashPassword(password);

        if (passwordHash !== user.password_hash) {

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

        return Response.json(
            {
                success: true,

                user: {

                    uuid: user.uuid,

                    nombre: user.nombre,

                    email: user.email

                }

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