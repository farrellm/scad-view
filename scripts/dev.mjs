#!/usr/bin/env node
// Runs the API server and the Vite dev server together. Any extra arguments
// (the model root, --port) are passed through to the API server.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);

const children = [
  spawn(process.execPath, [path.join(ROOT, 'server/index.mjs'), ...args], { stdio: 'inherit', cwd: ROOT }),
  spawn('npx', ['vite'], { stdio: 'inherit', cwd: ROOT }),
];

let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
};

for (const c of children) c.on('exit', (code) => shutdown(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
