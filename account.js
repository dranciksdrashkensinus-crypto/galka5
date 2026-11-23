/* ГАЛЬКА — общие аккаунты, топы и админка через публичный MQTT-канал.
   Общий канал: galka5/online/v1/accounts/... — баны, топы и сообщения видны
   со всех устройств. localStorage служит кэшем и запасным вариантом без сети. */
(function (G) {
  'use strict';

  const USERS_KEY = 'galka_accounts_v2';
  const SESSION_KEY = 'galka_session_v2';
  const SEEN_KEY = 'galka_seen_v1';
  const overlay = document.getElementById('accountOverlay');
  const banner = document.getElementById('adminMessage');
  let activeTab = 'login';
  let topTab = 'completions';
  let bannerTimer = null;
  let nextMessageAt = 0;
  let lastRender = 0;
  const shared = { users: {}, msgs: {}, deleted: {} };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* file:// */ }
  }
  function session() { return read(SESSION_KEY, null); }
  function saveSession(s) { write(SESSION_KEY, s); }

  function online() { return !!(G.net && G.net.ready && G.net.ready()); }
  function send(topic, obj, retain) {
    const N = G.net;
    if (!N || !N.send) return;
    if (online()) { N.send(topic, obj, retain); return; }
    N.whenReady(ok => { if (ok) N.send(topic, obj, retain); });
  }

  /* Retained messages can be lost or overwritten. Every client periodically
     republishes its own record, and opening the tops tab asks everyone to
     do it right away — so progress is visible on all devices. */
  function publishMine() {
    if (!online()) return;
    const u = current();
    if (!u) return;
    send('accounts/user/' + u.nick + '/profile', profileOf(u.nick, u), true);
    send('accounts/user/' + u.nick + '/stats', Object.assign({ completions: 0, bestMs: 0 }, u.stats || {}), true);
    if (u.live) send('accounts/user/' + u.nick + '/live', u.live, true);
  }
  function requestSync() {
    if (!online()) return;
    send('accounts/sync/request', { at: Date.now() }, false);
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  const passHash = (nick, pass, salt) => hash('galka:' + nick.toLowerCase() + ':' + (salt || '') + ':' + pass);

  function checkPass(u, nick, pass) {
    if (u.salt) return u.pass === passHash(nick, pass, u.salt);
    return u.pass === hash('galka:' + nick.toLowerCase() + ':' + pass);
  }

  const NICK_RE = /^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9_-]{3,16}$/;
  function validNick(n) { return NICK_RE.test(n || ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function fmtTime(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function isBanActive(u) {
    if (!u || !u.banUntil) return false;
    return u.banUntil < 0 || u.banUntil > Date.now();
  }
  function banText(u) {
    if (!u || !u.banUntil) return '—';
    if (u.banUntil < 0) return 'НАВСЕГДА';
    return u.banUntil > Date.now() ? 'ДО ' + new Date(u.banUntil).toLocaleString('ru-RU') : 'ИСТЁК';
  }

  // Общее состояние = то, что пришло с сервера; локальная копия — запасной вариант.
  function users() {
    const local = read(USERS_KEY, {});
    const names = {};
    Object.keys(local).forEach(n => { names[n] = 1; });
    Object.keys(shared.users).forEach(n => { names[n] = 1; });
    const out = {};
    Object.keys(names).forEach(n => {
      if (shared.deleted[n]) return; // удалён админкой — больше не существует
      const l = local[n] || {};
      const s = shared.users[n] || {};
      const p = s.profile || {};
      const has = !!(s.profile || s.stats || s.live);
      out[n] = Object.assign({}, l, {
        nick: n,
        salt: has ? (p.salt || l.salt || '') : (l.salt || ''),
        pass: has ? (p.pass || l.pass || '') : (l.pass || ''),
        isAdmin: has ? (p.isAdmin != null ? !!p.isAdmin : !!l.isAdmin) : !!l.isAdmin,
        created: has ? (p.created || l.created || 0) : (l.created || 0),
        banUntil: has ? (p.banUntil != null ? p.banUntil : (l.banUntil || 0)) : (l.banUntil || 0),
        banReason: p.banReason || l.banReason || '',
        stats: s.stats || l.stats || { completions: 0, bestMs: 0 },
        live: s.live !== undefined ? s.live : (l.live || null),
        online: has
          ? !!(s.live && s.live.online !== false && Date.now() - (s.live.at || 0) < 120000)
          : !!l.online
      });
    });
    return out;
  }

  // Если два игрока зарегистрировались одновременно, админом становится
  // самый ранний аккаунт с пометкой isAdmin — результат одинаков у всех.
  function adminNick() {
    const all = users();
    const claims = Object.keys(all).filter(n => all[n].isAdmin);
    if (!claims.length) return '';
    claims.sort((a, b) => (all[a].created || 0) - (all[b].created || 0) || a.localeCompare(b));
    return claims[0];
  }
  function current() {
    const s = session();
    if (!s || !s.nick) return null;
    return users()[s.nick] || null;
  }
  function isAdmin() {
    const u = current(), a = adminNick();
    return !!(u && a && u.nick === a);
  }
  function onlineNow(u) {
    return !!(u && u.online && u.live && Date.now() - (u.live.at || 0) < 120000);
  }

  function profileOf(nick, u) {
    return {
      nick, salt: u.salt || '', pass: u.pass || '',
      isAdmin: !!u.isAdmin, created: u.created || Date.now(),
      banUntil: u.banUntil || 0, banReason: u.banReason || ''
    };
  }
  function writeProfile(nick, patch) {
    const merged = Object.assign({}, (users()[nick] || {}), patch);
    const prof = profileOf(nick, merged);
    const local = read(USERS_KEY, {});
    local[nick] = Object.assign({}, local[nick] || {}, prof);
    write(USERS_KEY, local);
    shared.users[nick] = shared.users[nick] || {};
    shared.users[nick].profile = prof;
    send('accounts/user/' + nick + '/profile', prof, true);
    afterChange();
  }
  function writeStats(nick, stats) {
    const s = Object.assign({ completions: 0, bestMs: 0 }, stats);
    const local = read(USERS_KEY, {});
    local[nick] = Object.assign({}, local[nick] || {}, { stats: s });
    write(USERS_KEY, local);
    shared.users[nick] = shared.users[nick] || {};
    shared.users[nick].stats = s;
    send('accounts/user/' + nick + '/stats', s, true);
    afterChange();
  }
  function writeLive(nick, live) {
    const local = read(USERS_KEY, {});
    local[nick] = Object.assign({}, local[nick] || {}, { live, online: live.online !== false });
    write(USERS_KEY, local);
    shared.users[nick] = shared.users[nick] || {};
    shared.users[nick].live = live;
    if (online()) send('accounts/user/' + nick + '/live', live, true);
  }
  function sendMsg(nick, text) {
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const m = {
      id, text: String(text || '').slice(0, 160), at: Date.now(),
      from: ((session() || {}).nick) || ''
    };
    send('accounts/msg/' + nick + '/' + id, m, true);
    afterChange();
  }

  function afterChange() {
    const now = Date.now();
    if (now - lastRender < 90) return;
    lastRender = now;
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.toggle('hidden', !isAdmin());
    updateNetBadge();
    if (isOpen()) {
      if (activeTab === 'tops') renderTops();
      if (activeTab === 'admin') renderAdmin();
    }
  }

  function build() {
    if (!overlay) return;
    overlay.innerHTML = [
      '<div class="account-card">',
      '  <button class="acc-close" data-action="close" aria-label="Закрыть">×</button>',
      '  <h2>ГАЛЬКА · АККАУНТ</h2>',
      '  <div id="accNet" class="acc-note">Сервер аккаунтов: подключение…</div>',
      '  <div class="acc-msg" id="accMsg"></div>',
      '  <div class="acc-tabs">',
      '    <button data-tab="login" class="active">ВХОД</button>',
      '    <button data-tab="register">РЕГИСТРАЦИЯ</button>',
      '    <button data-tab="tops">ТОПЫ</button>',
      '    <button data-tab="admin" id="accAdminTab" class="hidden">АДМИНКА</button>',
      '  </div>',
      '  <section class="acc-panel" data-panel="login">',
      '    <label>НИК (RU / EN / UA)<input id="loginNick" maxlength="16" autocomplete="username"></label>',
      '    <label>ПАРОЛЬ<input id="loginPass" type="password" autocomplete="current-password"></label>',
      '    <div class="acc-buttons"><button data-action="login" class="primary">ВОЙТИ</button><button data-action="logout">ВЫЙТИ</button></div>',
      '    <p class="acc-note">Аккаунты общие для всех устройств. Первый зарегистрированный — админ.</p>',
      '  </section>',
      '  <section class="acc-panel hidden" data-panel="register">',
      '    <label>НИК (RU / EN / UA, 3–16)<input id="regNick" maxlength="16" autocomplete="username"></label>',
      '    <label>ПАРОЛЬ (от 4 символов)<input id="regPass" type="password" autocomplete="new-password"></label>',
      '    <label>ПОВТОРИ ПАРОЛЬ<input id="regPass2" type="password" autocomplete="new-password"></label>',
      '    <div class="acc-buttons"><button data-action="register" class="primary">ЗАРЕГИСТРИРОВАТЬСЯ</button></div>',
      '    <p class="acc-note">Можно смешивать английские, русские и украинские буквы.</p>',
      '  </section>',
      '  <section class="acc-panel hidden" data-panel="tops">',
      '    <div class="top-tabs">',
      '      <button data-top="completions" class="active">ПО ПРОХОЖДЕНИЯМ</button>',
      '      <button data-top="speed">ПО СКОРОСТИ</button>',
      '      <button data-top="unknown">В РАЗРАБОТКЕ</button>',
      '    </div>',
      '    <div id="topList" class="acc-list"></div>',
      '  </section>',
      '  <section class="acc-panel hidden" data-panel="admin">',
      '    <p class="acc-note">ИГРОКИ СО ВСЕХ УСТРОЙСТВ. Бан и текст приходят на их экран.</p>',
      '    <label>ТЕКСТ НА ЭКРАН ИГРОКА<input id="adminText" maxlength="160" placeholder="Например: Галька, иди в класс"></label>',
      '    <div id="adminList" class="acc-list"></div>',
      '    <div class="acc-buttons"><button data-action="refreshAdmin">ОБНОВИТЬ</button></div>',
      '  </section>',
      '</div>'
    ].join('');
    updateNetBadge();
  }

  function updateNetBadge() {
    const el = document.getElementById('accNet');
    if (!el) return;
    const st = G.net ? G.net.status() : 'idle';
    el.textContent = 'СЕРВЕР АККАУНТОВ: ' + (
      st === 'online' ? 'ОНЛАЙН — баны, топы и админка общие для всех устройств'
        : st === 'connecting' ? 'ПОДКЛЮЧЕНИЕ…'
          : 'НЕТ СВЯЗИ — пока работает только этот браузер'
    );
    el.classList.toggle('bad', st !== 'online');
  }

  function msg(text, bad) {
    const el = document.getElementById('accMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }
  function setTab(tab) {
    activeTab = tab;
    if (!overlay) return;
    overlay.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    overlay.querySelectorAll('.acc-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    msg('');
    if (tab === 'tops') { requestSync(); renderTops(); }
    if (tab === 'admin') renderAdmin();
  }
  function isOpen() { return !!(overlay && !overlay.classList.contains('hidden')); }
  function open() {
    if (!overlay) return;
    build();
    requestSync();
    overlay.classList.remove('hidden');
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.toggle('hidden', !isAdmin());
    setTab(activeTab || 'login');
    const nick = document.getElementById(activeTab === 'register' ? 'regNick' : 'loginNick');
    if (nick) try { nick.focus(); } catch (e) {}
  }
  function close() { if (overlay) overlay.classList.add('hidden'); }

  function showBanner(text) {
    if (!banner) return;
    banner.textContent = text;
    banner.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 6000);
  }

  function doRegister() {
    const nick = (document.getElementById('regNick').value || '').trim();
    const pass = document.getElementById('regPass').value || '';
    const pass2 = document.getElementById('regPass2').value || '';
    const all = users();
    if (!validNick(nick)) return msg('НИК: только RU/EN/UA буквы, цифры, _ и -, от 3 до 16.', true);
    if (all[nick]) return msg('Этот ник уже занят на сервере.', true);
    if (pass.length < 4) return msg('ПАРОЛЬ: минимум 4 символа.', true);
    if (pass !== pass2) return msg('Пароли не совпадают.', true);
    const salt = hash(nick + ':' + Date.now() + ':' + Math.random());
    const created = Date.now();
    const first = !Object.keys(all).some(n => all[n].isAdmin);
    writeProfile(nick, {
      nick, salt, pass: passHash(nick, pass, salt),
      isAdmin: first, created, banUntil: 0, banReason: ''
    });
    writeStats(nick, { completions: 0, bestMs: 0 });
    writeLive(nick, { online: true, at: created, room: '', quests: 0, max: 0, bosses: 0, hp: 0 });
    saveSession({ nick, loginAt: created });
    publishMine();
    requestSync();
    document.getElementById('regPass').value = '';
    document.getElementById('regPass2').value = '';
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.toggle('hidden', !isAdmin());
    msg('ГОТОВО. Ты вошёл' + (isAdmin() ? '. Твой аккаунт — админский.' : '.'));
    setTab('login');
  }

  function doLogin() {
    const nick = (document.getElementById('loginNick').value || '').trim();
    const pass = document.getElementById('loginPass').value || '';
    const all = users(), user = all[nick];
    if (!user) return msg('Нет такого ника. Зарегистрируйся.', true);
    const wasLegacy = !user.salt;
    if (!checkPass(user, nick, pass)) return msg('Неверный пароль.', true);
    if (wasLegacy) {
      const newSalt = hash(nick + ':' + Date.now() + ':' + Math.random());
      writeProfile(nick, { salt: newSalt, pass: passHash(nick, pass, newSalt) });
    }
    if (isBanActive(user)) return msg('Аккаунт забанен: ' + banText(user), true);
    const old = user.live || {};
    writeLive(nick, Object.assign({}, old, { online: true, at: Date.now() }));
    saveSession({ nick, loginAt: Date.now() });
    publishMine();
    requestSync();
    document.getElementById('loginPass').value = '';
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.toggle('hidden', !isAdmin());
    msg('ВХОЙ ВЫПОЛНЕН: ' + nick);
  }

  function doLogout() {
    const s = session();
    if (s && s.nick) {
      const u = users()[s.nick];
      writeLive(s.nick, Object.assign({}, (u && u.live) || {}, { online: false, at: Date.now() }));
    }
    saveSession(null);
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.add('hidden');
    msg('Ты вышел из аккаунта.');
  }

  function renderTops() {
    const box = document.getElementById('topList');
    if (!box) return;
    overlay.querySelectorAll('[data-top]').forEach(b => b.classList.toggle('active', b.dataset.top === topTab));
    if (topTab === 'unknown') {
      box.innerHTML = '<div class="acc-empty">В РАЗРАБОТКЕ<br><br>Третий топ появится позже.</div>';
      return;
    }
    const all = Object.values(users());
    let list;
    if (topTab === 'completions') {
      list = all.sort((a, b) => (b.stats.completions || 0) - (a.stats.completions || 0));
      box.innerHTML = list.length
        ? list.map((u, i) => '<div class="top-row"><b>' + (i + 1) + '.</b> ' + esc(u.nick) + '<span>' + (u.stats.completions || 0) + ' прох.</span></div>').join('')
        : '<div class="acc-empty">Пока нет записей.</div>';
    } else {
      list = all.filter(u => u.stats.bestMs > 0).sort((a, b) => a.stats.bestMs - b.stats.bestMs);
      box.innerHTML = list.length
        ? list.map((u, i) => '<div class="top-row"><b>' + (i + 1) + '.</b> ' + esc(u.nick) + '<span>' + fmtTime(u.stats.bestMs) + '</span></div>').join('')
        : '<div class="acc-empty">Пока никто не дошёл до конца.</div>';
    }
  }

  function renderAdmin() {
    const box = document.getElementById('adminList');
    if (!box || !isAdmin()) return;
    const u = users(), admin = adminNick();
    const names = Object.keys(u).sort();
    box.innerHTML = names.length ? names.map(n => {
      const x = u[n], live = x.live || {};
      const progress = live.room ? esc(live.room) + ' · квесты ' + (live.quests || 0) + '/' + ((G.QUESTS || []).length) + ' · боссы ' + (live.bosses || 0) + '/5' : 'нет данных';
      return [
        '<div class="admin-row" data-nick="' + esc(n) + '">',
        '  <div class="admin-name">' + esc(n) + (n === admin ? ' ★' : '') + ' <small>' + (onlineNow(x) ? 'ОНЛАЙН' : 'офлайн') + '</small></div>',
        '  <div class="admin-progress">' + progress + '</div>',
        '  <div class="admin-progress">БАН: ' + banText(x) + '</div>',
        '  <div class="admin-actions">',
        '    <button data-action="ban" data-nick="' + esc(n) + '">БАН</button>',
        '    <button data-action="ban1h" data-nick="' + esc(n) + '">БАН 1Ч</button>',
        '    <button data-action="unban" data-nick="' + esc(n) + '">РАЗБАН</button>',
        '    <button data-action="send" data-nick="' + esc(n) + '">ТЕКСТ</button>',
        n === admin ? '' : '    <button data-action="delete" data-nick="' + esc(n) + '" class="danger">УДАЛИТЬ</button>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('') : '<div class="acc-empty">Нет аккаунтов.</div>';
  }

  function mutate(nick, fn) {
    const all = users();
    if (!all[nick]) return;
    const obj = Object.assign({}, all[nick]);
    fn(obj);
    writeProfile(nick, obj);
    renderAdmin();
  }

  /* Админ может удалить любой чужой аккаунт. Свой — никогда.
     «Могила» рассылается retain-сообщением, поэтому удалённый игрок на всех
     устройствах разлогинивается и не может заново записать свой профиль. */
  function deleteAccount(nick) {
    if (!isAdmin()) return msg('Только админ может удалять аккаунты.', true);
    if (!nick || nick === ((session() || {}).nick)) return msg('Нельзя удалить свой аккаунт.', true);
    const stamp = { deleted: true, at: Date.now(), by: ((session() || {}).nick) || '' };
    const local = read(USERS_KEY, {});
    delete local[nick];
    write(USERS_KEY, local);
    delete shared.users[nick];
    shared.deleted[nick] = stamp.at;
    send('accounts/user/' + nick + '/profile', stamp, true);
    send('accounts/user/' + nick + '/stats', null, true);
    send('accounts/user/' + nick + '/live', null, true);
    if (current() && current().nick === nick) doLogout();
    msg('АККАУНТ УДАЛЁН: ' + nick);
    renderAdmin();
  }

  if (overlay) {
    build();
    overlay.addEventListener('click', e => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
      const topBtn = e.target.closest('[data-top]');
      if (topBtn) { topTab = topBtn.dataset.top; requestSync(); renderTops(); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.dataset.action, nick = btn.dataset.nick;
      if ((act === 'ban' || act === 'ban1h') && nick === ((session() || {}).nick)) {
        msg('Нельзя забанить самого себя.', true);
        return;
      }
      if (act === 'delete' && nick === ((session() || {}).nick)) {
        msg('Нельзя удалить свой аккаунт.', true);
        return;
      }
      if (act === 'close') close();
      else if (act === 'register') doRegister();
      else if (act === 'login') doLogin();
      else if (act === 'logout') doLogout();
      else if (act === 'refreshAdmin') renderAdmin();
      else if (act === 'ban') mutate(nick, x => { x.banUntil = -1; x.online = false; });
      else if (act === 'ban1h') mutate(nick, x => { x.banUntil = Date.now() + 3600000; });
      else if (act === 'unban') mutate(nick, x => { x.banUntil = 0; });
      else if (act === 'delete') deleteAccount(nick);
      else if (act === 'send') {
        const inp = document.getElementById('adminText');
        const text = (inp && inp.value || '').trim();
        if (!text) { msg('Введи текст для игрока.', true); return; }
        sendMsg(nick, text);
        if (inp) inp.value = '';
        msg('Текст отправлен: ' + nick);
      }
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (activeTab === 'login') doLogin();
        else if (activeTab === 'register') doRegister();
      }
      if (e.key === 'Escape') close();
    });
  }

  function tick() {
    const u = current();
    if (!u) return false;
    if (isBanActive(u)) {
      showBanner('АККАУНТ ЗАБАНЕН' + (u.banUntil > 0 ? ' ДО ' + new Date(u.banUntil).toLocaleString('ru-RU') : ' НАВСЕГДА') + '. Игра остановлена.');
      return true;
    }
    const inbox = shared.msgs[u.nick] || {};
    const seen = read(SEEN_KEY, {});
    const pending = Object.keys(inbox)
      .filter(id => !seen[id] && inbox[id] && inbox[id].text)
      .map(id => inbox[id])
      .sort((a, b) => (a.at || 0) - (b.at || 0));
    if (pending.length && Date.now() >= nextMessageAt) {
      const m = pending[0];
      seen[m.id] = 1;
      write(SEEN_KEY, seen);
      nextMessageAt = Date.now() + 6200;
      showBanner('СООБЩЕНИЕ: ' + m.text);
      return false;
    }
    if (u.messages && u.messages.length && Date.now() >= nextMessageAt) {
      const m = u.messages.shift();
      const all = users();
      if (all[u.nick]) {
        const local = read(USERS_KEY, {});
        if (local[u.nick]) { local[u.nick].messages = u.messages; write(USERS_KEY, local); }
      }
      nextMessageAt = Date.now() + 6200;
      showBanner('СООБЩЕНИЕ: ' + m.text);
    }
    return false;
  }

  function recordCompletion(game) {
    const u = current();
    if (!u) return;
    const stats = Object.assign({ completions: 0, bestMs: 0 }, u.stats || {});
    stats.completions = (stats.completions || 0) + 1;
    const spent = Math.max(1000, Date.now() - (game.startedAt || Date.now()));
    if (!stats.bestMs || spent < stats.bestMs) stats.bestMs = spent;
    writeStats(u.nick, stats);
  }

  function updateLive(game) {
    const u = current();
    if (!u) return;
    const r = (G.rooms && G.rooms[game.roomId]) || {};
    writeLive(u.nick, {
      online: true,
      room: r.name || game.roomId,
      quests: game.questsDone || 0,
      max: (G.QUESTS || []).length,
      bosses: Object.keys(game.defeated || {}).length,
      hp: game.hp,
      at: Date.now()
    });
  }

  // Подписываемся на общий канал. Retained-сообщения сразу дадут актуальный список.
  if (G.net && G.net.rawOn) {
    G.net.rawOn(d => {
      const parts = String(d.topic || '').split('/');
      let val = null;
      try { val = d.payload ? JSON.parse(d.payload) : null; } catch (e) { val = null; }
      if (parts[0] === 'accounts' && parts[1] === 'user' && parts.length >= 4) {
        const nick = parts[2], kind = parts[3];
        if (kind === 'profile' && val && val.deleted) {
          shared.deleted[nick] = val.at || Date.now();
          delete shared.users[nick];
          const local = read(USERS_KEY, {});
          delete local[nick];
          write(USERS_KEY, local);
          const s = session();
          if (s && s.nick === nick) {
            saveSession(null);
            showBanner('АККАУНТ УДАЛЁН АДМИНИСТРАТОРОМ. ЗАРЕГИСТРИРУЙСЯ ЗАНОВО.');
          }
          afterChange();
          return;
        }
        if (kind === 'profile' && shared.deleted[nick] && !(val && val.created > shared.deleted[nick])) return;
        shared.users[nick] = shared.users[nick] || {};
        shared.users[nick][kind] = val;
        const rec = shared.users[nick];
        if (!rec.profile && !rec.stats && !rec.live) delete shared.users[nick];
        afterChange();
      } else if (parts[0] === 'accounts' && parts[1] === 'msg' && parts.length >= 4) {
        const nick = parts[2], id = parts[3];
        shared.msgs[nick] = shared.msgs[nick] || {};
        if (val) shared.msgs[nick][id] = val; else delete shared.msgs[nick][id];
        afterChange();
      } else if (parts[0] === 'accounts' && parts[1] === 'sync' && parts[2] === 'request') {
        publishMine();
      }
    });
    G.net.on('status', updateNetBadge);
    G.net.whenReady(ok => {
      if (!ok) return;
      G.net.listen('accounts/user/+/#');
      G.net.listen('accounts/msg/+/#');
      G.net.listen('accounts/sync/#');
      publishMine();
      requestSync();
      setInterval(() => { publishMine(); }, 15000);
      setInterval(() => { requestSync(); }, 30000);
      updateNetBadge();
    });
  }

  window.addEventListener('beforeunload', () => {
    const s = session();
    if (!s || !s.nick) return;
    const u = users()[s.nick];
    writeLive(s.nick, Object.assign({}, (u && u.live) || {}, { online: false, at: Date.now() }));
  });

  G.accounts = {
    open, close, isOpen, tick, recordCompletion, updateLive,
    isAdmin, current, users, deleteAccount,
    hideAdminTab: () => { const t = document.getElementById('accAdminTab'); if (t) t.classList.add('hidden'); }
  };
})(window.GALKA = window.GALKA || {});
