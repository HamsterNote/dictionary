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
          server.middlewares.use('/preview-contract', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await server.transformIndexHtml(
                '/preview-contract',
                '<div id="scroller" style="position:fixed;inset:0;overflow:auto"><div id="host" style="position:absolute;left:80px;top:120px;transform:translate(25px,35px);width:280px"><div id="root"></div></div></div><script type="module" src="/scripts/fixtures/preview-contract.tsx"></script>',
              ),
            );
          });
          server.middlewares.use('/layout', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await server.transformIndexHtml(
                '/layout',
                '<div id="root" style="max-width:680px;margin:auto"></div><script type="module" src="/scripts/fixtures/layout.tsx"></script>',
              ),
            );
          });
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
