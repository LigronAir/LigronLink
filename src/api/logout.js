import { revokeUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export async function logout(request, env) {
    if (request.method !== "POST") {
        return Response.json({ success: false, error: "Método no permitido." }, { status: 405, headers: corsHeaders });
    }
    try {
        // Es idempotente: no revela si el token había caducado o fue revocado.
        await revokeUserSession(request, env.DB);
        return Response.json({ success: true }, { headers: corsHeaders });
    }
    catch {
        return Response.json({ success: false, error: "No se pudo cerrar la sesión." }, { status: 500, headers: corsHeaders });
    }
}
