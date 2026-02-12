#!/usr/bin/env node
/**
 * claude-code-memory CLI
 *
 * 4-layer persistent memory for Claude Code.
 *
 * Usage:
 *   npx claude-code-memory          # = setup (default)
 *   npx claude-code-memory setup    # Install hooks globally
 *   npx claude-code-memory init     # Initialize memory in current project
 *   npx claude-code-memory status   # Show health of all 4 layers
 *   npx claude-code-memory cleanup  # Manual cleanup by importance/age
 *   npx claude-code-memory backup   # Encrypted export of all memory
 *   npx claude-code-memory uninstall # Clean removal
 */

'use strict';

const VERSION = require('../package.json').version;

const args = process.argv.slice(2);
const command = args[0] || 'setup';

// Handle version/help first
if (command === '--version' || command === '-v') {
  console.log(`claude-code-memory v${VERSION}`);
  process.exit(0);
}

if (command === '--help' || command === '-h') {
  console.log(`
claude-code-memory v${VERSION}
4-layer persistent memory for Claude Code

Usage:
  npx claude-code-memory [command] [options]

Commands:
  setup      Install hooks globally (default)
  init       Initialize memory in current project
  status     Show health of all 4 layers
  cleanup    Manual cleanup by importance/age
  backup     Encrypted export of all memory
  uninstall  Clean removal of hooks and files
  gepa       GEPA v2.1 memory paradigm (enable|disable|status|reflect|...)
  bench      Run memory system benchmarks (recall|persist|fitness|effort|context|drift|all)

Options:
  --help, -h       Show this help
  --version, -v    Show version
  --dry-run        Preview changes without applying
  --force          Skip confirmation prompts

Documentation: https://github.com/divnjl2/claude-code-memory
`);
  process.exit(0);
}

// Parse flags
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
}

// Command dispatch
const commands = {
  setup: '../src/commands/setup.cjs',
  init: '../src/commands/init.cjs',
  status: '../src/commands/status.cjs',
  cleanup: '../src/commands/cleanup.cjs',
  backup: '../src/commands/backup.cjs',
  uninstall: '../src/commands/uninstall.cjs',
  gepa: '../src/commands/gepa.cjs',
  bench: '../src/commands/bench.cjs',
};

// GEPA subcommand parsing: `gepa enable`, `gepa promote <id>`, etc.
if (command === 'gepa') {
  const gepaSubIdx = args.indexOf('gepa');
  const gepaSub = args[gepaSubIdx + 1] || '';
  const gepaArg = args[gepaSubIdx + 2] || '';
  if (gepaSub && !gepaSub.startsWith('--')) {
    flags._sub = gepaSub;
    if (gepaArg && !gepaArg.startsWith('--')) {
      flags._arg = gepaArg;
    }
    // Handle 4th arg for `gepa effort assess --score X` etc.
    const gepaArg2 = args[gepaSubIdx + 3] || '';
    if (gepaArg2 && !gepaArg2.startsWith('--')) {
      flags._arg2 = gepaArg2;
    }
  }
}

// Bench subcommand parsing: `bench recall`, `bench all --json`, etc.
if (command === 'bench') {
  const benchSubIdx = args.indexOf('bench');
  const benchSub = args[benchSubIdx + 1] || '';
  if (benchSub && !benchSub.startsWith('--')) {
    flags._sub = benchSub;
  }
}

const commandPath = commands[command];
if (!commandPath) {
  console.error(`Unknown command: ${command}`);
  console.error('Run with --help for usage info');
  process.exit(1);
}

try {
  const handler = require(commandPath);
  handler(flags);
} catch (err) {
  console.error(`Error: ${err.message}`);
  if (flags.verbose) console.error(err.stack);
  process.exit(1);
}
