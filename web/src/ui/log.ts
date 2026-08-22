import type { LogLine } from '../render/protocol';

/** Append-only console for OpenSCAD stdout/stderr, plus our own status lines. */
export class LogPane {
  #pre: HTMLElement;
  #status: HTMLElement;
  #lines: string[] = [];

  constructor(pre: HTMLElement, status: HTMLElement) {
    this.#pre = pre;
    this.#status = status;
  }

  clear() {
    this.#lines = [];
    this.#pre.replaceChildren();
  }

  append(line: LogLine) {
    this.#write(line.text, line.stream === 'stderr' ? 'err' : 'out');
  }

  note(text: string) {
    this.#write(text, 'note');
  }

  #write(text: string, cls: string) {
    this.#lines.push(text);
    const span = document.createElement('span');
    span.className = `line ${cls}`;
    span.textContent = text;
    this.#pre.append(span, document.createTextNode('\n'));
    // Only autoscroll when the user is already at the bottom, so scrolling back
    // through a long warning list is not yanked away on the next render.
    const nearBottom = this.#pre.scrollHeight - this.#pre.scrollTop - this.#pre.clientHeight < 40;
    if (nearBottom) this.#pre.scrollTop = this.#pre.scrollHeight;
  }

  setStatus(text: string, kind: 'ok' | 'err' | 'busy' | '' = '') {
    this.#status.textContent = text;
    this.#status.className = `muted ${kind}`;
  }

  /** Count of stderr lines that look like OpenSCAD problems, for the status line. */
  countProblems(): { warnings: number; errors: number } {
    let warnings = 0, errors = 0;
    for (const l of this.#lines) {
      if (/^\s*ERROR:/i.test(l)) errors++;
      else if (/^\s*WARNING:/i.test(l)) warnings++;
    }
    return { warnings, errors };
  }
}
