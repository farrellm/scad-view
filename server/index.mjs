#!/usr/bin/env node
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { safeResolve, UnsafePathError } from './paths.mjs';
import { buildTree } from './tree.mjs';
import { collectBundle } from './deps.mjs';
import { createWatcher } from './watch.mjs';

const PKG_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

function parseArgs(argv) {
  const opts = { root: process.cwd(), port: 8173, host: '127.0.0.1' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  if (rest.length) opts.root = rest[0];
  return opts;
}

const USAGE = `Usage: scad-view [root] [--port N] [--host H]

  root    directory of .scad models to browse (default: current directory)
  --port  port to listen on (default: 8173)
  --host  interface to bind (default: 127.0.0.1)
`;

export async function createApp(root, watcher) {
  const app = express();

  app.get('/api/root', (_req, res) => res.json({ root, name: path.basename(root) }));

  app.get('/api/tree', async (_req, res, next) => {
    try {
      res.json({ root: path.basename(root), children: await buildTree(root) });
    } catch (e) { next(e); }
  });

  app.get('/api/bundle', async (req, res, next) => {
    try {
      const rel = String(req.query.path ?? '');
      const abs = await safeResolve(root, rel); // validate the entry before walking
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile()) return res.status(404).json({ error: 'not a file' });
      res.json(await collectBundle(root, rel));
    } catch (e) {
      if (e instanceof UnsafePathError) return res.status(400).json({ error: e.message });
      next(e);
    }
  });

  app.get('/api/events', (req, res) => watcher.subscribe(req, res));

  // Built frontend, when it exists. In dev, Vite serves this and proxies /api here.
  const dist = path.join(PKG_ROOT, 'web/dist');
  if (await stat(dist).then(() => true, () => false)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: String(err?.message ?? err) });
  });

  return app;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(USAGE); return; }

  let root;
  try {
    root = await realpath(path.resolve(opts.root));
  } catch {
    console.error(`No such directory: ${opts.root}`);
    process.exit(1);
  }
  if (!(await stat(root)).isDirectory()) {
    console.error(`Not a directory: ${root}`);
    process.exit(1);
  }

  const watcher = createWatcher(root);
  const app = await createApp(root, watcher);

  const server = app.listen(opts.port, opts.host, () => {
    console.log(`scad-view serving ${root}`);
    console.log(`  http://${opts.host}:${opts.port}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { watcher.close(); server.close(() => process.exit(0)); });
  }
}

if (process.argv[1] && (await realpath(process.argv[1])) === (await realpath(fileURLToPath(import.meta.url)))) {
  main();
}
