const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export default {

    async fetch(request, env, ctx) {

        const url = new URL(request.url);

        // ==========================================
        // CORS PRE-FLIGHT
        // ==========================================

        if (request.method === "OPTIONS") {

            return new Response(null, {
                headers: corsHeaders
            });

        }

        // ==========================================
        // STATUS
        // ==========================================

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/status"
        ) {

            return Response.json({

                service: "LigronLink Registry",

                version: "0.3.0",

                status: "ONLINE"

            }, {
                headers: corsHeaders
            });

        }

        // ==========================================
        // REGISTER
        // ==========================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/register"
        ) {

            const data = await request.json();

            return Response.json({

                success: true,

                message: "Datos recibidos correctamente.",

                received: data

            }, {
                headers: corsHeaders
            });

        }

        // ==========================================
        // 404
        // ==========================================

        return Response.json({

            success: false,

            error: "Endpoint not found"

        }, {

            status: 404,

            headers: corsHeaders

        });

    }

};