// Snapshot the club's MyAnimeList lists into public/mal/<user>.json.
//
// MAL's list endpoint refuses browser requests, so the site reads these files.
// The usernames come from the club's Firestore (clubs/<CLUB_KEY>/malLists),
// read through the same security rules as the app. Files are keyed by MAL
// username only and never name a club member.
//
//   node scripts/fetch-mal.mjs           fetch every list, write snapshots
//   node scripts/fetch-mal.mjs --check   decide whether a deploy is needed and
//                                        whether to raise the daily-limit alert
//                                        (writes need=/alert= to $GITHUB_OUTPUT)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const PROJECT = 'krystade-anime-club';
const SITE = process.env.SITE_URL ?? 'https://krystade.github.io/anime-club/';
const KEY = process.env.CLUB_KEY;
const DAILY_LIMIT = 10;
const OUT = new URL('../public/mal/', import.meta.url);
const STATUS = { 1: 'watching', 2: 'completed', 3: 'onhold', 4: 'dropped', 6: 'plan' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanImg = (u) => (u ? u.replace(/\/r\/\d+x\d+/, '').replace(/\?s=.*$/, '') : null);
const docs = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/clubs/${KEY}`;

async function requestedUsers() {
  if (!KEY) { console.warn('CLUB_KEY not set: no lists to fetch'); return []; }
  const r = await fetch(`${docs}/malLists?pageSize=300`);
  if (!r.ok) throw new Error(`reading lists: HTTP ${r.status}`);
  const body = await r.json();
  return (body.documents ?? []).map((d) => d.name.split('/').pop());
}

async function quota() {
  const r = await fetch(`${docs}/meta/malQuota`);
  if (r.status === 404) return { day: 0, count: 0 };
  const f = (await r.json()).fields ?? {};
  return { day: Number(f.day?.integerValue ?? f.day?.doubleValue ?? 0), count: Number(f.count?.integerValue ?? 0) };
}

async function publishedIndex() {
  try {
    const r = await fetch(`${SITE}mal/index.json?t=${Date.now()}`);
    return r.ok ? await r.json() : { lists: {} };
  } catch { return { lists: {} }; }
}

async function fetchList(user) {
  const all = [];
  for (let offset = 0; ; offset += 300) {
    const r = await fetch(`https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`, {
      headers: { 'User-Agent': 'anime-club-list-snapshot' },
    });
    if (r.status === 400 || r.status === 404) return { error: 'notfound' };
    if (r.status === 401 || r.status === 403) return { error: 'private' };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const page = await r.json();
    if (!Array.isArray(page)) return { error: 'private' };
    all.push(...page);
    if (page.length < 300) break;
    await sleep(1500);
  }
  return {
    entries: all.map((a) => ({
      id: a.anime_id,
      title: String(a.anime_title_eng || a.anime_title),
      alt: a.anime_title_eng && a.anime_title_eng !== a.anime_title ? String(a.anime_title) : null,
      image: cleanImg(a.anime_image_path),
      eps: a.anime_num_episodes || null,
      type: a.anime_media_type_string || null,
      year: a.anime_season?.year ?? (a.anime_start_date_string ? 2000 + Number(String(a.anime_start_date_string).slice(-2)) : null),
      malScore: a.anime_score_val || null,
      myScore: a.score || null,
      status: STATUS[a.status] ?? 'other',
      genres: (a.genres ?? []).map((g) => g.name),
      updated: a.updated_at,
    })),
  };
}

function output(k, v) {
  console.log(`${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}

if (process.argv.includes('--check')) {
  // Deploy when a requested list has no snapshot yet, a removed list still has one,
  // or the newest snapshot is older than 20 hours.
  const [users, index, q] = await Promise.all([requestedUsers(), publishedIndex(), quota()]);
  const have = Object.keys(index.lists ?? {});
  const want = users.map((u) => u.toLowerCase());
  const missing = want.filter((u) => !have.includes(u));
  const extra = have.filter((u) => !want.includes(u));
  const age = index.fetchedAt ? Date.now() - Date.parse(index.fetchedAt) : Infinity;
  output('need', String(missing.length > 0 || extra.length > 0 || age > 20 * 3600_000));
  output('alert', String(q.day === Math.floor(Date.now() / 86400000) && q.count >= DAILY_LIMIT));
  output('added_today', String(q.day === Math.floor(Date.now() / 86400000) ? q.count : 0));
} else {
  mkdirSync(OUT, { recursive: true });
  const users = await requestedUsers();
  const index = { fetchedAt: new Date().toISOString(), lists: {} };
  for (const user of users) {
    const file = new URL(`${user.toLowerCase()}.json`, OUT);
    try {
      const res = await fetchList(user);
      writeFileSync(file, JSON.stringify({ user, fetchedAt: index.fetchedAt, ...res }));
      index.lists[user.toLowerCase()] = { user, ok: !res.error, error: res.error ?? null, count: res.entries?.length ?? 0 };
      console.log(`${user}: ${res.error ?? `${res.entries.length} entries`}`);
    } catch (e) {
      // MAL hiccup: keep serving the last published snapshot for this list.
      try {
        const prev = await fetch(`${SITE}mal/${user.toLowerCase()}.json`);
        if (prev.ok) { writeFileSync(file, await prev.text()); index.lists[user.toLowerCase()] = { user, ok: true, error: null, stale: true }; }
      } catch { /* nothing to keep */ }
      console.warn(`${user}: ${e.message}; kept the previous snapshot if there was one`);
    }
    await sleep(1500);
  }
  writeFileSync(new URL('index.json', OUT), JSON.stringify(index));
}
