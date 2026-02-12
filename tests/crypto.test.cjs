#!/usr/bin/env node
/**
 * Tests for crypto.cjs
 * Validates: encrypt/decrypt roundtrip, key derivation, plaintext fallback
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { encrypt, decrypt, isEncryptionEnabled, deriveKey } = require('../src/lib/crypto.cjs');

describe('crypto', () => {
  const TEST_KEY = 'test-encryption-key-32-chars-ok!';

  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts short string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext, TEST_KEY);
      assert.notEqual(encrypted, plaintext);
      const decrypted = decrypt(encrypted, TEST_KEY);
      assert.equal(decrypted, plaintext);
    });

    it('encrypts and decrypts long string', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encrypt(plaintext, TEST_KEY);
      const decrypted = decrypt(encrypted, TEST_KEY);
      assert.equal(decrypted, plaintext);
    });

    it('encrypts and decrypts JSON', () => {
      const data = { nodes: [{ id: '1', content: 'test' }], count: 42 };
      const plaintext = JSON.stringify(data);
      const encrypted = encrypt(plaintext, TEST_KEY);
      const decrypted = decrypt(encrypted, TEST_KEY);
      assert.deepEqual(JSON.parse(decrypted), data);
    });

    it('encrypts and decrypts unicode', () => {
      const plaintext = 'Привет мир! 🌍 日本語';
      const encrypted = encrypt(plaintext, TEST_KEY);
      const decrypted = decrypt(encrypted, TEST_KEY);
      assert.equal(decrypted, plaintext);
    });

    it('encrypts and decrypts empty string', () => {
      const encrypted = encrypt('', TEST_KEY);
      assert.notEqual(encrypted, ''); // Empty string still produces ciphertext (salt+iv+tag)
      const decrypted = decrypt(encrypted, TEST_KEY);
      assert.equal(decrypted, '');
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'determinism test';
      const enc1 = encrypt(plaintext, TEST_KEY);
      const enc2 = encrypt(plaintext, TEST_KEY);
      assert.notEqual(enc1, enc2); // Different due to random salt+IV
      assert.equal(decrypt(enc1, TEST_KEY), plaintext);
      assert.equal(decrypt(enc2, TEST_KEY), plaintext);
    });
  });

  describe('wrong key', () => {
    it('throws on decryption with wrong key', () => {
      const encrypted = encrypt('secret data', TEST_KEY);
      assert.throws(() => decrypt(encrypted, 'wrong-key-wrong-key-wrong-key-!!'), {
        message: /Unsupported state|unable to authenticate/i,
      });
    });
  });

  describe('passthrough mode (no key)', () => {
    it('returns plaintext when no key provided', () => {
      const plaintext = 'not encrypted';
      const result = encrypt(plaintext);
      assert.equal(result, plaintext);
    });

    it('returns encrypted data unchanged when no key for decrypt', () => {
      const data = 'some data';
      const result = decrypt(data);
      assert.equal(result, data);
    });
  });

  describe('isEncryptionEnabled', () => {
    const originalKey = process.env.CLAUDE_MEMORY_KEY;

    afterEach(() => {
      if (originalKey !== undefined) {
        process.env.CLAUDE_MEMORY_KEY = originalKey;
      } else {
        delete process.env.CLAUDE_MEMORY_KEY;
      }
    });

    it('returns false when key not set', () => {
      delete process.env.CLAUDE_MEMORY_KEY;
      assert.equal(isEncryptionEnabled(), false);
    });

    it('returns true when key is set', () => {
      process.env.CLAUDE_MEMORY_KEY = 'test-key';
      assert.equal(isEncryptionEnabled(), true);
    });
  });

  describe('deriveKey', () => {
    it('produces consistent key from same passphrase+salt', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
      const key1 = deriveKey('passphrase', salt);
      const key2 = deriveKey('passphrase', salt);
      assert.deepEqual(key1, key2);
    });

    it('produces different keys from different salts', () => {
      const salt1 = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
      const salt2 = Buffer.from('fedcba9876543210fedcba9876543210', 'hex');
      const key1 = deriveKey('passphrase', salt1);
      const key2 = deriveKey('passphrase', salt2);
      assert.notDeepEqual(key1, key2);
    });

    it('produces 32-byte key', () => {
      const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
      const key = deriveKey('passphrase', salt);
      assert.equal(key.length, 32);
    });
  });
});
