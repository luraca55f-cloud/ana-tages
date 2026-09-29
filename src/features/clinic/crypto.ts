const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LEGACY_VERIFIER_TEXT = "TAGES-ANNA-CLINICAL-VAULT-V2";
const LEGACY_VERIFIER_AAD = "tages-anna:vault-verifier:v2";
const PASSWORD_WRAP_AAD = "tages-anna:vault-key-wrap:password:v3";
const RECOVERY_WRAP_AAD = "tages-anna:vault-key-wrap:recovery:v3";
const PBKDF2_ITERATIONS = 600_000;

export type VaultKeyEnvelope = {
  salt: string;
  ciphertext: string;
  iv: string;
};

export type RecoverableVault = {
  key: CryptoKey;
  password: VaultKeyEnvelope;
  recovery: VaultKeyEnvelope;
  recoveryCode: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(size: number) {
  return crypto.getRandomValues(new Uint8Array(size));
}

function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-F0-9]/g, "");
}

function generateRecoveryCode() {
  const hex = Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return hex.match(/.{1,4}/g)?.join("-") ?? hex;
}

export function randomSalt() {
  return bytesToBase64(randomBytes(16));
}

export function clinicalAad(patientId: string) {
  return `tages-anna:clinical-note:v2:patient:${patientId}`;
}

// A senha do cofre não possui requisito mínimo imposto pela aplicação.
// Ela nunca é persistida: serve apenas para derivar uma chave de proteção local.
export function isValidVaultPassphrase(value: string) {
  return value.length > 0;
}

async function deriveWrappingKey(secret: string, saltBase64: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
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

// Mantido para abrir cofres legados v2. extractable=true é proposital: ao desbloquear
// um cofre antigo, a mesma chave de conteúdo é encapsulada na arquitetura recuperável v3
// sem recriptografar prontuários já existentes.
export async function deriveLegacyVaultKey(passphrase: string, saltBase64: string) {
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
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(key: CryptoKey, plaintext: string, aad?: string) {
  const iv = randomBytes(12);
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

async function wrapVaultKey(key: CryptoKey, secret: string, aad: string): Promise<VaultKeyEnvelope> {
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const salt = randomSalt();
  const wrappingKey = await deriveWrappingKey(secret, salt);
  const encrypted = await encryptText(wrappingKey, bytesToBase64(rawKey), aad);
  return { salt, ciphertext: encrypted.ciphertext, iv: encrypted.iv };
}

async function unwrapVaultKey(secret: string, envelope: VaultKeyEnvelope, aad: string) {
  try {
    const wrappingKey = await deriveWrappingKey(secret, envelope.salt);
    const rawBase64 = await decryptText(wrappingKey, envelope.ciphertext, envelope.iv, aad);
    return await crypto.subtle.importKey(
      "raw",
      base64ToBytes(rawBase64),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}


export async function exportVaultKeyBase64(key: CryptoKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToBase64(raw);
}

export async function importVaultKeyBase64(rawBase64: string) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawBase64),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function createRecoverableVault(passphrase: string): Promise<RecoverableVault> {
  if (!isValidVaultPassphrase(passphrase)) throw new Error("Informe uma senha para o cofre.");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const recoveryCode = generateRecoveryCode();
  const [password, recovery] = await Promise.all([
    wrapVaultKey(key, passphrase, PASSWORD_WRAP_AAD),
    wrapVaultKey(key, normalizeRecoveryCode(recoveryCode), RECOVERY_WRAP_AAD),
  ]);
  return { key, password, recovery, recoveryCode };
}

export async function createRecoverableEnvelopeForExistingKey(passphrase: string, key: CryptoKey): Promise<Omit<RecoverableVault, "key">> {
  if (!isValidVaultPassphrase(passphrase)) throw new Error("Informe a senha atual do cofre.");
  const recoveryCode = generateRecoveryCode();
  const [password, recovery] = await Promise.all([
    wrapVaultKey(key, passphrase, PASSWORD_WRAP_AAD),
    wrapVaultKey(key, normalizeRecoveryCode(recoveryCode), RECOVERY_WRAP_AAD),
  ]);
  return { password, recovery, recoveryCode };
}

export async function unlockRecoverableVault(passphrase: string, envelope: VaultKeyEnvelope) {
  if (!passphrase) return null;
  return unwrapVaultKey(passphrase, envelope, PASSWORD_WRAP_AAD);
}

export async function recoverVaultWithCode(recoveryCode: string, envelope: VaultKeyEnvelope) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (!normalized) return null;
  return unwrapVaultKey(normalized, envelope, RECOVERY_WRAP_AAD);
}

export async function createPasswordEnvelope(key: CryptoKey, newPassphrase: string) {
  if (!isValidVaultPassphrase(newPassphrase)) throw new Error("Informe a nova senha do cofre.");
  return wrapVaultKey(key, newPassphrase, PASSWORD_WRAP_AAD);
}

export async function createRecoveryEnvelope(key: CryptoKey) {
  const recoveryCode = generateRecoveryCode();
  const recovery = await wrapVaultKey(key, normalizeRecoveryCode(recoveryCode), RECOVERY_WRAP_AAD);
  return { recoveryCode, recovery };
}

// Compatibilidade com o cofre v2. A chave resultante continua sendo a mesma usada
// para cifrar as evoluções antigas, permitindo migração para v3 sem perda de dados.
export async function unlockLegacyVault(passphrase: string, salt: string, ciphertext: string, iv: string) {
  try {
    const key = await deriveLegacyVaultKey(passphrase, salt);
    const value = await decryptText(key, ciphertext, iv, LEGACY_VERIFIER_AAD);
    return value === LEGACY_VERIFIER_TEXT ? key : null;
  } catch {
    return null;
  }
}
