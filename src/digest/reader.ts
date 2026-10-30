import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

// Parse one line at the edge; anything that isn't a whole run line is null (a bad line).
export function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string') return null;
  if (!STATUSES.includes(o.status as RunStatus)) return null;
  const owner = o.owner === null || o.owner === undefined ? null : typeof o.owner === 'string' ? o.owner : undefined;
  if (owner === undefined) return null;
  const parsed: RunLine = { at: o.at, job: o.job, status: o.status as RunStatus, owner };
  if (typeof o.error === 'string') parsed.error = o.error;
  return parsed;
}

export function digest(night: string, text: string): Night {
  const rows = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (!run) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const row = rows.get(run.job);
    if (!row) {
      rows.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
      continue;
    }
    // Lines are in time order: the latest line sets owner, status and error.
    row.runs++;
    if (run.status === 'retry') row.retries++;
    row.owner = run.owner ?? row.owner;
    row.lastStatus = run.status;
    row.lastError = run.error ?? null;
    row.lastAt = run.at;
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    counts,
    badLines,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const file = join(runsDir, `${night}.jsonl`);
  if (!existsSync(file)) return null;
  return digest(night, readFileSync(file, 'utf8'));
};
