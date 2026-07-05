export async function register(request, env) {

    const body = await request.json();

    return Response.json({

        success: true,

        recibido: body

    });

}