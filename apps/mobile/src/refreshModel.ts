/**
 * Auto-refresh without surprises (tests/refresh.test.ts): one load at a time,
 * ticks only while the app is in the foreground, a failing load never throws
 * out of the timer (the screen keeps its last data), and stop() ends it.
 * refresh.tsx wraps this in a React hook.
 */

export const AUTO_REFRESH_MS = 30_000;

export interface RefresherDeps {
  /** Returns false (or throws) when nothing new could be loaded. */
  load(background: boolean): Promise<boolean | void>;
  isForeground(): boolean;
  onState(state: { refreshing: boolean; updatedAt: number | null; failed: boolean }): void;
  now?(): number;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(id: unknown): void;
}

export class Refresher {
  private busy = false;
  private timer: unknown = null;
  private stopped = false;
  private updatedAt: number | null = null;
  private readonly deps: RefresherDeps;
  private readonly intervalMs: number;

  constructor(deps: RefresherDeps, intervalMs = AUTO_REFRESH_MS) {
    this.deps = deps;
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.stopped = false;
    void this.run(false);
    const every = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = every(() => { if (this.deps.isForeground()) void this.run(true); }, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) (this.deps.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
  }

  /** A refresh the person asked for (button, pull-down). */
  refresh(): Promise<void> {
    return this.run(false);
  }

  private async run(background: boolean): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    if (!background) this.deps.onState({ refreshing: true, updatedAt: this.updatedAt, failed: false });
    let ok = false;
    try {
      ok = (await this.deps.load(background)) !== false;
    } catch {
      ok = false;   // never let a failed load escape the timer
    } finally {
      this.busy = false;
    }
    if (this.stopped) return;
    if (ok) this.updatedAt = (this.deps.now ?? Date.now)();
    this.deps.onState({ refreshing: false, updatedAt: this.updatedAt, failed: !ok });
  }
}
