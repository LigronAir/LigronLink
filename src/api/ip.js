// ==========================================================
// LigronLink
// src/api/ip.js
// Devuelve la IP pública del cliente.
// ==========================================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export async function getPublicIp(request)
{
    try
    {
        // Cloudflare añade esta cabecera automáticamente.
        const ip =
            request.headers.get("CF-Connecting-IP") || "";

        return Response.json(
            {
                success: true,
                ip
            },
            {
                headers: corsHeaders
            }
        );
    }
    catch (error)
    {
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