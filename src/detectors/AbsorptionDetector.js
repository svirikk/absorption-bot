/**
 * detectors/AbsorptionDetector.js
 * Основна логіка детектування абсорбції ліквідності.
 *
 * Зберігає стан попередніх свічок для перевірки умов:
 * - liquidity sweep
 * - delta spike
 * - volume spike
 * - закриття відносно POC
 * - відсутність продовження після свічки
 * - підтвердження виснаження (наступні 1-2 свічки)
 */

const { config } = require('../config');
const RollingStats = require('../utils/rollingStats');
const logger = require('../utils/logger');

// Стан підозрілої свічки (очікуємо підтвердження)
const PendingState = {
  NONE: 'NONE',
  SHORT: 'SHORT_PENDING',  // шукаємо підтвердження short абсорбції
  LONG: 'LONG_PENDING',    // шукаємо підтвердження long абсорбції
};

class AbsorptionDetector {
  constructor() {
    this.stats = new RollingStats(config.alert.rollingWindow);

    // Підозріла свічка, що очікує підтвердження
    this.pending = {
      state: PendingState.NONE,
      candle: null,       // сама підозріла свічка
      footprint: null,    // її footprint
      swingLevel: null,   // рівень свінгу, що був пробитий
      sweepHigh: null,    // ціна sweep high
      sweepLow: null,     // ціна sweep low
      confirmCount: 0,    // скільки свічок вже перевірено
    };

    this.maxConfirmCandles = 2; // скільки свічок чекаємо підтвердження
  }

  /**
   * Оновлює ковзну статистику закритою свічкою
   * @param {number} totalVolume
   * @param {number} delta
   */
  updateStats(totalVolume, delta) {
    this.stats.push(totalVolume, delta);
  }

  /**
   * Перевіряє чи підозріла свічка є initial sweep+absorption кандидатом
   *
   * @param {Object} candle     - закрита 1m свічка
   * @param {Object} footprint  - розрахований footprint для цієї свічки
   * @param {Object} swingHigh  - { price } або null
   * @param {Object} swingLow   - { price } або null
   * @returns {{ type: 'SHORT'|'LONG'|null, data: Object }}
   */
  checkCandle(candle, footprint, swingHigh, swingLow) {
    if (!footprint || !this.stats.isReady) {
      return { type: null };
    }

    const avgVol = this.stats.avgVolume;
    const avgAbsDelta = this.stats.avgAbsDelta;

    logger.debug(
      `[AbsorptionDetector] Перевірка свічки: vol=${footprint.totalVolume.toFixed(2)}, ` +
      `delta=${footprint.delta.toFixed(2)}, poc=${footprint.poc}, close=${candle.close} | ` +
      `avgVol=${avgVol.toFixed(2)}, avgAbsDelta=${avgAbsDelta.toFixed(2)}`
    );

    // ─── SHORT Absorption Candidate ─────────────────────────────────────────
    if (swingHigh && candle.high > swingHigh.price) {
      const deltaSpike = footprint.delta > avgAbsDelta * config.alert.deltaMultiplier;
      const volSpike = footprint.totalVolume > avgVol * config.alert.volumeMultiplier;
      const closeBelowPOC = candle.close < footprint.poc;

      logger.debug(
        `[AbsorptionDetector] SHORT кандидат: sweep=${candle.high > swingHigh.price}, ` +
        `deltaSpike=${deltaSpike}(${footprint.delta.toFixed(2)} > ${(avgAbsDelta * config.alert.deltaMultiplier).toFixed(2)}), ` +
        `volSpike=${volSpike}, closeBelowPOC=${closeBelowPOC}`
      );

      if (deltaSpike && volSpike && closeBelowPOC) {
        logger.info(`[AbsorptionDetector] 🟡 SHORT кандидат виявлено, очікуємо підтвердження...`);
        this.pending = {
          state: PendingState.SHORT,
          candle,
          footprint,
          swingLevel: swingHigh.price,
          sweepHigh: candle.high,
          sweepLow: null,
          confirmCount: 0,
        };
        return { type: null }; // ще не підтверджено
      }
    }

    // ─── LONG Absorption Candidate ──────────────────────────────────────────
    if (swingLow && candle.low < swingLow.price) {
      const deltaSpike = footprint.delta < -(avgAbsDelta * config.alert.deltaMultiplier);
      const volSpike = footprint.totalVolume > avgVol * config.alert.volumeMultiplier;
      const closeAbovePOC = candle.close > footprint.poc;

      logger.debug(
        `[AbsorptionDetector] LONG кандидат: sweep=${candle.low < swingLow.price}, ` +
        `deltaSpike=${deltaSpike}(${footprint.delta.toFixed(2)} < ${-(avgAbsDelta * config.alert.deltaMultiplier).toFixed(2)}), ` +
        `volSpike=${volSpike}, closeAbovePOC=${closeAbovePOC}`
      );

      if (deltaSpike && volSpike && closeAbovePOC) {
        logger.info(`[AbsorptionDetector] 🟡 LONG кандидат виявлено, очікуємо підтвердження...`);
        this.pending = {
          state: PendingState.LONG,
          candle,
          footprint,
          swingLevel: swingLow.price,
          sweepHigh: null,
          sweepLow: candle.low,
          confirmCount: 0,
        };
        return { type: null }; // ще не підтверджено
      }
    }

    return { type: null };
  }

  /**
   * Перевіряє підтвердження для pending кандидата наступними свічками.
   * Виклик після кожної свічки що йде після кандидата.
   *
   * @param {Object} candle    - нова закрита свічка (наступна після кандидата)
   * @param {Object} footprint - її footprint
   * @returns {{ type: 'SHORT'|'LONG'|null, data: Object }}
   */
  checkConfirmation(candle, footprint) {
    if (this.pending.state === PendingState.NONE) {
      return { type: null };
    }

    this.pending.confirmCount++;
    const avgVol = this.stats.avgVolume;
    const avgAbsDelta = this.stats.avgAbsDelta;

    // ─── SHORT Підтвердження ─────────────────────────────────────────────────
    if (this.pending.state === PendingState.SHORT) {
      // Умова: свічка НЕ оновлює sweep high
      const noHigherHigh = candle.high <= this.pending.sweepHigh;

      // Виснаження: обʼєм знижується, дельта нормалізується
      const volumeDropped = footprint
        ? footprint.totalVolume < avgVol * config.alert.exhaustionVolumeDropRatio
        : false;
      const deltaNormalized = footprint
        ? Math.abs(footprint.delta) < avgAbsDelta * config.alert.exhaustionDeltaNormalizeRatio
        : false;

      if (noHigherHigh) {
        // Базове підтвердження — достатньо
        const result = this._buildResult('SHORT');
        this._clearPending();
        return result;
      }

      // Якщо оновив high — кандидат провалився
      if (candle.high > this.pending.sweepHigh) {
        logger.info(`[AbsorptionDetector] SHORT кандидат скасовано: нове HH ${candle.high} > ${this.pending.sweepHigh}`);
        this._clearPending();
        return { type: null };
      }
    }

    // ─── LONG Підтвердження ──────────────────────────────────────────────────
    if (this.pending.state === PendingState.LONG) {
      const noLowerLow = candle.low >= this.pending.sweepLow;

      if (noLowerLow) {
        const result = this._buildResult('LONG');
        this._clearPending();
        return result;
      }

      if (candle.low < this.pending.sweepLow) {
        logger.info(`[AbsorptionDetector] LONG кандидат скасовано: нове LL ${candle.low} < ${this.pending.sweepLow}`);
        this._clearPending();
        return { type: null };
      }
    }

    // Якщо вичерпали maxConfirmCandles — скасовуємо
    if (this.pending.confirmCount >= this.maxConfirmCandles) {
      logger.info(`[AbsorptionDetector] Кандидат скасовано: вичерпано ${this.maxConfirmCandles} свічки підтвердження`);
      this._clearPending();
    }

    return { type: null };
  }

  /**
   * Чи є поточний pending кандидат
   */
  hasPending() {
    return this.pending.state !== PendingState.NONE;
  }

  // ─── Приватні методи ────────────────────────────────────────────────────────

  _buildResult(type) {
    const p = this.pending;
    return {
      type,
      data: {
        swingLevel: p.swingLevel,
        sweepPrice: type === 'SHORT' ? p.sweepHigh : p.sweepLow,
        delta: p.footprint.delta,
        totalVolume: p.footprint.totalVolume,
        avgVolume: this.stats.avgVolume,
        avgAbsDelta: this.stats.avgAbsDelta,
        poc: p.footprint.poc,
        candleClose: p.candle.close,
        volumeMultiple: (p.footprint.totalVolume / this.stats.avgVolume).toFixed(2),
        deltaMultiple: (Math.abs(p.footprint.delta) / this.stats.avgAbsDelta).toFixed(2),
        candle: p.candle,
        footprint: p.footprint,
      },
    };
  }

  _clearPending() {
    this.pending = {
      state: PendingState.NONE,
      candle: null,
      footprint: null,
      swingLevel: null,
      sweepHigh: null,
      sweepLow: null,
      confirmCount: 0,
    };
  }
}

module.exports = AbsorptionDetector;
