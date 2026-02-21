/**
 * engines/CandleBuilder.js
 * Будує 1m свічки з kline-стріму та агрегує їх у 15m свічки.
 * Емітує події при закритті свічок.
 */

const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class CandleBuilder extends EventEmitter {
  constructor() {
    super();

    // Поточна 1m свічка (незакрита, з kline-стріму)
    this.current1m = null;

    // Буфер закритих 1m свічок для збірки 15m
    this.closed1mBuffer = [];

    // Список закритих 15m свічок (зберігаємо останні N)
    this.closed15m = [];
    this.max15mHistory = 60;

    // Поточна 15m свічка (збирається вручну)
    this.current15m = null;
  }

  /**
   * Обробляє повідомлення з kline@1m стріму
   * @param {Object} msg - raw Binance kline message
   */
  handleKlineMessage(msg) {
    if (msg.e !== 'kline') return;

    const k = msg.k;
    const candle = {
      openTime: k.t,
      closeTime: k.T,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
    };

    this.current1m = candle;

    if (candle.isClosed) {
      logger.debug(`[CandleBuilder] 1m свічка закрита: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
      this._on1mClose(candle);
    }
  }

  /**
   * Повертає поточну (незакриту) 1m свічку
   */
  getCurrentCandle() {
    return this.current1m;
  }

  /**
   * Повертає масив закритих 15m свічок
   */
  getClosed15m() {
    return this.closed15m;
  }

  // ─── Приватні методи ────────────────────────────────────────────────────────

  _on1mClose(candle) {
    // Генеруємо подію закриття 1m
    this.emit('1mClose', candle);

    // Визначаємо індекс 15-хвилинного вікна для цієї свічки
    // 15m вікно = floor(openTime / 15*60*1000)
    const windowId = Math.floor(candle.openTime / (15 * 60 * 1000));

    if (!this.current15m) {
      // Починаємо нову 15m свічку
      this.current15m = this._create15mFrom1m(candle, windowId);
    } else if (windowId === this.current15m.windowId) {
      // Оновлюємо поточну 15m свічку
      this._update15m(this.current15m, candle);
    } else {
      // Нове 15m вікно — закриваємо поточну 15m і починаємо нову
      this._close15m(this.current15m);
      this.current15m = this._create15mFrom1m(candle, windowId);
    }
  }

  _create15mFrom1m(candle1m, windowId) {
    return {
      windowId,
      openTime: candle1m.openTime,
      open: candle1m.open,
      high: candle1m.high,
      low: candle1m.low,
      close: candle1m.close,
      volume: candle1m.volume,
      count: 1,
    };
  }

  _update15m(candle15m, candle1m) {
    candle15m.high = Math.max(candle15m.high, candle1m.high);
    candle15m.low = Math.min(candle15m.low, candle1m.low);
    candle15m.close = candle1m.close;
    candle15m.volume += candle1m.volume;
    candle15m.count++;
  }

  _close15m(candle15m) {
    logger.debug(`[CandleBuilder] 15m свічка закрита: H=${candle15m.high} L=${candle15m.low}`);

    // Додаємо до масиву закритих 15m свічок
    this.closed15m.push({ ...candle15m });

    // Обрізаємо буфер
    if (this.closed15m.length > this.max15mHistory) {
      this.closed15m.shift();
    }

    // Емітуємо подію
    this.emit('15mClose', candle15m);
  }
}

module.exports = CandleBuilder;
