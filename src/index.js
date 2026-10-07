// ==========================================================
// LigronLink
// src/index.js
// Router principal
// ==========================================================

import { register } from "./api/register.js";
import { login } from "./api/login.js";
import { logout } from "./api/logout.js";
import { deviceRegister } from "./api/deviceRegister.js";
import { devicesGet } from "./api/devicesGet.js";
// ### FIX
import { getPublicIp } from "./api/ip.js";
import { deviceDelete } from "./api/deviceDelete.js";
import { deviceOffline } from "./api/deviceOffline.js";
// ### FIX
import { deviceStatus } from "./api/deviceStatus.js";
import { srtReceivers } from "./api/srtReceivers.js";
import { srtDestinations } from "./api/srtDestinations.js";
import { srtAllocate } from "./api/srtAllocate.js";
import { srtRelease } from "./api/srtRelease.js";
// ### FIX — SRT RENDEZVOUS
import { rendezvousPoll, rendezvousReady, rendezvousResult } from "./api/rendezvous.js";
import { connectionRequest, connectionPoll, connectionClaim, connectionStatus, connectionActivate, connectionReady, connectionCancel } from "./api/connectionRequests.js";
import { ligronTailBootstrap } from "./api/ligronTailBootstrap.js";
import { ligronRelayAuth } from "./api/ligronRelay.js";
import { deviceCommands, deviceCommandResult } from "./api/deviceCommands.js";
import { deviceCredential } from "./api/deviceCredential.js";
import { deviceBootstrap } from "./api/deviceBootstrap.js";
import { poolClaim } from "./api/poolClaim.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    // ### FIX
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

                version: "0.5.0",

                status: "ONLINE"

            }, {
                headers: corsHeaders
            });

        }

        // ==================================================
        // ### FIX
        // PUBLIC IP
        // ==================================================

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/ip"
        ) {

            return await getPublicIp(request);

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
        // LOGIN
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/login"
        ) {

            return await login(request, env);

        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/logout"
        ) {

            return await logout(request, env);

        }

        // ==================================================
        // DEVICE REGISTER
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/device/register"
        ) {

            return await deviceRegister(request, env);

        }

        // Credencial persistente de Pi: se emite sólo a una sesión web
        // autenticada y se consume desde systemd, no desde settings.json.
        if (
            (request.method === "POST" || request.method === "DELETE") &&
            url.pathname === "/api/v1/device/credential"
        ) {
            return await deviceCredential(request, env);
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/device/bootstrap"
        ) {
            return await deviceBootstrap(request, env);
        }

        // ==================================================
        // LIGRONTAIL - alta automática de Native
        // ==================================================
        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/ligrontail/bootstrap"
        ) {

            return await ligronTailBootstrap(request, env);

        }

        // MediaMTX calls this endpoint to validate one relay session. It is
        // intentionally separate from user-facing CORS/API operations.
        if (request.method === "POST" && url.pathname === "/api/v1/relay/auth") {
            return await ligronRelayAuth(request, env);
        }

        // ==================================================
        // DEVICE OFFLINE
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/device/offline"
        ) {

            return await deviceOffline(request, env);

        }

        // ==================================================
        // SRT RECEIVERS
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/srt/receivers"
        ) {

            return await srtReceivers(request, env);

        }

        // ==================================================
        // SRT DESTINATIONS
        // ==================================================

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/srt/destinations"
        ) {

            return await srtDestinations(request, env);

        }

        // ==================================================
        // ### FIX
        // DEVICE RUNTIME STATUS
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/device/status"
        ) {

            return await deviceStatus(request, env);

        }

        // Control remoto autenticado Native -> Link -> Pi. Link sólo
        // almacena órdenes efímeras; la Pi las consulta desde dentro de su
        // propia conexión HTTPS, sin puertos entrantes.
        if (
            (request.method === "POST" || request.method === "GET") &&
            url.pathname === "/api/v1/device/commands"
        ) {
            return await deviceCommands(request, env);
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/device/commands/result"
        ) {
            return await deviceCommandResult(request, env);
        }

        // Pool sólo solicita una reclamación; Link ejecuta la transición por
        // reserva + órdenes confirmadas a las Pi, nunca desde el navegador.
        if (request.method === "POST" && url.pathname === "/api/v1/pool/claim") {
            return await poolClaim(request, env);
        }

        // ==================================================
        // ### FIX
        // SRT ALLOCATE
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/srt/allocate"
        ) {

            return await srtAllocate(request, env);

        }

        // ==================================================
        // ### FIX
        // SRT RELEASE
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/srt/release"
        ) {

            return await srtRelease(request, env);

        }

        // ==================================================
        // ### FIX — SRT RENDEZVOUS
        // ==================================================
        if (request.method === "GET" && url.pathname === "/api/v1/rendezvous") {
            return await rendezvousPoll(request, env);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/rendezvous/ready") {
            return await rendezvousReady(request, env);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/rendezvous/result") {
            return await rendezvousResult(request, env);
        }
        // ### FIX — NATIVE-OWNED CONNECTION ORCHESTRATION
        if (request.method === "POST" && url.pathname === "/api/v1/connection/request") return await connectionRequest(request, env);
        if (request.method === "GET" && url.pathname === "/api/v1/connection/poll") return await connectionPoll(request, env);
        if (request.method === "POST" && url.pathname === "/api/v1/connection/claim") return await connectionClaim(request, env);
        if (request.method === "GET" && url.pathname === "/api/v1/connection/status") return await connectionStatus(request, env);
        if (request.method === "POST" && url.pathname === "/api/v1/connection/activate") return await connectionActivate(request, env);
        if (request.method === "POST" && url.pathname === "/api/v1/connection/ready") return await connectionReady(request, env);
        if (request.method === "POST" && url.pathname === "/api/v1/connection/cancel") return await connectionCancel(request, env);

        // ==================================================
        // DEVICES LIST
        // ==================================================

        if (
            request.method === "GET" &&
            url.pathname === "/api/v1/devices"
        ) {

            return await devicesGet(request, env);

        }

        // ==================================================
        // ### FIX
        // DEVICE DELETE
        // ==================================================

        if (
            request.method === "DELETE" &&
            url.pathname.startsWith("/api/v1/device/")
        ) {

            return await deviceDelete(request, env);

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
