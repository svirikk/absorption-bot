/**
 * services/WebSocketManager.js
 * Управляє WebSocket зʼєднаннями з Binance Futures
 * Автоматичне перепідключення з exponential backoff
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const { config } = require('../config');

class WebSocketManager extends EventEmitter {
  /**
   * @param {string} name - назва потоку (для логів)
   * @param {string} url - WebSocket URL
   */
  constructor(name, url) {
    super();
    this.name = name;
    this.url = url;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.pingInterval = null;
    this.shouldReconnect = true;
  }

  /** Ініціалізація зʼєднання */
  connect() {
    logger.info(`[${this.name}] Підключення до ${this.url}`);

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      logger.error(`[${this.name}] Помилка створення WebSocket: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => this._onOpen());
    this.ws.on('message', (data) => this._onMessage(data));
    this.ws.on('error', (err) => this._onError(err));
    this.ws.on('close', (code, reason) => this._onClose(code, reason));
  }

  /** Закриття зʼєднання (навмисне) */
  disconnect() {
    this.shouldReconnect = false;
    this._clearPing();
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.isConnected = false;
    logger.info(`[${this.name}] Зʼєднання закрито навмисно`);
  }

  // ─── Приватні методи ────────────────────────────────────────────────────────

  _onOpen() {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    logger.info(`[${this.name}] ✅ Зʼєднано`);
    this.emit('connected');
    this._startPing();
  }

  _onMessage(raw) {
    try {
      const data = JSON.parse(raw);
      this.emit('message', data);
    } catch (err) {
      logger.warn(`[${this.name}] Помилка парсингу повідомлення: ${err.message}`);
    }
  }

  _onError(err) {
    logger.error(`[${this.name}] WebSocket помилка: ${err.message}`);
    this.emit('error', err);
  }

  _onClose(code, reason) {
    this.isConnected = false;
    this._clearPing();
    const reasonStr = reason ? reason.toString() : 'невідома причина';
    logger.warn(`[${this.name}] Зʼєднання закрито (код: ${code}, причина: ${reasonStr})`);
    this.emit('disconnected', { code, reason: reasonStr });

    if (this.shouldReconnect) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= config.websocket.maxReconnectAttempts) {
      logger.error(`[${this.name}] ❌ Перевищено максимум спроб перепідключення (${config.websocket.maxReconnectAttempts})`);
      this.emit('maxReconnectReached');
      return;
    }

    // Exponential backoff: 3s, 6s, 12s, 24s... макс 60s
    const delay = Math.min(
      config.websocket.reconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      60_000,
    );
    this.reconnectAttempts++;

    logger.info(`[${this.name}] Перепідключення через ${delay}ms (спроба ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  _startPing() {
    this._clearPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, config.websocket.pingIntervalMs);
  }

  _clearPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

module.exports = WebSocketManager;
