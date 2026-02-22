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

    // Дедублікація: хеш по (тип + набір swept рівнів)
    const alertHash = `${type}_${data.sweptLevels.join('_')}`;
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

    // Список пробитих рівнів (від нижнього до верхнього)
    const levelsStr = data.sweptLevels
      .slice()
      .sort((a, b) => a - b)
      .map(p => `<code>${p}</code>`)
      .join(' → ');

    return (
      `⚠️ <b>BTCUSDT 1M – SHORT Absorption Detected</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔺 <b>Liquidity Sweep:</b> Знято <b>${data.sweptCount} хаїв</b> одним рухом\n` +
      `📍 <b>Рівні:</b> ${levelsStr}\n` +
      `📌 <b>Sweep до:</b> <code>${data.sweepPrice}</code>\n` +
      `⚡ <b>Delta Spike:</b> <code>${deltaFormatted}</code> (${data.deltaMultiple}x avg)\n` +
      `📊 <b>Volume Spike:</b> <code>${data.volumeMultiple}x</code> avg (${data.totalVolume.toFixed(2)} BTC)\n` +
      `🎯 <b>POC:</b> <code>${data.poc}</code>\n` +
      `📉 <b>Close:</b> <code>${data.candleClose}</code> <i>(нижче POC ✓)</i>\n` +
      `✅ <b>Підтвердження:</b> Немає продовження вгору\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Агресивні покупці поглинуті пасивними продавцями.\n` +
      `Знято ліквідність одразу з ${data.sweptCount} рівнів.</i>\n` +
      `🔴 <b>Potential SHORT reversal.</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 ${candleTime}`
    );
  }

  _formatLongAlert(data) {
    const deltaSign = data.delta >= 0 ? '+' : '';
    const deltaFormatted = `${deltaSign}${data.delta.toFixed(3)} BTC`;
    const candleTime = new Date(data.candle.openTime).toUTCString();

    // Список пробитих рівнів (від нижнього до верхнього)
    const levelsStr = data.sweptLevels
      .slice()
      .sort((a, b) => a - b)
      .map(p => `<code>${p}</code>`)
      .join(' → ');

    return (
      `✅ <b>BTCUSDT 1M – LONG Absorption Detected</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔻 <b>Liquidity Sweep:</b> Знято <b>${data.sweptCount} лоїв</b> одним рухом\n` +
      `📍 <b>Рівні:</b> ${levelsStr}\n` +
      `📌 <b>Sweep до:</b> <code>${data.sweepPrice}</code>\n` +
      `⚡ <b>Delta Spike:</b> <code>${deltaFormatted}</code> (${data.deltaMultiple}x avg)\n` +
      `📊 <b>Volume Spike:</b> <code>${data.volumeMultiple}x</code> avg (${data.totalVolume.toFixed(2)} BTC)\n` +
      `🎯 <b>POC:</b> <code>${data.poc}</code>\n` +
      `📈 <b>Close:</b> <code>${data.candleClose}</code> <i>(вище POC ✓)</i>\n` +
      `✅ <b>Підтвердження:</b> Немає продовження вниз\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Агресивні продавці поглинуті пасивними покупцями.\n` +
      `Знято ліквідність одразу з ${data.sweptCount} рівнів.</i>\n` +
      `🟢 <b>Potential LONG reversal.</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🕐 ${candleTime}`
    );
  }
}

module.exports = AlertService;
