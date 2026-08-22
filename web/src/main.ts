import './style.css';
import { fetchBundle, fetchRoot, fetchTree, subscribeToChanges, type Bundle } from './api';
import { parseOff } from './off';
import { Renderer } from './render/client';
import { Viewer } from './viewer';
import { FileTree } from './ui/tree';
import { LogPane } from './ui/log';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');
const overlay = $('overlay');
const modelName = $('model-name');
const qualityBadge = $('quality-badge');
const statsEl = $('stats');
const fullRenderBtn = $<HTMLButtonElement>('full-render');
const watchDot = $('watch-dot');
const logToggle = $<HTMLButtonElement>('log-toggle');

const viewer = new Viewer(canvas);
const renderer = new Renderer();
const log = new LogPane($('log'), $('log-status'));
const tree = new FileTree($('tree'), (path) => void openModel(path));

type Quality = 'preview' | 'full';

/**
 * OpenSCAD exits non-zero and writes nothing for several perfectly ordinary
 * situations. Reporting those as "produced no output" sends people hunting for a
 * bug that is not there, so translate the ones we can recognise.
 */
function explainFailure(message: string, logLines: string[]): string {
  const log = logLines.join('\n');
  if (/top level object is not a 3D object/i.test(log)) {
    return 'This is a 2D model. scad-view renders 3D geometry only — wrap it in linear_extrude() to view it.';
  }
  if (/top level object is empty/i.test(log)) {
    return /Ignoring unknown (module|function)/i.test(log)
      ? 'No geometry produced: the model uses a module or library that is not available here.'
      : 'This model produces no geometry.';
  }
  if (/memory access out of bounds/i.test(message)) {
    return 'The OpenSCAD WebAssembly build ran out of memory on this model.';
  }
  return message;
}

const state = {
  path: null as string | null,
  bundle: null as Bundle | null,
  quality: 'preview' as Quality,
  /** A full render is stale once the source changes under it. */
  fullStale: false,
  renderSeq: 0,
};

// --- rendering ---------------------------------------------------------------

async function runRender(quality: Quality, frame: boolean) {
  const bundle = state.bundle;
  if (!bundle) return;

  const seq = ++state.renderSeq;
  const logLines: string[] = [];
  setBusy(true, quality);
  log.clear();
  log.note(`$ openscad ${bundle.entry}${quality === 'preview' ? '  (preview quality)' : '  (full render)'}`);
  for (const m of bundle.missing) log.note(`! missing include: ${m.path} (${m.reason})`);

  try {
    const result = await renderer.render(
      { entry: bundle.entry, files: bundle.files, assets: bundle.assets, preview: quality === 'preview' },
      { onLog: (line) => { logLines.push(line.text); log.append(line); } },
    );
    if (seq !== state.renderSeq) return; // superseded

    const { geometry, triangles, hasColor } = parseOff(result.offText);
    viewer.setGeometry(geometry, hasColor, frame);

    state.quality = quality;
    state.fullStale = false;
    const { warnings, errors } = log.countProblems();
    const problems = [
      errors ? `${errors} error${errors > 1 ? 's' : ''}` : '',
      warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ');
    log.setStatus(
      `${triangles.toLocaleString()} triangles in ${Math.round(result.elapsedMs)} ms${problems ? ` — ${problems}` : ''}`,
      errors ? 'err' : 'ok',
    );
    statsEl.textContent = `${triangles.toLocaleString()} tris · ${Math.round(result.elapsedMs)} ms`;
    showOverlay(null);
  } catch (err) {
    if (seq !== state.renderSeq) return;
    const raw = err instanceof Error ? err.message : String(err);
    const message = explainFailure(raw, logLines);
    log.note(message);
    log.setStatus('no output', 'err');
    statsEl.textContent = '';
    // Keep the last good mesh on screen; the log explains what broke. Blanking
    // the viewport on a transient syntax error while typing is worse than stale.
    showOverlay(message);
  } finally {
    if (seq === state.renderSeq) setBusy(false, quality);
  }
}

function setBusy(busy: boolean, quality: Quality) {
  fullRenderBtn.disabled = busy || !state.bundle;
  qualityBadge.hidden = !state.bundle;
  if (busy) {
    qualityBadge.textContent = quality === 'preview' ? 'rendering…' : 'full render…';
    qualityBadge.className = 'badge busy';
    log.setStatus('rendering…', 'busy');
  } else {
    updateBadge();
  }
}

function updateBadge() {
  if (!state.bundle) { qualityBadge.hidden = true; return; }
  qualityBadge.hidden = false;
  if (state.quality === 'full' && !state.fullStale) {
    qualityBadge.textContent = 'full';
    qualityBadge.className = 'badge full';
  } else if (state.quality === 'full') {
    qualityBadge.textContent = 'full (stale)';
    qualityBadge.className = 'badge stale';
  } else {
    qualityBadge.textContent = 'preview';
    qualityBadge.className = 'badge preview';
  }
}

function showOverlay(text: string | null) {
  overlay.hidden = text === null;
  overlay.textContent = text ?? '';
}

// --- model selection ---------------------------------------------------------

const hashPath = () => (location.hash ? decodeURIComponent(location.hash.slice(1)) : '');

async function openModel(path: string) {
  state.path = path;
  tree.select(path);
  modelName.textContent = path;
  if (hashPath() !== path) location.hash = encodeURIComponent(path);

  try {
    state.bundle = await fetchBundle(path);
  } catch (err) {
    log.clear();
    log.note(`Failed to load ${path}: ${err instanceof Error ? err.message : err}`);
    log.setStatus('load failed', 'err');
    return;
  }
  await runRender('preview', /* frame */ true);
}

/** Re-read the bundle from disk; the dep set may have changed too. */
async function reloadAndRender() {
  if (!state.path) return;
  try {
    state.bundle = await fetchBundle(state.path);
  } catch (err) {
    log.note(`Failed to reload: ${err instanceof Error ? err.message : err}`);
    return;
  }
  // Auto-render is always preview quality: a full render never runs unattended.
  if (state.quality === 'full') state.fullStale = true;
  await runRender('preview', /* frame */ false);
}

// --- wiring ------------------------------------------------------------------

fullRenderBtn.onclick = () => void runRender('full', false);

logToggle.onclick = () => {
  const collapsed = document.body.classList.toggle('log-collapsed');
  logToggle.textContent = collapsed ? 'show' : 'hide';
};

let debounce: number | undefined;
subscribeToChanges(
  (event) => {
    // The server broadcasts every .scad change under the root; only the ones in
    // the model's own dependency set matter to this tab.
    const watched = state.bundle
      && (event.path in state.bundle.files || event.path in state.bundle.assets);
    if (!watched) {
      // Only .scad files appear in the tree, so only those can change its shape.
      if (event.type !== 'change' && event.path.toLowerCase().endsWith('.scad')) void refreshTree();
      return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => void reloadAndRender(), 150);
  },
  (connected) => {
    watchDot.classList.toggle('off', !connected);
    watchDot.title = connected ? 'watching for changes' : 'disconnected from server';
  },
);

window.addEventListener('hashchange', () => {
  const path = hashPath();
  if (path && path !== state.path) void openModel(path);
});

async function refreshTree() {
  const { children } = await fetchTree();
  tree.setNodes(children);
  tree.select(state.path);
}

async function boot() {
  try {
    const [{ name }, { children }] = await Promise.all([fetchRoot(), fetchTree()]);
    $('root-name').textContent = name;
    tree.setNodes(children);
  } catch (err) {
    log.note(`Cannot reach the server: ${err instanceof Error ? err.message : err}`);
    log.setStatus('offline', 'err');
    return;
  }

  const initial = hashPath();
  if (initial) await openModel(initial);
  else showOverlay('Select a model from the sidebar');
}

// Debug handle: lets you poke at the current model from the console, and makes
// the render inspectable from automated tests.
(window as unknown as { scadView: unknown }).scadView = { state, viewer, renderer };

void boot();
