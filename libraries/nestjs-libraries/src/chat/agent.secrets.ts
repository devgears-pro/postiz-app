import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type AgentSecrets = {
  providerApiKey?: string;
  mcpBearerTokens?: Record<string, string>;
};

const agentSecretsSchema = z
  .object({
    providerApiKey: z.string().min(1).optional(),
    mcpBearerTokens: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();

const associatedData = (organizationId: string) =>
  Buffer.from(`postiz-agent-config:${VERSION}:${organizationId}`, 'utf8');

export const isEmptyAgentSecrets = (secrets: AgentSecrets) =>
  !secrets.providerApiKey &&
  Object.keys(secrets.mcpBearerTokens ?? {}).length === 0;

export type AgentSecretSummary = {
  providerApiKey: boolean;
  mcp: string[];
};

export const summarizeAgentSecrets = (
  secrets: AgentSecrets
): AgentSecretSummary => ({
  providerApiKey: Boolean(secrets.providerApiKey),
  mcp: Object.keys(secrets.mcpBearerTokens ?? {}).sort(),
});

export function encryptAgentSecrets(
  organizationId: string,
  secrets: AgentSecrets,
  key: Buffer
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(associatedData(organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptAgentSecrets(
  organizationId: string,
  payload: string,
  key: Buffer
): AgentSecrets {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unsupported agent secret payload');
  }

  const ivBuffer = Buffer.from(iv, 'base64url');
  const tagBuffer = Buffer.from(tag, 'base64url');
  if (ivBuffer.length !== IV_BYTES || tagBuffer.length !== TAG_BYTES) {
    throw new Error('Malformed agent secret payload');
  }

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAAD(associatedData(organizationId));
  decipher.setAuthTag(tagBuffer);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]);

  return agentSecretsSchema.parse(
    JSON.parse(plaintext.toString('utf8'))
  ) as AgentSecrets;
}

export function loadAgentEncryptionKey(
  env: Readonly<Record<string, string | undefined>>
): Buffer | null {
  const raw = env.POSTIZ_AI_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error('POSTIZ_AI_ENCRYPTION_KEY must be 32 bytes (hex or base64)');
  }

  return key;
}
