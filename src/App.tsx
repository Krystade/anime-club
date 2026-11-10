import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, FieldPath,
  onSnapshot, updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { searchAnime } from './jikan';
import {
  DAYS, bump, clubAverage, formatDay, formatISO, formatLog, formatTime, hueFor, localISODate,
  malUrl, nextSession, rankNext,
} from './logic';
import type { Club, Lookup, Show, ShowData, Status } from './types';

type Tab = 'watching' | 'next' | 'watched';
const MEMBER_COLORS = ['#3550E8', '#1F8A5B', '#B26A00', '#9B3BD1', '#D93A6E', '#0F8A9E', '#7A5C2E', '#C2410C'];

// ---------- local prefs (per device) ----------
function readLS(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function writeLS(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
}

function clubKeyFromUrl(): string | null {
  const m = /[#&]c=([A-Za-z0-9_-]{16,64})/.exec(location.hash);
  return m ? m[1] : null;
}

export function App() {
  const [key] = useState(() => {
    const k = clubKeyFromUrl() ?? readLS('ac:club');
    if (k) {
      writeLS('ac:club', k);
      if (!clubKeyFromUrl()) history.replaceState(null, '', `#c=${k}`);
    }
    return k;
  });
  if (!key) return <Landing />;
  return <ClubView clubKey={key} />;
}

function Landing() {
  return (
    <div className="app center">
      <h1 className="display">Anime Club</h1>
      <p className="sub">Open your club's invite link to get in. Ask whoever runs the club to send it to you.</p>
    </div>
  );
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = (m: string) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 2200);
  };
  return { msg, show };
}

function ClubView({ clubKey }: { clubKey: string }) {
  const [club, setClub] = useState<Club | null | 'missing'>(null);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(() => readLS('ac:name'));
  const [tab, setTab] = useState<Tab>('watching');
  const [sheet, setSheet] = useState<'add' | 'name' | 'settings' | null>(null);
  const toast = useToast();

  const clubRef = useMemo(() => doc(db, 'clubs', clubKey), [clubKey]);
  const showsRef = useMemo(() => collection(db, 'clubs', clubKey, 'shows'), [clubKey]);

  useEffect(() => onSnapshot(clubRef,
    (s) => setClub(s.exists() ? (s.data() as Club) : 'missing'),
    (e) => setError(e.message)), [clubRef]);
  useEffect(() => onSnapshot(showsRef,
    (s) => setShows(s.docs.map((d) => ({ id: d.id, ...(d.data() as ShowData) }))),
    (e) => setError(e.message)), [showsRef]);

  const needsName = club && club !== 'missing' && (!me || !club.members.includes(me));
  useEffect(() => { if (needsName) setSheet('name'); }, [needsName]);

  if (error) return <div className="app center"><h1 className="display">Can't reach the club</h1><p className="sub">{error}</p></div>;
  if (club === 'missing') return (
    <div className="app center">
      <h1 className="display">Club not found</h1>
      <p className="sub">This invite link doesn't match a club. Ask for the link again.</p>
      <button className="btn" onClick={() => { writeLS('ac:club', null); location.hash = ''; location.reload(); }}>Forget this link</button>
    </div>
  );
  if (!club || !shows) return <div className="app center"><p className="sub">Loading the club…</p></div>;

  const colorOf = (n: string) => MEMBER_COLORS[Math.max(0, club.members.indexOf(n)) % MEMBER_COLORS.length];
  const save = async (p: Promise<unknown>, ok?: string) => {
    try { await p; if (ok) toast.show(ok); } catch (e) { toast.show(`Couldn't save: ${(e as Error).message}`); }
  };
  const showRef = (id: string) => doc(showsRef, id);

  const watching = shows.filter((s) => s.status === 'watching').sort((a, b) => a.statusAt - b.statusAt);
  const next = rankNext(shows.filter((s) => s.status === 'next'));
  const watched = shows.filter((s) => s.status === 'done' || s.status === 'drop').sort((a, b) => b.statusAt - a.statusAt);
  const session = nextSession(new Date(), club.meetDay, club.meetTime);
  const name = me ?? '';

  const actions = {
    bump: (s: Show, n: number) => {
      const r = bump(s, n, localISODate(new Date()));
      return save(updateDoc(showRef(s.id), r));
    },
    setStatus: (s: Show, status: Status, ok: string) => save(updateDoc(showRef(s.id), { status, statusAt: Date.now() }), ok),
    vote: (s: Show) => save(updateDoc(showRef(s.id), { votes: s.votes.includes(name) ? arrayRemove(name) : arrayUnion(name) })),
    score: (s: Show, v: number | null) => save(updateDoc(showRef(s.id), new FieldPath('scores', name), v === null ? deleteField() : v)),
    remove: (s: Show) => save(deleteDoc(showRef(s.id)), `Removed ${s.title}`),
  };

  const addShow = async (l: Lookup) => {
    const data: ShowData = {
      malId: l.malId, title: l.title.slice(0, 200), image: l.image, eps: l.eps, score: l.score, year: l.year,
      type: l.type, status: 'next', ep: 0, by: name, votes: [name], scores: {}, log: [], addedAt: Date.now(), statusAt: Date.now(),
    };
    setSheet(null);
    setTab('next');
    await save(addDoc(showsRef, data), `Added ${l.title} to Up Next`);
  };

  return (
    <div className="app">
      <header>
        <div className="club">
          <h1 className="display">{club.name}</h1>
          <div className="head-btns">
            <button className="me" onClick={() => setSheet('name')} aria-label={`You are ${name}. Change`}>
              {me && <Av name={me} color={colorOf(me)} />}{me ? me : 'Pick your name'}
            </button>
            <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="Club settings">⚙</button>
          </div>
        </div>
        <div className="next">
          <span className={`dot ${session.tonight ? 'live' : ''}`} />
          {session.tonight ? <>Tonight <b>{formatTime(club.meetTime)}</b></> : <>Next session <b>{formatDay(session.at)} · {formatTime(club.meetTime)}</b></>}
        </div>
        <nav className="tabs" role="tablist">
          {([['watching', 'Watching', watching.length], ['next', 'Up Next', next.length], ['watched', 'Watched', watched.length]] as const).map(([k, l, c]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l} <span className="count">{c}</span></button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'watching' && <div className="list">
          {watching.map((s) => <WatchingCard key={s.id} s={s} a={actions} />)}
          {!watching.length && <p className="empty">Nothing on the go. Start a show from <button className="link" onClick={() => setTab('next')}>Up Next</button>.</p>}
        </div>}
        {tab === 'next' && <div className="list">
          {next.map((s, i) => <NextCard key={s.id} s={s} rank={i + 1} me={name} colorOf={colorOf} a={actions} />)}
          {!next.length && <p className="empty">The queue is empty. Tap <b>Add a show</b> to suggest one.</p>}
        </div>}
        {tab === 'watched' && <WatchedList shows={watched} me={name} colorOf={colorOf} a={actions} />}
      </main>

      <button className="fab" onClick={() => setSheet('add')}><span aria-hidden="true">＋</span> Add a show</button>

      {sheet === 'add' && <AddSheet shows={shows} onAdd={addShow} onClose={() => setSheet(null)} />}
      {sheet === 'name' && <NameSheet club={club} me={me} colorOf={colorOf} mustPick={!!needsName}
        onPick={(n) => { setMe(n); writeLS('ac:name', n); setSheet(null); }}
        onAddMember={(n) => save(updateDoc(clubRef, { members: arrayUnion(n) }))}
        onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet club={club} clubKey={clubKey}
        onSave={(c) => save(updateDoc(clubRef, c), 'Club updated')} onClose={() => setSheet(null)} toast={toast.show} />}
      {toast.msg && <div className="toast" role="status">{toast.msg}</div>}
    </div>
  );
}

type Actions = {
  bump: (s: Show, n: number) => Promise<void>;
  setStatus: (s: Show, st: Status, ok: string) => Promise<void>;
  vote: (s: Show) => Promise<void>;
  score: (s: Show, v: number | null) => Promise<void>;
  remove: (s: Show) => Promise<void>;
};

function Av({ name, color }: { name: string; color: string }) {
  return <span className="av" style={{ background: color }} title={name}>{[...name][0]?.toUpperCase()}</span>;
}

function Poster({ s, small }: { s: { title: string; image: string | null }; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const h = hueFor(s.title);
  return (
    <div className={`poster ${small ? 'small' : ''}`} style={{ background: `linear-gradient(160deg, oklch(0.62 0.15 ${h}), oklch(0.32 0.12 ${h + 40}))` }}>
      {s.image && !broken
        ? <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span>{s.title.split(/[:(]/)[0]}</span>}
    </div>
  );
}

function Meta({ s }: { s: Pick<Show, 'malId' | 'score' | 'type' | 'eps' | 'year'> }) {
  return (
    <div className="meta">
      {s.score != null && <span>MAL <span className="mal">{s.score.toFixed(2)}</span></span>}
      {(s.type || s.eps != null) && <span>{[s.type, s.eps != null ? `${s.eps} ep${s.eps === 1 ? '' : 's'}` : 'eps ?'].filter(Boolean).join(' · ')}</span>}
      {s.year != null && <span>{s.year}</span>}
      {s.malId != null && <a href={malUrl(s.malId)} target="_blank" rel="noopener noreferrer">MAL ↗</a>}
    </div>
  );
}

/** A button that needs a second tap within 3s, for anything destructive. */
function ConfirmButton({ label, confirm, onConfirm, className = 'btn ghost' }: { label: string; confirm: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button className={`${className} ${armed ? 'armed' : ''}`} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirm : label}</button>;
}

function WatchingCard({ s, a }: { s: Show; a: Actions }) {
  const last = s.log[s.log.length - 1];
  const done = s.eps != null && s.ep >= s.eps;
  return (
    <article className="card">
      <Poster s={s} />
      <div className="info">
        <h3 className="title">{s.title}</h3>
        <Meta s={s} />
        <div className="prog">
          <span>EP <b>{String(s.ep).padStart(2, '0')}</b>{s.eps != null && <> / {s.eps}</>}</span>
          {s.eps != null && <span className="sub">{done ? 'all watched' : `${s.eps - s.ep} left`}</span>}
        </div>
        {s.eps != null && s.eps <= 200 && <div className="eps" aria-hidden="true">
          {Array.from({ length: s.eps }, (_, k) => <i key={k} className={k < s.ep ? 'on' : ''} />)}
        </div>}
        <div className="sub">{last ? `Last session ${formatLog(last)}` : 'Not started yet'} · picked by {s.by}</div>
        {done
          ? <div className="finish"><span>All {s.eps} episodes watched.</span>
              <div className="row"><button className="btn ghost" onClick={() => a.bump(s, -1)}>−1</button>
              <button className="btn primary" onClick={() => a.setStatus(s, 'done', 'Moved to Watched. Add your score.')}>Mark finished</button></div></div>
          : <div className="row">
              <button className="btn primary" onClick={() => a.bump(s, 1)}>+1 ep</button>
              <button className="btn" onClick={() => a.bump(s, 3)}>+3</button>
              <button className="btn ghost" onClick={() => a.bump(s, -1)} disabled={s.ep === 0} aria-label="Undo one episode">−1</button>
              <span className="spacer" />
              {s.eps == null && <button className="btn ghost" onClick={() => a.setStatus(s, 'done', 'Moved to Watched')}>Finish</button>}
              <ConfirmButton label="Drop" confirm="Tap to drop" onConfirm={() => a.setStatus(s, 'drop', `Dropped ${s.title}`)} />
            </div>}
      </div>
    </article>
  );
}

function NextCard({ s, rank, me, colorOf, a }: { s: Show; rank: number; me: string; colorOf: (n: string) => string; a: Actions }) {
  const mine = s.votes.includes(me);
  return (
    <article className="card">
      <Poster s={s} />
      <div className="info">
        <div className="title-row"><h3 className="title">{s.title}</h3><span className="rank">#{rank}</span></div>
        <Meta s={s} />
        <div className="sub">Suggested by {s.by}</div>
        <div className="row between">
          <div className="votes">
            <button className="vote" aria-pressed={mine} onClick={() => a.vote(s)} aria-label={mine ? 'Remove your vote' : 'Vote for this'}>▲ {s.votes.length}</button>
            <span className="stack">{s.votes.map((v) => <Av key={v} name={v} color={colorOf(v)} />)}</span>
          </div>
          <div className="row">
            <ConfirmButton label="Remove" confirm="Tap to remove" onConfirm={() => a.remove(s)} />
            <button className="btn" onClick={() => a.setStatus(s, 'watching', `Now watching ${s.title}`)}>Start</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function WatchedList({ shows, me, colorOf, a }: { shows: Show[]; me: string; colorOf: (n: string) => string; a: Actions }) {
  const [filter, setFilter] = useState<'all' | 'done' | 'drop'>('all');
  const items = shows.filter((s) => filter === 'all' || s.status === filter);
  return (
    <>
      <div className="filters">
        {([['all', 'All'], ['done', 'Finished'], ['drop', 'Dropped']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="list">
        {items.map((s) => {
          const avg = clubAverage(s.scores);
          const when = formatISO(localISODate(new Date(s.statusAt)));
          return (
            <article className="card" key={s.id}>
              <Poster s={s} />
              <div className="info">
                <div className="title-row">
                  <h3 className="title">{s.title}</h3>
                  {s.status === 'done' && <div className="club-score-box"><div className="club-score">{avg == null ? '–' : avg.toFixed(1)}</div><div className="sub">club</div></div>}
                </div>
                <Meta s={s} />
                <div className="row">
                  <span className={`chip ${s.status}`}>{s.status === 'done' ? 'Finished' : 'Dropped'}</span>
                  <span className="sub">{when}{s.status === 'drop' && ` · at ep ${s.ep}`}</span>
                </div>
                {s.status === 'done' && <>
                  {Object.keys(s.scores).length > 0 && <div className="scores">
                    {Object.entries(s.scores).sort((x, y) => y[1] - x[1]).map(([n, v]) => <span key={n}><Av name={n} color={colorOf(n)} />{v}</span>)}
                  </div>}
                  <label className="sub row" htmlFor={`score-${s.id}`}>Your score
                    <select id={`score-${s.id}`} value={s.scores[me] ?? ''} onChange={(e) => a.score(s, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">—</option>
                      {Array.from({ length: 10 }, (_, k) => 10 - k).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                </>}
                <div className="row">
                  <button className="btn ghost" onClick={() => a.setStatus(s, 'watching', `Back to Watching: ${s.title}`)}>Watch again</button>
                  <ConfirmButton label="Remove" confirm="Tap to remove" onConfirm={() => a.remove(s)} />
                </div>
              </div>
            </article>
          );
        })}
        {!items.length && <p className="empty">{filter === 'drop' ? 'Nothing dropped. Nice.' : 'Finished shows land here.'}</p>}
      </div>
    </>
  );
}

function Sheet({ title, onClose, children, head, closable = true }: { title: string; onClose: () => void; children: React.ReactNode; head?: React.ReactNode; closable?: boolean }) {
  useEffect(() => {
    if (!closable) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [closable, onClose]);
  return (
    <>
      <div className="scrim" onClick={closable ? onClose : undefined} />
      <section className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-head">
          <div className="row between"><h2>{title}</h2>{closable && <button className="btn ghost" onClick={onClose}>Close</button>}</div>
          {head}
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}

function AddSheet({ shows, onAdd, onClose }: { shows: Show[]; onAdd: (l: Lookup) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; results: Lookup[]; error?: string }>({ status: 'idle', results: [] });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setState({ status: 'idle', results: [] }); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setState((s) => ({ ...s, status: 'loading' }));
      searchAnime(term, ctl.signal)
        .then((results) => setState({ status: 'done', results }))
        .catch((e: Error) => { if (e.name !== 'AbortError') setState({ status: 'error', results: [], error: e.message }); });
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const onBoard = new Map(shows.filter((s) => s.malId != null).map((s) => [s.malId, s.status]));
  const label: Record<Status, string> = { next: 'In Up Next', watching: 'Watching', done: 'Watched', drop: 'Dropped' };
  const term = q.trim();
  return (
    <Sheet title="Find on MyAnimeList" onClose={onClose} head={<>
      <input ref={input} id="search" className="search" type="search" placeholder="Search a title…" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="src">Results from MyAnimeList (via Jikan)</div>
    </>}>
      <div className="results">
        {state.status === 'idle' && <p className="empty">Type a title to search.</p>}
        {state.status === 'loading' && !state.results.length && <p className="empty">Searching…</p>}
        {state.status === 'error' && <p className="empty">Search isn't responding ({state.error}). Try again, or add it by title below.</p>}
        {state.status === 'done' && !state.results.length && <p className="empty">No matches on MyAnimeList.</p>}
        {state.results.map((r) => {
          const st = r.malId != null ? onBoard.get(r.malId) : undefined;
          return (
            <div className="result" key={r.malId ?? r.title}>
              <Poster s={r} small />
              <div className="result-info">
                <div className="title small">{r.title}</div>
                {r.altTitle && <div className="sub alt">{r.altTitle}</div>}
                <Meta s={r} />
              </div>
              {st ? <span className="sub">{label[st]}</span> : <button className="btn primary" onClick={() => onAdd(r)}>Add</button>}
            </div>
          );
        })}
        {term.length >= 2 && (
          <div className="result manual">
            <div className="result-info"><div className="title small">“{term}”</div><div className="sub">Not on MyAnimeList? Add it by title only.</div></div>
            <button className="btn" onClick={() => onAdd({ malId: null, title: term, altTitle: null, image: null, eps: null, score: null, year: null, type: null })}>Add by title</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function NameSheet({ club, me, colorOf, mustPick, onPick, onAddMember, onClose }: {
  club: Club; me: string | null; colorOf: (n: string) => string; mustPick: boolean;
  onPick: (n: string) => void; onAddMember: (n: string) => Promise<void>; onClose: () => void;
}) {
  const [n, setN] = useState('');
  const clean = n.trim().replace(/\s+/g, ' ').slice(0, 40);
  const exists = club.members.some((m) => m.toLowerCase() === clean.toLowerCase());
  return (
    <Sheet title="Who are you?" onClose={onClose} closable={!mustPick}>
      <div className="names">
        <p className="sub">Your name goes on your votes and scores. It's saved on this device only.</p>
        <div className="name-grid">
          {club.members.map((m) => (
            <button key={m} className="name-btn" aria-pressed={m === me} onClick={() => onPick(m)}><Av name={m} color={colorOf(m)} />{m}</button>
          ))}
        </div>
        <form className="row" onSubmit={async (e) => {
          e.preventDefault();
          if (!clean) return;
          const name = exists ? club.members.find((m) => m.toLowerCase() === clean.toLowerCase())! : clean;
          if (!exists) await onAddMember(name);
          onPick(name);
        }}>
          <label htmlFor="new-name" className="sr">Your name</label>
          <input id="new-name" className="search grow" placeholder={club.members.length ? 'Not listed? Add your name' : 'Your name'} value={n} onChange={(e) => setN(e.target.value)} maxLength={40} />
          <button className="btn primary" disabled={!clean}>{exists ? "That's me" : 'Join'}</button>
        </form>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ club, clubKey, onSave, onClose, toast }: {
  club: Club; clubKey: string; onSave: (c: Partial<Club>) => Promise<void>; onClose: () => void; toast: (m: string) => void;
}) {
  const [name, setName] = useState(club.name);
  const [day, setDay] = useState(club.meetDay);
  const [time, setTime] = useState(club.meetTime);
  const link = `${location.origin}${location.pathname}#c=${clubKey}`;
  const dirty = name.trim() !== club.name || day !== club.meetDay || time !== club.meetTime;
  const linkRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet title="Club settings" onClose={onClose}>
      <form className="settings" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onSave({ name: name.trim().slice(0, 60), meetDay: day, meetTime: time }); onClose(); }}>
        <label htmlFor="club-name">Club name<input id="club-name" className="search" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <div className="row two">
          <label htmlFor="meet-day">Meets on<select id="meet-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <label htmlFor="meet-time">At<input id="meet-time" type="time" value={time} onChange={(e) => setTime(e.target.value || club.meetTime)} /></label>
        </div>
        <button className="btn primary" disabled={!dirty || !name.trim()}>Save</button>
        <div className="invite">
          <label htmlFor="invite">Invite link</label>
          <p className="sub">Anyone with this link can see and edit the club. Share it in your group chat, not publicly.</p>
          <div className="row">
            <input id="invite" ref={linkRef} className="search grow mono" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => {
              navigator.clipboard.writeText(link).then(() => toast('Invite link copied'), () => { linkRef.current?.select(); toast('Select the link and copy it'); });
            }}>Copy</button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}
