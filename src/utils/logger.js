/**
 * utils/logger.js
 * Centralized Winston logger з кольоровим виводом у консоль
 */

const winston = require('winston');
const { config } = require('../config');

const { combine, timestamp, colorize, printf, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  const base = `${timestamp} [${level}]: ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  ),
  transports: [
    // Консоль — кольоровий вивід
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss.SSS' }),
        logFormat,
      ),
    }),
    // Файл для помилок
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), logFormat),
      maxsize: 5_242_880, // 5MB
      maxFiles: 3,
    }),
    // Файл для всіх логів
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), logFormat),
      maxsize: 10_485_760, // 10MB
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
