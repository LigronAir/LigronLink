// ==========================================================
// LigronLink
// src/api/register.js
// Registro de usuarios
// ==========================================================

import { generateUserUUID } from "../security/uuid.js";
import { hashPassword } from "../security/hash.js";
import { createUser } from "../database/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export async function register(request, env) {

    try {

        console.log("======================================");
        console.log("LigronLink - Nuevo registro");
        console.log("======================================");

        const body = await request.json();

        console.log("Datos recibidos:", body);

        const nombre = body.nombre?.trim();

        const email = body.email?.trim().toLowerCase();

        const password = body.password;

        if (!nombre || !email || !password) {

            console.log("ERROR: Faltan datos obligatorios.");

            return Response.json(
                {
                    success: false,
                    error: "Faltan datos obligatorios."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        console.log("Datos validados correctamente.");

        console.log("Generando UUID...");

        const uuid = generateUserUUID();

        console.log("UUID:", uuid);

        console.log("Generando hash de contraseña...");

        const passwordHash = await hashPassword(password);

        console.log("Hash generado correctamente.");

        console.log("Comprobando acceso a D1...");

        console.log("env.DB =", env.DB);

        console.log("Insertando usuario...");

        await createUser(env.DB, {

            uuid,

            nombre,

            email,

            passwordHash

        });

        console.log("Usuario insertado correctamente.");

        return Response.json(
            {
                success: true,
                uuid,
                message: "Cuenta creada correctamente."
            },
            {
                headers: corsHeaders
            }
        );

    }

    catch (error) {

        console.error("ERROR EN REGISTER");

        console.error(error);

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