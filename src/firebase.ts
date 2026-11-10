import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Public web config: safe to ship. Access is enforced by firestore.rules.
const app = initializeApp({
  apiKey: 'AIzaSyD9sHNUWfDAaaXTRCffF3luG2NCuGfnq0M',
  authDomain: 'krystade-anime-club.firebaseapp.com',
  projectId: 'krystade-anime-club',
  storageBucket: 'krystade-anime-club.firebasestorage.app',
  messagingSenderId: '689446484990',
  appId: '1:689446484990:web:6407badbce2ed3ff8d1eaf',
});

export const db = getFirestore(app);
