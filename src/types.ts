/**
 * Where a show sits in the club's pipeline, mirroring the club's sheet:
 * a member recommends it, it waits in the queue, the club samples an episode
 * and votes, then watches it through or drops it.
 */
export type Status = 'rec' | 'queue' | 'sampled' | 'watching' | 'done' | 'drop';

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
  /** Who added it to the app. */
  by: string;
  /** Members who have it on their recommendations list. */
  recBy: string[];
  /** Members voting to continue a sampled show. */
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
  /** 24h "HH:MM": when people arrive */
  meetTime: string;
  /** 24h "HH:MM": when the episode starts */
  startTime: string;
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
