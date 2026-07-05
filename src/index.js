// ==========================================================
// LigronLink
// src/index.js
// Router principal
// ==========================================================

import { register } from "./api/register.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export default {

    async fetch(request, env, ctx) {

        const url = new URL(request.url);

        // ==================================================
        // CORS
        // ==================================================

        if (request.method === "OPTIONS") {

            return new Response(null, {
                headers: corsHeaders
            });

        }

        // ==================================================
        // STATUS
        // ==================================================

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/status"
        ) {

            return Response.json({

                service: "LigronLink Registry",

                version: "0.4.0",

                status: "ONLINE"

            }, {
                headers: corsHeaders
            });

        }

        // ==================================================
        // REGISTER
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/register"
        ) {

            return await register(request, env);

        }

        // ==================================================
        // NOT FOUND
        // ==================================================

        return Response.json({

            success: false,

            error: "Endpoint not found"

        }, {

            status: 404,

            headers: corsHeaders

        });

    }

};