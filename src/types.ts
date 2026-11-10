export type Status = 'next' | 'watching' | 'done' | 'drop';

/** One meeting's worth of episodes on a show: watched `from`–`to` on `date` (local YYYY-MM-DD). */
export interface LogEntry {
  date: string;
  from: number;
  to: number;
}

export interface ShowData {
  malId: number | null;
  title: string;
  image: string | null;
  eps: number | null;
  score: number | null;
  year: number | null;
  type: string | null;
  status: Status;
  ep: number;
  by: string;
  votes: string[];
  scores: Record<string, number>;
  log: LogEntry[];
  addedAt: number;
  statusAt: number;
}

export interface Show extends ShowData {
  id: string;
}

export interface Club {
  name: string;
  /** 0 = Sunday … 6 = Saturday */
  meetDay: number;
  /** 24h "HH:MM" */
  meetTime: string;
  members: string[];
}

/** What a MyAnimeList lookup gives us before it becomes a show. */
export interface Lookup {
  malId: number | null;
  title: string;
  altTitle: string | null;
  image: string | null;
  eps: number | null;
  score: number | null;
  year: number | null;
  type: string | null;
}
