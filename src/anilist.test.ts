import { describe, expect, it } from 'vitest';
import { fromAniList } from './anilist';

describe('fromAniList', () => {
  it('prefers the English title and keeps the MAL id', () => {
    expect(fromAniList({
      id: 1281, idMal: 1281, episodes: 19, format: 'TV', seasonYear: 2000,
      title: { romaji: 'Gakkou no Kaidan', english: 'Ghost Stories' },
      coverImage: { large: 'https://s4.anilist.co/x.png' },
    })).toEqual({
      malId: 1281, title: 'Ghost Stories', altTitle: 'Gakkou no Kaidan', image: 'https://s4.anilist.co/x.png',
      eps: 19, score: null, year: 2000, type: 'TV',
    });
  });
  it('falls back to romaji, start year, and missing fields', () => {
    const r = fromAniList({
      id: 9, idMal: null, episodes: null, format: 'MOVIE', seasonYear: null, startDate: { year: 2017 },
      title: { romaji: 'Yoru wa Mijikashi Arukeyo Otome', english: null }, coverImage: null,
    });
    expect(r).toMatchObject({ malId: null, title: 'Yoru wa Mijikashi Arukeyo Otome', altTitle: null, image: null, year: 2017, type: 'Movie' });
  });
});
