// server/index.js
import 'dotenv/config';
import { createServer } from 'http'; // Thêm http module
import { startWebSocketServer } from './websocket.js';
import { logger } from '../utils/serverLogger.js';

const PORT = process.env.PORT || 8080;

// Tạo HTTP server tối thiểu
const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Khởi động WebSocket server
startWebSocketServer(server); // Truyền HTTP server vào WebSocket
logger.info(`Server running on port ${PORT}`);

// Lắng nghe trên cổng được cung cấp bởi Railway
server.listen(PORT, () => {
  logger.info(`HTTP server listening on port ${PORT}`);
});

// Xử lý lỗi
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection:', { error: err.message, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});