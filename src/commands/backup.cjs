#!/usr/bin/env node
/**
 * backup.cjs — AES-256 encrypted backup of all memory.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createGzip } = require('zlib');
const { pipeline } = require('stream');

const { getMemoryDir, forwardSlash } = require('../lib/path-resolver.cjs');
const { encrypt, isEncryptionEnabled } = require('../lib/crypto.cjs');

function backup(flags) {
  const projectRoot = process.cwd();
  const memoryDir = getMemoryDir(projectRoot);
  const output = flags.output || `claude-memory-backup-${Date.now()}.json`;
  const outputPath = path.resolve(projectRoot, output);

  console.log('claude-code-memory: Creating backup...\n');

  if (!fs.existsSync(memoryDir)) {
    console.error('Error: No .claude-memory/ directory found.');
    console.error('Run `npx claude-code-memory init` first.');
    process.exit(1);
  }

  // Collect all files
  const files = {};
  function collectFiles(dir, prefix) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git') continue; // Skip git internals
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          collectFiles(fullPath, relPath);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            // Skip files larger than 50MB
            if (stat.size > 50 * 1024 * 1024) continue;

            // Read as base64 for binary safety
            const content = fs.readFileSync(fullPath);
            files[relPath] = {
              size: stat.size,
              modified: stat.mtime.toISOString(),
              content: content.toString('base64'),
            };
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  collectFiles(memoryDir, '');

  const backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    projectRoot: forwardSlash(projectRoot),
    fileCount: Object.keys(files).length,
    encrypted: isEncryptionEnabled(),
    files,
  };

  // Serialize
  let data = JSON.stringify(backup, null, 2);

  // Encrypt if key is set
  if (isEncryptionEnabled()) {
    console.log('Encrypting backup with CLAUDE_MEMORY_KEY...');
    data = encrypt(data);
  }

  // Write
  fs.writeFileSync(outputPath, data);

  const sizeMB = Math.round(fs.statSync(outputPath).size / 1024 / 1024 * 100) / 100;

  console.log(`Backup created: ${forwardSlash(outputPath)}`);
  console.log(`Files: ${Object.keys(files).length}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log(`Encrypted: ${isEncryptionEnabled() ? 'YES' : 'NO'}`);
  console.log('');
  console.log('To restore, use the backup file with `npx claude-code-memory restore`');
}

module.exports = backup;
