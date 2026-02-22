/**
 * detectors/SwingDetector.js
 *
 * Відстежує СЕРІЮ підтверджених swing high і swing low на 15m.
 * Замість одного рівня — зберігаємо пул ліквідності:
 *
 * Ascending lows (LONG liquidity pool):
 *   Low1 < Low2 < Low3 < Low4  → сходинки вгору → стопи під кожним
 *   Коли ціна одним рухом пробиває кілька → масове зняття ліквідності
 *
 * Descending highs (SHORT liquidity pool):
 *   High1 > High2 > High3 > High4  → сходинки вниз → стопи над кожним
 *   Коли ціна одним рухом пробиває кілька → масове зняття ліквідності
 */

const { config } = require('../config');
const logger = require('../utils/logger');

class SwingDetector {
  constructor() {
    this.lookback    = config.swing.lookback;     // N свічок ліво/право
    this.maxPoolSize = config.swing.maxPoolSize;  // макс рівнів у пулі

    // Масиви підтверджених свінгів (від старого до нового)
    // Кожен: { price, time, idx }
    this.swingHighPool = [];
    this.swingLowPool  = [];
  }

  /**
   * Оновлює пули при закритті нової 15m свічки.
   * @param {Object[]} candles15m
   */
  update(candles15m) {
    const len = candles15m.length;
    if (len < this.lookback * 2 + 1) return;

    const idx = len - 1 - this.lookback;
    if (idx < this.lookback) return;

    const candidate = candles15m[idx];

    const alreadyHigh = this.swingHighPool.some(s => s.time === candidate.openTime);
    const alreadyLow  = this.swingLowPool.some(s => s.time === candidate.openTime);

    // ─── Swing High ───────────────────────────────────────────────────────────
    if (!alreadyHigh) {
      let isSwingHigh = true;
      for (let i = 1; i <= this.lookback; i++) {
        if (candles15m[idx - i].high >= candidate.high ||
            candles15m[idx + i].high >= candidate.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        this._addToPool(this.swingHighPool, { price: candidate.high, time: candidate.openTime, idx });
        logger.info(
          `[SwingDetector] 🔺 Swing High: ${candidate.high} | ` +
          `Пул: [${this.swingHighPool.map(s => s.price).join(', ')}]`
        );
      }
    }

    // ─── Swing Low ────────────────────────────────────────────────────────────
    if (!alreadyLow) {
      let isSwingLow = true;
      for (let i = 1; i <= this.lookback; i++) {
        if (candles15m[idx - i].low <= candidate.low ||
            candles15m[idx + i].low <= candidate.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        this._addToPool(this.swingLowPool, { price: candidate.low, time: candidate.openTime, idx });
        logger.info(
          `[SwingDetector] 🔻 Swing Low: ${candidate.low} | ` +
          `Пул: [${this.swingLowPool.map(s => s.price).join(', ')}]`
        );
      }
    }
  }

  /**
   * Повертає всі swing low що були ПРОБИТІ (candleLow < swingLow.price).
   * @param {number} candleLow
   */
  getSweptLows(candleLow) {
    const swept = this.swingLowPool.filter(s => candleLow < s.price);
    return {
      swept,
      count: swept.length,
      highestSweptLevel: swept.length > 0 ? Math.max(...swept.map(s => s.price)) : null,
      deepestLevel:      swept.length > 0 ? Math.min(...swept.map(s => s.price)) : null,
    };
  }

  /**
   * Повертає всі swing high що були ПРОБИТІ (candleHigh > swingHigh.price).
   * @param {number} candleHigh
   */
  getSweptHighs(candleHigh) {
    const swept = this.swingHighPool.filter(s => candleHigh > s.price);
    return {
      swept,
      count: swept.length,
      lowestSweptLevel: swept.length > 0 ? Math.min(...swept.map(s => s.price)) : null,
      highestLevel:     swept.length > 0 ? Math.max(...swept.map(s => s.price)) : null,
    };
  }

  /**
   * Видаляє swept рівні з пулу після підтвердженого алерту.
   * @param {'high'|'low'} type
   * @param {Object[]} sweptLevels
   */
  clearSweptLevels(type, sweptLevels) {
    const sweptTimes = new Set(sweptLevels.map(s => s.time));
    if (type === 'high') {
      this.swingHighPool = this.swingHighPool.filter(s => !sweptTimes.has(s.time));
    } else {
      this.swingLowPool = this.swingLowPool.filter(s => !sweptTimes.has(s.time));
    }
  }

  getStatus() {
    return {
      swingHighs: this.swingHighPool.map(s => s.price),
      swingLows:  this.swingLowPool.map(s => s.price),
    };
  }

  _addToPool(pool, entry) {
    pool.push(entry);
    pool.sort((a, b) => a.time - b.time);
    while (pool.length > this.maxPoolSize) pool.shift();
  }
}

module.exports = SwingDetector;
