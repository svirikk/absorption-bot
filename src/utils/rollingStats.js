/**
 * utils/rollingStats.js
 * Ковзне середнє і статистика для останніх N свічок
 */

class RollingStats {
  /**
   * @param {number} windowSize - розмір вікна (кількість свічок)
   */
  constructor(windowSize) {
    this.windowSize = windowSize;
    this.volumes = [];        // totalVolume кожної свічки
    this.absDeltaValues = []; // |delta| кожної свічки
    this.deltaValues = [];    // delta зі знаком
  }

  /**
   * Додає статистику закритої свічки
   * @param {number} totalVolume
   * @param {number} delta
   */
  push(totalVolume, delta) {
    this.volumes.push(totalVolume);
    this.absDeltaValues.push(Math.abs(delta));
    this.deltaValues.push(delta);

    // Обрізаємо до windowSize
    if (this.volumes.length > this.windowSize) {
      this.volumes.shift();
      this.absDeltaValues.shift();
      this.deltaValues.shift();
    }
  }

  /** Середній обʼєм */
  get avgVolume() {
    if (this.volumes.length === 0) return 0;
    return this.volumes.reduce((a, b) => a + b, 0) / this.volumes.length;
  }

  /** Середня абсолютна дельта */
  get avgAbsDelta() {
    if (this.absDeltaValues.length === 0) return 0;
    return this.absDeltaValues.reduce((a, b) => a + b, 0) / this.absDeltaValues.length;
  }

  /** Середня дельта зі знаком */
  get avgDelta() {
    if (this.deltaValues.length === 0) return 0;
    return this.deltaValues.reduce((a, b) => a + b, 0) / this.deltaValues.length;
  }

  /** Чи достатньо даних для розрахунку */
  get isReady() {
    return this.volumes.length >= Math.floor(this.windowSize / 2);
  }

  /** Скидання статистики */
  reset() {
    this.volumes = [];
    this.absDeltaValues = [];
    this.deltaValues = [];
  }
}

module.exports = RollingStats;
