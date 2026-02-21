/**
 * services/Bot.js
 * Головний оркестратор — зʼєднує всі модулі разом.
 * Координує потоки даних між WebSocket → CandleBuilder → FootprintEngine
 * → SwingDetector → AbsorptionDetector → AlertService
 */

const WebSocketManager = require('./WebSocketManager');
const AlertService = require('./AlertService');
const CandleBuilder = require('../engines/CandleBuilder');
const FootprintEngine = require('../engines/FootprintEngine');
const SwingDetector = require('../detectors/SwingDetector');
const AbsorptionDetector = require('../detectors/AbsorptionDetector');
const { config } = require('../config');
const logger = require('../utils/logger');

class Bot {
  constructor() {
    // ─── WebSocket Менеджери ─────────────────────────────────────────────────
    this.aggTradeWS = new WebSocketManager(
      'aggTrade',
      config.binance.aggTradeStream,
    );
    this.klineWS = new WebSocketManager(
      'kline_1m',
      config.binance.klineStream,
    );

    // ─── Двигуни та детектори ────────────────────────────────────────────────
    this.candleBuilder = new CandleBuilder();
    this.footprintEngine = new FootprintEngine();
    this.swingDetector = new SwingDetector();
    this.absorptionDetector = new AbsorptionDetector();
    this.alertService = new AlertService();

    // ─── Стан ───────────────────────────────────────────────────────────────
    // Footprint для поточної незакритої свічки
    this._isRunning = false;

    // Зберігаємо footprint попередньої закритої свічки
    // (потрібен для перевірки підтвердження)
    this._lastClosedFootprint = null;
    this._lastClosedCandle = null;

    // Буфер footprintів для поточного циклу підтвердження
    this._pendingConfirmBuffer = [];
  }

  /**
   * Запускає бота
   */
  async start() {
    logger.info('🤖 Absorption Bot запускається...');

    this._bindCandleEvents();
    this._bindAggTradeEvents();
    this._bindKlineEvents();
    this._bindReconnectEvents();

    // Підключаємо обидва потоки
    this.aggTradeWS.connect();
    this.klineWS.connect();

    this._isRunning = true;

    // Повідомляємо про старт у Telegram
    await this.alertService.sendStatus(
      '🤖 <b>Absorption Bot запущено</b>\n' +
      `📊 Символ: BTCUSDT Futures\n` +
      `⏱ Таймфрейм: 1m / 15m\n` +
      `🕐 ${new Date().toUTCString()}`
    );

    logger.info('✅ Бот запущено і підключається до потоків...');
  }

  /**
   * Зупиняє бота
   */
  async stop() {
    logger.info('🛑 Зупинка бота...');
    this._isRunning = false;
    this.aggTradeWS.disconnect();
    this.klineWS.disconnect();

    await this.alertService.sendStatus('🛑 <b>Absorption Bot зупинено</b>');
    logger.info('Бот зупинено');
  }

  // ─── Прив'язка подій ────────────────────────────────────────────────────────

  /**
   * Обробка подій від CandleBuilder
   */
  _bindCandleEvents() {
    // 1m свічка закрита
    this.candleBuilder.on('1mClose', async (candle) => {
      await this._on1mClose(candle);
    });

    // 15m свічка закрита — оновлюємо свінги
    this.candleBuilder.on('15mClose', (candle15m) => {
      const candles = this.candleBuilder.getClosed15m();
      this.swingDetector.update(candles);

      const status = this.swingDetector.getStatus();
      logger.info(
        `[Bot] 15m свічка закрита | ` +
        `Swing High: ${status.swingHigh ?? 'n/a'} | ` +
        `Swing Low: ${status.swingLow ?? 'n/a'}`
      );
    });
  }

  /**
   * aggTrade потік → FootprintEngine
   */
  _bindAggTradeEvents() {
    this.aggTradeWS.on('message', (msg) => {
      this.footprintEngine.handleTrade(msg);
    });

    this.aggTradeWS.on('connected', () => {
      logger.info('[Bot] aggTrade потік підключено');
    });
  }

  /**
   * kline_1m потік → CandleBuilder
   */
  _bindKlineEvents() {
    this.klineWS.on('message', (msg) => {
      this.candleBuilder.handleKlineMessage(msg);
    });

    this.klineWS.on('connected', () => {
      logger.info('[Bot] kline_1m потік підключено');
    });
  }

  /**
   * Обробка перепідключень
   */
  _bindReconnectEvents() {
    this.aggTradeWS.on('maxReconnectReached', async () => {
      await this.alertService.sendStatus(
        '❌ <b>ПОМИЛКА:</b> aggTrade WebSocket не може перепідключитися. Перевірте зʼєднання!'
      );
    });

    this.klineWS.on('maxReconnectReached', async () => {
      await this.alertService.sendStatus(
        '❌ <b>ПОМИЛКА:</b> kline WebSocket не може перепідключитися. Перевірте зʼєднання!'
      );
    });
  }

  // ─── Основна логіка при закритті 1m свічки ──────────────────────────────────

  async _on1mClose(candle) {
    // 1. Отримуємо footprint для цієї свічки
    const footprint = this.footprintEngine.calculate();

    // 2. Оновлюємо ковзну статистику (для наступних свічок)
    if (footprint) {
      this.absorptionDetector.updateStats(footprint.totalVolume, footprint.delta);
    }

    logger.debug(
      `[Bot] 1m закрито: C=${candle.close} | ` +
      (footprint
        ? `vol=${footprint.totalVolume.toFixed(2)}, delta=${footprint.delta.toFixed(2)}, poc=${footprint.poc}`
        : 'footprint=null')
    );

    // 3. Якщо є pending кандидат — перевіряємо підтвердження
    if (this.absorptionDetector.hasPending() && footprint) {
      const confirmation = this.absorptionDetector.checkConfirmation(candle, footprint);
      if (confirmation.type) {
        await this._handleAbsorptionConfirmed(confirmation);
      }
    }

    // 4. Перевіряємо нову свічку на кандидата абсорбції
    if (footprint) {
      const swingHigh = this.swingDetector.getSwingHigh();
      const swingLow = this.swingDetector.getSwingLow();

      const candidate = this.absorptionDetector.checkCandle(
        candle,
        footprint,
        swingHigh,
        swingLow,
      );

      if (candidate.type) {
        // Це не має статися (checkCandle не повертає type напряму)
        await this._handleAbsorptionConfirmed(candidate);
      }
    }

    // 5. Зберігаємо для наступного циклу
    this._lastClosedCandle = candle;
    this._lastClosedFootprint = footprint;

    // 6. Скидаємо footprint для нової свічки
    this.footprintEngine.reset();
  }

  async _handleAbsorptionConfirmed(result) {
    const { type, data } = result;
    logger.info(`[Bot] 🚨 ${type} Абсорбція підтверджена! Swing: ${data.swingLevel}, POC: ${data.poc}`);

    let sent = false;
    if (type === 'SHORT') {
      sent = await this.alertService.sendShortAlert(data);
    } else if (type === 'LONG') {
      sent = await this.alertService.sendLongAlert(data);
    }

    if (sent) {
      logger.info(`[Bot] ✅ Telegram алерт надіслано`);
    } else {
      logger.warn(`[Bot] ⚠️ Алерт не надісланий (cooldown або дублікат)`);
    }
  }
}

module.exports = Bot;
