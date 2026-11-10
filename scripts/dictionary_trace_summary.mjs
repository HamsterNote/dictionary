export function mainThreadIntervals(events, action) {
  const begin = events.find((event) => event.name === `hotspot-${action}-begin`);
  const end = events.findLast((event) => event.name === `hotspot-${action}-end`);
  if (!begin || !end) throw new Error('Trace is missing action markers');
  // Chromium also runs microtask checkpoints as independent toplevel spans.
  // Counting only RunTask misses synchronous work after async resource reads.
  const spans = events
    .filter(
      (event) =>
        event.pid === begin.pid &&
        event.tid === begin.tid &&
        event.ph === 'X' &&
        event.cat.split(',').includes('toplevel') &&
        event.ts >= begin.ts &&
        event.ts < end.ts,
    )
    .sort((a, b) => a.ts - b.ts);
  const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    const finish = span.ts + span.dur;
    if (previous && span.ts < previous.end) previous.end = Math.max(previous.end, finish);
    else merged.push({ start: span.ts, end: finish });
  }
  const tasks = merged.map((span) => ({
    startMs: (span.start - begin.ts) / 1000,
    durationMs: (span.end - span.start) / 1000,
  }));
  return {
    elapsedMs: (end.ts - begin.ts) / 1000,
    longestTaskMs: Math.max(0, ...tasks.map((task) => task.durationMs)),
    longTasks: tasks.filter((task) => task.durationMs >= 50),
    tasks,
  };
}
