import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

export function createTextResolutionServer() {
  return createServer({
    configFile: false,
    plugins: [
      react(),
      {
        name: 'text-resolution-fixture',
        configureServer(server) {
          server.middlewares.use('/benchmark', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await server.transformIndexHtml(
                '/benchmark',
                '<button id="start">Start</button><div id="root"></div><script type="module" src="/scripts/fixtures/text-resolution.tsx"></script>',
              ),
            );
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
}
