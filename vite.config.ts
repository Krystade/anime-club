/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5195 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
