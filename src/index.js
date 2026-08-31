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
import { srtReceivers } from "./api/srtReceivers.js";
import { srtDestinations } from "./api/srtDestinations.js";

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