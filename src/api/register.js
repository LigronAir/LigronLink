const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

export async function register(request, env) {

    const body = await request.json();

    return Response.json(
        {
            success: true,
            recibido: body
        },
        {
            headers: corsHeaders
        }
    );

}