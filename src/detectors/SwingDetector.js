/**
 * detectors/SwingDetector.js
 * Визначає swing high та swing low з 15m свічок.
 *
 * Swing High: high > highs сусідніх N свічок ліворуч і праворуч
 * Swing Low:  low  < lows  сусідніх N свічок ліворуч і праворуч
 *
 * Оскільки ми не знаємо майбутніх свічок у реальному часі,
 * свінг підтверджується коли пройшло N свічок після кандидата.
 */

const { config } = require('../config');
const logger = require('../utils/logger');

class SwingDetector {
  constructor() {
    this.lookback = config.swing.lookback; // N = 2

    // Остання підтверджена swing high / low
    this.latestSwingHigh = null; // { price, time, index }
    this.latestSwingLow = null;  // { price, time, index }

    // Черга кандидатів на перевірку
    // Кандидат підтверджується через N свічок
    this.highCandidates = [];
    this.lowCandidates = [];
  }

  /**
   * Викликається при закритті нової 15m свічки
   * @param {Object[]} candles15m - масив усіх закритих 15m свічок
   */
  update(candles15m) {
    const len = candles15m.length;
    if (len < this.lookback * 2 + 1) return; // недостатньо даних

    // Перевіряємо свічку на позиції (len - 1 - lookback)
    // тобто свічку, яка має lookback свічок праворуч
    const idx = len - 1 - this.lookback;
    if (idx < this.lookback) return;

    const candidate = candles15m[idx];

    // ─── Перевірка Swing High ───────────────────────────────────────────────
    let isSwingHigh = true;
    for (let i = 1; i <= this.lookback; i++) {
      if (candles15m[idx - i].high >= candidate.high ||
          candles15m[idx + i].high >= candidate.high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      // Оновлюємо лише якщо це новий рівень (не повтор)
      if (!this.latestSwingHigh || this.latestSwingHigh.time !== candidate.openTime) {
        const prev = this.latestSwingHigh;
        this.latestSwingHigh = {
          price: candidate.high,
          time: candidate.openTime,
          idx,
        };
        logger.info(`[SwingDetector] 🔺 Новий Swing High: ${candidate.high} (попередній: ${prev?.price ?? 'немає'})`);
      }
    }

    // ─── Перевірка Swing Low ────────────────────────────────────────────────
    let isSwingLow = true;
    for (let i = 1; i <= this.lookback; i++) {
      if (candles15m[idx - i].low <= candidate.low ||
          candles15m[idx + i].low <= candidate.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      if (!this.latestSwingLow || this.latestSwingLow.time !== candidate.openTime) {
        const prev = this.latestSwingLow;
        this.latestSwingLow = {
          price: candidate.low,
          time: candidate.openTime,
          idx,
        };
        logger.info(`[SwingDetector] 🔻 Новий Swing Low: ${candidate.low} (попередній: ${prev?.price ?? 'немає'})`);
      }
    }
  }

  /**
   * Повертає поточний swing high рівень або null
   */
  getSwingHigh() {
    return this.latestSwingHigh;
  }

  /**
   * Повертає поточний swing low рівень або null
   */
  getSwingLow() {
    return this.latestSwingLow;
  }

  /**
   * Повертає стан детектора для логування
   */
  getStatus() {
    return {
      swingHigh: this.latestSwingHigh?.price ?? null,
      swingLow: this.latestSwingLow?.price ?? null,
    };
  }
}

module.exports = SwingDetector;
