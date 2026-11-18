import { THUMBNAIL_POLICY as policy } from "./policy.js";

export async function readLimited(request, limit) {
    const length = request.headers.get("Content-Length");
    if (length !== null && !/^\d+$/.test(length)) return { status: 400 };
    if (Number(length) > limit) return { status: 413 };
    const reader = request.body?.getReader();
    if (!reader) return { status: 400 };
    const buffer = new Uint8Array(limit);
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (size + value.length > limit) {
                await reader.cancel();
                return { status: 413 };
            }
            buffer.set(value, size);
            size += value.length;
        }
    } finally {
        reader.releaseLock();
    }
    if (length !== null && Number(length) !== size) return { status: 400 };
    return { bytes: buffer.subarray(0, size) };
}

// Walk length-delimited segments and stuffed entropy bytes without decoding pixels.
export function validJpeg(bytes) {
    const word = i => bytes[i] * 256 + bytes[i + 1];
    if (word(0) !== 0xffd8) return false;
    let frame = false;
    let scanning = false;
    let sawScan = false;
    for (let i = 2; i < bytes.length;) {
        if (bytes[i++] !== 255) {
            if (scanning) continue;
            return false;
        }
        while (bytes[i] === 255) i++;
        const marker = bytes[i++];
        if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
        scanning = false;
        if (marker === 0xd9) return sawScan && i === bytes.length;
        if (i + 2 > bytes.length) return false;
        const length = word(i);
        if (length < 2 || i + length > bytes.length) return false;
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
            const height = word(i + 3), width = word(i + 5);
            const components = bytes[i + 7];
            if (frame || length !== 8 + 3 * components || !components || bytes[i + 2] !== 8 ||
                !width || width > policy.maxWidth || !height || height > policy.maxHeight) return false;
            frame = true;
        } else if (marker === 0xda) {
            if (!frame || !bytes[i + 2] || length !== 6 + 2 * bytes[i + 2]) return false;
            scanning = sawScan = true;
        } else if (!(marker >= 0xe0 && marker <= 0xef) && ![0xfe, 0xdb, 0xc4, 0xdd].includes(marker)) {
            return false;
        }
        i += length;
    }
    return false;
}
