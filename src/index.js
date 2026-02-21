/**
 * index.js — Точка входу
 * Валідує конфіг, налаштовує обробку виключень і запускає бота
 */

const { validateConfig } = require('./config');
const Bot = require('./services/Bot');
const logger = require('./utils/logger');
const fs = require('fs');
const path = require('path');

// Переконуємось що папка для логів існує
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function main() {
  logger.info('══════════════════════════════════════');
  logger.info('     BTCUSDT Absorption Bot v1.0.0    ');
  logger.info('══════════════════════════════════════');

  // Валідація конфігурації
  try {
    validateConfig();
    logger.info('✅ Конфігурація валідна');
  } catch (err) {
    logger.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const bot = new Bot();

  // ─── Обробка сигналів завершення ─────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`\n📛 Отримано сигнал ${signal}, завершуємо роботу...`);
    try {
      await bot.stop();
    } catch (err) {
      logger.error(`Помилка при зупинці: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ─── Глобальні обробники помилок ─────────────────────────────────────────
  process.on('uncaughtException', (err) => {
    logger.error(`💥 Uncaught Exception: ${err.message}`, err);
    // Не виходимо — намагаємось продовжити роботу
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`💥 Unhandled Rejection: ${reason}`);
  });

  // ─── Запуск ───────────────────────────────────────────────────────────────
  try {
    await bot.start();
  } catch (err) {
    logger.error(`❌ Помилка запуску бота: ${err.message}`, err);
    process.exit(1);
  }
}

main();
