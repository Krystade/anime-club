import { describe, expect, it } from 'vitest';
import { bump, clubAverage, formatLog, formatTime, nextSession, rankNext } from './logic';
import type { Show } from './types';

describe('nextSession', () => {
  // Monday 9 Nov 2026
  const mon = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
  it('is tonight before the meeting starts on meeting day', () => {
    const r = nextSession(mon(12), 1, '19:00');
    expect(r.tonight).toBe(true);
    expect(r.at.getDate()).toBe(9);
    expect(r.at.getHours()).toBe(19);
  });
  it('stays tonight while the meeting is running', () => {
    expect(nextSession(mon(22, 30), 1, '19:00').tonight).toBe(true);
  });
  it('rolls to next week once the meeting is over', () => {
    const r = nextSession(mon(23, 30), 1, '19:00');
    expect(r.tonight).toBe(false);
    expect(r.at.getDate()).toBe(16);
  });
  it('finds a later weekday in the same week', () => {
    const r = nextSession(mon(9), 5, '18:30');
    expect(r.at.getDate()).toBe(13);
    expect(r.at.getMinutes()).toBe(30);
  });
  it('wraps to an earlier weekday next week', () => {
    expect(nextSession(new Date(2026, 10, 11, 9), 1, '19:00').at.getDate()).toBe(16);
  });
});

describe('formatTime', () => {
  it('formats 12-hour times', () => {
    expect(formatTime('19:00')).toBe('7:00 PM');
    expect(formatTime('00:05')).toBe('12:05 AM');
    expect(formatTime('12:30')).toBe('12:30 PM');
  });
});

describe('bump', () => {
  const show = { ep: 8, eps: 12, log: [{ date: '2026-11-02', from: 6, to: 8 }] };
  it('opens a new log entry on a new day', () => {
    expect(bump(show, 1, '2026-11-09')).toEqual({
      ep: 9,
      log: [{ date: '2026-11-02', from: 6, to: 8 }, { date: '2026-11-09', from: 9, to: 9 }],
    });
  });
  it('extends the same day', () => {
    const a = bump(show, 1, '2026-11-09');
    const b = bump({ ...show, ...a }, 2, '2026-11-09');
    expect(b.ep).toBe(11);
    expect(b.log.at(-1)).toEqual({ date: '2026-11-09', from: 9, to: 11 });
    expect(b.log).toHaveLength(2);
  });
  it('clamps at the episode count', () => {
    expect(bump(show, 10, '2026-11-09').ep).toBe(12);
  });
  it('has no upper limit when the episode count is unknown', () => {
    expect(bump({ ...show, eps: null }, 10, '2026-11-09').ep).toBe(18);
  });
  it('undo below the start of today removes the entry', () => {
    const a = bump(show, 1, '2026-11-09');
    expect(bump({ ...show, ...a }, -1, '2026-11-09')).toEqual({ ep: 8, log: show.log });
  });
  it('undo within today shortens the entry', () => {
    const a = bump(show, 3, '2026-11-09');
    expect(bump({ ...show, ...a }, -1, '2026-11-09').log.at(-1)).toEqual({ date: '2026-11-09', from: 9, to: 10 });
  });
  it('undo on another day leaves past meetings alone', () => {
    expect(bump(show, -1, '2026-11-09')).toEqual({ ep: 7, log: show.log });
  });
  it('never goes below zero and does not mutate input', () => {
    const s = { ep: 0, eps: 12, log: [] };
    expect(bump(s, -1, '2026-11-09')).toEqual({ ep: 0, log: [] });
    expect(show.log[0].to).toBe(8);
  });
});

describe('rankNext', () => {
  const s = (id: string, votes: number, addedAt: number) => ({ id, votes: Array(votes).fill('x'), addedAt }) as unknown as Show;
  it('sorts by votes then age', () => {
    expect(rankNext([s('a', 1, 1), s('b', 3, 5), s('c', 3, 2)]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('misc', () => {
  it('averages scores', () => {
    expect(clubAverage({})).toBeNull();
    expect(clubAverage({ a: 8, b: 9 })).toBe(8.5);
  });
  it('formats log entries', () => {
    expect(formatLog({ date: `${new Date().getFullYear()}-11-02`, from: 9, to: 11 })).toBe('Nov 2 · eps 9–11');
    expect(formatLog({ date: `${new Date().getFullYear()}-11-02`, from: 4, to: 4 })).toBe('Nov 2 · ep 4');
  });
});
