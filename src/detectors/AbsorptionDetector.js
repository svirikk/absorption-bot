/**
 * detectors/AbsorptionDetector.js
 *
 * Логіка абсорбції з перевіркою ПУЛУ ліквідності.
 *
 * Тепер вимагаємо що свічка пробила МІНІМУМ minLevelsSwept рівнів —
 * тобто знялась ліквідність з кількох swing точок одночасно.
 * Це фільтрує слабкі локальні sweep одного рівня.
 */

const { config } = require('../config');
const RollingStats = require('../utils/rollingStats');
const logger = require('../utils/logger');

const PendingState = {
  NONE:  'NONE',
  SHORT: 'SHORT_PENDING',
  LONG:  'LONG_PENDING',
};

class AbsorptionDetector {
  constructor() {
    this.stats = new RollingStats(config.alert.rollingWindow);
    this.minLevelsSwept = config.swing.minLevelsSwept; // мін. рівнів для валідного sweep

    this.pending = this._emptyPending();
    this.maxConfirmCandles = 2;
  }

  updateStats(totalVolume, delta) {
    this.stats.push(totalVolume, delta);
  }

  /**
   * Перевіряє свічку на кандидата абсорбції.
   *
   * @param {Object} candle
   * @param {Object} footprint
   * @param {{ swept, count, highestSweptLevel, deepestLevel }} sweptLows  - від SwingDetector
   * @param {{ swept, count, lowestSweptLevel, highestLevel }}  sweptHighs - від SwingDetector
   * @returns {{ type: null }}  — завжди null тут (підтвердження через наступну свічку)
   */
  checkCandle(candle, footprint, sweptLows, sweptHighs) {
    if (!footprint || !this.stats.isReady) return { type: null };

    const avgVol      = this.stats.avgVolume;
    const avgAbsDelta = this.stats.avgAbsDelta;

    // ─── SHORT: свічка пробила кілька swing highs ──────────────────────────
    if (sweptHighs.count >= this.minLevelsSwept) {
      const deltaSpike   = footprint.delta > avgAbsDelta * config.alert.deltaMultiplier;
      const volSpike     = footprint.totalVolume > avgVol * config.alert.volumeMultiplier;
      const closeBelowPOC = candle.close < footprint.poc;

      logger.debug(
        `[AbsorptionDetector] SHORT кандидат: swept=${sweptHighs.count} хаїв, ` +
        `delta=${footprint.delta.toFixed(2)} (потрібно >${(avgAbsDelta * config.alert.deltaMultiplier).toFixed(2)}), ` +
        `vol=${footprint.totalVolume.toFixed(2)} (потрібно >${(avgVol * config.alert.volumeMultiplier).toFixed(2)}), ` +
        `closeBelowPOC=${closeBelowPOC}`
      );

      if (deltaSpike && volSpike && closeBelowPOC) {
        logger.info(
          `[AbsorptionDetector] 🟡 SHORT кандидат: знято ${sweptHighs.count} рівнів хаїв ` +
          `[${sweptHighs.swept.map(s => s.price).join(', ')}]`
        );
        this.pending = {
          state:       PendingState.SHORT,
          candle,
          footprint,
          sweptHighs,
          sweptLows:   null,
          sweepPrice:  candle.high,
          confirmCount: 0,
        };
        return { type: null };
      }
    }

    // ─── LONG: свічка пробила кілька swing lows ────────────────────────────
    if (sweptLows.count >= this.minLevelsSwept) {
      const deltaSpike    = footprint.delta < -(avgAbsDelta * config.alert.deltaMultiplier);
      const volSpike      = footprint.totalVolume > avgVol * config.alert.volumeMultiplier;
      const closeAbovePOC = candle.close > footprint.poc;

      logger.debug(
        `[AbsorptionDetector] LONG кандидат: swept=${sweptLows.count} лоїв, ` +
        `delta=${footprint.delta.toFixed(2)} (потрібно <${-(avgAbsDelta * config.alert.deltaMultiplier).toFixed(2)}), ` +
        `vol=${footprint.totalVolume.toFixed(2)} (потрібно >${(avgVol * config.alert.volumeMultiplier).toFixed(2)}), ` +
        `closeAbovePOC=${closeAbovePOC}`
      );

      if (deltaSpike && volSpike && closeAbovePOC) {
        logger.info(
          `[AbsorptionDetector] 🟡 LONG кандидат: знято ${sweptLows.count} рівнів лоїв ` +
          `[${sweptLows.swept.map(s => s.price).join(', ')}]`
        );
        this.pending = {
          state:       PendingState.LONG,
          candle,
          footprint,
          sweptLows,
          sweptHighs:  null,
          sweepPrice:  candle.low,
          confirmCount: 0,
        };
        return { type: null };
      }
    }

    return { type: null };
  }

  /**
   * Перевіряє підтвердження наступною свічкою.
   */
  checkConfirmation(candle, footprint) {
    if (this.pending.state === PendingState.NONE) return { type: null };

    this.pending.confirmCount++;

    // ─── SHORT підтвердження ──────────────────────────────────────────────
    if (this.pending.state === PendingState.SHORT) {
      if (candle.high > this.pending.sweepPrice) {
        logger.info(`[AbsorptionDetector] SHORT скасовано: нове HH ${candle.high}`);
        this._clearPending();
        return { type: null };
      }
      // Не оновив high → підтверджено
      const result = this._buildResult('SHORT');
      this._clearPending();
      return result;
    }

    // ─── LONG підтвердження ───────────────────────────────────────────────
    if (this.pending.state === PendingState.LONG) {
      if (candle.low < this.pending.sweepPrice) {
        logger.info(`[AbsorptionDetector] LONG скасовано: нове LL ${candle.low}`);
        this._clearPending();
        return { type: null };
      }
      const result = this._buildResult('LONG');
      this._clearPending();
      return result;
    }

    if (this.pending.confirmCount >= this.maxConfirmCandles) {
      logger.info(`[AbsorptionDetector] Кандидат скасовано: вичерпано ліміт свічок`);
      this._clearPending();
    }

    return { type: null };
  }

  hasPending() {
    return this.pending.state !== PendingState.NONE;
  }

  // ─── Приватне ─────────────────────────────────────────────────────────────

  _buildResult(type) {
    const p = this.pending;
    const sweptInfo = type === 'SHORT' ? p.sweptHighs : p.sweptLows;

    return {
      type,
      data: {
        // Пул рівнів що були swept
        sweptLevels:    sweptInfo.swept.map(s => s.price).sort((a, b) => a - b),
        sweptCount:     sweptInfo.count,
        // Найвищий swept рівень (для SHORT) або найнижчий (для LONG)
        swingLevel: type === 'SHORT'
          ? sweptInfo.highestLevel
          : sweptInfo.highestSweptLevel,
        sweepPrice:     p.sweepPrice,
        delta:          p.footprint.delta,
        totalVolume:    p.footprint.totalVolume,
        avgVolume:      this.stats.avgVolume,
        avgAbsDelta:    this.stats.avgAbsDelta,
        poc:            p.footprint.poc,
        candleClose:    p.candle.close,
        volumeMultiple: (p.footprint.totalVolume / this.stats.avgVolume).toFixed(2),
        deltaMultiple:  (Math.abs(p.footprint.delta) / this.stats.avgAbsDelta).toFixed(2),
        candle:         p.candle,
        footprint:      p.footprint,
        // Для очищення пулу після алерту
        sweptLowsInfo:  p.sweptLows,
        sweptHighsInfo: p.sweptHighs,
      },
    };
  }

  _clearPending() {
    this.pending = this._emptyPending();
  }

  _emptyPending() {
    return {
      state:        PendingState.NONE,
      candle:       null,
      footprint:    null,
      sweptLows:    null,
      sweptHighs:   null,
      sweepPrice:   null,
      confirmCount: 0,
    };
  }
}

module.exports = AbsorptionDetector;
