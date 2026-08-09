import { API_BASE } from "@/lib/api-base";

const DASHBOARD = "https://supabase.com/dashboard";
const PROXY = `${API_BASE}/api/supabase-mgmt/proxy`;

export interface LoginSession {
  sessionId: string;
  url: string;
  submit: (deviceCode: string) => Promise<string>;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out.buffer as ArrayBuffer;
}

export async function createLoginSession(): Promise<LoginSession> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;

  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = toHex(rawPub);
  const sessionId = crypto.randomUUID();

  const tokenName = encodeURIComponent(
    `rexadb_${typeof navigator !== "undefined" ? navigator.userAgent : "app"}_${Date.now()}`,
  );

  const url =
    `${DASHBOARD}/cli/login` +
    `?session_id=${sessionId}` +
    `&token_name=${tokenName}` +
    `&public_key=${publicKeyHex}`;

  const submit = async (deviceCode: string): Promise<string> => {
    const res = await fetch(
      `${PROXY}/platform/cli/login/${sessionId}?device_code=${encodeURIComponent(deviceCode)}`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Login failed (${res.status}): ${text}`);
    }

    const {
      access_token: encHex,
      public_key: serverPubHex,
      nonce: nonceHex,
    } = (await res.json()) as {
      access_token: string;
      public_key: string;
      nonce: string;
    };

    const serverPubKey = await crypto.subtle.importKey(
      "raw",
      fromHex(serverPubHex),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: serverPubKey },
      keyPair.privateKey,
      256,
    );

    const aesKey = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromHex(nonceHex) },
      aesKey,
      fromHex(encHex),
    );

    return new TextDecoder().decode(decrypted);
  };

  return { sessionId, url, submit };
}
