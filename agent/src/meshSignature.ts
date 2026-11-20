import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The Mesh Cloud signs every webhook call (mesh-cloud/app/Services/MeshSignature.php):
 *
 *   Mesh-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Refuse a t more than 5 minutes off.
 */
export const MESH_SIGNATURE_HEADER = "mesh-signature";

export function signMesh(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function verifyMesh(
  secret: string,
  header: string | undefined,
  body: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const m = header?.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${m[1]}.${body}`).digest();
  const given = Buffer.from(m[2], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
