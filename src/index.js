export default {
  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // =====================================================
    // GET /api/v1/status
    // =====================================================
    if (request.method === "GET" && url.pathname === "/api/v1/status") {

      return Response.json({
        service: "LigronLink Registry",
        version: "0.2.0",
        status: "ONLINE"
      });

    }

    // =====================================================
    // Endpoint inexistente
    // =====================================================
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Endpoint not found"
        }
      },
      {
        status: 404
      }
    );

  }
};
