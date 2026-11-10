// Snapshot members' public MyAnimeList lists into public/mal/<user>.json.
// MAL's list endpoint doesn't allow browser requests, so the site reads these
// files instead. Runs before every build and on a daily schedule. If MAL can't
// be reached, the existing snapshot is kept.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const users = JSON.parse(readFileSync(new URL('../src/mal-users.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS = { 1: 'watching', 2: 'completed', 3: 'onhold', 4: 'dropped', 6: 'plan' };
const cleanImg = (u) => (u ? u.replace(/\/r\/\d+x\d+/, '').replace(/\?s=.*$/, '') : null);

async function fetchList(user) {
  const all = [];
  for (let offset = 0; ; offset += 300) {
    const r = await fetch(`https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`, {
      headers: { 'User-Agent': 'anime-club-list-snapshot' },
    });
    if (!r.ok) throw new Error(`${user}: HTTP ${r.status}`);
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error(`${user}: unexpected response`);
    all.push(...page);
    if (page.length < 300) break;
    await sleep(1500);
  }
  return all;
}

for (const [member, user] of Object.entries(users)) {
  const out = new URL(`../public/mal/${user.toLowerCase()}.json`, import.meta.url);
  try {
    const list = await fetchList(user);
    const entries = list.map((a) => ({
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
    }));
    writeFileSync(out, JSON.stringify({ member, user, fetchedAt: new Date().toISOString(), entries }));
    console.log(`${user}: ${entries.length} entries`);
  } catch (e) {
    console.warn(`${user}: ${e.message}; ${existsSync(out) ? 'keeping the previous snapshot' : 'no snapshot yet'}`);
  }
}
