// ==========================================================
// LigronLink
// src/index.js
// Router principal
// ==========================================================

import { register } from "./api/register.js";
import { login } from "./api/login.js";
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
import { connectionRequest, connectionPoll, connectionClaim, connectionStatus, connectionActivate, connectionReady } from "./api/connectionRequests.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    // ### FIX
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

        // ==================================================
        // DEVICE REGISTER
        // ==================================================

        if (
            request.method === "POST" &&
            url.pathname === "/api/v1/device/register"
        ) {

            return await deviceRegister(request, env);

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
