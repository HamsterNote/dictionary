import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mainThreadIntervals } from './dictionary_trace_summary.mjs';

await mkdir('docs/performance', { recursive: true });
for (const device of ['mobile', 'desktop']) {
  const comparisons = [];
  for (const host of ['web', 'native']) {
    const phases = [];
    for (const phase of ['before', 'after']) {
      const directory = `artifacts/hotspots-${phase}-final${device === 'desktop' ? '-desktop' : ''}`;
      const entries = JSON.parse(await readFile(`${directory}/${host}-summary.json`, 'utf8'));
      phases.push(entries);
      for (const entry of entries) {
        const trace = JSON.parse(
          await readFile(`${directory}/${host}-${entry.action}.trace.json`, 'utf8'),
        );
        const result = mainThreadIntervals(trace.traceEvents, entry.action);
        comparisons.push({
          device,
          host,
          phase,
          action: entry.action,
          cpuThrottle: device === 'desktop' ? 1 : 4,
          elapsedMs: result.elapsedMs,
          longestTaskMs: result.longestTaskMs,
          observerLongestTaskMs: entry.observerLongestTaskMs,
          longTasks: result.longTasks,
          totalBlockingMs: result.longTasks.reduce((sum, task) => sum + task.durationMs - 50, 0),
          topSelfSamples: entry.topSelfSamples.map(([name, ms]) => [
            name.replace(/ @ https?:\/\/.*?\/(?:@fs\/.*?)?\/(src|demo\/src)\//u, ' @ $1/'),
            ms,
          ]),
          errors: entry.errors,
        });
      }
    }
  }
  await writeFile(
    `docs/performance/text-hotspots-${device}.json`,
    JSON.stringify(comparisons, null, 2) + '\n',
  );
}
for (const phase of ['before', 'after']) {
  const atoms = JSON.parse(await readFile(`artifacts/hotspots-${phase}/atoms.json`, 'utf8'));
  await writeFile(
    `docs/performance/text-hotspots-atoms-${phase}.json`,
    JSON.stringify(atoms, null, 2) + '\n',
  );
}
