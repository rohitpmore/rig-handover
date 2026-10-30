import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Fixtures live in a temp dir only; runs/ is never read here.
const runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
const app = createApp(config);

const NORMAL = '2026-10-28';
const BAD = '2026-10-27';
const EMPTY = '2026-10-29';
const MISSING = '2026-01-01';

const files: Record<string, string[]> = {
  [NORMAL]: [
    '{"at":"2026-10-28T09:00:01+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
    '{"at":"2026-10-28T09:10:01+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-28T09:12:01+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-28T09:14:01+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-28T09:16:01+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
    '{"at":"2026-10-28T09:20:00+01:00","job":"notes/backup","status":"fail","owner":"rook","error":"quota exceeded"}',
    '{"at":"2026-10-28T09:30:00+01:00","job":"digest/render","status":"retry","owner":null,"error":"disk full"}',
    '{"at":"2026-10-28T10:00:01+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  ],
  [BAD]: [
    '{"at":"2026-10-27T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"rook"}',
    '{"at":"2026-10-27T23:00:06+01:00","job":"lane/sync","status":"ok","owner":"rook"',
    '{"at":"2026-10-27T23:30:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  ],
  [EMPTY]: [],
};

// The same night as the reader must return it: 4 jobs, 8 lines, no bad lines.
const normal: Night = {
  night: NORMAL,
  rows: [
    {
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 1,
      lastStatus: 'retry',
      lastError: 'disk full',
      firstAt: '2026-10-28T09:30:00+01:00',
      lastAt: '2026-10-28T09:30:00+01:00',
    },
    {
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T09:10:01+01:00',
      lastAt: '2026-10-28T09:16:01+01:00',
    },
    {
      job: 'lane/sync',
      owner: 'rook',
      runs: 2,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T09:00:01+01:00',
      lastAt: '2026-10-28T10:00:01+01:00',
    },
    {
      job: 'notes/backup',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      firstAt: '2026-10-28T09:20:00+01:00',
      lastAt: '2026-10-28T09:20:00+01:00',
    },
  ],
  counts: { ok: 3, retry: 4, fail: 1 },
  badLines: 0,
};

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  for (const [night, lines] of Object.entries(files)) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => `${line}\n`).join(''));
  }
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Hono escapes ' as &#39; in HTML; a browser shows it as '.
const visible = (html: string) => html.replaceAll('&#39;', "'");

// The table row that holds a job: from its <tr> (where a class would sit) to its </tr>.
function rowOf(html: string, job: string): string {
  const at = html.indexOf(job);
  expect(at, `${job} on the page`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
}

describe('GET /digest/:night', () => {
  it('renders the lane banner and one row per job', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    for (const job of ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup']) {
      expect(html).toContain(job);
    }
  });

  it('marks a job with 3+ retries or a fail, and leaves the others unmarked', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    expect(rowOf(html, 'fixtures/refresh')).toContain('class="warn"');
    expect(rowOf(html, 'notes/backup')).toContain('class="warn"');
    expect(rowOf(html, 'lane/sync')).not.toContain('class="warn"');
    expect(rowOf(html, 'digest/render')).not.toContain('class="warn"');
  });

  it('shows an em dash for a null owner', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    // digest/render has a lastError, so the dash in its row can only be the owner.
    expect(rowOf(html, 'digest/render')).toContain('—');
  });

  it('renders an empty night as nothing ran', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('says a line did not parse and still renders the valid jobs', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = visible(await res.text());
    expect(res.status).toBe(200);
    expect(html).toContain("didn't parse");
    expect(html).toContain('rig/rotate-logs');
    expect(html).toContain('lane/sync');
  });

  it('returns 404 for a night with no file', async () => {
    expect((await app.request(`/digest/${MISSING}`)).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night with rows sorted by job', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(normal);
  });

  it('keeps the valid lines and counts the bad one', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });

  it('returns no rows and no bad lines for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('returns 404 with an error for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe('page and JSON agree', () => {
  it.each([NORMAL, BAD])('lists the JSON rows in the same order on the page (%s)', async (night) => {
    const { rows } = (await (await app.request(`/api/digest/${night}`)).json()) as Night;
    const html = await (await app.request(`/digest/${night}`)).text();
    expect(rows.length).toBeGreaterThan(0);
    const at = rows.map((r) => html.indexOf(r.job));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});
