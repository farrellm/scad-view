export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

export interface Bundle {
  entry: string;
  files: Record<string, string>;
  /** base64 blobs for non-.scad references: import(), surface(), font files. */
  assets: Record<string, string>;
  mtimes: Record<string, number>;
  missing: { path: string; reason: string }[];
}

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const fetchRoot = () => json<{ root: string; name: string }>('/api/root');
export const fetchTree = () => json<{ root: string; children: TreeNode[] }>('/api/tree');
export const fetchBundle = (path: string) =>
  json<Bundle>(`/api/bundle?path=${encodeURIComponent(path)}`);

/** Subscribe to server file-change events. EventSource reconnects on its own. */
export function subscribeToChanges(
  onEvent: (e: WatchEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const source = new EventSource('/api/events');
  source.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data) as WatchEvent); } catch { /* ignore malformed frame */ }
  };
  source.onopen = () => onStatus?.(true);
  source.onerror = () => onStatus?.(false);
  return () => source.close();
}
