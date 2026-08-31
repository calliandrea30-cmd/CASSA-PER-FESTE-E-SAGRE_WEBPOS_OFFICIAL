/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' genera una cartella self-contained con tutte le dipendenze necessarie.
  // Questo permette di avviare la web app con: node .next/standalone/server.js
  // senza dover copiare node_modules/ separatamente.
  output: 'standalone',

  // Immagini: disabilita l'ottimizzazione server-side (compatibile con standalone)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

