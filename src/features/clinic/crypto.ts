const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERIFIER_TEXT = "TAGES-ANNA-CLINICAL-VAULT-V2";
const VERIFIER_AAD = "tages-anna:vault-verifier:v2";
const PBKDF2_ITERATIONS = 600_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export function clinicalAad(patientId: string) {
  return `tages-anna:clinical-note:v2:patient:${patientId}`;
}

export function isStrongVaultPassphrase(value: string) {
  if (value.length < 16) return false;
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  return groups >= 3;
}

export async function deriveVaultKey(passphrase: string, saltBase64: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltBase64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(key: CryptoKey, plaintext: string, aad?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv,
    ...(aad ? { additionalData: encoder.encode(aad) } : {}),
  };
  const encrypted = await crypto.subtle.encrypt(algorithm, key, encoder.encode(plaintext));
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptText(key: CryptoKey, ciphertext: string, iv: string, aad?: string) {
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: base64ToBytes(iv),
    ...(aad ? { additionalData: encoder.encode(aad) } : {}),
  };
  const decrypted = await crypto.subtle.decrypt(algorithm, key, base64ToBytes(ciphertext));
  return decoder.decode(decrypted);
}

export async function createVaultVerifier(passphrase: string) {
  const salt = randomSalt();
  const key = await deriveVaultKey(passphrase, salt);
  const encrypted = await encryptText(key, VERIFIER_TEXT, VERIFIER_AAD);
  return { salt, key, ciphertext: encrypted.ciphertext, iv: encrypted.iv };
}

export async function unlockVault(passphrase: string, salt: string, ciphertext: string, iv: string) {
  try {
    const key = await deriveVaultKey(passphrase, salt);
    const value = await decryptText(key, ciphertext, iv, VERIFIER_AAD);
    return value === VERIFIER_TEXT ? key : null;
  } catch {
    return null;
  }
}
