import type { LogLine, RenderRequest, WorkerMessage } from './protocol';

export interface RenderResult {
  offText: string;
  exitCode: number;
  elapsedMs: number;
}

export interface RenderHandlers {
  onLog(line: LogLine): void;
}

/**
 * Runs one OpenSCAD invocation per Worker and keeps at most one alive.
 *
 * A fresh worker per render is what openscad-playground does, and it buys
 * cancellation for free: superseding a render is just terminate(), which is a
 * hard stop even in the middle of a long CGAL evaluation. Without that, a burst
 * of saves would queue up renders faster than they complete.
 */
export class Renderer {
  #worker: Worker | null = null;
  #generation = 0;

  /** Abandon any render in flight. Its promise rejects with a Superseded error. */
  cancel(): void {
    this.#generation++;
    this.#worker?.terminate();
    this.#worker = null;
  }

  get busy(): boolean {
    return this.#worker !== null;
  }

  render(request: RenderRequest, handlers: RenderHandlers): Promise<RenderResult> {
    this.cancel();
    const generation = this.#generation;

    return new Promise<RenderResult>((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.#worker = worker;

      const finish = () => {
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
      };

      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        if (generation !== this.#generation) return; // superseded mid-flight
        const msg = e.data;
        if (msg.kind === 'log') {
          handlers.onLog(msg.line);
          return;
        }
        finish();
        if (msg.kind === 'error') {
          reject(new Error(msg.message));
        } else if (!msg.off) {
          reject(new Error(`OpenSCAD produced no output (exit code ${msg.exitCode})`));
        } else {
          resolve({
            offText: new TextDecoder().decode(msg.off),
            exitCode: msg.exitCode,
            elapsedMs: msg.elapsedMs,
          });
        }
      };

      worker.onerror = (e) => {
        finish();
        reject(new Error(e.message || 'render worker failed to start'));
      };

      worker.postMessage(request);
    });
  }
}
