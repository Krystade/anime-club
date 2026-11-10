import type { Lookup } from './types';

// Jikan mirrors MyAnimeList's public data, needs no key, and allows browser
// requests (MAL's own API does neither). Limit: ~3 requests/second.
const BASE = 'https://api.jikan.moe/v4';

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english: string | null;
  images?: { webp?: { image_url?: string }; jpg?: { image_url?: string } };
  episodes: number | null;
  score: number | null;
  year: number | null;
  type: string | null;
  aired?: { prop?: { from?: { year?: number | null } } };
}

export function fromJikan(a: JikanAnime): Lookup {
  const english = a.title_english?.trim() || null;
  return {
    malId: a.mal_id,
    title: english ?? a.title,
    altTitle: english && english !== a.title ? a.title : null,
    image: a.images?.webp?.image_url ?? a.images?.jpg?.image_url ?? null,
    eps: a.episodes ?? null,
    score: a.score ?? null,
    year: a.year ?? a.aired?.prop?.from?.year ?? null,
    type: a.type ?? null,
  };
}

export async function searchAnime(q: string, signal: AbortSignal): Promise<Lookup[]> {
  const url = `${BASE}/anime?q=${encodeURIComponent(q)}&limit=10&sfw=true&order_by=members&sort=desc`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { signal });
    if (r.status === 429 && attempt < 2) {
      await new Promise((res) => setTimeout(res, 700));
      continue;
    }
    if (!r.ok) throw new Error(`MyAnimeList search failed (${r.status})`);
    const body = (await r.json()) as { data: JikanAnime[] };
    const seen = new Set<number>();
    return body.data.filter((a) => !seen.has(a.mal_id) && seen.add(a.mal_id)).map(fromJikan);
  }
}
