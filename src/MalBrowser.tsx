import { useEffect, useMemo, useState } from 'react';
import type { Lookup, Show, Status } from './types';

export interface MalEntry {
  id: number; title: string; alt: string | null; image: string | null; eps: number | null; type: string | null;
  year: number | null; malScore: number | null; myScore: number | null;
  status: 'watching' | 'completed' | 'onhold' | 'dropped' | 'plan' | 'other'; genres: string[]; updated: number;
}
export interface MalSnapshot { member: string; user: string; fetchedAt: string; entries: MalEntry[] }

const TABS: [MalEntry['status'], string][] = [['plan', 'Plan to watch'], ['completed', 'Completed'], ['watching', 'Watching'], ['onhold', 'On hold'], ['dropped', 'Dropped']];
type Sort = 'updated' | 'mine' | 'mal' | 'az';
const SORTS: Record<Sort, string> = { updated: 'Recently updated', mine: 'Their score', mal: 'MAL score', az: 'A to Z' };
export type AddTarget = 'queue' | 'rec' | 'sampled';
const CLUB_TAG: Record<Status, string> = { rec: 'recommended', queue: 'in queue', sampled: 'sampled', watching: 'watching', done: 'club watched', drop: 'club dropped' };

export function useMalSnapshot(user: string | null) {
  const [snap, setSnap] = useState<MalSnapshot | null | 'error'>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    // Bust the cache hourly so a fresh daily snapshot shows up without a hard refresh.
    fetch(`./mal/${user.toLowerCase()}.json?h=${Math.floor(Date.now() / 3_600_000)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: MalSnapshot) => { if (live) setSnap(d); })
      .catch(() => { if (live) setSnap('error'); });
    return () => { live = false; };
  }, [user]);
  return snap;
}

export function toLookup(e: MalEntry): Lookup {
  return { malId: e.id, title: e.title, altTitle: e.alt, image: e.image, eps: e.eps, score: e.malScore, year: e.year, type: e.type };
}

export function MalBrowser({ snap, shows, onAdd, onOpenShow, Thumb }: {
  snap: MalSnapshot; shows: Show[]; onAdd: (l: Lookup, t: AddTarget) => void; onOpenShow: (s: Show) => void;
  Thumb: (p: { s: { title: string; image: string | null }; size?: 'sm' | 'md' | 'lg' | 'hero' }) => React.ReactElement;
}) {
  const [tab, setTab] = useState<MalEntry['status']>('plan');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [hideClub, setHideClub] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const onBoard = useMemo(() => new Map(shows.filter((s) => s.malId != null).map((s) => [s.malId!, s])), [shows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of snap.entries) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [snap]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const l = snap.entries.filter((e) => e.status === tab
      && (!term || e.title.toLowerCase().includes(term) || e.alt?.toLowerCase().includes(term) || e.genres.some((g) => g.toLowerCase() === term))
      && !(hideClub && onBoard.has(e.id)));
    const by: Record<Sort, (a: MalEntry, b: MalEntry) => number> = {
      updated: (a, b) => b.updated - a.updated,
      mine: (a, b) => (b.myScore ?? -1) - (a.myScore ?? -1) || (b.malScore ?? 0) - (a.malScore ?? 0),
      mal: (a, b) => (b.malScore ?? 0) - (a.malScore ?? 0),
      az: (a, b) => a.title.localeCompare(b.title),
    };
    return l.sort(by[sort]);
  }, [snap, tab, q, sort, hideClub, onBoard]);

  return (
    <div className="mal">
      <div className="seg" role="tablist">
        {TABS.filter(([k]) => counts[k]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpen(null); }}>{label} <span className="num">{counts[k]}</span></button>
        ))}
      </div>
      <input id="mal-filter" className="field" type="search" placeholder="Filter by title or genre" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <div className="mal-opts">
        <label htmlFor="mal-sort" className="sr">Sort</label>
        <select id="mal-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="check" htmlFor="mal-hide"><input id="mal-hide" type="checkbox" checked={hideClub} onChange={(e) => setHideClub(e.target.checked)} /> Hide ones already in the club</label>
      </div>
      <div className="grp">
        {list.map((e) => {
          const club = onBoard.get(e.id);
          const isOpen = open === e.id;
          return (
            <div key={e.id} className="mal-item">
              <div className="row static">
                <Thumb s={e} size="sm" />
                <span className="row-m">
                  <span className="t">{e.title}</span>
                  <span className="s">{[e.type, e.eps != null ? `${e.eps} eps` : null, e.year, e.malScore ? `MAL ${e.malScore.toFixed(2)}` : null].filter(Boolean).join(' · ')}</span>
                  {(e.myScore || e.genres.length > 0) && <span className="s">{e.myScore ? <b className="mine-score">{snap.member} {e.myScore}/10</b> : null}{e.myScore && e.genres.length ? ' · ' : ''}{e.genres.slice(0, 3).join(', ')}</span>}
                </span>
                {club
                  ? <button className="tagbtn" onClick={() => onOpenShow(club)}>{CLUB_TAG[club.status]}</button>
                  : <button className="btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}>{isOpen ? 'Close' : 'Add'}</button>}
              </div>
              {isOpen && !club && (
                <div className="add-to">
                  <span className="muted">Add to</span>
                  <button className="btn primary" onClick={() => { onAdd(toLookup(e), 'queue'); setOpen(null); }}>Queue</button>
                  <button className="btn" onClick={() => { onAdd(toLookup(e), 'sampled'); setOpen(null); }}>Sampled</button>
                  <button className="btn" onClick={() => { onAdd(toLookup(e), 'rec'); setOpen(null); }}>My recs</button>
                  <a className="link small" href={`https://myanimelist.net/anime/${e.id}`} target="_blank" rel="noopener noreferrer">MAL ↗</a>
                </div>
              )}
            </div>
          );
        })}
        {!list.length && <div className="empty">{q ? 'No matches.' : 'Nothing here.'}</div>}
      </div>
      <p className="note">From MyAnimeList user {snap.user}, updated {new Date(snap.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Refreshes daily.</p>
    </div>
  );
}
