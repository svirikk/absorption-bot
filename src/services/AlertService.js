/**
 * services/AlertService.js
 * Формує і надсилає Telegram алерти про абсорбцію.
 * Підтримує cooldown між алертами та дедублікацію.
 */

const TelegramBot = require('node-telegram-bot-api');
const { config } = require('../config');
const logger = require('../utils/logger');

class AlertService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.chatId = config.telegram.chatId;

    // Cooldown
    this.lastAlertTime = 0;
    this.cooldownMs = config.alert.cooldownMs;

    // Дедублікація: зберігаємо хеш останніх N алертів
    this.recentAlertHashes = new Set();
    this.maxRecentHashes = 20;
  }

  /**
   * Надсилає SHORT абсорбційний алерт
   * @param {Object} data - дані події абсорбції
   * @returns {boolean} чи був алерт надісланий
   */
  async sendShortAlert(data) {
    return this._sendAlert('SHORT', data);
  }

  /**
   * Надсилає LONG абсорбційний алерт
   * @param {Object} data - дані події абсорбції
   * @returns {boolean} чи був алерт надісланий
   */
  async sendLongAlert(data) {
    return this._sendAlert('LONG', data);
  }

  /**
   * Надсилає статусне повідомлення (старт бота тощо)
   * @param {string} text
   */
  async sendStatus(text) {
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
      logger.info(`[AlertService] Статус надіслано: ${text.substring(0, 50)}...`);
    } catch (err) {
      logger.error(`[AlertService] Помилка надсилання статусу: ${err.message}`);
    }
  }

  // ─── Приватні методи ────────────────────────────────────────────────────────

  async _sendAlert(type, data) {
    // Перевірка cooldown
    const now = Date.now();
    const timeSinceLast = now - this.lastAlertTime;
    if (timeSinceLast < this.cooldownMs) {
      const remaining = ((this.cooldownMs - timeSinceLast) / 1000).toFixed(0);
      logger.info(`[AlertService] Cooldown активний, залишилось ${remaining}s`);
      return false;
    }

    // Дедублікація по ключу (тип + рівень свінгу + POC)
    const alertHash = `${type}_${data.swingLevel}_${data.poc}`;
    if (this.recentAlertHashes.has(alertHash)) {
      logger.info(`[AlertService] Дублікат алерту пропущено: ${alertHash}`);
      return false;
    }

    const message = type === 'SHORT'
      ? this._formatShortAlert(data)
      : this._formatLongAlert(data);

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      this.lastAlertTime = now;

      // Зберігаємо хеш
      this.recentAlertHashes.add(alertHash);
      if (this.recentAlertHashes.size > this.maxRecentHashes) {
        const firstKey = this.recentAlertHashes.values().next().value;
        this.recentAlertHashes.delete(firstKey);
      }

      logger.info(`[AlertService] ✅ ${type} алерт надіслано! Swing: ${data.swingLevel}, POC: ${data.poc}`);
      return true;
    } catch (err) {
      logger.error(`[AlertService] Помилка надсилання алерту: ${err.message}`);
      return false;
    }
  }

  _formatShortAlert(data) {
    const deltaSign = data.delta >= 0 ? '+' : '';
    const deltaFormatted = `${deltaSign}${data.delta.toFixed(3)} BTC`;
    const candleTime = new Date(data.candle.openTime).toUTCString();

    return (
      `⚠️ <b>BTCUSDT 1M – SHORT Absorption Detected</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔺 <b>Liquidity Sweep:</b> Previous 15m Swing High taken at <code>${data.swingLevel}</code>\n` +
      `⚡ <b>Delta Spike:</b> <code>${deltaFormatted}</code> (${data.deltaMultiple}x avg)\n` +
      `📊 <b>Volume Spike:</b> <code>${data.volumeMultiple}x</code> average (${data.totalVolume.toFixed(2)} BTC)\n` +
      `🎯 <b>POC:</b> <code>${data.poc}</code>\n` +
      `📉 <b>Close:</b> <code>${data.candleClose}</code> <i>(below POC ✓)</i>\n` +
      `✅ <b>Follow-up:</b> No continuation higher\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Interpretation: Aggressive buyers were absorbed by passive sellers.</i>\n` +
      `🔴 <b>Potential SHORT reversal setup.</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 ${candleTime}`
    );
  }

  _formatLongAlert(data) {
    const deltaSign = data.delta >= 0 ? '+' : '';
    const deltaFormatted = `${deltaSign}${data.delta.toFixed(3)} BTC`;
    const candleTime = new Date(data.candle.openTime).toUTCString();

    return (
      `✅ <b>BTCUSDT 1M – LONG Absorption Detected</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔻 <b>Liquidity Sweep:</b> Previous 15m Swing Low taken at <code>${data.swingLevel}</code>\n` +
      `⚡ <b>Delta Spike:</b> <code>${deltaFormatted}</code> (${data.deltaMultiple}x avg)\n` +
      `📊 <b>Volume Spike:</b> <code>${data.volumeMultiple}x</code> average (${data.totalVolume.toFixed(2)} BTC)\n` +
      `🎯 <b>POC:</b> <code>${data.poc}</code>\n` +
      `📈 <b>Close:</b> <code>${data.candleClose}</code> <i>(above POC ✓)</i>\n` +
      `✅ <b>Follow-up:</b> No continuation lower\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Interpretation: Aggressive sellers were absorbed by passive buyers.</i>\n` +
      `🟢 <b>Potential LONG reversal setup.</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 ${candleTime}`
    );
  }
}

module.exports = AlertService;
