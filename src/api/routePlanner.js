// ==========================================================
// LigronLink - planificador único de rutas de media
// ==========================================================
// El navegador no decide cómo circula el vídeo. Esta política se reutiliza
// para el panel y para la asignación SRT; así lo que se ve es lo que Link usa.

function privateLan(address) {
    const parts = String(address || "").split(".").map(Number);
    const valid = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    return valid && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) ? parts : null;
}

function samePrivateLan(left, right) {
    const a = privateLan(left);
    const b = privateLan(right);
    return Boolean(a && b && a.slice(0, 3).join(".") === b.slice(0, 3).join("."));
}

function tailscaleEndpoint(capabilities) {
    const address = String(capabilities?.tailscale_ipv4_address || "").trim();
    return /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ? address : "";
}

function candidate(id, label, state, reason) {
    return { id, label, state, reason, selectable: state === "READY" };
}

export function publicRoutePlan(plan) {
    return {
        selected_transport: plan.selected?.id || null,
        selected_label: plan.selected?.label || "Sin ruta disponible",
        selected_reason: plan.selected?.reason || "No hay una ruta comprobada.",
        candidates: plan.candidates
    };
}

export function buildRoutePlan({ pi, native, piNetwork = {}, nativeNetwork = {}, relay = null }) {
    const bothOnline = String(pi?.estado || "").toUpperCase() === "ONLINE"
        && String(native?.estado || "").toUpperCase() === "ONLINE";
    const piTailnet = String(piNetwork.tailscale_tailnet || "").trim().toLowerCase();
    const nativeTailnet = String(nativeNetwork.tailscale_tailnet || "").trim().toLowerCase();
    const nativeTailAddress = tailscaleEndpoint(nativeNetwork);
    const tailReady = bothOnline && piNetwork.tailscale_available === true && nativeNetwork.tailscale_available === true
        && Boolean(piTailnet) && piTailnet === nativeTailnet && Boolean(nativeTailAddress);
    const lanReady = bothOnline && samePrivateLan(piNetwork.ipv4_address, nativeNetwork.ipv4_address);
    const offlineReason = "Pi y Native deben estar ONLINE en LigronLink.";
    const candidates = [
        relay
            ? candidate("LIGRONRELAY_SRT", "LigronRelay", bothOnline ? "READY" : "UNAVAILABLE", bothOnline
                ? "Ruta principal: ambos equipos salen al relay; no requiere abrir puertos ni una IP pública."
                : offlineReason)
            : candidate("LIGRONRELAY_SRT", "LigronRelay", "UNAVAILABLE", "Infraestructura relay todavía no desplegada. No se seleccionará hasta estar configurada."),
        candidate("TAILSCALE_DIRECT_CALLER", "LigronTail directo", tailReady ? "READY" : "UNAVAILABLE", tailReady
            ? `Reserva privada comprobada: ${piNetwork.tailscale_ipv4_address} → ${nativeTailAddress}.`
            : !bothOnline ? offlineReason : "Requiere Pi y Native activos en el mismo tailnet. Una VPN de terceros puede bloquear el UDP de la aplicación."),
        candidate("LAN_DIRECT_CALLER", "LAN directa", lanReady ? "READY" : "UNAVAILABLE", lanReady
            ? `Ambos equipos están en la misma LAN: ${piNetwork.ipv4_address} → ${nativeNetwork.ipv4_address}.`
            : !bothOnline ? offlineReason : "Solo se utiliza si Pi y Native comparten la misma subred privada."),
        candidate("IPV6_DIRECT_CALLER", "IPv6 directa", "UNAVAILABLE", "Reservada para una IP IPv6 global y un listener dedicado. No se activa con fe80:: ni con IPv6 de Tailscale."),
        candidate("UPNP_DIRECT_CALLER", "UPnP / puerto público", "UNAVAILABLE", "No se selecciona automáticamente: necesita una comprobación real de accesibilidad y no resuelve VPN de escritorio o CGNAT.")
    ];
    return { candidates, selected: candidates.find((item) => item.selectable) || null };
}

export function buildSrtCallerUrl(host, port) {
    const normalizedHost = String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
    return `srt://${normalizedHost}:${port}?mode=caller`;
}
