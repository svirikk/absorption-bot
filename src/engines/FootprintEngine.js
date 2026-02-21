/**
 * engines/FootprintEngine.js
 * Будує footprint (стакан обʼємів за ціновими рівнями) з aggTrade потоку.
 * Групує угоди за ціновими кластерами та розраховує delta, POC, тощо.
 */

const { config } = require('../config');
const logger = require('../utils/logger');

class FootprintEngine {
  constructor() {
    // clusters: Map<priceLevel, { buyVolume, sellVolume, totalVolume, delta }>
    this.clusters = new Map();

    this.totalBuyVolume = 0;
    this.totalSellVolume = 0;
    this.tradeCount = 0;

    // Відкриваємо нову свічку з моменту запуску
    this.candleOpenTime = null;
  }

  /**
   * Обробляє одну aggTrade подію
   * @param {Object} msg - raw Binance aggTrade message
   */
  handleTrade(msg) {
    if (msg.e !== 'aggTrade') return;

    const price = parseFloat(msg.p);
    const qty = parseFloat(msg.q);
    const isBuyerMaker = msg.m; // true = seller initiated (market sell)

    // Визначаємо ціновий рівень (округлення до priceClusterSize)
    const level = this._snapToCluster(price);

    // Отримуємо або створюємо кластер
    if (!this.clusters.has(level)) {
      this.clusters.set(level, {
        price: level,
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
        delta: 0,
      });
    }

    const cluster = this.clusters.get(level);

    if (isBuyerMaker) {
      // Market sell (покупець — мейкер, продавець — тейкер)
      cluster.sellVolume += qty;
      this.totalSellVolume += qty;
    } else {
      // Market buy (продавець — мейкер, покупець — тейкер)
      cluster.buyVolume += qty;
      this.totalBuyVolume += qty;
    }

    cluster.totalVolume = cluster.buyVolume + cluster.sellVolume;
    cluster.delta = cluster.buyVolume - cluster.sellVolume;
    this.tradeCount++;
  }

  /**
   * Розраховує повний footprint для поточної свічки
   * @returns {Object} footprintData
   */
  calculate() {
    if (this.clusters.size === 0) {
      return null;
    }

    const clusterArray = Array.from(this.clusters.values())
      .sort((a, b) => a.price - b.price);

    // POC = рівень з максимальним totalVolume
    const poc = clusterArray.reduce((max, c) =>
      c.totalVolume > max.totalVolume ? c : max, clusterArray[0]);

    const totalVolume = this.totalBuyVolume + this.totalSellVolume;
    const delta = this.totalBuyVolume - this.totalSellVolume;

    // Топ кластер (найвища ціна)
    const topCluster = clusterArray[clusterArray.length - 1];
    // Нижній кластер (найнижча ціна)
    const bottomCluster = clusterArray[0];

    return {
      clusters: clusterArray,
      poc: poc.price,
      pocVolume: poc.totalVolume,
      totalBuyVolume: this.totalBuyVolume,
      totalSellVolume: this.totalSellVolume,
      totalVolume,
      delta,
      topClusterVolume: topCluster.totalVolume,
      bottomClusterVolume: bottomCluster.totalVolume,
      tradeCount: this.tradeCount,
    };
  }

  /**
   * Скидає дані для нової свічки
   */
  reset() {
    this.clusters.clear();
    this.totalBuyVolume = 0;
    this.totalSellVolume = 0;
    this.tradeCount = 0;
    this.candleOpenTime = null;
  }

  /**
   * Округлює ціну до найближчого кластеру
   * @param {number} price
   * @returns {number}
   */
  _snapToCluster(price) {
    const size = config.footprint.priceClusterSize;
    return Math.round(price / size) * size;
  }
}

module.exports = FootprintEngine;
