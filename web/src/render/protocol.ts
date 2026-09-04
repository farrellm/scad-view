export type OutputFormat = 'off' | 'binstl';

export interface RenderRequest {
  entry: string;                      // root-relative path of the model
  files: Record<string, string>;      // entry + every transitive include/use
  assets: Record<string, string>;     // base64 blobs for import()/surface() targets
  preview: boolean;
  /** 'off' feeds the viewer; 'binstl' is only ever exported to a file. */
  format: OutputFormat;
}

export interface LogLine { stream: 'stdout' | 'stderr'; text: string; }

export type WorkerMessage =
  | { kind: 'log'; line: LogLine }
  | { kind: 'done'; exitCode: number; output: ArrayBuffer | null; elapsedMs: number }
  | { kind: 'error'; message: string; elapsedMs: number };

/** Where each format is written inside the wasm FS; the worker reads it back from here. */
export const OUTPUT_PATH: Record<OutputFormat, string> = {
  off: '/out.off',
  binstl: '/out.stl',
};

/**
 * Preview overrides the model's own curve resolution. `$fn=0` must be included:
 * without it a model that sets `$fn` at top level wins over $fa/$fs and the
 * preview comes out at full detail. `-D` does beat a top-level assignment.
 */
export const PREVIEW_VARS = '$preview=true;$fa=12;$fs=2;$fn=0;';

export function renderArgs(entry: string, preview: boolean, format: OutputFormat): string[] {
  return [
    `/${entry}`,
    '-o', OUTPUT_PATH[format],
    `--export-format=${format}`,
    '--backend=manifold',
    // Full render passes no -D at all, so the model's own $fn/$fa/$fs govern.
    ...(preview ? ['-D', PREVIEW_VARS] : []),
  ];
}
