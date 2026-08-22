import chokidar from 'chokidar';
import { toRel } from './paths.mjs';

/**
 * Watch the whole root and broadcast every .scad change to all SSE subscribers.
 *
 * The server deliberately does not track which model each client has open: the
 * client already holds its bundle's file list and filters events itself. That
 * keeps this stateless and makes several tabs on different models work for free.
 */
export function createWatcher(root) {
  const clients = new Set();

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => /(^|[/\\])\.[^/\\]/.test(p) || /[/\\]node_modules([/\\]|$)/.test(p),
    // Editors that save via write-to-temp-then-rename otherwise fire on a
    // half-written file, which OpenSCAD would then fail to parse.
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  });

  // Every file is broadcast, not just .scad: a model can import() an STL or
  // surface() a PNG, and editing those should refresh the view too. The client
  // filters against its own bundle, so the extra traffic costs nothing.
  for (const type of ['add', 'change', 'unlink']) {
    watcher.on(type, (abs) => broadcast({ type, path: toRel(root, abs) }));
  }

  function broadcast(event) {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  function subscribe(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this, a proxy in front of the dev server can sit on the stream.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);

    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  }

  return { subscribe, close: () => watcher.close(), get clientCount() { return clients.size; } };
}
