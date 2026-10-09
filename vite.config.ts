import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'http';

function forgeImageProxyPlugin(): Plugin {
  const imageCache = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>();

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/forge-image')) {
      return next();
    }

    if (req.url === '/api/forge-image/clear') {
      imageCache.clear();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Server image cache cleared' }));
      return;
    }

    try {
      const parsedUrl = new URL(req.url, 'http://localhost:3000');
      const targetUrl = parsedUrl.searchParams.get('url');

      if (!targetUrl) {
        res.statusCode = 400;
        res.end('Missing url query parameter');
        return;
      }

      // Check server-side memory cache
      const cached = imageCache.get(targetUrl);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Blacksite-Image-Cache', 'HIT');
        res.end(cached.buffer);
        return;
      }

      const targetObj = new URL(targetUrl);
      if (!targetObj.hostname.endsWith('sp-mod.com')) {
        res.statusCode = 403;
        res.end('Forbidden host');
        return;
      }

      const remoteRes = await fetch(targetUrl, {
        headers: {
          'Referer': 'https://sp-mod.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });

      if (!remoteRes.ok) {
        res.statusCode = remoteRes.status;
        res.end(`Remote error: ${remoteRes.statusText}`);
        return;
      }

      const contentType = remoteRes.headers.get('content-type') || 'image/png';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Blacksite-Image-Cache', 'MISS');

      const arrayBuffer = await remoteRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Keep cache size bounded to last 500 images
      if (imageCache.size > 500) {
        const firstKey = imageCache.keys().next().value;
        if (firstKey) imageCache.delete(firstKey);
      }
      imageCache.set(targetUrl, { buffer, contentType, timestamp: Date.now() });

      res.end(buffer);
    } catch (err: any) {
      res.statusCode = 500;
      res.end(`Proxy error: ${err.message}`);
    }
  };

}

function emblemUploadPlugin(): Plugin {
  return {
    name: 'emblem-upload-handler',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url === '/api/upload-emblem' && req.method === 'POST') {
          try {
            const chunks: Buffer[] = [];
            req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            req.on('end', async () => {
              const bodyStr = Buffer.concat(chunks).toString('utf-8');
              const { dataUrl, imageBase64 } = JSON.parse(bodyStr);
              const base64Data = (dataUrl || imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
              if (!base64Data) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'No image data provided' }));
                return;
              }

              const fs = await import('fs');
              const path = await import('path');
              const { execSync } = await import('child_process');

              const imageBuffer = Buffer.from(base64Data, 'base64');
              const emblemPath = path.resolve(__dirname, 'public/emblem.png');
              const icoPath = path.resolve(__dirname, 'public/app.ico');

              fs.writeFileSync(emblemPath, imageBuffer);
              try {
                execSync(`convert ${emblemPath} -define icon:auto-resize=256,128,64,48,32,16 ${icoPath}`);
              } catch (convErr) {
                console.warn('ImageMagick convert warning:', convErr);
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
            });
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // Also check if user uploaded directly to public or uploads with the emblem name
        if (req.url === '/api/check-uploaded-emblem' && req.method === 'GET') {
          const fs = await import('fs');
          const path = await import('path');
          const { execSync } = await import('child_process');

          const candidates = [
            path.resolve(__dirname, 'public/Blacksite Mod Manager Emblem.png'),
            path.resolve(__dirname, 'uploads/Blacksite Mod Manager Emblem.png'),
            path.resolve(__dirname, 'Blacksite Mod Manager Emblem.png'),
          ];

          let found = false;
          for (const cand of candidates) {
            if (fs.existsSync(cand)) {
              const emblemPath = path.resolve(__dirname, 'public/emblem.png');
              const icoPath = path.resolve(__dirname, 'public/app.ico');
              fs.copyFileSync(cand, emblemPath);
              try {
                execSync(`convert ${emblemPath} -define icon:auto-resize=256,128,64,48,32,16 ${icoPath}`);
              } catch (_) {}
              found = true;
              break;
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ found }));
          return;
        }

        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), forgeImageProxyPlugin(), emblemUploadPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
