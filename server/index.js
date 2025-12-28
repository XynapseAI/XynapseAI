// server/index.js
import 'dotenv/config';
import { createServer } from 'http';
import { startWebSocketServer } from './websocket.js';
import { logger } from '../utils/serverLogger.js';

const PORT = process.env.PORT || 8080;

const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

startWebSocketServer(server); 
logger.info(`Server running on port ${PORT}`);

server.listen(PORT, () => {
  logger.info(`HTTP server listening on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection:', { error: err.message, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});