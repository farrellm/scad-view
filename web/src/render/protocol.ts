export interface RenderRequest {
  entry: string;                      // root-relative path of the model
  files: Record<string, string>;      // entry + every transitive include/use
  assets: Record<string, string>;     // base64 blobs for import()/surface() targets
  preview: boolean;
}

export interface LogLine { stream: 'stdout' | 'stderr'; text: string; }

export type WorkerMessage =
  | { kind: 'log'; line: LogLine }
  | { kind: 'done'; exitCode: number; off: ArrayBuffer | null; elapsedMs: number }
  | { kind: 'error'; message: string; elapsedMs: number };

/**
 * Preview overrides the model's own curve resolution. `$fn=0` must be included:
 * without it a model that sets `$fn` at top level wins over $fa/$fs and the
 * preview comes out at full detail. `-D` does beat a top-level assignment.
 */
export const PREVIEW_VARS = '$preview=true;$fa=12;$fs=2;$fn=0;';

export function renderArgs(entry: string, preview: boolean): string[] {
  return [
    `/${entry}`,
    '-o', '/out.off',
    '--export-format=off',
    '--backend=manifold',
    // Full render passes no -D at all, so the model's own $fn/$fa/$fs govern.
    ...(preview ? ['-D', PREVIEW_VARS] : []),
  ];
}
