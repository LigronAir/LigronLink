// ==========================================================
// LigronLink
// security/hash.js
// Hash y verificación de contraseñas
// ==========================================================

const PBKDF2_PREFIX = "pbkdf2_sha256";
// Se conserva aquí, junto al formato, para poder aumentar el coste con una
// migración explícita posterior sin dejar hashes ambiguos en D1.
// Web Crypto en Cloudflare Workers limita PBKDF2 a 100.000 iteraciones.
// Usar ese máximo conserva el endurecimiento sin bloquear login ni bootstrap.
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const LEGACY_SHA256 = /^[a-f0-9]{64}$/i;

function toBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value) {
    try {
        return Uint8Array.from(atob(value), character => character.charCodeAt(0));
    }
    catch {
        return null;
    }
}

function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

async function pbkdf2(password, salt, iterations) {
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        passwordKey,
        HASH_BITS
    );
    return new Uint8Array(bits);
}

async function legacySha256(password) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const digest = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(digest)}`;
}

// Acepta SHA-256 sólo como puente para cuentas existentes. Una verificación
// válida indica al llamador que debe sustituirlo inmediatamente por PBKDF2.
export async function verifyPassword(password, storedHash) {
    const stored = String(storedHash || "");
    if (LEGACY_SHA256.test(stored)) {
        const candidate = await legacySha256(password);
        const valid = equalBytes(
            new TextEncoder().encode(candidate),
            new TextEncoder().encode(stored.toLowerCase())
        );
        return {
            valid,
            needsRehash: valid
        };
    }

    const [prefix, iterationsText, saltText, digestText] = stored.split("$");
    const iterations = Number(iterationsText);
    const salt = fromBase64(saltText || "");
    const expected = fromBase64(digestText || "");
    if (prefix !== PBKDF2_PREFIX || !Number.isInteger(iterations) || iterations < 100000 || iterations > PBKDF2_ITERATIONS || !salt || salt.length < SALT_BYTES || !expected || expected.length !== HASH_BITS / 8) {
        return { valid: false, needsRehash: false };
    }

    const candidate = await pbkdf2(password, salt, iterations);
    return {
        valid: equalBytes(candidate, expected),
        needsRehash: iterations < PBKDF2_ITERATIONS
    };
}
