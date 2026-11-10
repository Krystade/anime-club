import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const KEY = 'testclubkey_0123456789abcdef';
let env: RulesTestEnvironment;

const show = (over: Record<string, unknown> = {}) => ({
  malId: 52991, title: 'Frieren', image: null, eps: 28, score: 9.3, year: 2023, type: 'TV',
  status: 'queue', ep: 0, by: 'Jack', recBy: [], votes: ['Jack'], scores: {}, log: [], addedAt: 1, statusAt: 1, ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-anime-club',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'clubs', KEY), { name: 'Club', meetDay: 1, meetTime: '19:00', startTime: '19:30', members: ['Jack'] });
    await setDoc(doc(c.firestore(), 'clubs', KEY, 'shows', 's1'), show());
  });
});
const anon = () => env.unauthenticatedContext().firestore();

describe('clubs', () => {
  it('anyone with the key can read the club', () => assertSucceeds(getDoc(doc(anon(), 'clubs', KEY))));
  it('nobody can list clubs', () => assertFails(getDocs(collection(anon(), 'clubs'))));
  it('nobody can create a club', () => assertFails(setDoc(doc(anon(), 'clubs', 'another_long_key_123456'), { name: 'x', meetDay: 1, meetTime: '19:00', members: [] })));
  it('nobody can delete a club', () => assertFails(deleteDoc(doc(anon(), 'clubs', KEY))));
  it('can rename and reschedule', () => assertSucceeds(updateDoc(doc(anon(), 'clubs', KEY), { name: 'Monday Club', meetDay: 2, meetTime: '18:30' })));
  it('can change the episode start time', () => assertSucceeds(updateDoc(doc(anon(), 'clubs', KEY), { startTime: '19:45' })));
  it('rejects a bad start time', () => assertFails(updateDoc(doc(anon(), 'clubs', KEY), { startTime: '7:30pm' })));
  it('rejects a bad time',() => assertFails(updateDoc(doc(anon(), 'clubs', KEY), { meetTime: '25:00' })));
  it('rejects extra fields', () => assertFails(updateDoc(doc(anon(), 'clubs', KEY), { owner: 'me' })));
});

describe('shows', () => {
  it('can list shows in a real club', () => assertSucceeds(getDocs(collection(anon(), 'clubs', KEY, 'shows'))));
  it('cannot list shows in a club that does not exist', () => assertFails(getDocs(collection(anon(), 'clubs', 'nope_nope_nope_nope', 'shows'))));
  it('can add a valid show', () => assertSucceeds(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show())));
  it('cannot add shows to a made-up club', () => assertFails(addDoc(collection(anon(), 'clubs', 'made_up_key_123456789', 'shows'), show())));
  it('accepts every pipeline status', async () => {
    for (const status of ['rec', 'queue', 'sampled', 'watching', 'done', 'drop']) {
      await assertSucceeds(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ status, recBy: ['Jack', 'Cameron'] })));
    }
  });
  it('rejects the old "next" status', () => assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ status: 'next' }))));
  it('rejects an unknown status',() => assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ status: 'paused' }))));
  it('rejects missing fields', () => {
    const { log: _l, ...rest } = show();
    return assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), rest));
  });
  it('rejects extra fields', () => assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ evil: true }))));
  it('rejects an empty title', () => assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ title: '' }))));
  it('accepts a title-only show', () => assertSucceeds(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ malId: null, eps: null, score: null, year: null, type: null }))));
  it('can bump episodes', () => assertSucceeds(updateDoc(doc(anon(), 'clubs', KEY, 'shows', 's1'), { ep: 3, log: [{ date: '2026-11-09', from: 1, to: 3 }] })));
  it('rejects a negative episode', () => assertFails(updateDoc(doc(anon(), 'clubs', KEY, 'shows', 's1'), { ep: -1 })));
  it('can delete a show', () => assertSucceeds(deleteDoc(doc(anon(), 'clubs', KEY, 'shows', 's1'))));
});

describe('MyAnimeList lists and the daily limit', () => {
  const today = () => Math.floor(Date.now() / 86400000);
  const addList = (user: string, count: number, day = today()) => {
    const db = anon();
    const b = writeBatch(db);
    b.set(doc(db, 'clubs', KEY, 'malLists', user), { addedAt: Date.now(), day });
    b.set(doc(db, 'clubs', KEY, 'meta', 'malQuota'), { day, count, last: user });
    return b.commit();
  };
  it('adds a list when the quota goes up by one', () => assertSucceeds(addList('someone', 1)));
  it('refuses a list without bumping the quota', () => assertFails(setDoc(doc(anon(), 'clubs', KEY, 'malLists', 'someone'), { addedAt: 1, day: today() })));
  it('refuses a quota that skips ahead', () => assertFails(addList('someone', 2)));
  it('refuses a quota with yesterday as the day', () => assertFails(addList('someone', 1, today() - 1)));
  it('refuses bad usernames', () => assertFails(addList('no spaces!', 1)));
  it('refuses re-adding an existing list to reset the count', async () => {
    await assertSucceeds(addList('someone', 1));
    await assertFails(addList('someone', 2));
  });
  it('stops at 10 a day', async () => {
    for (let i = 1; i <= 10; i++) await assertSucceeds(addList(`user${i}`, i));
    await assertFails(addList('user11', 11));
    await assertFails(addList('user11', 1));
  });
  it('starts again the next day', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'clubs', KEY, 'meta', 'malQuota'), { day: today() - 1, count: 10, last: 'old' }));
    await assertSucceeds(addList('fresh', 1));
  });
  it('lets members remove a list', async () => {
    await assertSucceeds(addList('someone', 1));
    await assertSucceeds(deleteDoc(doc(anon(), 'clubs', KEY, 'malLists', 'someone')));
  });
  it('cannot list lists in a made-up club', () => assertFails(getDocs(collection(anon(), 'clubs', 'made_up_key_123456789', 'malLists'))));
});
