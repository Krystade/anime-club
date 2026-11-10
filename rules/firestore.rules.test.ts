import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const KEY = 'testclubkey_0123456789abcdef';
let env: RulesTestEnvironment;

const show = (over: Record<string, unknown> = {}) => ({
  malId: 52991, title: 'Frieren', image: null, eps: 28, score: 9.3, year: 2023, type: 'TV',
  status: 'next', ep: 0, by: 'Jack', votes: ['Jack'], scores: {}, log: [], addedAt: 1, statusAt: 1, ...over,
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
    await setDoc(doc(c.firestore(), 'clubs', KEY), { name: 'Club', meetDay: 1, meetTime: '19:00', members: ['Jack'] });
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
  it('rejects a bad time', () => assertFails(updateDoc(doc(anon(), 'clubs', KEY), { meetTime: '25:00' })));
  it('rejects extra fields', () => assertFails(updateDoc(doc(anon(), 'clubs', KEY), { owner: 'me' })));
});

describe('shows', () => {
  it('can list shows in a real club', () => assertSucceeds(getDocs(collection(anon(), 'clubs', KEY, 'shows'))));
  it('cannot list shows in a club that does not exist', () => assertFails(getDocs(collection(anon(), 'clubs', 'nope_nope_nope_nope', 'shows'))));
  it('can add a valid show', () => assertSucceeds(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show())));
  it('cannot add shows to a made-up club', () => assertFails(addDoc(collection(anon(), 'clubs', 'made_up_key_123456789', 'shows'), show())));
  it('rejects an unknown status', () => assertFails(addDoc(collection(anon(), 'clubs', KEY, 'shows'), show({ status: 'paused' }))));
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
