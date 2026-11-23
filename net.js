/* ГАЛЬКА — сетевые лобби и синхронизация игры.
   Общий сервер: публичный MQTT-брокер. Никаких ключей и регистрации.
   Если брокер недоступен — игра остаётся офлайн-версией. */
(function (G) {
  'use strict';

  const BROKER = window.GALKA_BROKER || 'wss://broker.emqx.io:8084/mqtt';
  const PFX = 'galka5/online/v1/';
  const LOBBY_TTL = 90000;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // без I и O, чтобы не путаться
  const listeners = {};
  let client = null;
  let connected = false;
  let connectTried = false;
  let myLobby = null;
  let customNick = '';
  let refreshTimer = null;
  let startedFired = false;
  const lobbies = {};
  const selfId = 'p' + Math.random().toString(36).slice(2, 10);

  function emit(ev, data) {
    (listeners[ev] || []).slice().forEach(fn => {
      try { fn(data); } catch (e) { console.error('[net] listener', ev, e); }
    });
  }
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function off(ev, fn) {
    const a = listeners[ev]; if (!a) return;
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  function ready() { return !!(client && connected); }
  function whenReady(cb) {
    if (ready()) { cb(true); return; }
    let done = false;
    const finish = ok => { if (done) return; done = true; off('status', h); cb(ok); };
    function h(s) { if (s === 'online') finish(true); }
    on('status', h);
    setTimeout(() => finish(false), 8000);
    connect();
  }
  function nick() {
    let n = customNick;
    if (!n) {
      try { n = ((G.accounts && G.accounts.current && G.accounts.current()) || {}).nick || ''; } catch (e) {}
    }
    return String(n || '').trim();
  }

  function makeCode() {
    let c;
    do {
      c = '';
      for (let i = 0; i < 3; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    } while (lobbies[c] && Date.now() - lobbies[c].created < LOBBY_TTL);
    return c;
  }
  function pub(topic, obj, retain) {
    if (!ready()) return;
    try {
      client.publish(PFX + topic, obj == null ? '' : JSON.stringify(obj), { qos: 0, retain: !!retain });
    } catch (e) { console.warn('[net] publish failed', e); }
  }
  function sub(topic) { if (ready()) client.subscribe(PFX + topic, { qos: 0 }); }
  function unsub(topic) { if (ready()) client.unsubscribe(PFX + topic); }

  function lobbiesCopy() {
    const now = Date.now(), out = [];
    Object.keys(lobbies).forEach(code => {
      const l = lobbies[code];
      if (l && l.host && now - l.created < LOBBY_TTL) out.push(Object.assign({}, l, { code }));
    });
    out.sort((a, b) => a.created - b.created);
    return out;
  }

  function publishLobby() {
    if (!myLobby || myLobby.role !== 'host') return;
    myLobby.created = Date.now();
    pub('lobby/list/' + myLobby.code, {
      code: myLobby.code, host: myLobby.host, need: myLobby.need,
      count: Object.keys(myLobby.players).length, created: myLobby.created,
      started: !!myLobby.started
    }, true);
    pub('lobby/' + myLobby.code + '/peers', Object.assign({}, myLobby.players), true);
  }

  function announceStart(data) {
    if (!myLobby || startedFired) return;
    startedFired = true;
    myLobby.started = true;
    emit('start', data);
  }

  function handleMessage(topic, payload) {
    const p = PFX;
    if (topic.indexOf(p) === 0) {
      emit('rawmessage', { topic: topic.slice(p.length), payload: String(payload == null ? '' : payload) });
    }
    if (topic.indexOf(p + 'lobby/list/') === 0) {
      const code = topic.slice((p + 'lobby/list/').length);
      let d = null;
      try { d = payload ? JSON.parse(payload) : null; } catch (e) {}
      if (!d || !d.host || Date.now() - d.created > LOBBY_TTL) delete lobbies[code];
      else lobbies[code] = d;
      emit('lobbies', lobbiesCopy());
      return;
    }
    if (!myLobby) return;
    const base = 'lobby/' + myLobby.code + '/';
    if (topic.indexOf(p + base) !== 0) return;
    const rest = topic.slice((p + base).length);
    let d = null;
    try { d = payload ? JSON.parse(payload) : null; } catch (e) {}
    if (!d) return;

    if (rest === 'join' && myLobby.role === 'host' && !myLobby.started) {
      if (!d.id || !d.nick) return;
      myLobby.players[d.id] = String(d.nick).slice(0, 16);
      publishLobby();
      emit('roster', roster());
      if (Object.keys(myLobby.players).length >= myLobby.need + 1) {
        const start = {
          seed: Math.floor(Math.random() * 1e9),
          hostId: selfId,
          players: Object.keys(myLobby.players).map(id => ({ id, nick: myLobby.players[id] })),
          at: Date.now()
        };
        myLobby.start = start;
        pub(base + 'start', start, true);
        announceStart(start);
      }
      return;
    }
    if (rest === 'leave' && myLobby.role === 'host') {
      if (d.id && myLobby.players[d.id]) {
        delete myLobby.players[d.id];
        publishLobby();
        emit('roster', roster());
        emit('peerleft', d.id);
      }
      return;
    }
    if (rest === 'peers' && myLobby.role === 'guest') {
      myLobby.players = d || {};
      emit('roster', roster());
      return;
    }
    if (rest === 'start' && myLobby.role === 'guest') {
      myLobby.players = (d.players || []).reduce((o, x) => { o[x.id] = x.nick; return o; }, {});
      emit('roster', roster());
      announceStart(d);
      return;
    }
    if (rest === 'state' && myLobby.role === 'guest') { emit('state', d); return; }
    if (rest === 'msg') { emit('msg', d); return; }
    if (rest.indexOf('in/') === 0 && myLobby.role === 'host') {
      emit('input', { id: d.id || rest.slice(3), data: d });
    }
  }

  function connect(cb) {
    if (ready()) { cb && cb(null); return; }
    if (connectTried && client) { cb && cb(new Error('нет соединения с сервером')); return; }
    connectTried = true;
    emit('status', 'connecting');
    if (typeof mqtt === 'undefined') {
      emit('status', 'offline');
      cb && cb(new Error('библиотека сети не загрузилась'));
      return;
    }
    try {
      client = mqtt.connect(BROKER, {
        clientId: 'galka-' + selfId, clean: true, reconnectPeriod: 2500,
        connectTimeout: 12000, keepalive: 25
      });
    } catch (e) {
      emit('status', 'offline');
      cb && cb(e);
      return;
    }
    client.on('connect', () => {
      connected = true;
      sub('lobby/list/+');
      sub('accounts/user/+/#');
      sub('accounts/msg/+/#');
      emit('status', 'online');
      if (myLobby) resubscribe();
      cb && cb(null);
    });
    client.on('reconnect', () => emit('status', 'connecting'));
    client.on('offline', () => { connected = false; emit('status', 'offline'); });
    client.on('close', () => { connected = false; emit('status', 'offline'); });
    client.on('error', e => { emit('error', e); });
    client.on('message', handleMessage);
  }

  function resubscribe() {
    if (!myLobby) return;
    const base = 'lobby/' + myLobby.code + '/';
    if (myLobby.role === 'host') {
      sub(base + 'join'); sub(base + 'leave'); sub(base + 'in/+'); sub(base + 'msg');
    } else {
      sub(base + 'peers'); sub(base + 'start'); sub(base + 'state'); sub(base + 'msg');
    }
  }

  function roster() {
    if (!myLobby) return [];
    const me = { id: selfId, nick: nick() || 'ИГРОК', self: true };
    const others = Object.keys(myLobby.players)
      .filter(id => id !== selfId)
      .map(id => ({ id, nick: myLobby.players[id], self: false }));
    return [me].concat(others);
  }

  function create(need, cb) {
    const n = Math.max(1, Math.min(5, parseInt(need, 10) || 1));
    connect(err => {
      if (err) return cb && cb(err);
      leave(true);
      const host = nick() || 'ИГРОК';
      myLobby = {
        code: makeCode(), host, need: n, role: 'host', started: false,
        players: {}, created: Date.now()
      };
      myLobby.players[selfId] = host;
      startedFired = false;
      resubscribe();
      publishLobby();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(publishLobby, 15000);
      emit('created', publicLobby());
      emit('roster', roster());
      cb && cb(null, publicLobby());
    });
  }

  function join(code, cb) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (c.length !== 3) return cb && cb(new Error('код — ровно 3 буквы'));
    connect(err => {
      if (err) return cb && cb(err);
      leave(true);
      myLobby = {
        code: c, host: (lobbies[c] || {}).host || '?', need: (lobbies[c] || {}).need || 1,
        role: 'guest', players: {}, created: Date.now(), started: false
      };
      startedFired = false;
      resubscribe();
      pub('lobby/' + c + '/join', { id: selfId, nick: nick() || 'ИГРОК' });
      setTimeout(() => pub('lobby/' + c + '/join', { id: selfId, nick: nick() || 'ИГРОК' }), 700);
      emit('joined', publicLobby());
      cb && cb(null, publicLobby());
    });
  }

  function publicLobby() {
    if (!myLobby) return null;
    return {
      code: myLobby.code, host: myLobby.host, need: myLobby.need,
      role: myLobby.role, players: roster()
    };
  }

  function leave(silent) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (!myLobby) return;
    const base = 'lobby/' + myLobby.code + '/';
    if (myLobby.role === 'host') {
      pub('lobby/list/' + myLobby.code, null, true);
      pub(base + 'peers', null, true);
      pub(base + 'start', null, true);
    } else {
      pub(base + 'leave', { id: selfId });
    }
    unsub(base + 'join'); unsub(base + 'leave'); unsub(base + 'in/+');
    unsub(base + 'peers'); unsub(base + 'start'); unsub(base + 'state'); unsub(base + 'msg');
    myLobby = null;
    startedFired = false;
    if (!silent) emit('left', null);
  }

  G.net = {
    selfId, on, off, connect, whenReady, create, join, leave,
    send: pub, listen: sub, rawOn: fn => on('rawmessage', fn),
    setNick: s => { customNick = String(s || '').trim().slice(0, 16); },
    lobbies: lobbiesCopy,
    lobby: publicLobby,
    roster,
    ready,
    nick,
    status: () => connected ? 'online' : (connectTried ? 'offline' : 'idle'),
    sendInput: data => { if (myLobby) pub('lobby/' + myLobby.code + '/in/' + selfId, Object.assign({ id: selfId }, data)); },
    sendState: data => { if (myLobby && myLobby.role === 'host') pub('lobby/' + myLobby.code + '/state', data); },
    sendMsg: text => { if (myLobby) pub('lobby/' + myLobby.code + '/msg', { id: selfId, text: String(text || '').slice(0, 160) }); },
    isHost: () => !!(myLobby && myLobby.role === 'host')
  };

  window.addEventListener('beforeunload', () => leave(true));

  // Аккаунты работают сразу при загрузке страницы, даже если лобби ещё не создано.
  setTimeout(() => connect(), 200);
})(window.GALKA = window.GALKA || {});
