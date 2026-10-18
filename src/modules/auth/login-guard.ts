/**
 * Temporary lockout after repeated failures, kept in memory (fine for one API process; with several processes each
 * keeps its own count, so use a shared store such as Redis before scaling out).
 * Entries expire on their own and the map is swept, so it cannot grow without bound.
 */
export interface LoginGuardOptions {
  maxAttempts: number;
  lockoutMs: number;
  /** Failures older than this are forgotten even if the lock was never reached. */
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  count: number;
  lastFailureAt: number;
  lockedUntil?: number;
}

export class LoginGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(private readonly options: LoginGuardOptions) {
    this.windowMs = options.windowMs ?? Math.max(options.lockoutMs, 15 * 60 * 1000);
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Milliseconds until the key may try again, or 0 when it is not locked. */
  lockedFor(key: string): number {
    const entry = this.entries.get(key);
    if (!entry?.lockedUntil) return 0;
    return Math.max(0, entry.lockedUntil - this.now());
  }

  recordFailure(key: string): void {
    const now = this.now();
    const current = this.entries.get(key);
    const entry: Entry =
      current && now - current.lastFailureAt <= this.windowMs ? current : { count: 0, lastFailureAt: now };
    entry.count += 1;
    entry.lastFailureAt = now;
    if (entry.count >= this.options.maxAttempts) {
      entry.lockedUntil = now + this.options.lockoutMs;
      entry.count = 0;
    }
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.sweep();
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drops entries whose lock ended and whose failures are outside the window. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      const lockActive = entry.lockedUntil !== undefined && entry.lockedUntil > now;
      if (!lockActive && now - entry.lastFailureAt > this.windowMs) this.entries.delete(key);
    }
  }
}
