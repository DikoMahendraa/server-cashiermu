import winston from 'winston';
import { env } from '../config/env';

const production = env.NODE_ENV === 'production';
const json = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    // Production: one JSON object per line (what Loki / Alloy parse). Development: readable.
    format: production ? json : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  }),
];
if (env.LOG_FILE) {
  transports.push(
    new winston.transports.File({
      filename: env.LOG_FILE,
      format: json,
      maxsize: 20 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  );
}

export const logger = winston.createLogger({ level: env.LOG_LEVEL, format: json, transports });
