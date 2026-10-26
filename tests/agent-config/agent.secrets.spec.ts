import { randomBytes } from 'node:crypto';
import {
  decryptAgentSecrets,
  encryptAgentSecrets,
  loadAgentEncryptionKey,
  type AgentSecrets,
} from '@gitroom/nestjs-libraries/chat/agent.secrets';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const SECRETS: AgentSecrets = {
  providerApiKey: 'sk-org-provider',
  mcpBearerTokens: { 'shared-crm': 'crm-token' },
  langfuse: { publicKey: 'pk-lf', secretKey: 'sk-lf' },
};

describe('agent secrets', () => {
  it('round-trips organization credentials', () => {
    const ciphertext = encryptAgentSecrets('org-1', SECRETS, KEY);

    expect(decryptAgentSecrets('org-1', ciphertext, KEY)).toEqual(SECRETS);
  });

  it('produces different ciphertext for identical plaintext', () => {
    const first = encryptAgentSecrets('org-1', SECRETS, KEY);
    const second = encryptAgentSecrets('org-1', SECRETS, KEY);

    expect(first).not.toEqual(second);
    expect(decryptAgentSecrets('org-1', second, KEY)).toEqual(SECRETS);
  });

  it('rejects ciphertext copied to another organization', () => {
    const ciphertext = encryptAgentSecrets('org-1', SECRETS, KEY);

    expect(() => decryptAgentSecrets('org-2', ciphertext, KEY)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const ciphertext = encryptAgentSecrets('org-1', SECRETS, KEY);
    const parts = ciphertext.split('.');
    const payload = Buffer.from(parts[3], 'base64url');
    payload[0] = payload[0] ^ 0xff;
    parts[3] = payload.toString('base64url');

    expect(() => decryptAgentSecrets('org-1', parts.join('.'), KEY)).toThrow();
  });

  it('rejects the wrong encryption key', () => {
    const ciphertext = encryptAgentSecrets('org-1', SECRETS, KEY);

    expect(() => decryptAgentSecrets('org-1', ciphertext, OTHER_KEY)).toThrow();
  });

  it('rejects an unsupported ciphertext version', () => {
    const ciphertext = encryptAgentSecrets('org-1', SECRETS, KEY);

    expect(() =>
      decryptAgentSecrets('org-1', ciphertext.replace('v1.', 'v2.'), KEY)
    ).toThrow();
  });
});

describe('loadAgentEncryptionKey', () => {
  it('accepts a base64 32-byte key', () => {
    const encoded = randomBytes(32).toString('base64');

    const key = loadAgentEncryptionKey({ POSTIZ_AI_ENCRYPTION_KEY: encoded });

    expect(key).toHaveLength(32);
  });

  it('accepts a hex 32-byte key', () => {
    const encoded = randomBytes(32).toString('hex');

    const key = loadAgentEncryptionKey({ POSTIZ_AI_ENCRYPTION_KEY: encoded });

    expect(key).toHaveLength(32);
  });

  it('returns null when the key is absent', () => {
    expect(loadAgentEncryptionKey({})).toBeNull();
  });

  it('rejects a key with the wrong length', () => {
    expect(() =>
      loadAgentEncryptionKey({ POSTIZ_AI_ENCRYPTION_KEY: 'c2hvcnQ=' })
    ).toThrow(/32 bytes/);
  });
});
