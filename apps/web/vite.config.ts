import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'web-build',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, '/');
          if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) return 'react-vendor';
          if (moduleId.includes('/node_modules/@firebase/auth')) return 'firebase-auth';
          if (moduleId.includes('/node_modules/@firebase/firestore')) return 'firebase-firestore';
          if (moduleId.includes('/node_modules/@firebase/storage')) return 'firebase-storage';
          if (moduleId.includes('/node_modules/@firebase/')) return 'firebase-core';
          return undefined;
        },
      },
    },
  },
});
