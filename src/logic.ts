import type { LogEntry, Show } from './types';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function localISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** How long after the start a meeting still counts as "tonight". */
const MEETING_HOURS = 4;

/** The next meeting, or tonight's if it started less than MEETING_HOURS ago. */
export function nextSession(now: Date, meetDay: number, meetTime: string): { at: Date; tonight: boolean } {
  const [h, m] = meetTime.split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  let add = (meetDay - now.getDay() + 7) % 7;
  if (add === 0 && now.getTime() > at.getTime() + MEETING_HOURS * 3600_000) add = 7;
  at.setDate(at.getDate() + add);
  return { at, tonight: add === 0 };
}

export function formatTime(meetTime: string): string {
  const [h, m] = meetTime.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDay(d: Date): string {
  return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function formatISO(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  return `${MONTHS[mo - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
}

export function formatLog(e: LogEntry): string {
  return `${formatISO(e.date)} · ${e.from === e.to ? `ep ${e.to}` : `eps ${e.from}–${e.to}`}`;
}

/**
 * Move a show's shared episode counter by `n` (negative to undo) and keep the
 * meeting log in step: the first bump on a given day opens a log entry, later
 * bumps that day extend it, and undoing below its start removes it.
 */
export function bump(show: Pick<Show, 'ep' | 'eps' | 'log'>, n: number, today: string): { ep: number; log: LogEntry[] } {
  const max = show.eps ?? Infinity;
  const ep = Math.max(0, Math.min(max, show.ep + n));
  const log = show.log.map((e) => ({ ...e }));
  const last = log[log.length - 1];
  if (ep === show.ep) return { ep, log };
  if (ep > show.ep) {
    if (last && last.date === today) last.to = ep;
    else log.push({ date: today, from: show.ep + 1, to: ep });
  } else if (last && last.date === today) {
    if (ep < last.from) log.pop();
    else last.to = ep;
  }
  return { ep, log };
}

/** Up Next order: most votes first, then whoever was suggested first. */
export function rankNext(shows: Show[]): Show[] {
  return [...shows].sort((a, b) => b.votes.length - a.votes.length || a.addedAt - b.addedAt);
}

export function clubAverage(scores: Record<string, number>): number | null {
  const v = Object.values(scores);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function malUrl(malId: number): string {
  return `https://myanimelist.net/anime/${malId}`;
}

/** A stable hue per title, for posters we have no image for. */
export function hueFor(title: string): number {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
