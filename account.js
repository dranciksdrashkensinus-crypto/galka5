/* ГАЛЬКА — общие аккаунты, топы и админка через публичный MQTT-канал.
   Общий канал: galka5/online/v1/accounts/... — баны, топы и сообщения видны
   со всех устройств. localStorage служит кэшем и запасным вариантом без сети. */
(function (G) {
  'use strict';

  const USERS_KEY = 'galka_accounts_v2';
  const SESSION_KEY = 'galka_session_v2';
  const SEEN_KEY = 'galka_seen_v1';
  const VOTES_KEY = 'galka_board_votes_v1';
  const BOARD_KEY = 'galka_board_v1';
  const RESULT_KEY = 'galka_board_result_v1';
  const CREDS_KEY = 'galka_creds_v1';
  /* Владелец админки закреплён за аккаунтом MEKIO. Публичный MQTT не даёт
     надёжно хранить права: любой сохранённый профиль мог перезаписать флаг
     isAdmin, поэтому право проверяется по нику, а не по сетевым данным. */
  const ADMIN_NICK = 'MEKIO';
  const ADMIN_RECOVERY = 'ГАЛЬКА-МЕКИО-2026';
  function isAdminNick(nick) { return String(nick || '').toUpperCase() === ADMIN_NICK; }
  const overlay = document.getElementById('accountOverlay');
  const banner = document.getElementById('adminMessage');
  let activeTab = 'login';
  let topTab = 'completions';
  let bannerTimer = null;
  let nextMessageAt = 0;
  let lastRender = 0;
  const shared = { users: {}, msgs: {}, deleted: {} };
  /* Administrative board: notices and polls are retained on the MQTT topic,
     so they hang on the screens of everyone who opens the game. */
  const board = {};
  let boardEnd = null;
  let boardResult = null;
  let boardVotes = read(VOTES_KEY, {});
  const lastActive = { notice: '', poll: '' };
  const defaultStats = () => ({
    completions: 0, bestMs: 0,
    ch2Completions: 0, ch2BestMs: 0, ch2Fights: 0
  });

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
    send('accounts/user/' + u.nick + '/stats', Object.assign(defaultStats(), u.stats || {}), true);
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

  /* Пароль хранится локально отдельно от общего профиля: публичный канал
     мог перезаписать соль или хэш, из-за чего верный пароль не подходил. */
  function allCreds() { return read(CREDS_KEY, {}); }
  function credFor(nick) { return allCreds()[nick] || null; }
  function saveCreds(nick, salt, pass) {
    const all = allCreds();
    all[nick] = { salt, pass };
    write(CREDS_KEY, all);
  }
  function passMatches(rec, nick, pass) {
    if (!rec) return false;
    if (rec.salt) return rec.pass === passHash(nick, pass, rec.salt);
    return rec.pass === hash('galka:' + nick.toLowerCase() + ':' + pass);
  }
  function matchedCred(nick, pass) {
    const local = read(USERS_KEY, {})[nick] || null;
    const remote = (shared.users[nick] || {}).profile || null;
    const list = [credFor(nick), local, users()[nick], remote];
    for (let i = 0; i < list.length; i++) if (passMatches(list[i], nick, pass)) return list[i];
    return null;
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
        salt: (credFor(n) || {}).salt || l.salt || (has ? p.salt : '') || '',
        pass: (credFor(n) || {}).pass || l.pass || (has ? p.pass : '') || '',
        isAdmin: isAdminNick(n),
        created: has ? (p.created || l.created || 0) : (l.created || 0),
        banUntil: has ? (p.banUntil != null ? p.banUntil : (l.banUntil || 0)) : (l.banUntil || 0),
        banReason: p.banReason || l.banReason || '',
        stats: Object.assign(defaultStats(), s.stats || l.stats || {}),
        live: s.live !== undefined ? s.live : (l.live || null),
        online: has
          ? !!(s.live && s.live.online !== false && Date.now() - (s.live.at || 0) < 120000)
          : !!l.online
      });
    });
    return out;
  }

  // Админ всегда один и тот же аккаунт — MEKIO. Остальные профили, даже если
  // в них осталась старая пометка isAdmin, прав не получают.
  function adminNick() { return ADMIN_NICK; }
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
      isAdmin: isAdminNick(nick), created: u.created || Date.now(),
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
    const s = Object.assign(defaultStats(), stats);
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
      '    <p class="acc-note">Аккаунты общие для всех устройств. Админ — аккаунт MEKIO.</p>',
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
      '      <button data-top="ch2">ГЛАВА 2</button>',
      '      <button data-top="unknown">В РАЗРАБОТКЕ</button>',
      '    </div>',
      '    <div id="topList" class="acc-list"></div>',
      '  </section>',
      '  <section class="acc-panel hidden" data-panel="admin">',
      '    <p class="acc-note">ИГРОКИ СО ВСЕХ УСТРОЙСТВ. Бан, текст, объявления и опросы приходят на их экран.</p>',
      '    <div class="acc-buttons">',
      '      <button data-action="toggleNotice">ОБЪЯВЛЕНИЕ</button>',
      '      <button data-action="togglePoll">ВОПРОС</button>',
      '    </div>',
      '    <div class="board-form" data-board="notice">',
      '      <label>ОБЪЯВЛЕНИЕ ВСЕМ<input id="adminNoticeText" maxlength="160" placeholder="Например: Галька, иди в класс"></label>',
      '      <label>ВРЕМЯ, МИНУТ (1–1440)<input id="adminNoticeMin" type="number" min="1" max="1440" value="5"></label>',
      '      <div class="acc-buttons"><button data-action="sendNotice" class="primary">ОПУБЛИКОВАТЬ</button></div>',
      '      <div id="adminNoticeList" class="acc-list"></div>',
      '    </div>',
      '    <div class="board-form hidden" data-board="poll">',
      '      <label>ВОПРОС<input id="adminPollQuestion" maxlength="160" placeholder="Например: солнце зелёное или жёлтое?"></label>',
      '      <label>ВАРИАНТЫ ОТВЕТА: ДО 10, ПО ОДНОМУ В СТРОКУ<textarea id="adminPollOptions" rows="6" placeholder="Зелёное&#10;Жёлтое"></textarea></label>',
      '      <label>ВРЕМЯ, МИНУТ (1–1440)<input id="adminPollMin" type="number" min="1" max="1440" value="3"></label>',
      '      <div class="acc-buttons"><button data-action="sendPoll" class="primary">ОПУБЛИКОВАТЬ</button></div>',
      '      <div id="adminPollList" class="acc-list"></div>',
      '    </div>',
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

  /* ---------- общая доска: объявления и опросы для всех игроков ---------- */

  function boardList() {
    return Object.keys(board).map(k => board[k]).sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  /* Cache keeps notices and polls on screen after a reload or while offline.
     Expired records are dropped, so a stale copy can never come back. */
  function saveBoardCache() { write(BOARD_KEY, board); }
  function loadBoardCache() {
    const cached = read(BOARD_KEY, {}), now = Date.now();
    Object.keys(cached || {}).forEach(id => {
      if (cached[id] && cached[id].until > now) board[id] = cached[id];
    });
    boardResult = read(RESULT_KEY, null);
    saveBoardCache();
  }
  function myNick() {
    const s = session();
    return String((s && s.nick) || (G.net && G.net.nick && G.net.nick()) ||
      ('ГОСТЬ-' + String((G.net && G.net.selfId) || '0000').slice(-4))).slice(0, 16);
  }
  function voteCounts(poll) {
    const votes = boardVotes[poll.id] || {};
    const counts = (poll.options || []).map(() => 0);
    Object.keys(votes).forEach(n => {
      const i = votes[n] && votes[n].option;
      if (Number.isInteger(i) && counts[i] != null) counts[i]++;
    });
    return counts;
  }
  function winnerText(poll) {
    const counts = voteCounts(poll), total = counts.reduce((a, b) => a + b, 0);
    if (!total) return 'ИТОГИ ОПРОСА: НИКТО НЕ ПРОГОЛОСОВАЛ';
    const top = Math.max.apply(Math, counts);
    const winners = counts.map((n, i) => n === top ? i : -1).filter(i => i >= 0);
    if (winners.length > 1) {
      return 'ИТОГИ ОПРОСА: НЕОПРЕДЕЛЁННО · ПО ' + top + ' ГОЛОС(ОВ) У ВАРИАНТОВ ' +
        winners.map(i => (i + 1) + ' «' + poll.options[i] + '»').join(', ');
    }
    const i = winners[0];
    return 'ИТОГИ ОПРОСА: ПОБЕДИЛ ВАРИАНТ ' + (i + 1) + ' «' + poll.options[i] + '» · ' + top + ' ГОЛОС(ОВ)';
  }
  function finishPoll(poll) {
    boardResult = { id: poll.id, text: winnerText(poll), until: Date.now() + 60000 };
    write(RESULT_KEY, boardResult);
    /* Retained result lets an admin who was offline when the poll closed
       still see who won after opening or reloading the page. */
    if (isAdmin()) send('accounts/board/' + poll.id + '/result', boardResult, true);
  }
  function clearVotes(id) {
    const votes = boardVotes[id] || {};
    Object.keys(votes).forEach(n => send('accounts/board/' + id + '/votes/' + n, null, true));
    delete boardVotes[id];
    write(VOTES_KEY, boardVotes);
  }
  function castVote(id, option) {
    const cur = board[id];
    if (!cur || cur.kind !== 'poll' || !Number.isInteger(option)) return;
    const voter = myNick();
    const v = { nick: voter, option, at: Date.now() };
    boardVotes[id] = boardVotes[id] || {};
    boardVotes[id][voter] = v;
    write(VOTES_KEY, boardVotes);
    send('accounts/board/' + id + '/votes/' + voter, v, true);
    renderBoard();
    renderAdminBoards();
  }
  function pubBoard(obj) {
    board[obj.id] = obj;
    saveBoardCache();
    if (obj.kind === 'poll') {
      boardResult = null;
      try { localStorage.removeItem(RESULT_KEY); } catch (e) {}
      send('accounts/board/' + obj.id + '/result', null, true);
    }
    send('accounts/board/' + obj.id, obj, true);
    renderAdminBoards();
    renderBoard();
  }
  function minutes(id, fallback) {
    const el = document.getElementById(id);
    const n = Math.min(1440, Math.max(1, parseInt(el && el.value, 10) || fallback));
    if (el) el.value = n;
    return n;
  }
  function sendNotice() {
    if (!isAdmin()) return msg('Только админ может публиковать объявления.', true);
    const el = document.getElementById('adminNoticeText');
    const text = ((el && el.value) || '').trim().slice(0, 160);
    if (!text) return msg('Введи текст объявления.', true);
    const min = minutes('adminNoticeMin', 5);
    const at = Date.now();
    pubBoard({
      id: 'n' + at.toString(36) + Math.random().toString(36).slice(2, 5),
      kind: 'notice', text, at, until: at + min * 60000,
      from: ((session() || {}).nick) || ''
    });
    if (el) el.value = '';
    msg('ОБЪЯВЛЕНИЕ НА ЭКРАНАХ ВСЕХ · ' + min + ' МИН.');
  }
  function sendPoll() {
    if (!isAdmin()) return msg('Только админ может создавать опросы.', true);
    const qEl = document.getElementById('adminPollQuestion');
    const oEl = document.getElementById('adminPollOptions');
    const question = ((qEl && qEl.value) || '').trim().slice(0, 160);
    const options = String((oEl && oEl.value) || '')
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (!question || options.length < 2) return msg('Вопрос и минимум два варианта ответа — обязательно.', true);
    const min = minutes('adminPollMin', 3);
    const at = Date.now();
    pubBoard({
      id: 'p' + at.toString(36) + Math.random().toString(36).slice(2, 5),
      kind: 'poll', question, options, at, until: at + min * 60000,
      from: ((session() || {}).nick) || ''
    });
    if (qEl) qEl.value = '';
    if (oEl) oEl.value = '';
    msg('ОПРОС НА ЭКРАНАХ ВСЕХ · ' + options.length + ' ВАРИАНТОВ · ' + min + ' МИН.');
  }
  function removeBoard(id) {
    if (!isAdmin()) return msg('Только админ может удалять сообщения.', true);
    const it = board[id];
    if (!it) return;
    if (it.kind === 'poll') finishPoll(it);
    clearVotes(id);
    delete board[id];
    saveBoardCache();
    lastActive[it.kind] = '';
    send('accounts/board/' + id, null, true);
    boardEnd = {
      kind: it.kind,
      text: it.kind === 'notice' ? 'ОБЪЯВЛЕНИЕ УДАЛЕНО АДМИНИСТРАТОРОМ' : 'ОПРОС УДАЛЁН АДМИНИСТРАТОРОМ',
      until: Date.now() + 3500
    };
    renderAdminBoards();
    renderBoard();
    msg('УДАЛЕНО С ЭКРАНОВ ВСЕХ ИГРОКОВ.');
  }
  function toggleBoard(kind) {
    const el = overlay && overlay.querySelector('[data-board="' + kind + '"]');
    if (el) el.classList.toggle('hidden');
  }

  function renderAdminBoards() {
    if (!isAdmin()) return;
    const list = boardList(), now = Date.now();
    const notices = list.filter(x => x.kind === 'notice');
    const polls = list.filter(x => x.kind === 'poll');
    const nBox = document.getElementById('adminNoticeList');
    const pBox = document.getElementById('adminPollList');
    if (nBox) nBox.innerHTML = notices.length ? notices.map(x =>
      '<div class="board-entry">' + esc(x.text) + ' <small>· ' + fmtTime(x.until - now) + '</small>' +
      '<button data-action="delNotice" data-id="' + esc(x.id) + '">УДАЛИТЬ</button></div>').join('')
      : '<div class="acc-empty">Нет активных объявлений.</div>';
    if (pBox) pBox.innerHTML = polls.length ? polls.map(x => {
      const votes = boardVotes[x.id] || {};
      const voters = Object.keys(votes).map(n =>
        esc(n) + ' → ' + ((votes[n] && votes[n].option != null)
          ? (votes[n].option + 1) + '. ' + esc((x.options || [])[votes[n].option] || '') : '—'));
      return '<div class="board-entry">' + esc(x.question) + ' <small>· ' + (x.options || []).length +
        ' вар. · ' + fmtTime(x.until - now) + '</small>' +
        '<button data-action="delPoll" data-id="' + esc(x.id) + '">ЗАКРЫТЬ</button>' +
        '<div class="admin-progress">ГОЛОСА: ' + (voters.length ? voters.join(' · ') : 'пока никто не голосовал') + '</div>' +
        '</div>';
    }).join('') : '<div class="acc-empty">Нет активных опросов.</div>';
  }

  function renderBoard() {
    const now = Date.now();
    /* Expired items are gone everywhere; show a short "finished" line. */
    Object.keys(board).forEach(id => {
      const it = board[id];
      if (it && it.until > now) return;
      if (it && lastActive[it.kind] === id) {
        boardEnd = {
          kind: it.kind,
          text: it.kind === 'notice' ? 'ОБЪЯВЛЕНИЕ ЗАВЕРШЕНО' : 'ОПРОС ЗАВЕРШЁН',
          until: now + 3500
        };
        if (it.kind === 'poll') finishPoll(it);
        lastActive[it.kind] = '';
      }
      if (it && it.kind === 'poll') clearVotes(id);
      delete board[id];
      saveBoardCache();
    });

    const noticeEl = document.getElementById('adminNotice');
    const pollEl = document.getElementById('adminPoll');
    const resultEl = document.getElementById('adminResult');
    const notice = boardList().filter(x => x.kind === 'notice')[0];
    const poll = boardList().filter(x => x.kind === 'poll')[0];

    if (noticeEl) {
      if (notice) {
        lastActive.notice = notice.id;
        noticeEl.innerHTML = '📢 ' + esc(notice.text) +
          '<small> · ОСТАЛОСЬ ' + fmtTime(notice.until - now) + '</small>';
        noticeEl.classList.remove('hidden');
      } else if (boardEnd && boardEnd.kind === 'notice' && boardEnd.until > now) {
        noticeEl.textContent = boardEnd.text;
        noticeEl.classList.remove('hidden');
      } else noticeEl.classList.add('hidden');
    }

    if (pollEl) {
      if (poll) {
        lastActive.poll = poll.id;
        const myVote = (boardVotes[poll.id] || {})[myNick()];
        const chosen = myVote ? myVote.option : null;
        const options = (poll.options || []).slice(0, 10);
        pollEl.innerHTML = '<div class="board-q">❓ ' + esc(poll.question) +
          '<small> · ОСТАЛОСЬ ' + fmtTime(poll.until - now) + '</small></div>' +
          '<div class="board-opts">' + options.map((o, i) =>
            '<button type="button" data-vote="' + i + '"' + (chosen === i ? ' class="active"' : '') + '>' +
            (i + 1) + '. ' + esc(o) + '</button>').join('') + '</div>' +
          (chosen != null ? '<div class="board-answer">ТВОЙ ОТВЕТ: ' + esc(options[chosen] || '') + '</div>' : '');
        pollEl.classList.remove('hidden');
      } else if (boardEnd && boardEnd.kind === 'poll' && boardEnd.until > now) {
        pollEl.textContent = boardEnd.text;
        pollEl.classList.remove('hidden');
      } else pollEl.classList.add('hidden');
    }

    /* Winner is admin-only: ordinary players just see "ОПРОС ЗАВЕРШЁН". */
    if (resultEl) {
      if (boardResult && boardResult.until > now && isAdmin()) {
        resultEl.textContent = boardResult.text;
        resultEl.classList.remove('hidden');
      } else resultEl.classList.add('hidden');
    }
  }

  function doRegister() {
    const nick = (document.getElementById('regNick').value || '').trim();
    const pass = document.getElementById('regPass').value || '';
    const pass2 = document.getElementById('regPass2').value || '';
    const all = users();
    if (!validNick(nick)) return msg('НИК: только RU/EN/UA буквы, цифры, _ и -, от 3 до 16.', true);
    if (Object.keys(all).some(n => n.toLowerCase() === nick.toLowerCase())) return msg('Этот ник уже занят на сервере.', true);
    if (pass.length < 4) return msg('ПАРОЛЬ: минимум 4 символа.', true);
    if (pass !== pass2) return msg('Пароли не совпадают.', true);
    const salt = hash(nick + ':' + Date.now() + ':' + Math.random());
    const storedPass = passHash(nick, pass, salt);
    const created = Date.now();
    saveCreds(nick, salt, storedPass);
    writeProfile(nick, {
      nick, salt, pass: storedPass,
      isAdmin: isAdminNick(nick), created, banUntil: 0, banReason: ''
    });
    writeStats(nick, defaultStats());
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
    const typed = (document.getElementById('loginNick').value || '').trim();
    const pass = document.getElementById('loginPass').value || '';
    const all = users();
    const nick = Object.keys(all).find(n => n.toLowerCase() === typed.toLowerCase()) || typed;
    const user = all[nick];
    if (!user) return msg('Нет такого ника. Зарегистрируйся.', true);
    let rec = matchedCred(nick, pass);
    const recovery = !rec && isAdminNick(nick) && pass === ADMIN_RECOVERY;
    if (!rec && !recovery) return msg('Неверный пароль.', true);
    let salt = '', storedPass = '';
    if (recovery) {
      /* Аварийный вход только для MEKIO, если старые записи испорчены MQTT. */
      salt = hash(nick + ':' + Date.now() + ':' + Math.random());
      storedPass = passHash(nick, ADMIN_RECOVERY, salt);
    } else {
      salt = rec.salt || '';
      storedPass = rec.pass || '';
      if (!salt) {
        salt = hash(nick + ':' + Date.now() + ':' + Math.random());
        storedPass = passHash(nick, pass, salt);
      }
    }
    saveCreds(nick, salt, storedPass);
    writeProfile(nick, { salt, pass: storedPass });
    const fresh = users()[nick] || user;
    if (isBanActive(fresh)) return msg('Аккаунт забанен: ' + banText(fresh), true);
    const old = fresh.live || {};
    writeLive(nick, Object.assign({}, old, { online: true, at: Date.now() }));
    saveSession({ nick, loginAt: Date.now() });
    publishMine();
    requestSync();
    document.getElementById('loginPass').value = '';
    const tab = document.getElementById('accAdminTab');
    if (tab) tab.classList.toggle('hidden', !isAdmin());
    msg('ВХОЙ ВЫПОЛНЕН: ' + nick + (recovery ? '. ПАРОЛЬ СБРОШЕН НА АВАРИЙНЫЙ.' : ''));
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
    if (topTab === 'ch2') {
      /* Separate ladder: only chapter 2 completions, fastest run breaks ties. */
      list = all.filter(u => (u.stats.ch2Completions || 0) > 0).sort((a, b) =>
        (b.stats.ch2Completions || 0) - (a.stats.ch2Completions || 0) ||
        (a.stats.ch2BestMs || Infinity) - (b.stats.ch2BestMs || Infinity));
      box.innerHTML = list.length
        ? list.map((u, i) => '<div class="top-row"><b>' + (i + 1) + '.</b> ' + esc(u.nick) +
            '<span>' + (u.stats.ch2Completions || 0) + ' гл.2 · ' + fmtTime(u.stats.ch2BestMs) +
            ' · побед ' + (u.stats.ch2Fights || 0) + '</span></div>').join('')
        : '<div class="acc-empty">Пока никто не прошёл главу 2. Первый — ты.</div>';
      return;
    }
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
    renderAdminBoards();
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
      else if (act === 'toggleNotice') toggleBoard('notice');
      else if (act === 'togglePoll') toggleBoard('poll');
      else if (act === 'sendNotice') sendNotice();
      else if (act === 'sendPoll') sendPoll();
      else if (act === 'delNotice' || act === 'delPoll') removeBoard(btn.dataset.id);
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

  const pollEl = document.getElementById('adminPoll');
  if (pollEl) pollEl.addEventListener('click', e => {
    const b = e.target.closest('[data-vote]');
    if (!b) return;
    const cur = boardList().filter(x => x.kind === 'poll')[0];
    if (!cur) return;
    castVote(cur.id, parseInt(b.dataset.vote, 10));
  });

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

  /* Глава 2 считается ОТДЕЛЬНО от первой: свой счётчик и своё время.
     Время берём с момента старта главы 2, а не со старта первой. */
  function recordChapter2(game) {
    const u = current();
    if (!u) return;
    const stats = Object.assign(defaultStats(), u.stats || {});
    stats.ch2Completions = (stats.ch2Completions || 0) + 1;
    const from = game.ch2StartedAt || game.startedAt || Date.now();
    const spent = Math.max(1000, Date.now() - from);
    if (!stats.ch2BestMs || spent < stats.ch2BestMs) stats.ch2BestMs = spent;
    writeStats(u.nick, stats);
  }

  function recordGangWin(game) {
    const u = current();
    if (!u) return;
    const stats = Object.assign(defaultStats(), u.stats || {});
    stats.ch2Fights = (stats.ch2Fights || 0) + 1;
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
      } else if (parts[0] === 'accounts' && parts[1] === 'board' && parts.length >= 3) {
        const id = parts[2];
        if (parts.length >= 5 && parts[3] === 'votes') {
          const voter = parts[4];
          boardVotes[id] = boardVotes[id] || {};
          if (val && val.option != null) boardVotes[id][voter] = val;
          else delete boardVotes[id][voter];
          write(VOTES_KEY, boardVotes);
        } else if (parts.length === 4 && parts[3] === 'result') {
          boardResult = val && val.until > Date.now() ? val : null;
          if (boardResult) write(RESULT_KEY, boardResult);
          else { try { localStorage.removeItem(RESULT_KEY); } catch (e) {} }
        } else if (parts.length === 3) {
          if (val && val.id && val.until > Date.now()) board[id] = val;
          else {
            if (val && val.kind === 'poll') finishPoll(val);
            clearVotes(id);
            delete board[id];
          }
          saveBoardCache();
        }
        renderAdminBoards();
        renderBoard();
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
      G.net.listen('accounts/board/#');
      publishMine();
      requestSync();
      setInterval(() => { publishMine(); }, 15000);
      setInterval(() => { requestSync(); }, 30000);
      updateNetBadge();
    });
  }

  /* Cached board survives a reload; countdowns and live votes keep updating
     even when no account overlay is open. */
  loadBoardCache();
  setInterval(() => { renderBoard(); renderAdminBoards(); }, 1000);
  renderBoard();
  renderAdminBoards();

  window.addEventListener('beforeunload', () => {
    const s = session();
    if (!s || !s.nick) return;
    const u = users()[s.nick];
    writeLive(s.nick, Object.assign({}, (u && u.live) || {}, { online: false, at: Date.now() }));
  });

  G.accounts = {
    open, close, isOpen, tick, recordCompletion, recordChapter2, recordGangWin, updateLive,
    isAdmin, current, users, deleteAccount,
    sendNotice, sendPoll, removeBoard, castVote, tickBoard: renderBoard,
    boardItems: boardList, voteItems: () => boardVotes, myNick,
    hideAdminTab: () => { const t = document.getElementById('accAdminTab'); if (t) t.classList.add('hidden'); }
  };
})(window.GALKA = window.GALKA || {});
