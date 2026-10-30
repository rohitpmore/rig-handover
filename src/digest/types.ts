// Plan morning-digest § 1. The contract every part of § 2 starts against: the reader fills it,
// the page, the JSON and the board only read it.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One parsed line of runs/<night>.jsonl.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the log's offset; owner and lastError stay null when missing
// (views render null as `—`).
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  fails: number; // any `fail` line, even if a later run recovered
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// Line counts per status, for the board.
export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string;
  rows: DigestRow[]; // sorted by job
  counts: StatusCounts;
  badLines: number; // lines that didn't parse: counted, never thrown
};

// null when runs/<night>.jsonl doesn't exist (or night isn't YYYY-MM-DD): the routes 404.
export type ReadNight = (runsDir: string, night: string) => Night | null;
