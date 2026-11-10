import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

// One colour per member, by join order. Used on avatars, hearts and score chips.
const MEMBER_COLORS = ['#4F7DF0', '#EF6F55', '#2FA36F', '#9A63EC', '#E09A22', '#1FA2B4', '#D9467A', '#7C8794'];
const Members = createContext<string[]>([]);
function useColor() {
  const members = useContext(Members);
  return (n: string) => MEMBER_COLORS[Math.max(0, members.indexOf(n)) % MEMBER_COLORS.length];
}
function Av({ name, size = 22 }: { name: string; size?: number }) {
  const color = useColor()(name);
  return <span className="av" style={{ background: color, width: size, height: size, fontSize: size * 0.48 }} aria-hidden="true">{[...name][0]?.toUpperCase()}</span>;
}
function Heart({ filled, color }: { filled: boolean; color: string }) {
  return <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 15s-7-4.3-7-9.2A3.8 3.8 0 0 1 9 3.6a3.8 3.8 0 0 1 7 2.2C16 10.7 9 15 9 15Z" fill={filled ? color : 'none'} stroke={filled ? color : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
function EpDots({ ep, eps }: { ep: number; eps: number }) {
  if (eps > 60) return null;
  return <span className="dots" aria-hidden="true">{Array.from({ length: eps }, (_, i) => <i key={i} className={i < ep ? 'on' : ''} />)}</span>;
}
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, FieldPath,
  onSnapshot, updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { searchAnime } from './anilist';
import {
  DAYS, bump, clubAverage, formatDay, formatLog, formatTime, localISODate,
  malUrl, nextSession,
} from './logic';
import type { Club, Lookup, Show, ShowData, Status } from './types';

// ---------- device prefs ----------
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
  if (!key) return <Message title="Anime Club" body="Open your club's invite link to get in. Ask whoever runs the club to send it." />;
  return <ClubView clubKey={key} />;
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return <div className="page center"><h1 className="h1">{title}</h1><p className="muted">{body}</p>{children}</div>;
}

// ---------- icons (inline, stroke) ----------
const Ico = {
  plus: <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  minus: <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  chev: <svg className="chev" width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>,
};

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = (m: string) => { setMsg(m); clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 2200); };
  return { msg, show };
}

type AddTarget = 'queue' | 'rec' | 'sampled';
const ADD_DONE: Record<AddTarget, string> = { queue: 'Added to the queue', rec: 'Added to your recommendations', sampled: 'Added to Sampled' };
/** Can a show already on the board be moved into this list from the add sheet? */
function canPromote(st: Status, target: AddTarget) {
  return (target === 'sampled' && (st === 'rec' || st === 'queue')) || (target === 'queue' && st === 'rec');
}
type SheetState = { kind: 'add'; target: AddTarget } | { kind: 'show'; id: string } | { kind: 'name' } | { kind: 'settings' } | null;

function ClubView({ clubKey }: { clubKey: string }) {
  const [club, setClub] = useState<Club | null | 'missing'>(null);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(() => readLS('ac:name'));
  const [sheet, setSheet] = useState<SheetState>(null);
  const toast = useToast();

  const clubRef = useMemo(() => doc(db, 'clubs', clubKey), [clubKey]);
  const showsRef = useMemo(() => collection(db, 'clubs', clubKey, 'shows'), [clubKey]);
  useEffect(() => onSnapshot(clubRef, (s) => setClub(s.exists() ? (s.data() as Club) : 'missing'), (e) => setError(e.message)), [clubRef]);
  useEffect(() => onSnapshot(showsRef, (s) => setShows(s.docs.map((d) => ({ id: d.id, ...(d.data() as ShowData) }))), (e) => setError(e.message)), [showsRef]);

  const needsName = !!club && club !== 'missing' && (!me || !club.members.includes(me));
  useEffect(() => { if (needsName) setSheet({ kind: 'name' }); }, [needsName]);

  if (error) return <Message title="Can't reach the club" body={error} />;
  if (club === 'missing') return (
    <Message title="Club not found" body="This invite link doesn't match a club. Ask for the link again.">
      <button className="btn" onClick={() => { writeLS('ac:club', null); location.hash = ''; location.reload(); }}>Forget this link</button>
    </Message>
  );
  if (!club || !shows) return <div className="page center"><p className="muted">Loading…</p></div>;

  const name = me ?? '';
  const startTime = club.startTime ?? '19:30';
  const save = async (p: Promise<unknown>, ok?: string) => {
    try { await p; if (ok) toast.show(ok); } catch (e) { toast.show(`Couldn't save. ${(e as Error).message}`); }
  };
  const ref = (id: string) => doc(showsRef, id);
  const a: Actions = {
    bump: (s, n) => save(updateDoc(ref(s.id), bump(s, n, localISODate(new Date())))),
    move: (s, status, ok) => save(updateDoc(ref(s.id), {
      status, statusAt: Date.now(),
      ...(status === 'sampled' && s.ep === 0 ? { ep: 1 } : {}),
      ...(status !== 'sampled' ? { votes: [] } : {}),
    }), ok),
    vote: (s) => save(updateDoc(ref(s.id), { votes: s.votes.includes(name) ? arrayRemove(name) : arrayUnion(name) })),
    score: (s, v) => save(updateDoc(ref(s.id), new FieldPath('scores', name), v === null ? deleteField() : v)),
    recToggle: (s) => save(updateDoc(ref(s.id), { recBy: s.recBy.includes(name) ? arrayRemove(name) : arrayUnion(name) })),
    remove: (s) => save(deleteDoc(ref(s.id)), `Removed ${s.title}`),
  };

  const by = (st: Status) => shows.filter((s) => s.status === st);
  const watching = by('watching').sort((x, y) => x.statusAt - y.statusAt);
  const queue = by('queue').sort((x, y) => x.addedAt - y.addedAt);
  const sampled = by('sampled').sort((x, y) => y.votes.length - x.votes.length || x.statusAt - y.statusAt);
  const done = by('done').sort((x, y) => y.statusAt - x.statusAt);
  const dropped = by('drop').sort((x, y) => y.statusAt - x.statusAt);
  const session = nextSession(new Date(), club.meetDay, club.meetTime);
  const open = (s: Show) => setSheet({ kind: 'show', id: s.id });

  const addShow = async (l: Lookup, target: AddTarget) => {
    const existing = l.malId != null ? shows.find((s) => s.malId === l.malId) : undefined;
    setSheet(null);
    if (existing) {
      if (canPromote(existing.status, target)) await a.move(existing, target, ADD_DONE[target]);
      else if (target === 'rec' && !existing.recBy.includes(name)) await save(updateDoc(ref(existing.id), { recBy: arrayUnion(name) }), ADD_DONE.rec);
      else toast.show(`${existing.title} is already on the board`);
      return;
    }
    const data: ShowData = {
      malId: l.malId, title: l.title.slice(0, 200), image: l.image, eps: l.eps, score: l.score, year: l.year, type: l.type,
      status: target, ep: target === 'sampled' ? 1 : 0, by: name, recBy: target === 'rec' ? [name] : [], votes: [], scores: {}, log: [], addedAt: Date.now(), statusAt: Date.now(),
    };
    await save(addDoc(showsRef, data), ADD_DONE[target]);
  };
  const current = sheet?.kind === 'show' ? shows.find((s) => s.id === sheet.id) : undefined;

  return (
    <Members.Provider value={club.members}>
    <div className="page">
      <div className="top">
        <h1 className="h1">{club.name}</h1>
        <div className="top-r">
          <button className="me-btn" onClick={() => setSheet({ kind: 'name' })}>{me && <Av name={me} />}<span>{me ?? 'Pick your name'}</span></button>
          <button className="icon" onClick={() => setSheet({ kind: 'settings' })} aria-label="Club settings">{Ico.gear}</button>
        </div>
      </div>

      <section className="grp tonight" aria-label={session.tonight ? 'Tonight' : 'Next meeting'}>
        <div className="tn-head">{session.tonight ? <b className="live">Tonight</b> : <b>Next meeting</b>}<span>{formatDay(session.at)}</span></div>
        <div className="times">
          <div><small>Meet</small><strong>{formatTime(club.meetTime).replace(/ [AP]M/, '')}</strong></div>
          <div><small>Episode starts</small><strong>{formatTime(startTime).replace(/ [AP]M/, '')}</strong></div>
        </div>
        <div className="now-h">Now watching</div>
        {watching.map((s) => <OnRow key={s.id} s={s} a={a} onOpen={() => open(s)} />)}
        {!watching.length && (
          <div className="not-watching">
            <span className="muted">Not watching anything right now.</span>
            {queue[0] && <button className="link" onClick={() => a.move(queue[0], 'watching', `Now watching ${queue[0].title}`)}>Start {queue[0].title}</button>}
          </div>
        )}
      </section>

      <Section title="Sampled" action={<button className="link" onClick={() => setSheet({ kind: 'add', target: 'sampled' })}>Add</button>} note="Tried an episode, not decided yet. Vote to keep watching.">
        {sampled.length ? <VoteGrid shows={sampled} members={club.members} me={name} a={a} onOpen={open} /> : <Empty>Nothing sampled. Try an episode of something from the queue.</Empty>}
      </Section>
      {sampled.length > 0 && sampled[0].votes.length > 0 && (
        <div className="winner"><span>Most votes: <b>{sampled[0].title}</b></span>
          <button className="btn primary" onClick={() => a.move(sampled[0], 'watching', `Now watching ${sampled[0].title}`)}>Watch it</button></div>
      )}

      <Section title="In queue" action={<button className="link" onClick={() => setSheet({ kind: 'add', target: 'queue' })}>Add</button>}>
        {queue.length ? queue.map((s, i) => <Row key={s.id} s={s} onOpen={() => open(s)} right={i === 0 ? <span className="ok">Next</span> : `#${i + 1}`} />) : <Empty>The queue is empty.</Empty>}
      </Section>

      <Section title="Completed" count={done.length}>
        {done.length ? done.map((s) => {
          const avg = clubAverage(s.scores);
          return <Row key={s.id} s={s} onOpen={() => open(s)} sub={s.eps != null ? `${s.eps} eps` : undefined} right={avg == null ? <span className="muted">Rate</span> : <span className="score">{avg.toFixed(1)}</span>} />;
        }) : <Empty>Finished shows land here.</Empty>}
      </Section>

      <Section title="Dropped" count={dropped.length || undefined}>
        {dropped.length ? dropped.map((s) => <Row key={s.id} s={s} onOpen={() => open(s)} right={<span className="warn">at ep {s.ep}</span>} />) : <Empty>Nothing dropped. Everyone's still friends.</Empty>}
      </Section>

      <Section title="Recommendations" action={<button className="link" onClick={() => setSheet({ kind: 'add', target: 'rec' })}>Add</button>}
        note="Everyone's personal list. Open one to move it to the queue.">
        <Recs shows={shows} members={club.members} me={name} onOpen={open} />
      </Section>

      <p className="foot-note">Show data from MyAnimeList</p>

      {sheet?.kind === 'add' && <AddSheet target={sheet.target} shows={shows} onAdd={addShow} onClose={() => setSheet(null)} />}
      {current && <ShowSheet s={current} me={name} members={club.members} a={a} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'name' && <NameSheet club={club} me={me} mustPick={needsName}
        onPick={(n) => { setMe(n); writeLS('ac:name', n); setSheet(null); }}
        onAddMember={(n) => save(updateDoc(clubRef, { members: arrayUnion(n) }))}
        onClose={() => setSheet(null)} />}
      {sheet?.kind === 'settings' && <SettingsSheet club={club} clubKey={clubKey}
        onSave={(c) => save(updateDoc(clubRef, c), 'Saved')} onClose={() => setSheet(null)} toast={toast.show} />}
      {toast.msg && <div className="toast" role="status">{toast.msg}</div>}
    </div>
    </Members.Provider>
  );
}

type Actions = {
  bump: (s: Show, n: number) => Promise<void>;
  move: (s: Show, st: Status, ok?: string) => Promise<void>;
  vote: (s: Show) => Promise<void>;
  score: (s: Show, v: number | null) => Promise<void>;
  recToggle: (s: Show) => Promise<void>;
  remove: (s: Show) => Promise<void>;
};

// ---------- building blocks ----------
function Section({ title, count, action, note, children }: { title: string; count?: number; action?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}{count != null && <span className="cnt"> {count}</span>}</h2>{action}</div>
      <div className="grp">{children}</div>
      {note && <p className="note">{note}</p>}
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function Thumb({ s, size = 'md' }: { s: { title: string; image: string | null }; size?: 'sm' | 'md' | 'lg' | 'hero' }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`thumb ${size}`} aria-hidden="true">
      {s.image && !broken ? <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span>{s.title.split(/[:(!,]/)[0].split(' ').slice(0, 3).join(' ')}</span>}
    </div>
  );
}

function Row({ s, onOpen, right, sub }: { s: Show; onOpen: () => void; right?: React.ReactNode; sub?: string }) {
  return (
    <button className="row" onClick={onOpen}>
      <Thumb s={s} size="sm" />
      <span className="row-m"><span className="t">{s.title}</span><span className="s">{sub ?? [s.type, s.eps != null ? `${s.eps} eps` : null, s.year].filter(Boolean).join(' · ')}</span></span>
      <span className="r">{right}</span>
      {Ico.chev}
    </button>
  );
}

function Stepper({ s, a }: { s: Show; a: Actions }) {
  return (
    <div className="stepper">
      <button onClick={() => a.bump(s, -1)} disabled={s.ep === 0} aria-label="Back one episode">{Ico.minus}</button>
      <span aria-live="polite">Ep {s.ep}</span>
      <button onClick={() => a.bump(s, 1)} disabled={s.eps != null && s.ep >= s.eps} aria-label="Forward one episode">{Ico.plus}</button>
    </div>
  );
}

function OnRow({ s, a, onOpen }: { s: Show; a: Actions; onOpen: () => void }) {
  const last = s.log[s.log.length - 1];
  const finished = s.eps != null && s.ep >= s.eps;
  return (
    <div className="on">
      <Thumb s={s} size="hero" />
      <button className="on-t" onClick={onOpen}>
        <span className="t">{s.title}</span>
        <span className="s">{s.eps != null ? `${s.ep} of ${s.eps}` : `${s.ep} watched`}{last ? ` · last ${formatLog(last)}` : ''}</span>
        {s.eps != null && <EpDots ep={s.ep} eps={s.eps} />}
      </button>
      {finished
        ? <button className="btn primary" onClick={() => a.move(s, 'done', `Finished ${s.title}. Add your score.`)}>Finish</button>
        : <Stepper s={s} a={a} />}
    </div>
  );
}

function VoteGrid({ shows, members, me, a, onOpen }: { shows: Show[]; members: string[]; me: string; a: Actions; onOpen: (s: Show) => void }) {
  const colorOf = useColor();
  return (
    <>
      {shows.map((s) => (
        <div key={s.id} className="sampled">
          <button className="row sampled-top" onClick={() => onOpen(s)}>
            <Thumb s={s} size="sm" />
            <span className="row-m"><span className="t">{s.title}</span><span className="s">{[s.type, s.eps != null ? `${s.eps} eps` : null, s.year].filter(Boolean).join(' · ')}{s.ep > 0 ? ` · saw ep ${s.ep}` : ''}</span></span>
            <span className="r" />
            {Ico.chev}
          </button>
          <div className="hearts">
            {members.map((m) => {
              const y = s.votes.includes(m);
              return (
                <button key={m} className={`heart ${y ? 'y' : ''} ${m === me ? 'mine' : ''}`} disabled={m !== me} onClick={() => a.vote(s)}
                  aria-label={`${m}: ${y ? 'wants to keep watching' : 'no vote'}`} aria-pressed={y}>
                  <Heart filled={y} color={colorOf(m)} /><span>{[...m][0]}</span>
                </button>
              );
            })}
            <span className="tally">{s.votes.length}<small>{s.votes.length === 1 ? ' vote' : ' votes'}</small></span>
          </div>
        </div>
      ))}
    </>
  );
}

const STATUS_TAG: Record<Status, string> = { rec: '', queue: 'in queue', sampled: 'sampled', watching: 'watching', done: 'watched', drop: 'dropped' };

function Recs({ shows, members, me, onOpen }: { shows: Show[]; members: string[]; me: string; onOpen: (s: Show) => void }) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  return (
    <>
      {members.map((m) => {
        const list = shows.filter((s) => s.recBy.includes(m)).sort((x, y) => x.addedAt - y.addedAt);
        const pending = list.filter((s) => s.status === 'rec').length;
        const isOpen = openFor === m;
        return (
          <div key={m} className="person-wrap">
            <button className="person" aria-expanded={isOpen} onClick={() => setOpenFor(isOpen ? null : m)}>
              <span className="n"><Av name={m} size={28} />{m}{m === me && <span className="muted"> (you)</span>}</span>
              <span className="c">{list.length ? `${pending} to watch${list.length > pending ? ` · ${list.length - pending} seen` : ''}` : 'none yet'}</span>
              {Ico.chev}
            </button>
            {isOpen && <div className="recs">
              {list.map((s) => {
                const others = s.recBy.filter((x) => x !== m);
                return (
                  <button key={s.id} className={`rec ${s.status === 'done' ? 'seen' : ''}`} onClick={() => onOpen(s)}>
                    <span className="nm">{s.title}</span>
                    <span className={`tag ${s.status === 'done' ? 'ok' : ''}`}>{STATUS_TAG[s.status] || (others.length ? `also ${others.join(', ')}` : '')}</span>
                  </button>
                );
              })}
              {!list.length && <div className="rec"><span className="muted">Nothing here yet.</span></div>}
            </div>}
          </div>
        );
      })}
    </>
  );
}

/** Needs a second tap within 3s; for anything destructive. */
function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button className={`act danger ${armed ? 'armed' : ''}`} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirm : label}</button>;
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
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <span className="grabber" aria-hidden="true" />
          <div className="sheet-bar">{closable ? <button className="link" onClick={onClose}>Done</button> : <span />}<h2>{title}</h2><span /></div>
          {head}
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}

// ---------- show detail ----------
const MOVES: Record<Status, [Status, string][]> = {
  rec: [['queue', 'Move to queue'], ['sampled', 'We sampled it']],
  queue: [['watching', 'Start watching'], ['sampled', 'We sampled it'], ['rec', 'Back to recommendations']],
  sampled: [['watching', 'Keep watching'], ['drop', 'Drop it'], ['queue', 'Back to queue']],
  watching: [['done', 'Mark completed'], ['drop', 'Drop it'], ['queue', 'Back to queue']],
  done: [['watching', 'Watch again']],
  drop: [['watching', 'Pick it back up'], ['queue', 'Back to queue']],
};
const STATUS_NAME: Record<Status, string> = { rec: 'Recommended', queue: 'In queue', sampled: 'Sampled', watching: 'Watching', done: 'Completed', drop: 'Dropped' };

function ShowSheet({ s, me, members, a, onClose }: { s: Show; me: string; members: string[]; a: Actions; onClose: () => void }) {
  const avg = clubAverage(s.scores);
  return (
    <Sheet title={STATUS_NAME[s.status]} onClose={onClose}>
      <div className="detail">
        <div className="d-top">
          <Thumb s={s} size="lg" />
          <div className="d-meta">
            <h3>{s.title}</h3>
            <p className="muted">{[s.type, s.eps != null ? `${s.eps} eps` : null, s.year].filter(Boolean).join(' · ') || 'No MyAnimeList info'}</p>
            {s.score != null && <p className="muted">MAL score <b className="num">{s.score.toFixed(2)}</b></p>}
            {s.malId != null && <a className="link" href={malUrl(s.malId)} target="_blank" rel="noopener noreferrer">Open on MyAnimeList</a>}
            {s.recBy.length > 0 && <p className="muted">Recommended by {s.recBy.join(', ')}</p>}
          </div>
        </div>

        {(s.status === 'watching' || s.status === 'sampled') && (
          <div className="grp d-grp">
            <div className="d-line"><span>Episode</span><Stepper s={s} a={a} /></div>
            {s.log.length > 0 && <div className="d-line col"><span>Meetings</span><span className="muted">{[...s.log].reverse().map(formatLog).join('  ·  ')}</span></div>}
          </div>
        )}

        {s.status === 'done' && (
          <div className="grp d-grp">
            <div className="d-line"><label htmlFor={`score-${s.id}`}>Your score</label>
              <select id={`score-${s.id}`} value={s.scores[me] ?? ''} onChange={(e) => a.score(s, e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {Array.from({ length: 10 }, (_, k) => 10 - k).map((v) => <option key={v} value={v}>{v}</option>)}
              </select></div>
            <div className="d-line"><span>Club</span><span className="num big">{avg == null ? '–' : avg.toFixed(1)}</span></div>
            <div className="d-scores">{members.map((m) => <span key={m} className="sc"><Av name={m} size={22} /><b className="num">{s.scores[m] ?? '–'}</b></span>)}</div>
          </div>
        )}

        <div className="grp actions">
          {MOVES[s.status].map(([st, label]) => <button key={st} className="act" onClick={() => { a.move(s, st, `${s.title}: ${STATUS_NAME[st].toLowerCase()}`); onClose(); }}>{label}</button>)}
          <button className="act" onClick={() => a.recToggle(s)}>{s.recBy.includes(me) ? 'Remove from my recommendations' : 'Add to my recommendations'}</button>
          <ConfirmButton label="Delete from the club" confirm="Tap again to delete" onConfirm={() => { a.remove(s); onClose(); }} />
        </div>
      </div>
    </Sheet>
  );
}

// ---------- add ----------
function AddSheet({ target, shows, onAdd, onClose }: { target: AddTarget; shows: Show[]; onAdd: (l: Lookup, t: AddTarget) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; results: Lookup[] }>({ status: 'idle', results: [] });
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
        .catch((e: Error) => { if (e.name !== 'AbortError') setState({ status: 'error', results: [] }); });
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const have = new Map(shows.filter((s) => s.malId != null).map((s) => [s.malId, s.status]));
  const term = q.trim();
  return (
    <Sheet title={{ rec: 'Recommend a show', queue: 'Add to queue', sampled: 'Add to Sampled' }[target]} onClose={onClose}
      head={<input ref={input} id="search" className="field" type="search" placeholder="Search anime" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <div className="grp">
        {state.status === 'idle' && <Empty>Type a title.</Empty>}
        {state.status === 'loading' && !state.results.length && <Empty>Searching…</Empty>}
        {state.status === 'error' && <Empty>Search isn't responding. You can still add it by title.</Empty>}
        {state.status === 'done' && !state.results.length && <Empty>No matches.</Empty>}
        {state.results.map((r) => {
          const st = r.malId != null ? have.get(r.malId) : undefined;
          return (
            <div className="row static" key={r.malId ?? r.title}>
              <Thumb s={r} size="sm" />
              <span className="row-m"><span className="t">{r.title}</span><span className="s">{[r.altTitle, r.type, r.eps != null ? `${r.eps} eps` : null, r.year].filter(Boolean).join(' · ')}</span></span>
              {st && !(target === 'rec' && st === 'rec') && !canPromote(st, target) ? <span className="r muted">{STATUS_TAG[st] || 'recommended'}</span> : <button className="btn" onClick={() => onAdd(r, target)}>Add</button>}
            </div>
          );
        })}
        {term.length >= 2 && (
          <div className="row static">
            <span className="row-m" style={{ gridColumn: '1 / 3' }}><span className="t">“{term}”</span><span className="s">Add by title only</span></span>
            <button className="btn" onClick={() => onAdd({ malId: null, title: term, altTitle: null, image: null, eps: null, score: null, year: null, type: null }, target)}>Add</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------- who are you ----------
function NameSheet({ club, me, mustPick, onPick, onAddMember, onClose }: {
  club: Club; me: string | null; mustPick: boolean; onPick: (n: string) => void; onAddMember: (n: string) => Promise<void>; onClose: () => void;
}) {
  const [n, setN] = useState('');
  const clean = n.trim().replace(/\s+/g, ' ').slice(0, 40);
  const match = club.members.find((m) => m.toLowerCase() === clean.toLowerCase());
  return (
    <Sheet title="Who are you?" onClose={onClose} closable={!mustPick}>
      <p className="muted pad">Your name goes on your votes, scores and recommendations. It's remembered on this phone.</p>
      <div className="grp">
        {club.members.map((m) => (
          <button key={m} className="row pick" onClick={() => onPick(m)}>
            <span className="row-m name-m"><Av name={m} size={30} /><span className="t">{m}</span></span>
            {m === me ? <span className="r ok">You</span> : <span />}
          </button>
        ))}
      </div>
      <form className="add-name" onSubmit={async (e) => {
        e.preventDefault();
        if (!clean) return;
        if (!match) await onAddMember(clean);
        onPick(match ?? clean);
      }}>
        <label htmlFor="new-name" className="sr">Your name</label>
        <input id="new-name" className="field" placeholder="Someone new? Type your name" value={n} onChange={(e) => setN(e.target.value)} maxLength={40} />
        <button className="btn primary" disabled={!clean}>{match ? "That's me" : 'Join'}</button>
      </form>
    </Sheet>
  );
}

// ---------- settings ----------
function SettingsSheet({ club, clubKey, onSave, onClose, toast }: {
  club: Club; clubKey: string; onSave: (c: Partial<Club>) => Promise<void>; onClose: () => void; toast: (m: string) => void;
}) {
  const [name, setName] = useState(club.name);
  const [day, setDay] = useState(club.meetDay);
  const [meet, setMeet] = useState(club.meetTime);
  const [start, setStart] = useState(club.startTime ?? '19:30');
  const link = `${location.origin}${location.pathname}#c=${clubKey}`;
  const dirty = name.trim() !== club.name || day !== club.meetDay || meet !== club.meetTime || start !== (club.startTime ?? '19:30');
  const linkRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet title="Club" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onSave({ name: name.trim().slice(0, 60), meetDay: day, meetTime: meet, startTime: start }); onClose(); }}>
        <div className="grp form">
          <label className="f-line" htmlFor="club-name"><span>Name</span><input id="club-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <label className="f-line" htmlFor="meet-day"><span>Day</span><select id="meet-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <label className="f-line" htmlFor="meet-time"><span>Meet</span><input id="meet-time" type="time" value={meet} onChange={(e) => setMeet(e.target.value || meet)} /></label>
          <label className="f-line" htmlFor="start-time"><span>Episode starts</span><input id="start-time" type="time" value={start} onChange={(e) => setStart(e.target.value || start)} /></label>
        </div>
        <button className="btn primary wide" disabled={!dirty || !name.trim()}>Save</button>
      </form>
      <div className="sec">
        <div className="sec-h"><h2>Invite link</h2></div>
        <div className="grp form">
          <div className="f-line"><input id="invite" ref={linkRef} className="mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button type="button" className="link" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Copied'), () => { linkRef.current?.select(); toast('Select the link and copy it'); })}>Copy</button></div>
        </div>
        <p className="note">Anyone with this link can see and edit the club. Keep it in the group chat.</p>
      </div>
    </Sheet>
  );
}
