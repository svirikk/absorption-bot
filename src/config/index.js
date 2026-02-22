/**
 * config/index.js
 * Централізований конфіг — зчитує .env і надає дефолтні значення
 */

require('dotenv').config();

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  binance: {
    symbol: 'btcusdt',
    aggTradeStream: 'wss://fstream.binance.com/ws/btcusdt@aggTrade',
    klineStream: 'wss://fstream.binance.com/ws/btcusdt@kline_1m',
  },

  alert: {
    cooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS) || 300_000,
    deltaMultiplier: parseFloat(process.env.DELTA_MULTIPLIER) || 2.0,
    volumeMultiplier: parseFloat(process.env.VOLUME_MULTIPLIER) || 1.5,
    rollingWindow: parseInt(process.env.ROLLING_WINDOW) || 20,
    exhaustionVolumeDropRatio: 0.5,   // обʼєм < 50% від середнього = виснаження
    exhaustionDeltaNormalizeRatio: 0.3, // дельта < 30% від середнього = нормалізація
  },

  footprint: {
    priceClusterSize: parseFloat(process.env.PRICE_CLUSTER_SIZE) || 0.5,
  },

  swing: {
    lookback: parseInt(process.env.SWING_LOOKBACK) || 2,
    historySize: 50,   // зберігаємо останні 50 15m свічок
    maxPoolSize: 8,    // зберігаємо до 8 останніх підтверджених свінгів
    minLevelsSwept: parseInt(process.env.MIN_LEVELS_SWEPT) || 2, // мінімум рівнів для валідного sweep
  },

  websocket: {
    reconnectDelayMs: parseInt(process.env.WS_RECONNECT_DELAY_MS) || 3_000,
    maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS) || 10,
    pingIntervalMs: 20_000,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

/**
 * Валідація обовʼязкових змінних середовища
 */
function validateConfig() {
  const errors = [];

  if (!config.telegram.botToken) {
    errors.push('TELEGRAM_BOT_TOKEN не задано у .env');
  }
  if (!config.telegram.chatId) {
    errors.push('TELEGRAM_CHAT_ID не задано у .env');
  }

  if (errors.length > 0) {
    throw new Error(`Помилки конфігурації:\n${errors.join('\n')}`);
  }
}

module.exports = { config, validateConfig };
