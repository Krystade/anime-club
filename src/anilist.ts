import type { Lookup } from './types';

// AniList's public GraphQL API: no key, allows browser requests, and fast.
// Every result carries its MyAnimeList id, so MAL links still work.
// (Jikan, the MAL mirror used before, was too often down or slow.)
const URL = 'https://graphql.anilist.co';
const QUERY = `query ($q: String) {
  Page(perPage: 12) {
    media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
      id idMal episodes format seasonYear startDate { year }
      title { romaji english }
      coverImage { large }
    }
  }
}`;

export interface AniListMedia {
  id: number;
  idMal: number | null;
  episodes: number | null;
  format: string | null;
  seasonYear: number | null;
  startDate?: { year: number | null } | null;
  title: { romaji: string | null; english: string | null };
  coverImage?: { large: string | null } | null;
}

const FORMAT: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };

export function fromAniList(m: AniListMedia): Lookup {
  const english = m.title.english?.trim() || null;
  const romaji = m.title.romaji?.trim() || null;
  const title = english ?? romaji ?? 'Untitled';
  return {
    malId: m.idMal ?? null,
    title,
    altTitle: romaji && romaji !== title ? romaji : null,
    image: m.coverImage?.large ?? null,
    eps: m.episodes ?? null,
    // AniList's score is its own community's, not MAL's, so we don't store it as a MAL score.
    score: null,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    type: m.format ? FORMAT[m.format] ?? m.format : null,
  };
}

export async function searchAnime(q: string, signal: AbortSignal): Promise<Lookup[]> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { q } }),
      signal,
    });
    if (r.status === 429 && attempt < 1) {
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }
    if (!r.ok) throw new Error(`search failed (${r.status})`);
    const body = (await r.json()) as { data?: { Page?: { media?: AniListMedia[] } } };
    return (body.data?.Page?.media ?? []).map(fromAniList);
  }
}
