import { exportJWK, generateKeyPair, SignJWT, type JWK, type JSONWebKeySet } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createFirebaseVerifier, type KeySet } from "./firebaseToken";

// El rol de propietario necesita `email` y `email_verified` de un token YA verificado. Claves RSA en memoria; tokens
// sintéticos, ningún uid ni cuenta real.

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "kid-main", alg: "RS256", use: "sig" };
const set: JSONWebKeySet = { keys: [jwk] };

function verifier() {
  const loadKeys = vi.fn<(signal: AbortSignal) => Promise<KeySet>>(() => Promise.resolve({ keys: set, expiresAt: NOW + 3_600_000 }));
  return createFirebaseVerifier({ loadKeys, now: () => NOW });
}

async function sign(extra: Record<string, unknown>) {
  return new SignJWT({
    iss: "https://securetoken.google.com/dialonapp",
    aud: "dialonapp",
    sub: "uid-ficticio",
    iat: NOW_S - 60,
    exp: NOW_S + 3000,
    auth_time: NOW_S - 120,
    ...extra,
  })
    .setProtectedHeader({ alg: "RS256", kid: "kid-main" })
    .sign(privateKey);
}

const signal = () => new AbortController().signal;

describe("claims de identidad verificados", () => {
  it("expone email y emailVerified del token verificado", async () => {
    const token = await sign({ email: "persona@example.com", email_verified: true });
    await expect(verifier().verify(`Bearer ${token}`, signal())).resolves.toEqual({
      ok: true,
      uid: "uid-ficticio",
      email: "persona@example.com",
      emailVerified: true,
    });
  });

  it("email_verified ausente o no booleano cuenta como no verificado; un email no string no se expone", async () => {
    const missing = await sign({ email: "persona@example.com" });
    await expect(verifier().verify(`Bearer ${missing}`, signal())).resolves.toEqual({
      ok: true,
      uid: "uid-ficticio",
      email: "persona@example.com",
      emailVerified: false,
    });
    const weird = await sign({ email: 42, email_verified: "true" });
    await expect(verifier().verify(`Bearer ${weird}`, signal())).resolves.toEqual({
      ok: true,
      uid: "uid-ficticio",
      emailVerified: false,
    });
  });
});
