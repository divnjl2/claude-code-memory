#!/usr/bin/env node
/**
 * crypto.cjs — AES-256-GCM encryption for claude-code-memory.
 *
 * Uses CLAUDE_MEMORY_KEY env var as the encryption key.
 * If not set, data passes through as plaintext (backwards compatible).
 *
 * Zero dependencies — Node.js `crypto` module only.
 */

'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/** Get encryption key from env, or null if not configured */
function getKey() {
  return process.env.CLAUDE_MEMORY_KEY || null;
}

/** Check if encryption is enabled */
function isEncryptionEnabled() {
  return !!getKey();
}

/**
 * Derive a 256-bit key from passphrase using PBKDF2.
 * @param {string} passphrase
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt data with AES-256-GCM.
 * Returns base64-encoded string: salt(32) + iv(16) + authTag(16) + ciphertext
 * If no key configured, returns data unchanged.
 *
 * @param {string|Buffer} data - Data to encrypt
 * @param {string} [keyOverride] - Optional key (defaults to CLAUDE_MEMORY_KEY)
 * @returns {string} Encrypted base64 string, or original data if no key
 */
function encrypt(data, keyOverride) {
  const passphrase = keyOverride || getKey();
  if (!passphrase) return typeof data === 'string' ? data : data.toString();

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const input = typeof data === 'string' ? data : data.toString();
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt + iv + authTag + ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt AES-256-GCM encrypted data.
 * If no key configured, returns data unchanged.
 *
 * @param {string} encryptedBase64 - Base64-encoded encrypted data
 * @param {string} [keyOverride] - Optional key (defaults to CLAUDE_MEMORY_KEY)
 * @returns {string} Decrypted string
 * @throws {Error} If decryption fails (wrong key, corrupted data)
 */
function decrypt(encryptedBase64, keyOverride) {
  const passphrase = keyOverride || getKey();
  if (!passphrase) return encryptedBase64;

  // Check if data looks encrypted (valid base64 with minimum length)
  const minLen = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH; // Header size (empty plaintext = 0 ciphertext bytes)
  let combined;
  try {
    combined = Buffer.from(encryptedBase64, 'base64');
  } catch {
    // Not base64 — return as-is (unencrypted data)
    return encryptedBase64;
  }

  if (combined.length < minLen) {
    // Too short to be encrypted — return as-is
    return encryptedBase64;
  }

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Encrypt a file in place.
 * @param {string} filePath
 * @param {string} [keyOverride]
 */
function encryptFile(filePath, keyOverride) {
  const fs = require('fs');
  const data = fs.readFileSync(filePath);
  const encrypted = encrypt(data, keyOverride);
  fs.writeFileSync(filePath, encrypted);
}

/**
 * Decrypt a file in place.
 * @param {string} filePath
 * @param {string} [keyOverride]
 */
function decryptFile(filePath, keyOverride) {
  const fs = require('fs');
  const data = fs.readFileSync(filePath, 'utf-8');
  const decrypted = decrypt(data, keyOverride);
  fs.writeFileSync(filePath, decrypted);
}

module.exports = {
  encrypt,
  decrypt,
  encryptFile,
  decryptFile,
  isEncryptionEnabled,
  getKey,
  deriveKey,
};
