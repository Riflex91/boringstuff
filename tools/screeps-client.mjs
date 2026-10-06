import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadConfigFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid Screeps config in ${file}`);
  }
  return parsed;
}

function configPath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SCREEPS_CONFIG) return path.resolve(process.env.SCREEPS_CONFIG);
  return path.join(__dirname, 'screeps.json');
}

function normalizeServer(parsed, serverName) {
  const servers = parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : parsed;
  const raw = servers[serverName];
  if (!raw) {
    throw new Error(`Server '${serverName}' not found in screeps.json. Available: ${Object.keys(servers).join(', ')}`);
  }

  let baseUrl;
  if (raw.url) {
    baseUrl = String(raw.url);
  } else {
    const protocol = raw.protocol || (raw.secure === false ? 'http' : 'https');
    const hostname = raw.hostname || raw.host || 'screeps.com';
    const port = raw.port ? `:${raw.port}` : '';
    const pathname = raw.pathname || raw.path || '/';
    baseUrl = `${protocol}://${hostname}${port}${pathname}`;
  }
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const email = raw.email || raw.username || null;
  const password = raw.password || null;
  const token = raw.token || null;
  if (!token && (!email || !password)) {
    throw new Error(`Server '${serverName}' needs either token or email/password in screeps.json`);
  }

  return { ...raw, baseUrl, email, password, token };
}

function addSearchParams(url, params) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
}

function decodeResponseBody(text) {
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { text }; }
}

export class ScreepsHttpClient {
  constructor(serverName, server) {
    this.serverName = serverName;
    this.server = server;
    this.token = server.token || null;
    this._me = null;
    this.socket = new ScreepsSocketClient(this);
  }

  static async fromConfig(serverName = 'newbieland', options = {}) {
    const file = configPath(options.file);
    if (!fs.existsSync(file)) {
      throw new Error(`Screeps config not found: ${file}\nCreate it from screeps.json.example first.`);
    }
    const parsed = loadConfigFile(file);
    const client = new ScreepsHttpClient(serverName, normalizeServer(parsed, serverName));
    if (!client.token) await client.auth();
    return client;
  }

  async auth() {
    if (this.server.token) {
      this.token = this.server.token;
      return { token: this.token };
    }
    const result = await this._request('POST', '/api/auth/signin', {
      email: this.server.email,
      password: this.server.password
    }, { skipAuth: true, retryAuth: false });
    if (!result?.token && !this.token) throw new Error('Authentication succeeded but no token was returned by the server.');
    if (result?.token) this.token = result.token;
    return result;
  }

  async _request(method, endpoint, params = {}, opts = {}) {
    if (!opts.skipAuth && !this.token) await this.auth();

    const max429Retries = Number.isInteger(opts.max429Retries) ? opts.max429Retries : 5;
    const max5xxRetries = Number.isInteger(opts.max5xxRetries) ? opts.max5xxRetries : 2;
    let retry429 = 0;
    let retry5xx = 0;

    while (true) {
      const url = new URL(endpoint.replace(/^\//, ''), this.server.baseUrl);
      if (method === 'GET') addSearchParams(url, params);
      const payload = method === 'GET' ? null : JSON.stringify(params || {});
      const transport = url.protocol === 'https:' ? https : http;

      const headers = { Accept: 'application/json' };
      if (payload !== null) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (this.token && !opts.skipAuth) {
        headers['X-Token'] = this.token;
        headers['X-Username'] = this.token;
      }

      let response;
      try {
        response = await new Promise((resolve, reject) => {
          const req = transport.request(url, { method, headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode || 0,
                headers: res.headers,
                text: Buffer.concat(chunks).toString('utf8')
              });
            });
          });
          req.setTimeout(30000, () => req.destroy(new Error(`HTTP timeout calling ${endpoint}`)));
          req.on('error', reject);
          if (payload !== null) req.write(payload);
          req.end();
        });
      } catch (err) {
        if (retry5xx < max5xxRetries) {
          retry5xx++;
          await sleep(250 * (2 ** (retry5xx - 1)));
          continue;
        }
        throw err;
      }

      const headerToken = response.headers['x-token'];
      if (headerToken) this.token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
      const data = decodeResponseBody(response.text);

      if (response.statusCode === 401 && !opts.skipAuth && opts.retryAuth !== false && this.server.email && this.server.password) {
        this.token = null;
        await this.auth();
        return this._request(method, endpoint, params, { ...opts, retryAuth: false });
      }

      if (response.statusCode === 429 && retry429 < max429Retries) {
        retry429++;
        const retryAfterRaw = response.headers['retry-after'];
        const retryAfter = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
        const retryAfterMs = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0;
        const delay = Math.max(retryAfterMs, Math.min(8000, 300 * (2 ** (retry429 - 1))));
        await sleep(delay);
        continue;
      }

      if (response.statusCode >= 500 && response.statusCode < 600 && retry5xx < max5xxRetries) {
        retry5xx++;
        await sleep(300 * (2 ** (retry5xx - 1)));
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300 || data?.error) {
        const detail = data?.error || data?.text || response.text || `HTTP ${response.statusCode}`;
        const err = new Error(`${method} ${endpoint} failed (${response.statusCode}): ${detail}`);
        err.statusCode = response.statusCode;
        err.response = data;
        throw err;
      }
      return data;
    }
  }

  async authMe() {
    const me = await this._request('GET', '/api/auth/me');
    this._me = me;
    return me;
  }

  async me() {
    if (!this._me) await this.authMe();
    return this._me;
  }

  gameRooms(shard) {
    return this._request('GET', '/api/game/rooms', { shard });
  }

  gameWorldSize(shard) {
    return this._request('GET', '/api/game/world-size', { shard });
  }

  gameRoomStatus(room, shard) {
    return this._request('GET', '/api/game/room-status', { room, shard });
  }

  gameRoomTerrain(room, shard) {
    return this._request('GET', '/api/game/room-terrain', { room, encoded: 1, shard });
  }

  gameRoomObjects(room, shard) {
    return this._request('GET', '/api/game/room-objects', { room, shard });
  }

  userWorldStatus() {
    return this._request('GET', '/api/user/world-status');
  }

  userFindById(id) {
    return this._request('GET', '/api/user/find', { id });
  }

  userRooms(id) {
    return this._request('GET', '/api/user/rooms', { id });
  }

  userStats(id, interval = 8) {
    return this._request('GET', '/api/user/stats', { id, interval });
  }

  userMemory(pathName = '') {
    return this._request('GET', '/api/user/memory', pathName ? { path: pathName } : {});
  }

  gameCheckUniqueObjectName(type, name, shard) {
    return this._request('POST', '/api/game/check-unique-object-name', { type, name, shard });
  }

  gamePlaceSpawn(room, x, y, name, shard) {
    return this._request('POST', '/api/game/place-spawn', { room, x, y, name, shard });
  }

  userBranches() {
    return this._request('GET', '/api/user/branches');
  }

  userSetActiveBranch(branch, activeName = 'activeWorld') {
    return this._request('POST', '/api/user/set-active-branch', { branch, activeName });
  }
}

export class ScreepsSocketClient extends EventEmitter {
  static CONNECTED = 'connected';
  static DISCONNECTED = 'disconnected';
  static AUTH = 'auth';
  static AUTHED = 'authed';
  static ERROR = 'error';

  constructor(httpClient) {
    super();
    this.http = httpClient;
    this.ws = null;
    this.connected = false;
    this.authed = false;
    this._manualClose = false;
    this._callbacks = new Map();
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
  }

  async connect() {
    this._manualClose = false;
    if (!this.http.token) await this.http.auth();
    const wsUrl = new URL('socket/websocket', this.http.server.baseUrl.replace(/^http/, 'ws'));
    const { default: WebSocket } = await import('ws');

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const failBeforeAuth = err => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.on('open', () => {
        this.connected = true;
        this.emit(ScreepsSocketClient.CONNECTED);
        ws.send(`auth ${this.http.token}`);
      });

      ws.on('message', data => {
        try {
          const msg = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
          if (msg.startsWith('[')) {
            const parsed = JSON.parse(msg);
            const spec = parsed[0];
            const payload = parsed[1];
            const callbacks = this._callbacks.get(spec);
            if (callbacks) {
              const match = /^(.+):(.+?)(?:\/(.+))?$/.exec(spec);
              const event = { type: match?.[1] || null, id: match?.[2] || null, path: match?.[3] || '', data: payload };
              for (const cb of callbacks) cb(event);
            }
            return;
          }

          const [command, ...parts] = msg.split(' ');
          if (command === 'auth') {
            const status = parts[0];
            const token = parts[1] || this.http.token;
            if (status === 'ok') {
              if (token) this.http.token = token;
              this.authed = true;
              this._reconnectAttempt = 0;
              this.emit(ScreepsSocketClient.AUTH, { data: { status, token } });
              this.emit(ScreepsSocketClient.AUTHED);
              this._resubscribe();
              clearInterval(this._pingTimer);
              this._pingTimer = setInterval(() => {
                if (this.ws?.readyState === 1) this.ws.ping();
              }, 10000);
              if (!settled) {
                settled = true;
                resolve();
              }
            } else {
              const err = new Error(`WebSocket authentication failed: ${msg}`);
              this.emit(ScreepsSocketClient.AUTH, { data: { status, token } });
              failBeforeAuth(err);
            }
          }
        } catch (err) {
          this.emit(ScreepsSocketClient.ERROR, err);
        }
      });

      ws.on('error', err => {
        this.emit(ScreepsSocketClient.ERROR, err);
        failBeforeAuth(err);
      });

      ws.on('close', () => {
        clearInterval(this._pingTimer);
        this._pingTimer = null;
        this.connected = false;
        this.authed = false;
        this.emit(ScreepsSocketClient.DISCONNECTED);
        if (!settled) failBeforeAuth(new Error('WebSocket closed before authentication completed.'));
        if (!this._manualClose) this._scheduleReconnect();
      });
    });
  }

  disconnect() {
    this._manualClose = true;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingTimer);
    this._reconnectTimer = null;
    this._pingTimer = null;
    try { this.ws?.terminate(); } catch {}
    this.ws = null;
    this.connected = false;
    this.authed = false;
  }

  async subscribeUserConsole(cb) {
    return this._subscribeUserPath('console', cb);
  }

  async subscribeUserCpu(cb) {
    return this._subscribeUserPath('cpu', cb);
  }

  async _subscribeUserPath(pathName, cb) {
    const me = await this.http.me();
    const userId = me?._id || me?.id;
    if (!userId) throw new Error('Could not determine Screeps user ID for websocket subscription.');
    const spec = `user:${userId}/${pathName}`;
    let set = this._callbacks.get(spec);
    if (!set) {
      set = new Set();
      this._callbacks.set(spec, set);
    }
    if (cb) set.add(cb);
    if (this.authed && this.ws?.readyState === 1) this.ws.send(`subscribe ${spec}`);
    return spec;
  }

  _resubscribe() {
    if (!this.authed || this.ws?.readyState !== 1) return;
    for (const spec of this._callbacks.keys()) this.ws.send(`subscribe ${spec}`);
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    const delay = Math.min(60000, 500 * (2 ** Math.min(this._reconnectAttempt, 7)));
    this._reconnectAttempt++;
    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        this.emit(ScreepsSocketClient.ERROR, err);
        if (!this._manualClose) this._scheduleReconnect();
      }
    }, delay);
  }
}
