/* ГАЛЬКА — окно сетевых лобби */
(function (G) {
  'use strict';

  const overlay = document.getElementById('lobbyOverlay');
  const statusEl = document.getElementById('lobbyStatus');
  const listEl = document.getElementById('lobbyList');
  const roomEl = document.getElementById('lobbyRoom');
  const rosterEl = document.getElementById('lobbyRoster');
  const codeEl = document.getElementById('lobbyMyCode');
  const hud = document.getElementById('netHud');
  const hudCode = document.getElementById('netCode');
  const hudRoster = document.getElementById('netRoster');
  let tab = 'create';
  let cachedLobbies = [];
  let busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function q(sel) { return overlay ? overlay.querySelector(sel) : null; }
  function say(text, bad) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('bad', !!bad);
  }
  function isOpen() { return !!(overlay && !overlay.classList.contains('hidden')); }
  function open() {
    if (!overlay) return;
    overlay.classList.remove('hidden');
    setTab('create');
    say(G.net && G.net.status() === 'online' ? 'Сервер лобби на связи.' : 'Подключаюсь к серверу лобби…');
  }
  function close() { if (overlay) overlay.classList.add('hidden'); }

  function setTab(t) {
    tab = t;
    overlay.querySelectorAll('[data-ltab]').forEach(b => b.classList.toggle('active', b.dataset.ltab === t));
    overlay.querySelectorAll('[data-lpanel]').forEach(p => p.classList.toggle('hidden', p.dataset.lpanel !== t));
    if (t === 'list') renderLobbies();
  }

  function renderLobbies() {
    if (!listEl) return;
    if (!cachedLobbies.length) {
      listEl.innerHTML = '<div class="acc-empty">Пока нет лобби. Создай первым — код увидят все игроки.</div>';
      return;
    }
    listEl.innerHTML = cachedLobbies.map(l =>
      '<div class="lobby-row"><b>' + esc(l.code) + '</b> · ' + esc(l.host) +
      ' создал лобби · игроков ' + (l.count || 1) + '/' + ((l.need || 1) + 1) +
      (l.started ? ' · ИДЁТ ИГРА' : '') +
      ' <button type="button" data-lobby-action="quickjoin" data-code="' + esc(l.code) + '">ВОЙТИ</button></div>'
    ).join('');
  }

  function renderRoster(list) {
    if (!rosterEl) return;
    rosterEl.innerHTML = list.map((p, i) =>
      '<div class="lobby-row' + (p.self ? ' lobby-self' : '') + '">' +
      (i + 1) + '. ' + esc(p.nick) + (p.self ? ' (ты)' : '') + '</div>'
    ).join('');
  }

  function showRoom(l) {
    overlay.querySelectorAll('[data-lpanel]').forEach(p => p.classList.add('hidden'));
    if (roomEl) roomEl.classList.remove('hidden');
    overlay.querySelectorAll('[data-ltab]').forEach(b => b.classList.remove('active'));
    if (codeEl) codeEl.textContent = l.code;
    say('Лобби создано. Ждём игроков…', false);
  }

  function enteredNick(which) {
    const el = document.getElementById(which);
    const v = (el && el.value || '').trim();
    if (v) G.net.setNick(v);
  }

  function doCreate() {
    if (busy) return;
    const need = document.getElementById('lobbyNeed');
    enteredNick('lobbyNick');
    busy = true;
    say('Создаём лобби…');
    G.net.create(need && need.value, err => {
      busy = false;
      if (err) return say('Не получилось: ' + err.message + '. Проверь интернет.', true);
      showRoom(G.net.lobby());
    });
  }
  function doJoin(code) {
    if (busy) return;
    enteredNick('lobbyNick2');
    const el = document.getElementById('lobbyCode');
    const c = code || (el && el.value || '');
    if (!/^[A-Za-zА-Яа-я]{3}$/.test(c.trim())) return say('Введи код из 3 букв, например ABC.', true);
    busy = true;
    say('Входим в лобби ' + c.trim().toUpperCase() + '…');
    G.net.join(c, err => {
      busy = false;
      if (err) return say('Не получилось: ' + err.message + '. Проверь интернет.', true);
      showRoom(G.net.lobby());
      say('Вошли. Ждём, пока лобби заполнится…', false);
    });
  }

  if (overlay) {
    overlay.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.ltab) { setTab(btn.dataset.ltab); return; }
      const a = btn.dataset.lobbyAction;
      if (a === 'close') { if (G.net.lobby()) G.net.leave(); close(); }
      else if (a === 'create') doCreate();
      else if (a === 'join') doJoin();
      else if (a === 'quickjoin') { setTab('join'); const el = document.getElementById('lobbyCode'); if (el) el.value = btn.dataset.code || ''; doJoin(btn.dataset.code); }
      else if (a === 'leave') { G.net.leave(); close(); renderLobbies(); }
    });
    const codeInput = document.getElementById('lobbyCode');
    if (codeInput) codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); });
  }

  G.net.on('status', s => {
    if (s === 'online') { cachedLobbies = G.net.lobbies(); if (isOpen() && tab === 'list') renderLobbies(); if (isOpen()) say('Сервер лобби на связи.'); }
    else if (s === 'connecting' && isOpen()) say('Подключаюсь к серверу лобби…');
    else if (s === 'offline' && isOpen()) say('Сервер недоступен. Проверь интернет — офлайн-игра работает как раньше.', true);
  });
  G.net.on('error', () => { if (isOpen()) say('Ошибка соединения. Проверь интернет.', true); });
  G.net.on('lobbies', list => { cachedLobbies = list; if (isOpen() && tab === 'list') renderLobbies(); });
  G.net.on('roster', list => { renderRoster(list); if (hudRoster) hudRoster.textContent = list.map(p => p.nick).join(' · '); });
  G.net.on('left', () => { if (hud) hud.classList.add('hidden'); });
  G.net.on('msg', d => {
    if (!d || !d.text) return;
    const m = document.getElementById('adminMessage');
    if (!m) return;
    m.textContent = 'ИГРОК: ' + d.text;
    m.classList.remove('hidden');
    setTimeout(() => m.classList.add('hidden'), 5000);
  });
  G.net.on('start', data => {
    close();
    if (hud) hud.classList.remove('hidden');
    if (hudCode) hudCode.textContent = (G.net.lobby() || {}).code || '---';
    if (G.startNetworkGame) G.startNetworkGame(G.net.isHost() ? 'host' : 'client', data);
  });

  G.netui = {
    open, close, isOpen,
    lobbyCount: () => cachedLobbies.length,
    lobbies: () => cachedLobbies.slice()
  };
})(window.GALKA = window.GALKA || {});
