# Anime Club

A phone-first tracker for a weekly anime club. It shows what the club is watching, what's up next (ranked by votes) and what it has watched (with everyone's scores), and it looks shows up on MyAnimeList through [Jikan](https://jikan.moe).

- React + Vite, hosted on GitHub Pages
- Firestore holds the data (project `krystade-anime-club`). See `firestore.rules`: each club's invite link carries its random key, and anyone with that key can read and edit that club.

```
npm run dev          # local dev server
npm test             # unit tests
npm run test:rules   # security rules against the Firestore emulator
npm run build
```
