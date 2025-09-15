// server/index.js
import 'dotenv/config';
import { startWebSocketServer } from './websocket.js'; // Add .js extension
import { logger } from '../utils/serverLogger.js'; // Adjust path, add .js extension

const PORT = process.env.PORT || 8080;

// Start WebSocket server
startWebSocketServer();
logger.info(`WebSocket server running on port ${PORT}`);

// Keep the process alive
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection:', { error: err.message, stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});