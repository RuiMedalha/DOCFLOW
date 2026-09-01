import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export interface PerfSample {
  endpoint: string;
  method: string;
  ms: number;
  budgetMs: number;
  ok: boolean;
  status: number;
}

const samples: PerfSample[] = [];

export function recordPerf(sample: PerfSample): void {
  samples.push(sample);
}

export function getPerfSamples(): PerfSample[] {
  return samples.slice();
}

export function writePerfBaseline(): string {
  const dir = resolve(__dirname, '..', '..', 'test-results');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'performance-baseline.json');
  const byEndpoint = samples.reduce<Record<string, PerfSample[]>>((acc, s) => {
    const key = `${s.method} ${s.endpoint}`;
    (acc[key] ??= []).push(s);
    return acc;
  }, {});
  const summary = Object.entries(byEndpoint).map(([key, list]) => {
    const times = list.map((s) => s.ms).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
    const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1] ?? 0;
    const budget = list[0]?.budgetMs ?? 0;
    return {
      endpoint: key,
      n: list.length,
      min: times[0] ?? 0,
      p50,
      p95,
      max: times[times.length - 1] ?? 0,
      budgetMs: budget,
      met: list.every((s) => s.ok),
    };
  });
  writeFileSync(
    path,
    JSON.stringify({ generatedAt: new Date().toISOString(), samples, summary }, null, 2),
    'utf8',
  );
  return path;
}
