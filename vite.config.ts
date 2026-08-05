import { defineConfig } from 'vite'

export default defineConfig({
  base: './',   // REQUIRED - relative paths work on both Pages and itch.io
  test: {
    environment: 'node',
  },
})
