// Security-rules tests need the Firestore emulator: run them with `npm run test:rules`, not `npm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['rules/**/*.test.ts'], testTimeout: 20_000, fileParallelism: false } });
