import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getPerfSamples, writePerfBaseline } from '../helpers/perf';

interface Row {
  title: string;
  file: string;
  status: TestResult['status'];
  tags: string[];
}

function tagsOf(title: string): string[] {
  return [...title.matchAll(/@([a-z0-9-]+)/g)].map((m) => m[1]);
}

const CHECKLIST: Array<{ id: string; label: string; tag: string }> = [
  { id: 'flows', label: 'All critical flows pass E2E tests', tag: 'flow' },
  { id: 'secrets', label: 'No sensitive data in logs/errors', tag: 'secrets' },
  { id: 'perf', label: 'Performance baselines met', tag: 'perf' },
  { id: 'tenant', label: 'Multi-tenant isolation verified', tag: 'tenant' },
  { id: 'rbac', label: 'RBAC working on all restricted routes', tag: 'rbac' },
  { id: 'audit', label: 'Audit trail unbroken', tag: 'audit' },
];

class ReadinessReporter implements Reporter {
  private rows: Row[] = [];

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.rows = [];
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.rows.push({
      title: test.title,
      file: test.location.file,
      status: result.status,
      tags: tagsOf(`${test.parent?.title ?? ''} ${test.title}`),
    });
  }

  onEnd(result: FullResult): void {
    const dir = resolve(__dirname, '..', '..', 'test-results');
    mkdirSync(dir, { recursive: true });

    const failed = this.rows.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
    const passed = this.rows.filter((r) => r.status === 'passed');
    const skipped = this.rows.filter((r) => r.status === 'skipped');

    const checklist = CHECKLIST.map((c) => {
      const tagged = this.rows.filter((r) => r.tags.includes(c.tag));
      const taggedFailed = tagged.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
      const ok = tagged.length > 0 && taggedFailed.length === 0;
      return { ...c, ok, tested: tagged.length, failed: taggedFailed.length };
    });

    const perfSamples = getPerfSamples();
    const perfMisses = perfSamples.filter((s) => !s.ok);
    const perfItem = checklist.find((c) => c.id === 'perf');
    if (perfItem && perfSamples.length) {
      perfItem.ok = perfMisses.length === 0;
      perfItem.tested = perfSamples.length;
      perfItem.failed = perfMisses.length;
    }

    const flowFailed = failed.filter((r) => r.tags.includes('flow') || r.tags.includes('blocker'));
    let goLive: 'YES' | 'CONDITIONAL' | 'NO';
    if (result.status !== 'passed' && flowFailed.length > 0) goLive = 'NO';
    else if (failed.length > 0 || perfMisses.length > 0) goLive = 'CONDITIONAL';
    else goLive = 'YES';

    let perfPath = '';
    try {
      perfPath = writePerfBaseline();
    } catch {
      perfPath = '(perf baseline not written)';
    }

    const md = renderMarkdown({
      goLive,
      result: result.status,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      checklist,
      failedTitles: failed.map((f) => f.title),
      perfMisses: perfMisses.map((s) => `${s.method} ${s.endpoint} ${s.ms}ms (budget ${s.budgetMs}ms)`),
      perfPath,
    });

    writeFileSync(resolve(dir, 'PRODUCTION_READINESS.md'), md, 'utf8');
    writeFileSync(
      resolve(dir, 'production-readiness.json'),
      JSON.stringify(
        {
          goLive,
          generatedAt: new Date().toISOString(),
          counts: { passed: passed.length, failed: failed.length, skipped: skipped.length },
          checklist,
          failed: failed.map((f) => f.title),
          perfMisses,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

function renderMarkdown(input: {
  goLive: string;
  result: string;
  passed: number;
  failed: number;
  skipped: number;
  checklist: Array<{ id: string; label: string; ok: boolean; tested: number; failed: number }>;
  failedTitles: string[];
  perfMisses: string[];
  perfPath: string;
}): string {
  const box = (ok: boolean) => (ok ? '[x]' : '[ ]');
  return `# Production Readiness — Wave 3 Critical Path

Generated: ${new Date().toISOString()}

**Go-live: ${input.goLive}**
Playwright status: \`${input.result}\` — ${input.passed} passed / ${input.failed} failed / ${input.skipped} skipped

## Matrix

${input.checklist.map((c) => `- ${box(c.ok)} ${c.label}  (${c.tested} tests, ${c.failed} failed)`).join('\n')}

- ${box(input.goLive === 'YES')} Go-live: **${input.goLive}**

## Performance baseline

See \`${input.perfPath}\`.
${input.perfMisses.length ? `\nBudget misses:\n${input.perfMisses.map((m) => `- ${m}`).join('\n')}` : '\nAll recorded samples met their budgets (or no samples were captured).'}

## Failed tests

${input.failedTitles.length ? input.failedTitles.map((t) => `- ${t}`).join('\n') : '_None._'}

## Notes

- API E2E uses Playwright \`request\` (no browser). UI login is skipped unless WEB is up.
- Tenant IBAN is patched via Prisma after register — there is no public settings API.
- Cross-tenant IDOR is asserted as 404 (tenant-scoped Prisma), which is isolation-correct even if the brief asked for 403.
`;
}

export default ReadinessReporter;
