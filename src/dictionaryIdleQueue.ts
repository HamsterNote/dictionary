// One queue for all definition readers, including concurrent popovers.
// A provider call is indivisible; yield between calls, even for cached promises.
interface IdleJob {
  readonly priority: () => number;
  readonly step: () => Promise<boolean>;
  readonly finish: (error?: unknown) => void;
}

const jobs = new Set<IdleJob>();
let running = false;
let cancelScheduled: (() => void) | undefined;
const SLICE_MS = 4;

function schedule(): void {
  if (running || cancelScheduled || jobs.size === 0) return;
  if (typeof globalThis.requestIdleCallback === 'function') {
    const id = globalThis.requestIdleCallback(
      (deadline) => {
        cancelScheduled = undefined;
        void run(deadline);
      },
      { timeout: 100 },
    );
    cancelScheduled = () => {
      globalThis.cancelIdleCallback(id);
    };
  } else {
    const id = setTimeout(() => {
      cancelScheduled = undefined;
      void run();
    }, 16);
    cancelScheduled = () => {
      clearTimeout(id);
    };
  }
}

async function run(deadline?: IdleDeadline): Promise<void> {
  running = true;
  const start = performance.now();
  try {
    do {
      let next: IdleJob | undefined;
      let priority = Infinity;
      for (const job of jobs) {
        const value = job.priority();
        if (value < priority) {
          next = job;
          priority = value;
        }
      }
      if (!next) break;
      try {
        if (await next.step()) next.finish();
      } catch (error: unknown) {
        next.finish(error);
      }
    } while (
      jobs.size > 0 &&
      performance.now() - start < SLICE_MS &&
      (deadline === undefined || deadline.didTimeout || deadline.timeRemaining() > 1)
    );
  } finally {
    running = false;
    schedule();
  }
}

export function enqueueDictionaryIdleJob(
  step: () => Promise<boolean>,
  signal?: AbortSignal,
  priority: () => number = () => 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      job.finish(signal?.reason ?? new Error('Dictionary resolution aborted'));
    };
    const job: IdleJob = {
      priority,
      step,
      finish(error) {
        if (!jobs.delete(job)) return;
        signal?.removeEventListener('abort', abort);
        if (jobs.size === 0) {
          cancelScheduled?.();
          cancelScheduled = undefined;
        }
        if (error === undefined) resolve();
        else
          reject(
            error instanceof Error
              ? error
              : new Error('Dictionary resolution failed', { cause: error }),
          );
      },
    };
    jobs.add(job);
    signal?.addEventListener('abort', abort, { once: true });
    schedule();
  });
}
