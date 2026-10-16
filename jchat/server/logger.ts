import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' }
        }
      }
    : {})
});
