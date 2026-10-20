import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token', '*.captureCode', '*.code'],
    censor: '[redacted]',
  },
  ...(process.env.NODE_ENV === 'development' && process.stdout.isTTY
    ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});
