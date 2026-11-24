/* ГАЛЬКА: Подземный ритм — game engine */
(function (G) {
  'use strict';

  const A = G.art, AU = G.audio, BOSSES = G.bosses, ROOMS = G.rooms;
  const CREW_GANG = G.CREW_GANG;
  const W = 640, H = 480;
  const KEY = 'galka_underground_save_v1';
  const PROGRESS_KEY = 'galka_chapter_progress_v1';
  const TAU = Math.PI * 2;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  G.images = {};
  G.imageErrors = [];
  function watchImage(im, name) {
    im.onerror = () => { if (G.imageErrors.indexOf(name) < 0) G.imageErrors.push(name); };
    return im;
  }
  G.images.heroine = watchImage(new Image(), 'heroine');
  G.images.heroine.src = 'heroine.png';

  /* Extra looks for Галька. Маша and Пастух are locked until you KILL their
     boss versions. Спасать insufficiently — only killing opens the skin. */
  const SKINS = [
    { id: 'gal', name: 'ГАЛЬКА', img: 'heroine.png' },
    { id: 'masha', name: 'МАША', img: 'masha.png', boss: 'masha' },
    { id: 'pastuh', name: 'ПАСТУХ', img: 'pastuh.png', boss: 'pastuh' }
  ];
  const SKIN_KEY = 'galka_skin_v1';
  const SKIN_UNLOCK_KEY = 'galka_skin_unlocks_v1';
  const skinUnlocked = { gal: true, masha: false, pastuh: false };
  try { Object.assign(skinUnlocked, JSON.parse(localStorage.getItem(SKIN_UNLOCK_KEY) || '{}')); } catch (e) {}
  function isSkinUnlocked(i) {
    const s = SKINS[(i + SKINS.length) % SKINS.length];
    return !!(s && skinUnlocked[s.id]);
  }
  let skinIndex = 0;
  try { skinIndex = Math.max(0, Math.min(SKINS.length - 1, parseInt(localStorage.getItem(SKIN_KEY) || '0', 10) || 0)); } catch (e) {}
  if (!isSkinUnlocked(skinIndex)) skinIndex = 0;
  SKINS.forEach((s, i) => {
    if (i === 0) return;
    const im = watchImage(new Image(), 'skin' + i);
    im.src = s.img;
    G.images['skin' + i] = im;
  });
  function heroImage() { return skinIndex === 0 ? G.images.heroine : G.images['skin' + skinIndex]; }
  function heroDraw(o) {
    return Object.assign({
      width: skinIndex ? 56 : 40, height: skinIndex ? 60 : 52, legH: skinIndex ? 14 : 13
    }, o || {});
  }
  function saveSkin() { try { localStorage.setItem(SKIN_KEY, String(skinIndex)); } catch (e) {} }
  function setSkin(i) {
    let k = ((i % SKINS.length) + SKINS.length) % SKINS.length;
    for (let n = 0; n < SKINS.length; n++) {
      if (isSkinUnlocked(k)) {
        const changed = k !== skinIndex;
        skinIndex = k;
        saveSkin();
        return changed;
      }
      k = (k + 1) % SKINS.length;
    }
    skinIndex = 0;
    saveSkin();
    return false;
  }
  function unlockSkinForBoss(bossId) {
    const s = SKINS.find(x => x.boss === bossId);
    if (!s || skinUnlocked[s.id]) return null;
    skinUnlocked[s.id] = true;
    try { localStorage.setItem(SKIN_UNLOCK_KEY, JSON.stringify(skinUnlocked)); } catch (e) {}
    return s.name;
  }
  function lockedSkinNames() {
    return SKINS.filter((s, i) => i > 0 && !isSkinUnlocked(i)).map(s => s.name);
  }
  G.setHeroSkin = setSkin;
  G.heroSkin = () => SKINS[skinIndex].name;

  BOSSES.forEach(b => {
    const im = watchImage(new Image(), b.id);
    im.src = b.portrait;
    G.images[b.id] = im;
  });
  Object.keys(G.NEWCHARS || {}).forEach(id => {
    const im = watchImage(new Image(), id);
    im.src = G.NEWCHARS[id].img;
    G.images[id] = im;
  });
  /* Quest foes use "qf_*" ids and ".png" portrait strings, while their art is
     already loaded under the short name (govnoed, globus, ...). Map all three
     spellings to the same image so battles show the real portrait. */
  Object.keys(G.QUEST_FOES || {}).forEach(k => {
    const f = G.QUEST_FOES[k];
    const src = String(f.portrait || '');
    const base = src.replace(/\.png$/i, '');
    if (!base) return;
    let im = G.images[base] || G.images[src];
    if (!im) { im = watchImage(new Image(), base); im.src = f.portrait; G.images[base] = im; }
    G.images[src] = im;
    if (f.id) G.images[f.id] = im;
  });
  function bossImage(boss) {
    if (!boss) return null;
    const p = String(boss.portrait || '');
    return G.images[p] || G.images[p.replace(/\.png$/i, '')] || G.images[boss.id] || null;
  }

  /* ---------------- input ---------------- */

  /* determine input device: keyboard hints on PC, arrows + action button on phone */
  function setInputMode(touch) {
    document.body.classList.toggle('touch-mode', touch);
    document.body.classList.toggle('pc-mode', !touch);
    const pad = document.getElementById('touch');
    if (pad) pad.setAttribute('aria-hidden', touch ? 'false' : 'true');
    fit();
  }
  const mq = window.matchMedia ? window.matchMedia : null;
  const coarse = !!(mq && mq('(pointer: coarse)').matches);
  const fine = !!(mq && mq('(pointer: fine)').matches);
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  // a touchscreen laptop still has a mouse -> keep PC hints; a phone -> show the pad
  const phoneLike = coarse || (!fine && hasTouch) || Math.min(window.innerWidth, window.innerHeight) < 560;

  const down = {}, pressed = {}, keyHeld = {}, stickHeld = {};
  // analog stick: x/y in -1..1, magnitude = how far the thumb pulled
  const stickVec = { x: 0, y: 0, active: false };
  G.stickVec = stickVec;
  const keymap = {
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
    z: 'z', enter: 'z', ' ': 'z', x: 'x', escape: 'x', m: 'm'
  };

  function toggleMute() {
    AU.setMuted(!AU.muted);
    const btn = document.getElementById('muteBtn');
    btn.textContent = AU.muted ? '♪ ЗВУК ВЫКЛ' : '♪ ЗВУК ВКЛ';
    btn.classList.toggle('off', AU.muted);
  }

  window.addEventListener('keydown', e => {
    const k = keymap[e.key.toLowerCase()];
    if (!k) return;
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    AU.ensure();
    if (!down[k]) {
      pressed[k] = true;
      if (k === 'm') toggleMute();
    }
    keyHeld[k] = true;
    down[k] = true;
  });
  window.addEventListener('keyup', e => {
    const k = keymap[e.key.toLowerCase()];
    if (k) {
      keyHeld[k] = false;
      down[k] = !!stickHeld[k];
    }
  });
  function choiceRowAt(e) {
    const rect = canvas.getBoundingClientRect();
    const cy = (e.clientY - rect.top) * canvas.height / (rect.height || 1);
    if (cy < 200 || cy > 320) return null;
    const opts = (G.CH2_CHOICE && G.CH2_CHOICE.options) || [];
    let best = null, dist = 1e9;
    opts.forEach((o, i) => {
      const d = Math.abs(cy - (232 + i * 48));
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }
  canvas.addEventListener('pointerdown', e => {
    AU.ensure();
    /* Measure BEFORE setInputMode(): switching to phone layout resizes the
       canvas and would make the tap land on the wrong row. */
    const row = (state === 'ch2Choice' && !game.dialogue) ? choiceRowAt(e) : null;
    if (e.pointerType === 'touch') setInputMode(true);
    /* The final choice is handled HERE, not only in the game loop — some
       phones swallow synthetic key events, and lobbies can skip updates. */
    if (state === 'ch2Choice') {
      if (game.dialogue) { pressed.z = true; return; }
      if (row !== null) confirmCh2Choice(row);
      return;
    }
    if (state === 'title' || state === 'chapterSelect' ||
        state === 'gameover' || state === 'ending') pressed.z = true;
  });
  /* iOS sometimes delivers click after pointerdown; the lock makes it safe. */
  canvas.addEventListener('click', e => {
    if (state !== 'ch2Choice') return;
    const row = choiceRowAt(e);
    if (row !== null) confirmCh2Choice(row);
  });
  /* NOTE: no global capture-phase pointerdown here. It used to resize the
     frame before the canvas handler measured a tap, moving menu rows. */
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
  document.getElementById('newGameBtn').addEventListener('click', () => {
    AU.ensure();
    newGame();
    state = 'world';
    say([{ who: 'sys', text: 'Галька проснулась. Восьмой год в школе. Шестой — с классом 6 «И». Сегодня опять кричать.' },
         { who: 'gal', text: 'Чай. Потом школа. Без объяснений.' }]);
  });
  document.getElementById('chapterBtn').addEventListener('click', () => {
    AU.ensure();
    state = 'chapterSelect';
    chapterIndex = 0;
  });

  const touchRoot = document.getElementById('touch');
  let activePointers = 0;
  function wake() { activePointers++; touchRoot.classList.add('active'); }
  function sleep() {
    activePointers = Math.max(0, activePointers - 1);
    if (!activePointers) touchRoot.classList.remove('active');
  }

  document.querySelectorAll('#touch button').forEach(btn => {
    const k = btn.dataset.key;
    let held = false;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (held) return;
      held = true;
      AU.ensure();
      setInputMode(true);
      wake();
      /* On the final screen the OK button confirms directly. */
      if (state === 'ch2Choice' && k === 'z' && !game.dialogue && !ch2ChoiceLocked) {
        confirmCh2Choice(ch2ChoiceIndex);
        return;
      }
      if (!down[k]) pressed[k] = true;
      down[k] = true;
    });
    const release = () => {
      if (!held) return;
      held = false;
      down[k] = !!keyHeld[k];
      sleep();
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  /* Thumb stick: drag the knob; a small tilt is slow, a full pull is full speed. */
  function setupStick(stickIdName, knobIdName, suffix, vec) {
    const stick = document.getElementById(stickIdName);
    const knob = document.getElementById(knobIdName);
    if (!stick || !knob) return;
    let pid = null;
    const K = k => k + suffix;
    function setDir(k, on) {
      const key = K(k);
      if (on && !stickHeld[key]) {
        if (!down[key]) pressed[key] = true;
        stickHeld[key] = true;
        down[key] = true;
      } else if (!on && stickHeld[key]) {
        stickHeld[key] = false;
        down[key] = !!keyHeld[key];
      }
    }
    function moveStick(e) {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const max = r.width * 0.34;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const rawLen = Math.hypot(dx, dy);
      const clamped = Math.min(rawLen, max);
      if (rawLen > 0) { dx = dx / rawLen * clamped; dy = dy / rawLen * clamped; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      const nx = dx / max, ny = dy / max, keyDead = 0.3;
      setDir('left', nx < -keyDead);
      setDir('right', nx > keyDead);
      setDir('up', ny < -keyDead);
      setDir('down', ny > keyDead);
      const dead = 0.12;
      const mag = Math.max(0, (clamped / max - dead) / (1 - dead));
      const len = Math.hypot(dx, dy) || 1;
      vec.x = dx / len * mag;
      vec.y = dy / len * mag;
      vec.active = mag > 0;
    }
    function endStick(e) {
      if (e && e.pointerId !== undefined && e.pointerId !== pid) return;
      if (pid === null) return;
      try { stick.releasePointerCapture(pid); } catch (_) {}
      pid = null;
      stick.classList.remove('active');
      knob.style.transform = 'translate(0,0)';
      vec.x = vec.y = 0;
      vec.active = false;
      ['up', 'down', 'left', 'right'].forEach(k => setDir(k, false));
      sleep();
    }
    stick.addEventListener('pointerdown', e => {
      e.preventDefault();
      AU.ensure();
      setInputMode(true);
      pid = e.pointerId;
      stick.classList.add('active');
      try { stick.setPointerCapture(e.pointerId); } catch (_) {}
      wake();
      moveStick(e);
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      moveStick(e);
    });
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    stick.addEventListener('lostpointercapture', endStick);
  }
  setupStick('stick', 'stickKnob', '', stickVec);

  /* Keyboard = digital (full speed), stick = analog (speed follows the tilt). */
  function moveInput() {
    let vx = 0, vy = 0, mag = 0;
    if (stickVec.active) {
      mag = Math.hypot(stickVec.x, stickVec.y);
      if (mag) { vx = stickVec.x / mag; vy = stickVec.y / mag; }
    } else {
      if (down.left) vx--; if (down.right) vx++;
      if (down.up) vy--; if (down.down) vy++;
      mag = Math.hypot(vx, vy);
      if (mag) { vx /= mag; vy /= mag; mag = 1; }
    }
    return { vx, vy, mag };
  }

  /* One-shot key presses must never survive a frame, even on an early return. */
  function clearPressed() {
    pressed.up = pressed.down = pressed.left = pressed.right = pressed.z = pressed.x = pressed.m = false;
  }

  function fit() {
    const touch = document.body.classList.contains('touch-mode');
    const reserve = touch ? 12 : 168;
    const pad = touch ? 4 : 20;
    const s = Math.min((window.innerWidth - pad) / W, (window.innerHeight - reserve) / H, 2);
    const frame = document.getElementById('frame');
    frame.style.width = Math.floor(W * s) + 'px';
    frame.style.height = Math.floor(H * s) + 'px';
  }
  window.addEventListener('resize', fit);
  setInputMode(phoneLike);
  fit();

  /* ---------------- state ---------------- */

  let state = 'title';
  let T = 0;
  let titleIndex = 0;
  let ch2ChoiceIndex = 0;
  let ch2ChoiceLocked = false;
  let chapterIndex = 0;
  let ch2MarkerCooldown = 0;
  let liveTick = 0;
  let toast = { text: '', time: 0 };

  /* ---------------- network play ---------------- */
  const NET_COLORS = ['#8ff5ff', '#c77dff', '#ffe6a0', '#8affc8', '#ff9ec0', '#ff8f6a'];
  let netMode = '';            // '' | 'host' | 'client'
  let netPlayers = [];         // global order from lobby start
  let netSelfIndex = 0;
  let netInputs = {};          // id -> { v:{x,y,mag}, z:bool, x:bool }
  let netSnap = null;          // latest host snapshot on clients
  let netLastSnapRef = null;   // only correct positions when a NEW snapshot arrives
  let netSnapSeq = 0, netAppliedSeq = 0, netLastRoom = '';
  let netSendT = 0, netStateT = 0;
  /* Phones choke on the old 20 state + 25 input messages per second. */
  const NET_INPUT_DT = phoneLike ? 0.07 : 0.05;
  const NET_STATE_DT = phoneLike ? 0.1 : 0.066;
  let netSig = { inv: '', flags: '', defeated: '', spared: '', dialogue: '' };
  let netDialogueSig = '', netDialogueDismissed = '';
  function netSelfColor() { return NET_COLORS[netSelfIndex % NET_COLORS.length]; }
  function netInputFor(i) {
    const p = netPlayers[i];
    return p ? (netInputs[p.id] || null) : null;
  }
  function takeNetZ(i) {
    const inp = netInputFor(i);
    if (!inp || !inp.z) return false;
    inp.z = false;
    return true;
  }
  function resetNetSouls(b) {
    if (!b) return;
    const cx = b.arena.x + b.arena.w / 2;
    b.netSouls = [];
    for (let i = 2; i < netPlayers.length; i++) {
      b.netSouls.push({
        i, id: netPlayers[i].id, color: netPlayers[i].color,
        x: cx + (i - 1) * 30 - 45, y: b.arena.y + b.arena.h - 32,
        invuln: 0, dash: 0, dashCd: 0
      });
    }
  }

  const game = {
    roomId: 'home', hp: 30, maxHp: 30, lov: 1, exp: 0, kills: 0, spares: 0,
    inv: { pie: 2, tea: 1, candy: 3 },
    flags: {}, defeated: {}, spared: {},
    player: { x: 320, y: 410, dir: 'down', frame: 0, walkT: 0 },
    dialogue: null, battle: null, particles: [], fade: null,
    messageTime: 0, message: '',
    questsDone: 0, startedAt: 0, ch2StartedAt: 0,
    chapter: 1, chapter1Done: false, ch2Done: false, ch2Choice: '', ch2Mission: 0
  };

  /* Chapter unlocks live separately from the current run. Starting a new game
     or refreshing the page must never close chapter 2 again. */
  const progress = { chapter1Done: false, ch2Done: false, ch2Choice: '' };
  function saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function readProgress() {
    try { Object.assign(progress, JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')); } catch (e) {}
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (d.chapter1Done || d.chapter >= 2 ||
          (d.defeated && d.defeated.director) || (d.spared && d.spared.director)) {
        progress.chapter1Done = true;
      }
      if (d.ch2Done) progress.ch2Done = true;
      if (d.ch2Choice) progress.ch2Choice = d.ch2Choice;
    } catch (e) {}
    saveProgress();
    game.chapter1Done = progress.chapter1Done;
    game.ch2Done = progress.ch2Done;
    game.ch2Choice = progress.ch2Choice;
  }
  readProgress();
  syncChapterNpcs();

  function newGame() {
    game.roomId = 'home';
    game.hp = 30; game.maxHp = 30; game.lov = 1; game.exp = 0;
    game.kills = 0; game.spares = 0;
    game.inv = { pie: 2, tea: 1, candy: 3 };
    game.flags = {}; game.defeated = {}; game.spared = {};
    game.questsDone = 0; game.startedAt = Date.now(); game.ch2StartedAt = 0;
    game.chapter = 1; game.chapter1Done = progress.chapter1Done;
    game.ch2Done = false; game.ch2Choice = ''; game.ch2Mission = 0;
    game.player = { x: 320, y: 410, dir: 'down', frame: 0, walkT: 0 };
    game.dialogue = null; game.battle = null; game.particles = []; game.fade = null;
    AU.setTrack('home');
    enterRoom('home', ROOMS.home.spawn, true);
  }

  /* Chapter 2 reuses the old bosses, but they are faster, tougher and angrier. */
  function chapter2Boss(src) {
    const L = (who, text) => ({ who, text });
    const hp = Math.round(src.hp * 1.7);
    const patterns = (src.patterns || []).map((p, i) =>
      i === 0 ? p.slice() : p.concat(p.indexOf('corner') < 0 ? ['corner'] : []));
    return Object.assign({}, src, {
      hp, enemyMax: hp, atk: src.atk + 4, def: src.def + 2,
      ch2: true, final: false,
      title: 'ГЛАВА 2 · ' + src.title,
      patterns,
      phases: (src.phases || []).map(ph => Object.assign({}, ph)),
      taunts: [
        [L('boss', 'В первой главе я была добрее.')],
        [L('boss', 'Ты пришилась к пацанам — теперь держи удар.')]
      ].concat(src.taunts || []),
      intro: [
        L('sys', 'ГЛАВА 2. ПЕРЕХВАТ.'),
        L('boss', src.name + '. Ты опять здесь.'),
        L('gal', 'Пришилась. Без объяснений.')
      ],
      kill: [
        L('boss', 'Ты сильнее, чем в первый раз. Но я больше не играю.'),
        L('sys', '✦ Перехват выполнен. Иди к старшему пацану.')
      ],
      spare: [
        L('boss', 'Ладно. Не бей. Я запомню.'),
        L('sys', '✦ Перехват выполнен без убийства. Иди к старшему пацану.')
      ]
    });
  }

  function startChapter2() {
    progress.chapter1Done = true;
    saveProgress();
    game.chapter = 2;
    game.hp = 42; game.maxHp = 42; game.lov = 2; game.exp = 0;
    game.kills = 0; game.spares = 0;
    game.inv = { pie: 3, tea: 2, candy: 4 };
    game.flags = {}; game.defeated = {}; game.spared = {};
    game.questsDone = 0; game.startedAt = Date.now(); game.ch2StartedAt = Date.now();
    game.ch2Done = false; game.ch2Choice = ''; game.ch2Mission = 0;
    game.dialogue = null; game.battle = null; game.particles = []; game.fade = null;
    /* First half: still in the director's office. */
    enterRoom('office', { x: 320, y: 330 }, true);
    game.player.dir = 'up';
    state = 'world';
    say([
      { who: 'sys', text: 'КАТСЦЕНА. КАБИНЕТ ДИРЕКТОРА. Дверь захлопнулась.' },
      { who: 'boss', text: 'Галька, ты побила меня. Вон из школы. И не возвращайся.' },
      { who: 'gal', text: 'Я не извиняюсь. Я ухожу.' },
      { who: 'sys', text: 'Сын директора остался за дверью. Экран темнеет...' }
    ], () => {
      /* Black screen first, then the next scene. */
      game.fade = {
        a: 0, phase: 'in', cb: () => {
          enterRoom('crew', { x: 90, y: 390 }, true);
          AU.sfx('door');
          sayCh2([
            { who: 'sys', text: 'ПЛОЩАДКА РОВНЫХ ПАЦАНОВ. Потом.' },
            { who: 'crew', text: 'Галька? Пришилась — значит, наша.' },
            { who: 'crew', text: 'Не потому что мы правы. Потому что чушпанкой быть хуже.' },
            { who: 'gal', text: 'Без объяснений. Что делать?' },
            { who: 'crew', text: 'Подойди — скажу. Следи за подсказкой сверху.' }
          ], null, 'СТАРШИЙ ПАЦАН');
          saveGame();
        }
      };
    }, 'npc');
    if (game.dialogue) {
      game.dialogue.npcName = 'СЫН ДИРЕКТОРА';
      game.dialogue.img = G.images.director || G.images['director-son'];
    }
  }

  G.startNetworkGame = function (role, startData) {
    netMode = role === 'host' ? 'host' : 'client';
    netInputs = {};
    netSnap = null;
    netLastSnapRef = null;
    netSnapSeq = 0; netAppliedSeq = 0; netLastRoom = '';
    netSig = { inv: '', flags: '', defeated: '', spared: '', dialogue: '' };
    netSendT = netStateT = 0;
    netPlayers = ((startData && startData.players) || []).map((p, i) => ({
      id: p.id, nick: p.nick || 'ИГРОК', color: NET_COLORS[i % NET_COLORS.length],
      x: 320 + (i % 2) * 36, y: 410
    }));
    if (!netPlayers.length) netPlayers = [{ id: G.net.selfId, nick: G.net.nick() || 'ГАЛЬКА', color: NET_COLORS[0], x: 320, y: 410 }];
    netSelfIndex = Math.max(0, netPlayers.findIndex(p => p.id === G.net.selfId));
    newGame();
    state = 'world';
    say([
      { who: 'sys', text: 'СЕТЕВАЯ ИГРА · БЕТА-ТЕСТ. Могут быть баги и задержки — не сердись.' },
      { who: 'sys', text: 'Код лобби висит в правом верхнем углу — зови друзей.' },
      { who: 'gal', text: 'Опять восьмой год. Раз так — кричать будем вместе.' }
    ]);
    showToast('⚠ СЕТЕВАЯ ИГРА В БЕТА-ТЕСТЕ · ВОЗМОЖНЫ БАГИ');
  };

  function netSnapshot() {
    const b = game.battle;
    const lob = G.net.lobby && G.net.lobby();
    const snap = {
      seq: ++netSnapSeq, lobby: lob ? lob.code : '',
      state, roomId: game.roomId,
      hp: game.hp, maxHp: game.maxHp, lov: game.lov, exp: game.exp,
      kills: game.kills, spares: game.spares,
      questsDone: game.questsDone, startedAt: game.startedAt,
      player: { x: game.player.x, y: game.player.y, dir: game.player.dir, frame: game.player.frame },
      /* The host's own entry must carry the live player position too. */
      peers: netPlayers.map((p, i) => ({
        id: p.id,
        x: i === netSelfIndex ? game.player.x : p.x,
        y: i === netSelfIndex ? game.player.y : p.y
      })),
      toast: toast.text
    };
    /* Heavy fields only go out when they actually change. The old version
       resent every flag/inventory/dialogue object 20 times a second — that
       was the main phone killer. */
    const put = (key, val, obj) => {
      const sig = JSON.stringify(obj);
      if (sig !== netSig[key]) { snap[key] = val; netSig[key] = sig; }
    };
    put('inv', Object.assign({}, game.inv), game.inv);
    put('flags', Object.assign({}, game.flags), game.flags);
    put('defeated', Object.assign({}, game.defeated), game.defeated);
    put('spared', Object.assign({}, game.spared), game.spared);
    const dlg = game.dialogue ? {
      speaker: game.dialogue.speaker, lines: game.dialogue.lines.slice(),
      i: game.dialogue.i, chars: game.dialogue.chars,
      npcName: game.dialogue.npcName || '', imgKey: netImageKey(game.dialogue.img)
    } : null;
    put('dialogue', dlg, dlg);
    if (b) snap.battle = {
        bossId: b.boss.id, questId: b.boss.questId || null, phase: b.phase, timer: b.timer, duration: b.duration,
        enemyHp: b.enemyHp, enemyMax: b.enemyMax, phaseIdx: b.phaseIdx,
        attackName: b.attackName, spareReady: b.spareReady, winType: b.winType,
        menuIndex: b.menuIndex, sub: b.sub, subIndex: b.subIndex,
        hx: b.hx, hy: b.hy, h2x: b.h2x, h2y: b.h2y,
        invuln: b.invuln, h2Invuln: b.h2Invuln, dash: b.dash, h2Dash: b.h2Dash,
        campMsg: b.campMsg,
        bullets: b.bullets.map(p => ({ x: p.x, y: p.y, r: p.r, color: p.color, shape: p.shape, rot: p.rot })),
        warns: b.warns.map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h, life: w.life, max: w.max, color: w.color })),
        souls: (b.netSouls || []).map(s => ({ id: s.id, x: s.x, y: s.y, invuln: s.invuln, dash: s.dash }))
      };
    else snap.battle = null;
    return snap;
  }

  function netImageKey(img) {
    if (!img) return '';
    for (const k in G.images) if (G.images[k] === img) return k;
    return '';
  }

  function applyNetSnapshot(dt) {
    const s = netSnap;
    if (!s) return;
    /* This function runs every frame, but the snapshot itself only changes
       when a broker message arrives. Correcting toward the SAME stale packet
       every frame is what made guests feel rubber-banded into a tiny circle. */
    const fresh = s !== netLastSnapRef;
    if (!fresh) return; // the same packet was already applied — huge win on phones
    netLastSnapRef = s;
    const roomChanged = ROOMS[s.roomId] && s.roomId !== netLastRoom;
    if (ROOMS[s.roomId]) netLastRoom = s.roomId;
    state = s.state || 'world';
    game.roomId = ROOMS[s.roomId] ? s.roomId : 'home';
    game.hp = s.hp; game.maxHp = s.maxHp; game.lov = s.lov; game.exp = s.exp || 0;
    game.kills = s.kills || 0; game.spares = s.spares || 0;
    if (s.inv) game.inv = Object.assign({ pie: 0, tea: 0, candy: 0 }, s.inv);
    if (s.flags) game.flags = s.flags;
    if (s.defeated) game.defeated = s.defeated;
    if (s.spared) game.spared = s.spared;
    game.questsDone = s.questsDone || 0; game.startedAt = s.startedAt || Date.now();
    if (roomChanged) {
      game.dialogue = null;
      netDialogueSig = ''; netDialogueDismissed = '';
      game.player.frame = 0; game.player.walkT = 0;
      AU.setTrack(ROOMS[game.roomId].track);
    }
    /* Match by player ID, never by array index — a late join or a different
       roster order used to put two Гальки on top of each other. */
    const peers = s.peers || [];
    const peerFor = id => peers.find(p => p.id === id);
    const selfId = G.net.selfId;
    netPlayers.forEach(q => {
      const p = peerFor(q.id);
      if (!p) return;
      if (q.id === selfId) {
        if (!roomChanged) return; // own soul is handled below with prediction
        game.player.x = p.x; game.player.y = p.y;
        return;
      }
      const k = roomChanged ? 1 : 0.35;
      q.x += (p.x - q.x) * k;
      q.y += (p.y - q.y) * k;
    });
    const ownPeer = peerFor(selfId) || (s.player && netPlayers[0] && netPlayers[0].id === selfId ? s.player : null);
    if (ownPeer && !roomChanged && fresh) {
      const k = 0.12;
      game.player.x += (ownPeer.x - game.player.x) * k;
      game.player.y += (ownPeer.y - game.player.y) * k;
    }
    /* Dialogue/text work only when a new packet arrives — on a phone doing
       this 60 times a second for the same text was a noticeable slowdown. */
    if (fresh || roomChanged) {
      if (s.toast) toast = { text: s.toast, time: 1.8 };
      if ('dialogue' in s && s.dialogue) {
        const sig = JSON.stringify([s.dialogue.speaker, s.dialogue.lines, s.dialogue.i]);
        if (sig !== netDialogueSig) { netDialogueSig = sig; netDialogueDismissed = ''; }
        if (netDialogueDismissed === sig) {
          game.dialogue = null;
        } else {
          if (!game.dialogue || game.dialogue.sig !== sig) {
            game.dialogue = new Dialog(s.dialogue.speaker, s.dialogue.lines, null);
            game.dialogue.sig = sig;
            game.dialogue.npcName = s.dialogue.npcName || '';
            if (s.dialogue.imgKey && G.images[s.dialogue.imgKey]) game.dialogue.img = G.images[s.dialogue.imgKey];
          }
          game.dialogue.i = s.dialogue.i || 0;
          game.dialogue.chars = s.dialogue.chars || 0;
        }
      } else if ('dialogue' in s) {
        game.dialogue = null;
        netDialogueSig = ''; netDialogueDismissed = '';
      }
    }

    if (s.battle) {
      const boss = bossById(s.battle.bossId) || questBossById(s.battle.bossId, s.battle.questId) || BOSSES[0];
      if (!game.battle || game.battle.boss.id !== boss.id) game.battle = makeBattle(boss);
      const b = game.battle;
      Object.assign(b, {
        phase: s.battle.phase, timer: s.battle.timer, duration: s.battle.duration,
        enemyHp: s.battle.enemyHp, enemyMax: s.battle.enemyMax, phaseIdx: s.battle.phaseIdx || 0,
        attackName: s.battle.attackName, spareReady: !!s.battle.spareReady, winType: s.battle.winType,
        menuIndex: s.battle.menuIndex || 0, sub: s.battle.sub, subIndex: s.battle.subIndex || 0,
        hx: s.battle.hx, hy: s.battle.hy,
        invuln: s.battle.invuln, h2Invuln: s.battle.h2Invuln,
        dash: s.battle.dash, h2Dash: s.battle.h2Dash, campMsg: s.battle.campMsg || 0
      });
      if (netMode === 'client' && netSelfIndex === 1) {
        if (fresh) {
          const k = 0.2;
          if (s.battle.h2x != null) b.h2x += (s.battle.h2x - b.h2x) * k;
          if (s.battle.h2y != null) b.h2y += (s.battle.h2y - b.h2y) * k;
        }
      } else if (fresh) {
        b.h2x = s.battle.h2x; b.h2y = s.battle.h2y;
      }
      if (fresh) {
        b.bullets = (s.battle.bullets || []).map(p => Object.assign({ age: 0, vx: 0, vy: 0, r: 5, color: '#fff', shape: 'circle', rot: 0 }, p));
        b.warns = (s.battle.warns || []).map(w => Object.assign({ life: 0, max: 1, color: '#ff5d7d' }, w));
        b.netSouls = (s.battle.souls || []).map((q, i) => {
          const old = (b.netSouls || []).find(x => x.id === q.id) || (b.netSouls || [])[i];
          const own = netMode === 'client' && q.id === G.net.selfId;
          return {
            i: i + 2, id: q.id, color: NET_COLORS[(i + 2) % NET_COLORS.length],
            x: own && old ? old.x + (q.x - old.x) * 0.2 : q.x,
            y: own && old ? old.y + (q.y - old.y) * 0.2 : q.y,
            invuln: q.invuln, dash: q.dash, dashCd: 0
          };
        });
      }
      b.phase2 = b.phaseIdx >= 1; b.phase3 = b.phaseIdx >= 2;
    } else game.battle = null;
  }

  /* Clients move themselves immediately and let the host's snapshot gently
     correct them. Without this the guest's own soul lags a full round trip
     through the public broker and feels almost uncontrollable. */
  function predictLocalPlayer(dt) {
    if (state !== 'world' || game.fade) return;
    /* A host dialogue is only text on the guest — it must never freeze them. */
    const mv = moveInput();
    if (mv.mag > 0) {
      if (Math.abs(mv.vx) > Math.abs(mv.vy)) game.player.dir = mv.vx < 0 ? 'left' : 'right';
      else game.player.dir = mv.vy < 0 ? 'up' : 'down';
      game.player.walkT += dt * 9 * mv.mag;
      game.player.frame = 1 + Math.floor(game.player.walkT) % 2;
      movePlayer(mv.vx * 132 * dt * mv.mag, mv.vy * 132 * dt * mv.mag);
    } else game.player.frame = 0;
  }

  function predictBattleSoul(dt) {
    const b = game.battle;
    if (!b || b.phase !== 'dodge' || game.dialogue || !b.arena) return;
    const A0 = b.arena, mv = moveInput();
    if (!mv.mag) return;
    if (netSelfIndex === 1) {
      const sp = (b.h2Dash > 0 ? 430 : 168) * dt * mv.mag;
      b.h2x = Math.max(A0.x + 12, Math.min(A0.x + A0.w - 12, b.h2x + mv.vx * sp));
      b.h2y = Math.max(A0.y + 12, Math.min(A0.y + A0.h - 12, b.h2y + mv.vy * sp));
    } else if (netSelfIndex >= 2 && b.netSouls) {
      const s = b.netSouls.find(x => x.id === G.net.selfId) || b.netSouls[netSelfIndex - 2];
      if (s) {
        const sp = (s.dash > 0 ? 430 : 168) * dt * mv.mag;
        s.x = Math.max(A0.x + 12, Math.min(A0.x + A0.w - 12, s.x + mv.vx * sp));
        s.y = Math.max(A0.y + 12, Math.min(A0.y + A0.h - 12, s.y + mv.vy * sp));
      }
    }
  }

  function snapshot() {
    return {
      roomId: game.roomId, hp: game.hp, maxHp: game.maxHp, lov: game.lov, exp: game.exp,
      kills: game.kills, spares: game.spares, inv: Object.assign({}, game.inv),
      flags: Object.assign({}, game.flags), defeated: Object.assign({}, game.defeated),
      spared: Object.assign({}, game.spared),
      questsDone: game.questsDone, startedAt: game.startedAt, ch2StartedAt: game.ch2StartedAt,
      chapter: game.chapter, chapter1Done: game.chapter1Done,
      ch2Done: game.ch2Done, ch2Choice: game.ch2Choice, ch2Mission: game.ch2Mission,
      player: { x: game.player.x, y: game.player.y }
    };
  }

  function saveGame() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { /* file:// */ }
    burst(320, 220, '#ffd98a', 26);
    AU.sfx('save');
  }

  function hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function loadGame() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      Object.assign(game, {
        roomId: ROOMS[d.roomId] ? d.roomId : 'home',
        hp: d.hp, maxHp: d.maxHp, lov: d.lov, exp: d.exp || 0,
        kills: d.kills || 0, spares: d.spares || 0,
        inv: Object.assign({ pie: 0, tea: 0, candy: 0 }, d.inv),
        flags: d.flags || {}, defeated: d.defeated || {}, spared: d.spared || {},
        questsDone: d.questsDone || 0, startedAt: d.startedAt || Date.now(),
        ch2StartedAt: d.ch2StartedAt || 0,
        chapter: d.chapter || 1, chapter1Done: !!d.chapter1Done,
        ch2Done: !!d.ch2Done, ch2Choice: d.ch2Choice || '', ch2Mission: d.ch2Mission || 0
      });
      if (!game.chapter1Done && (game.defeated.director || game.spared.director)) game.chapter1Done = true;
      if (game.chapter1Done) { progress.chapter1Done = true; saveProgress(); }
      if (game.ch2Done) { progress.ch2Done = true; saveProgress(); }
      if (game.ch2Choice) { progress.ch2Choice = game.ch2Choice; saveProgress(); }
      game.chapter1Done = game.chapter1Done || progress.chapter1Done;
      game.ch2Choice = game.ch2Choice || progress.ch2Choice;
      /* Old saves still carry the removed "smart man" reward. Wipe it on load. */
      const normalMax = 30 + 5 * BOSSES.filter(b => game.defeated[b.id]).length;
      if ((d.godRuns || 0) > 0 || game.maxHp > normalMax) {
        game.maxHp = normalMax;
        game.hp = Math.min(game.hp, game.maxHp);
      }
      game.hp = Math.max(1, Math.min(game.hp, game.maxHp));
      AU.setTrack(ROOMS[game.roomId].track);
      const savedPlayer = d.player || {};
      enterRoom(game.roomId, { x: savedPlayer.x || 320, y: savedPlayer.y || 400 }, true);
      return true;
    } catch (e) { return false; }
  }

  function bossById(id) { return BOSSES.find(b => b.id === id) || (CREW_GANG && CREW_GANG.id === id ? CREW_GANG : null); }
  function isSmartBoss(boss) { return !!(boss && boss.smart); }
  function defeatedCount() {
    if (game.chapter === 2) return BOSSES.length; // chapter 2 opens all old routes
    return BOSSES.filter(b => game.defeated[b.id]).length;
  }

  function isCh2Npc(n) {
    return !!(n && (n.ch2Boss || n.ch2Spy || n.ch2Ambush || n.ch2Boy || n.ch2Finale));
  }

  /* The way back to the ровные пацаны exists only in chapter 2. */
  function roomExits(id) {
    const list = (ROOMS[id] && ROOMS[id].exits) || [];
    return game.chapter === 2 ? list : list.filter(e => !e.ch2);
  }

  /* Chapter 2 markers must not exist at all in chapter 1 — not even as
     invisible NPCs. Add them only when the player is actually in chapter 2. */
  function syncChapterNpcs() {
    const markers = G.CH2_MARKERS || [];
    const wanted = game.chapter === 2;
    for (const roomId in ROOMS) {
      const list = ROOMS[roomId].npcs || (ROOMS[roomId].npcs = []);
      for (const mk of markers) {
        if (mk.room !== roomId) continue;
        const i = list.indexOf(mk.npc);
        if (wanted && i < 0) list.push(mk.npc);
        if (!wanted && i >= 0) list.splice(i, 1);
      }
    }
  }

  /* Walking onto the current marker is enough — no need to hunt for Z. */
  function activeCh2MarkerNear() {
    if (game.chapter !== 2 || state !== 'world' || game.dialogue || game.fade || ch2MarkerCooldown > 0) return null;
    const o = ch2Objective();
    if (!o) return null;
    for (const n of (ROOMS[game.roomId].npcs || [])) {
      if (!n.ch2Spy && !n.ch2Ambush) continue;
      if (n.x !== o.x || n.y !== o.y) continue;
      if (Math.hypot(n.x - game.player.x, n.y - game.player.y) > 34) continue;
      if (n.ch2Spy && !game.flags['ch2Spy_' + n.ch2Spy] && game.flags['ch2Active_' + n.ch2Spy]) return n;
      if (n.ch2Ambush && game.flags['ch2Report_' + n.ch2Ambush] && !game.flags['ch2Done_' + n.ch2Ambush]) return n;
    }
    return null;
  }

  /* Chapter 2 talks use the "crew" tag. Show a real name instead of CREW. */
  function sayCh2(lines, cb, name) {
    say(lines, cb, 'npc');
    if (game.dialogue) {
      game.dialogue.npcName = name || 'СТАРШИЙ ПАЦАН';
      game.dialogue.img = null;
    }
  }

  function ch2Objective() {
    if (game.chapter !== 2) return null;
    const missions = G.CH2_MISSIONS || [];
    const m = missions[game.ch2Mission];
    if (!m) return { text: 'Иди к забору между районами', room: 'crew', x: 560, y: 330, npc: 'ch2Fence' };
    if (!game.flags['ch2Spy_' + m.boss]) {
      if (!game.flags['ch2Active_' + m.boss]) {
        return { text: 'Возьми задание у старшего пацана', room: 'crew', x: 320, y: 250, npc: 'crewBoss' };
      }
      return {
        text: 'Шпиони за: ' + m.short + ' · ' + ((ROOMS[m.spyRoom] || {}).name || m.spyRoom),
        room: m.spyRoom, x: m.sx, y: m.sy, npc: 'spy_' + m.boss
      };
    }
    if (!game.flags['ch2Report_' + m.boss]) {
      return { text: 'Доложи старшему пацану', room: 'crew', x: 320, y: 250, npc: 'crewBoss' };
    }
    if (m.boss === 'director') {
      return {
        text: 'Перехвати: ' + m.short + ' · КАБИНЕТ ДИРЕКТОРА',
        room: 'office', x: 320, y: 245, npc: 'director'
      };
    }
    return {
      text: 'Перехвати: ' + m.short + ' · ' + ((ROOMS[m.ambushRoom] || {}).name || m.ambushRoom),
      room: m.ambushRoom, x: m.ax, y: m.ay, npc: 'amb_' + m.boss
    };
  }

  function routeExitTo(to) {
    const from = game.roomId;
    if (from === to || !ROOMS[from] || !ROOMS[to]) return null;
    const seen = {}; seen[from] = 1;
    const queue = [[from, null]];
    while (queue.length) {
      const [room, first] = queue.shift();
      for (const ex of roomExits(room)) {
        if (seen[ex.to]) continue;
        const step = first || ex;
        if (ex.to === to) return step;
        seen[ex.to] = 1;
        queue.push([ex.to, step]);
      }
    }
    return null;
  }

  function drawCh2Objective() {
    const o = ch2Objective();
    if (!o || state !== 'world') return;
    A.panel(ctx, 12, 80, 500, 42, { fill: 'rgba(8,10,24,.86)', border: '#8affc8' });
    A.text(ctx, 'ЗАДАНИЕ: ' + o.text, 22, 99, { size: 11, color: '#eaffd8', align: 'left', shadow: false });
    const step = routeExitTo(o.room);
    if (step) {
      A.text(ctx, 'ДАЛЬШЕ: ' + step.label, 22, 116, { size: 9, color: '#ffe6a0', align: 'left', shadow: false });
      if (step.to === 'crew' && game.roomId === 'street') {
        /* The real exit label sits under the top panels — draw a clear one. */
        const bob = Math.sin(T * 5) * 2;
        A.panel(ctx, 12, 178, 154, 42, { fill: 'rgba(8,10,24,.92)', border: '#8affc8' });
        A.text(ctx, '↖ К ПАЦАНАМ', 89, 199 + bob, { size: 13, color: '#8affc8', align: 'center' });
        A.text(ctx, 'ВЫХОД СЛЕВА, ВВЕРХУ', 89, 214, { size: 8, color: '#eaffd8', align: 'center', shadow: false });
      }
    } else {
      A.text(ctx, 'ЦЕЛЬ РЯДОМ — ПОДОЙДИ К МЕТКЕ (ИЛИ НАЖМИ Z)', 22, 116, { size: 9, color: '#8ff5ff', align: 'left', shadow: false });
      const bob = Math.sin(T * 5) * 5;
      ctx.strokeStyle = '#8affc8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(o.x, o.y - 34 + bob, 20 + Math.sin(T * 4) * 3, 0, Math.PI * 2);
      ctx.stroke();
      A.text(ctx, '▼', o.x, o.y - 54 + bob, { size: 18, color: '#8affc8', align: 'center' });
    }
  }

  function questFoeFor(key, questId) {
    const src = (G.QUEST_FOES || {})[key];
    if (!src) return BOSSES[0];
    return Object.assign({}, src, { questId: questId || null });
  }
  function questBossById(id, questId) {
    const src = Object.keys(G.QUEST_FOES || {}).map(k => G.QUEST_FOES[k]).find(b => b.id === id);
    return src ? Object.assign({}, src, { questId: questId || null }) : null;
  }

  /* Some rooms have furniture right next to the entrance. Never drop a guest
     inside a table — that looked exactly like "only the host can walk". */
  function safeSpawnSpot(roomId, base, i) {
    const solids = (ROOMS[roomId] && ROOMS[roomId].solids) || [];
    const blocked = (x, y) => solids.some(s =>
      x + 10 > s[0] && x - 10 < s[0] + s[2] && y + 6 > s[1] && y - 6 < s[1] + s[3]);
    const offsets = [[36 * i, 0], [-36 * i, 0], [0, 36 * i], [0, -36 * i],
      [36 * i, 36], [36 * i, -36], [-36 * i, 36], [-36 * i, -36],
      [36, 0], [-36, 0], [0, 36], [0, -36], [72, 0], [-72, 0]];
    for (const [dx, dy] of offsets) {
      const x = Math.max(24, Math.min(W - 24, base.x + dx));
      const y = Math.max(30, Math.min(H - 16, base.y + dy));
      if (!blocked(x, y)) return { x, y };
    }
    return { x: Math.max(24, Math.min(W - 24, base.x)), y: base.y };
  }

  function enterRoom(id, spawn, instant) {
    const doIt = () => {
      syncChapterNpcs();
      const roomChanged = id !== game.roomId;
      game.roomId = id;
      const r = ROOMS[id];
      game.player.x = spawn.x; game.player.y = spawn.y;
      game.player.frame = 0; game.player.walkT = 0;
      game.dialogue = null;
      AU.setTrack(r.track);
      /* Guests must appear at the new room's entrance too, not keep the
         coordinates they had in the previous room. */
      /* Only re-seat everyone on a REAL room change. Coming back from a
       * battle calls enterRoom(sameRoom) — guests must stay where they stood. */
      if (roomChanged && netMode === 'host' && netPlayers.length > 1) {
        netInputs = {}; // drop keys held in the previous room
        netPlayers.forEach((q, i) => {
          if (i === 0) return;
          const spot = safeSpawnSpot(id, spawn, i);
          q.x = spot.x; q.y = spot.y;
        });
      }
      maybeSmartEncounter(id);
    };
    if (instant) doIt();
    else game.fade = { a: 0, phase: 'in', cb: doIt };
  }

  /* After Галька disobeys, the smart man stops waiting in quests and
     meets her on the road. One rematch, then the orders are over. */
  function maybeSmartEncounter(id) {
    if (netMode || state === 'battle' || game.dialogue) return;
    if (id !== 'hub') return;
    if (!game.flags.smartDisobeyed || game.flags.smartRematchDone || game.flags.smartEncounterSeen) return;
    game.flags.smartEncounterSeen = true;
    say([
      { who: 'sys', text: 'Умный мужчина вышел на перекрёсток сам. Без задания.' },
      { who: 'boss', text: 'Ты ослушалась. Я это посчитал.' },
      { who: 'gal', text: 'Считай дальше. Только сначала помечай.' }
    ], () => startBattle(questFoeFor('smartRematch')), 'УМНЫЙ МУЖЧИНА');
    game.dialogue.img = G.images['smart-man'];
  }

  function say(lines, cb, speaker) {
    game.dialogue = new Dialog(speaker || 'sys', lines, cb);
  }

  /* ---------------- dialogue ---------------- */

  function Dialog(speaker, lines, cb) {
    this.speaker = speaker;
    this.lines = (lines || []).filter(Boolean);
    this.i = 0; this.chars = 0; this.cb = cb || null;
    this.onCancel = null;
    this.wrapped = null; this.cacheKey = '';
  }

  Dialog.prototype.cur = function () { return this.lines[this.i] || { text: '' }; };

  Dialog.prototype.update = function (dt) {
    const line = this.cur();
    this.chars += dt * 62;
    if (pressed.x && this.onCancel) {
      const cb = this.onCancel;
      this.onCancel = null;
      game.dialogue = null;
      AU.sfx('back');
      cb();
      return true;
    }
    if (pressed.z) {
      if (this.chars < line.text.length) {
        this.chars = line.text.length;
      } else {
        AU.sfx('select');
        this.i++;
        this.chars = 0;
        this.wrapped = null;
        if (this.i >= this.lines.length) {
          const cb = this.cb;
          this.cb = null;
          game.dialogue = null;
          if (cb) cb();
          return true;
        }
      }
    }
    return false;
  };

  Dialog.prototype.draw = function (x, y, w, h, nameOverride) {
    A.panel(ctx, x, y, w, h, { border: '#f0f2ff', inner: '#4b4f78' });
    const line = this.cur();
    let who = nameOverride || this.speaker;
    if (line.who) {
      if (line.who === 'boss') who = this.speaker === 'npc' ? (this.npcName || '???') : (game.battle ? game.battle.boss.name : '???');
      else if (line.who === 'gal') who = 'ГАЛЬКА';
      else if (line.who === 'sys') who = null;
      else if (line.who === 'crew') who = this.npcName || 'ПАЦАН';
      else who = String(line.who).toUpperCase();
    }
    if (who) {
      const tw = A.measure(ctx, who, 12) + 18;
      A.px(ctx, x + 12, y - 12, tw, 22, '#0b0d1c');
      A.px(ctx, x + 12, y - 12, tw, 2, '#f0f2ff');
      A.px(ctx, x + 12, y + 8, tw, 2, '#f0f2ff');
      A.text(ctx, who, x + 21, y + 3, { size: 12, color: '#ffe6a0', shadow: false });
    }
    let img = this.img || null;
    if (line.who === 'gal') img = heroImage();
    else if (line.who === 'sys') img = null;
    const textX = img ? x + 96 : x + 22;
    const textW = img ? w - 120 : w - 42;
    if (img && img.complete && img.naturalWidth > 0) {
      A.portrait(ctx, img, x + 12, y + 14, 72, 78, { bg: '#0d1020', t: T, zoom: 1.05 });
      A.px(ctx, x + 12, y + 14, 72, 2, '#ffe6a0');
      A.px(ctx, x + 12, y + 90, 72, 2, '#ffe6a0');
    }
    const big = document.body.classList.contains('touch-mode');
    const fontSize = big ? 17 : 15;
    const key = line.text + '|' + textW + '|' + who + '|' + (img ? 1 : 0) + '|' + fontSize;
    if (this.cacheKey !== key) {
      this.cacheKey = key;
      this.wrapped = A.wrap(ctx, line.text, textW, fontSize);
    }
    const visible = Math.floor(this.chars);
    let left = visible;
    const ty = y + 34;
    const maxLines = Math.max(2, Math.floor((h - 34) / 23));
    for (let i = 0; i < this.wrapped.length && i < maxLines; i++) {
      const txt = this.wrapped[i].slice(0, Math.max(0, left));
      left -= this.wrapped[i].length;
      A.text(ctx, txt, textX, ty + i * 23, { size: fontSize, color: '#eaf0ff', shadow: false });
    }
    if (visible >= line.text.length && Math.floor(T * 2) % 2 === 0) {
      A.text(ctx, '▼', x + w - 28, y + h - 16, { size: 14, color: '#ffe6a0', shadow: false });
    }
  };

  /* ---------------- particles & toast ---------------- */

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < (n || 12); i++) {
      const a = Math.random() * TAU, s = (speed || 90) * (0.3 + Math.random());
      game.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.6, max: 1.1, color,
        size: 2 + Math.floor(Math.random() * 3)
      });
    }
  }

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 60 * dt; p.life -= dt;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
  }

  function drawParticles() {
    game.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.6));
      A.px(ctx, p.x, p.y, p.size, p.size, p.color);
    });
    ctx.globalAlpha = 1;
  }

  function showToast(text) { toast = { text, time: 2.3 }; }

  /* ---------------- overworld ---------------- */

  function solidAt(x, y, w, h) {
    const solids = ROOMS[game.roomId].solids || [];
    for (const s of solids) {
      if (x + w > s[0] && x < s[0] + s[2] && y + h > s[1] && y < s[1] + s[3]) return true;
    }
    return false;
  }

  function movePlayer(dx, dy) {
    const p = game.player, bw = 20, bh = 12;
    let nx = Math.max(14, Math.min(W - 14, p.x + dx));
    if (!solidAt(nx - bw / 2, p.y - bh / 2, bw, bh)) p.x = nx;
    let ny = Math.max(30, Math.min(H - 16, p.y + dy));
    if (!solidAt(p.x - bw / 2, ny - bh / 2, bw, bh)) p.y = ny;
  }

  function nearestNpc(x, y) {
    const px = x == null ? game.player.x : x;
    const py = y == null ? game.player.y : y;
    const list = (ROOMS[game.roomId].npcs || []).filter(n => game.chapter === 2 || !isCh2Npc(n));
    let best = null, bd = 1e9;
    for (const n of list) {
      const d = Math.hypot(n.x - px, n.y - py);
      if (d < bd) { bd = d; best = n; }
    }
    return bd < 56 ? best : null;
  }

  function npcTalk(n) {
    if (n.id === 'questLog') {
      const done = game.questsDone || 0, total = (G.QUESTS || []).length;
      const lines = [
        { who: 'sys', text: 'ВЫПОЛНЕНО ДЕЛ: ' + done + ' / ' + total },
        { who: 'sys', text: game.flags.smartLost ? 'УМНЫЙ МУЖЧИНА: ты проиграла проверку. Он тебя пощадил и оставил список.' : 'УМНЫЙ МУЖЧИНА: ещё не проверял тебя. Он стоит на перекрёстке.' },
        { who: 'sys', text: game.flags.smartDisobeyed ? 'ОСЛУШАНИЕ: есть. Он придёт сам, вне заданий.' : 'ОСЛУШАНИЕ: пока нет.' },
        { who: 'sys', text: game.flags.smartRematchDone ? 'ВСТРЕЧА ВНЕ КВЕСТОВ: состоялась.' : 'ВСТРЕЧА ВНЕ КВЕСТОВ: ещё впереди, если ослушаешься.' },
        { who: 'gal', text: 'Пятьдесят дел. Без объяснений.' }
      ];
      say(lines);
      return;
    }
    /* Chapter 2 has its own missions. Old quests must not let the player
       replay/finish chapter 1 while inside chapter 2. */
    if (game.chapter === 2 && (n.questDuel || n.questFoe || n.questItem || n.quest)) {
      sayCh2([{ who: 'sys', text: 'Сейчас не до старых дел. Только задания старшего пацана.' }]);
      return;
    }
    if (game.chapter === 2 && (n.ch2Boss || n.ch2Spy || n.ch2Ambush || n.ch2Boy || n.ch2Finale ||
        (n.boss && (G.CH2_MISSIONS || []).some(x => x.boss === n.boss)))) {
      const missions = G.CH2_MISSIONS || [];
      const m = missions[game.ch2Mission];
      const ambushNpcId = m && m.boss === 'director' ? 'director' : 'amb_' + (m && m.boss);
      if (n.boss && m && m.boss === n.boss) {
        if (n.id !== ambushNpcId) {
          sayCh2([{ who: 'sys', text: 'Не здесь. Старший пацан сказал ждать на маршруте.' }]);
          return;
        }
        if (!game.flags['ch2Report_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Сначала шпионь и доложи. Потом — разборка.' }]);
          return;
        }
        if (game.flags['ch2Done_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Здесь уже разобрались. Иди к забору.' }]);
          return;
        }
        sayCh2(m.ambush, () => startBattle(bossById(m.boss), { ch2: true }), m.short);
        return;
      }
      if (n.boss) {
        sayCh2([{ who: 'sys', text: 'Не сейчас. Сначала сделай дело, которое дал старший пацан.' }]);
        return;
      }
      if (n.ch2Finale) {
        if (game.ch2Mission < missions.length) {
          sayCh2([
            { who: 'crew', text: 'Не сейчас. Сначала все перехваты.' },
            { who: 'sys', text: 'Осталось: ' + (missions.length - game.ch2Mission) + '.' }
          ]);
          return;
        }
        showChapter2Finale();
        return;
      }
      if (n.ch2Boy) {
        /* ровный пацан — без чужой картинки, просто имя в диалоге */
        sayCh2([
          { who: 'crew', text: 'Мы не доминируем. Мы просто пришились и держимся вместе.' },
          { who: 'gal', text: 'Я поняла. Без объяснений.' }
        ], null, 'РОВНЫЙ ПАЦАН');
        return;
      }
      if (n.ch2Boss) {
        if (!m) {
          sayCh2([
            { who: 'crew', text: 'Все перехваты сделаны. Сын директора НЕ БУДЕТ ПОМНИТЬ ЭТОТ ДЕНЬ.' },
            { who: 'gal', text: 'Поняла. Забор ждёт.' }
          ]);
          return;
        }
        if (!game.flags['ch2Spy_' + m.boss]) {
          game.flags['ch2Active_' + m.boss] = true;
          sayCh2(m.intro, null, 'СТАРШИЙ ПАЦАН');
          showToast('ГЛАВА 2 · ДЕЛО: ' + m.short);
          return;
        }
        if (!game.flags['ch2Report_' + m.boss]) {
          game.flags['ch2Report_' + m.boss] = true;
          sayCh2(m.report, null, 'СТАРШИЙ ПАЦАН');
          showToast('✦ ПЕРЕХВАТ ОТКРЫТ: ' + m.short);
          return;
        }
        if (!game.flags['ch2Done_' + m.boss]) {
          sayCh2([
            { who: 'crew', text: 'Ты уже доложила. Иди на перехват — ' + m.short + ' на маршруте.' },
            { who: 'gal', text: 'Иду.' }
          ]);
          return;
        }
        saveGame();
        const next = missions[game.ch2Mission];
        if (!next) {
          sayCh2([
            { who: 'crew', text: 'Дело закрыто. Вечером разборка с пацанами из другого района.' },
            { who: 'sys', text: 'Иди к забору. Там ждёт выбор.' }
          ]);
          showToast('✦ ВСЕ ПЕРЕХВАТЫ ВЫПОЛНЕНЫ. ФИНАЛ ГЛАВЫ 2 ОТКРЫТ.');
        } else {
          sayCh2([
            { who: 'crew', text: 'Принято. Следующее дело — ' + next.short + '.' },
            { who: 'gal', text: 'Без объяснений.' }
          ]);
          showToast('ГЛАВА 2 · ДЕЛО: ' + next.short);
        }
        return;
      }
      if (n.ch2Spy) {
        if (!m || m.boss !== n.ch2Spy) {
          sayCh2([{ who: 'sys', text: 'Сейчас не это дело. Спроси у старшего пацана.' }]);
          return;
        }
        if (!game.flags['ch2Active_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Сначала возьми задание у старшего пацана.' }]);
          return;
        }
        if (game.flags['ch2Spy_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Информация уже записана. Доложи старшему.' }]);
          return;
        }
        game.flags['ch2Spy_' + m.boss] = true;
        sayCh2(m.spy, null, m.short);
        showToast('✦ ИНФОРМАЦИЯ ПОЛУЧЕНА. ДОЛОЖИ СТАРШЕМУ ПАЦАНУ.');
        AU.sfx('save');
        return;
      }
      if (n.ch2Ambush) {
        if (!m || m.boss !== n.ch2Ambush) {
          sayCh2([{ who: 'sys', text: 'Этот перехват пока не нужен.' }]);
          return;
        }
        if (!game.flags['ch2Report_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Сначала посмотри и доложи. Перехват не просто так.' }]);
          return;
        }
        if (game.flags['ch2Done_' + m.boss]) {
          sayCh2([{ who: 'sys', text: 'Здесь уже разобрались.' }]);
          return;
        }
        sayCh2(m.ambush, () => startBattle(bossById(m.boss), { ch2: true }), m.short);
        return;
      }
    }
    if (n.warp) {
      const w = n.warp;
      say(n.lines || [{ who: 'sys', text: 'Ты пошла по указателю.' }], () => {
        AU.sfx('door');
        enterRoom(w.room, { x: w.x, y: w.y });
      });
      return;
    }
    if (n.questDuel === 'smartFirst') {
      if (!game.flags.smartLost) { startBattle(questFoeFor('smartFirst')); return; }
      say([
        { who: 'boss', text: 'Ты уже проиграла. Теперь делай список.' },
        { who: 'gal', text: 'Список у меня. Без объяснений.' }
      ]);
      game.dialogue.img = G.images['smart-man'];
      game.dialogue.npcName = 'УМНЫЙ МУЖЧИНА';
      return;
    }
    if (n.questFoe) {
      const q = (G.QUESTS || []).find(x => x.id === n.questFoe);
      if (!q) return;
      if (game.flags['qdone_' + q.id] || game.flags['qfoe_' + q.id] || game.flags['qitem_' + q.id]) {
        say([{ who: 'sys', text: 'Здесь уже разобрались. Иди к тому, кто просил.' }]);
        return;
      }
      game.flags['qstart_' + q.id] = true;
      startBattle(questFoeFor(q.foe, q.id));
      return;
    }
    if (n.questItem) {
      const q = (G.QUESTS || []).find(x => x.id === n.questItem);
      if (!q) return;
      if (game.flags['qitem_' + q.id]) {
        say([{ who: 'sys', text: q.item + ' уже у тебя. Отнеси ' + G.NEWCHARS[q.char].name + '.' }]);
      } else {
        game.flags['qitem_' + q.id] = true;
        say([{ who: 'sys', text: '✦ НАЙДЕНО: ' + q.item + '. Отнеси ' + G.NEWCHARS[q.char].name + '.' }]);
        showToast('✦ ' + q.item + ' — отнеси ' + G.NEWCHARS[q.char].name);
        AU.sfx('save');
      }
      return;
    }
    if (n.quest) {
      const q = (G.QUESTS || []).find(x => x.id === n.quest);
      if (!q) return;
      game.dialogue = null;
      if (game.flags['qdone_' + q.id]) {
        say([{ who: 'sys', text: 'Дело уже закрыто. ' + q.title }]);
      } else if (game.flags['qitem_' + q.id]) {
        game.flags['qdone_' + q.id] = true;
        game.questsDone++;
        game.maxHp += 2;
        game.hp = Math.min(game.maxHp, game.hp + 2);
        game.inv.candy = (game.inv.candy || 0) + 1;
        if (q.rival) {
          game.flags.smartDisobeyed = true;
          game.flags['ally_' + q.char] = (game.flags['ally_' + q.char] || 0) + 1;
        }
        say(q.doneLines);
        showToast('✦ ДЕЛО: ' + q.title + '  (' + game.questsDone + '/' + G.QUESTS.length + ')');
        AU.sfx('save');
      } else {
        game.flags['qstart_' + q.id] = true;
        say(q.lines);
        game.dialogue.onCancel = () => {
          game.flags['qdisobey_' + q.id] = true;
          if (!q.rival) {
            game.flags.smartDisobeyed = true;
            say([
              { who: 'gal', text: 'Не буду. И объяснять не буду.' },
              { who: 'sys', text: 'Умный мужчина услышал отказ. Он придёт сам.' }
            ]);
          } else {
            say([
              { who: 'gal', text: 'Не буду. У меня и так дел хватает.' },
              { who: 'sys', text: 'Ты отказала. Это не ослушание умного — просто отказ.' }
            ]);
          }
        };
      }
      game.dialogue.img = G.images[q.char];
      game.dialogue.npcName = G.NEWCHARS[q.char].name;
      return;
    }
    if (n.char && G.NEWCHARS[n.char]) {
      say(n.lines || G.NEWCHARS[n.char].lines, null, 'npc');
      game.dialogue.npcName = n.name;
      game.dialogue.img = G.images[n.char];
      return;
    }
    if (n.save) {
      game.hp = game.maxHp;
      saveGame();
      say([{ who: 'sys', text: '✦ Точка сохранения. Силы восстановлены.' }]);
      return;
    }
    if (n.boss) {
      const b = bossById(n.boss);
      if (n.needBoss && !game.defeated[n.needBoss]) {
        const g = bossById(n.needBoss);
        say([{ who: 'sys', text: 'Сначала разберись с «' + g.name + '». Она стоит ближе к доске.' }]);
        AU.sfx('back');
        return;
      }
      if (!game.defeated[b.id]) { startBattle(b); return; }
      say([{ who: 'boss', text: 'Галька. Опять ты.' },
           { who: 'gal', text: 'Без драки. Иду дальше.' }]);
      game.dialogue.img = G.images[b.id];
      return;
    }
    say(n.lines, null, 'npc');
    game.dialogue.npcName = n.name;
    if (n.boss && G.images[n.boss]) game.dialogue.img = G.images[n.boss];
    if (n.id === 'cat') game.dialogue.img = null;
    const alreadyTaken = !!(n.flag && game.flags[n.flag]);
    if (n.flag) game.flags[n.flag] = true;
    if (n.give && !alreadyTaken) {
      Object.keys(n.give).forEach(k => { game.inv[k] = (game.inv[k] || 0) + n.give[k]; });
      AU.sfx('save');
      if (n.flag) showToast('✦ НАЙДЕНО: ' + (n.flag === 'canteenNotebook' ? 'ТЕТРАДЬ АБАЮНДЫ' : n.flag === 'kioskPaper' ? 'ГАЗЕТА' : n.flag === 'tunnelGraffiti' ? 'ГРАФФИТИ' : 'ДОКЛАД'));
    } else if (n.give) {
      showToast('Ты уже забирала это. Больше не дают.');
    }
  }

  function updateOverworld(dt) {
    const p = game.player, room = ROOMS[game.roomId];
    /* Guests keep walking even while the host is reading a dialogue. */
    if (netMode === 'host' && netPlayers.length > 1 && !game.fade) {
      for (let i = 1; i < netPlayers.length; i++) {
        const q = netPlayers[i], inp = netInputFor(i);
        if (inp && inp.v && inp.v.mag > 0) {
          const v = inp.v;
          let nx = Math.max(14, Math.min(W - 14, q.x + v.x * 132 * dt * v.mag));
          if (!solidAt(nx - 10, q.y - 6, 20, 12)) q.x = nx;
          let ny = Math.max(30, Math.min(H - 16, q.y + v.y * 132 * dt * v.mag));
          if (!solidAt(q.x - 10, ny - 6, 20, 12)) q.y = ny;
        }
        if (takeNetZ(i) && !game.dialogue) {
          const n = nearestNpc(q.x, q.y);
          if (n) { AU.sfx('select'); npcTalk(n); }
        }
        /* A guest walking into a door must move EVERYONE, not only the host. */
        let went = false;
        for (const ex of roomExits(game.roomId)) {
          if (q.x > ex.x && q.x < ex.x + ex.w && q.y > ex.y && q.y < ex.y + ex.h) {
            if (!ex.need || defeatedCount() >= ex.need) {
              AU.sfx('door');
              enterRoom(ex.to, { x: ex.sx, y: ex.sy });
              went = true;
            }
            break;
          }
        }
        if (went) return;
      }
    }
    if (!game.dialogue && !game.fade) {
      const mv = moveInput();
      const vx = mv.vx, vy = mv.vy;
      if (mv.mag > 0) {
        if (Math.abs(vx) > Math.abs(vy)) p.dir = vx < 0 ? 'left' : 'right';
        else p.dir = vy < 0 ? 'up' : 'down';
        p.walkT += dt * 9 * mv.mag;
        p.frame = 1 + Math.floor(p.walkT) % 2;
        movePlayer(vx * 132 * dt * mv.mag, vy * 132 * dt * mv.mag);
      } else p.frame = 0;

      for (const ex of roomExits(game.roomId)) {
        if (p.x > ex.x && p.x < ex.x + ex.w && p.y > ex.y && p.y < ex.y + ex.h) {
          if (ex.need && defeatedCount() < ex.need) {
            if (toast.time <= 0) {
              showToast('Кабинет закрыт: сначала разберись с ' + ex.need + ' боссами (' + defeatedCount() + '/' + ex.need + ')');
              AU.sfx('back');
              p.y += 34;
            }
          } else {
            AU.sfx('door');
            enterRoom(ex.to, { x: ex.sx, y: ex.sy });
          }
          break;
        }
      }

      const autoMarker = activeCh2MarkerNear();
      if (autoMarker) {
        AU.sfx('select');
        ch2MarkerCooldown = 1.0;
        npcTalk(autoMarker);
      } else if (pressed.z) {
        const n = nearestNpc();
        if (n) { AU.sfx('select'); npcTalk(n); }
      }
    } else if (game.dialogue) {
      game.dialogue.update(dt);
    }
  }

  function drawOverworld() {
    A.drawRoom(ctx, game.roomId, T, game);
    const room = ROOMS[game.roomId];

    // exits markers
    roomExits(game.roomId).forEach(ex => {
      const cx = ex.x + ex.w / 2, cy = ex.y + ex.h / 2;
      ctx.globalAlpha = 0.35 + 0.12 * Math.sin(T * 3);
      A.px(ctx, cx - 26, cy - 10, 52, 20, '#000');
      ctx.globalAlpha = 1;
      A.text(ctx, ex.label, cx, cy + 4, { size: 10, color: '#fff4c8', align: 'center', shadow: false });
    });

    // NPCs
    room.npcs.forEach(n => {
      if (game.chapter !== 2 && isCh2Npc(n)) return; // chapter 2 markers are invisible in chapter 1
      if (n.ch2Finale) {
        // A real wooden fence between the districts — not a person.
        A.px(ctx, n.x - 28, n.y - 26, 8, 50, '#4b3322');
        A.px(ctx, n.x + 20, n.y - 26, 8, 50, '#4b3322');
        [n.y - 22, n.y - 7, n.y + 8].forEach(yy => {
          A.px(ctx, n.x - 30, yy, 60, 7, '#8a6442');
          A.px(ctx, n.x - 30, yy, 60, 2, '#b58a5e');
        });
        A.text(ctx, 'ЗАБОР', n.x, n.y - 38, { size: 9, color: '#ffe6a0', align: 'center', shadow: false });
      } else if (n.ch2Spy || n.ch2Ambush) {
        const spy = !!n.ch2Spy;
        const active = spy
          ? !!game.flags['ch2Active_' + n.ch2Spy] && !game.flags['ch2Spy_' + n.ch2Spy]
          : !!game.flags['ch2Report_' + n.ch2Ambush] && !game.flags['ch2Done_' + n.ch2Ambush];
        ctx.globalAlpha = active ? 1 : 0.4;
        ctx.fillStyle = spy ? '#8ff5ff' : '#ff8fb8';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = active ? 16 : 0;
        ctx.fillRect(n.x - 12, n.y - 8, 24, 22);
        ctx.shadowBlur = 0;
        A.text(ctx, spy ? '?' : '!', n.x, n.y + 2, { size: 15, color: '#0b1020', align: 'center', shadow: false });
        A.text(ctx, spy ? 'СЛЕД' : 'ПЕРЕХВАТ', n.x, n.y - 18, {
          size: 8, color: spy ? '#8ff5ff' : '#ffb3ce', align: 'center', shadow: false
        });
        ctx.globalAlpha = 1;
      } else if (n.save) {
        const s = 8 + Math.sin(T * 3) * 2;
        ctx.save();
        ctx.translate(n.x, n.y - 6);
        ctx.rotate(T * 0.7);
        ctx.fillStyle = '#ffe6a0';
        ctx.shadowColor = '#ffd070'; ctx.shadowBlur = 16;
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.fillRect(-2, -s, 4, s);
        }
        ctx.restore();
      } else if (n.boss) {
        const b = bossById(n.boss);
        const friendly = !!game.defeated[b.id];
        const locked = n.needBoss && !game.defeated[n.needBoss];
        ctx.globalAlpha = friendly ? 0.7 : locked ? 0.45 : 1;
        A.drawChar(ctx, G.images[b.id], n.x, n.y + 18, 0, {
          width: 44, height: 58, legH: 13,
          legColor: b.colors.dark, bootColor: '#111322',
          outline: friendly ? 'rgba(140,255,200,.45)' : 'rgba(255,255,255,.3)'
        });
        ctx.globalAlpha = 1;
        if (!friendly) {
          A.text(ctx, locked ? '🔒' : '!', n.x, n.y - 42 + Math.sin(T * 4) * 3, {
            size: 18, color: locked ? '#8f96bb' : '#ffe08a', align: 'center'
          });
        }
      } else if (n.id === 'cat') {
        A.px(ctx, n.x - 10, n.y - 2, 20, 12, '#23203a');
        A.px(ctx, n.x - 10, n.y - 12, 6, 12, '#23203a');
        A.px(ctx, n.x + 4, n.y - 12, 6, 12, '#23203a');
        A.px(ctx, n.x - 7, n.y - 3, 3, 3, '#ffe08a');
        A.px(ctx, n.x + 4, n.y - 3, 3, 3, '#ffe08a');
        A.px(ctx, n.x + 10, n.y + 2, 10, 3, '#23203a');
      } else if (n.char && G.NEWCHARS[n.char]) {
        const c = G.NEWCHARS[n.char];
        A.drawChar(ctx, G.images[n.char], n.x, n.y + 18, 0, {
          width: 44, height: 58, legH: 13,
          legColor: c.dark, bootColor: '#111322', outline: c.color
        });
        A.text(ctx, c.name, n.x, n.y - 42, { size: 9, color: c.color, align: 'center', shadow: false });
        if (n.quest) {
          const ready = !!game.flags['qitem_' + n.quest];
          const done = !!game.flags['qdone_' + n.quest];
          A.text(ctx, done ? '✓' : ready ? '!' : '?', n.x + 22, n.y - 52 + Math.sin(T * 4) * 3, {
            size: 16, color: done ? '#8affc8' : ready ? '#ffe08a' : '#ff9ec0', align: 'center'
          });
        }
      } else if (n.questItem) {
        const got = !!game.flags['qitem_' + n.questItem];
        ctx.globalAlpha = got ? 0.35 : 1;
        ctx.fillStyle = '#ffd98a';
        ctx.shadowColor = '#ffcf6a'; ctx.shadowBlur = 12;
        ctx.fillRect(n.x - 10, n.y - 6, 20, 14);
        ctx.shadowBlur = 0;
        A.text(ctx, got ? '✓' : '?', n.x, n.y - 16 + Math.sin(T * 5) * 2, { size: 13, color: '#fff', align: 'center' });
        ctx.globalAlpha = 1;
      } else if (n.warp) {
        A.px(ctx, n.x - 3, n.y - 24, 6, 42, '#6a5a48');
        A.px(ctx, n.x - 20, n.y - 30, 40, 18, '#3b4c5c');
        A.text(ctx, '➜', n.x, n.y - 18, { size: 13, color: '#ffe6a0', align: 'center', shadow: false });
      } else {
        // little pupils: same pixel style, distinguishable by colours
        const girl = n.id === 'pupil2';
        A.drawGal(ctx, n.x, n.y + 16, 0, {
          dir: 'down', scale: 1.6,
          colors: girl
            ? { coat: '#7c4a83', coatHi: '#c07fb0', hair: '#4a2c48', hairHi: '#a06a9a', scarf: '#ffd88a' }
            : { coat: '#2c5a7c', coatHi: '#5a9ac0', hair: '#232a3c', hairHi: '#4a6a8c', scarf: '#8fa4ff' }
        });
        A.text(ctx, n.name, n.x, n.y - 30, { size: 9, color: '#dfe6ff', align: 'center', shadow: false });
      }
    });

    /* Remote souls first, own soul last — otherwise your Галька disappears
       behind another one when you stand close together. */
    if (netMode) {
      netPlayers.forEach((q, i) => {
        /* On a guest, index 0 is the HOST and must be drawn.
           Only hide index 0 on the host (that's their own soul). */
        if ((netMode === 'host' && i === 0) || (netMode === 'client' && i === netSelfIndex)) return;
        A.drawChar(ctx, G.images.heroine, q.x, q.y + 16, 0, {
          width: 40, height: 52, legH: 13,
          legColor: i === 1 ? '#3a2a58' : '#243a52', bootColor: '#1b1630', outline: q.color
        });
        A.text(ctx, q.nick.slice(0, 8), q.x, q.y - 34, {
          size: 9, color: q.color, align: 'center', shadow: false
        });
      });
    }
    const p = game.player;
    A.drawChar(ctx, heroImage(), p.x, p.y + 16, p.frame, heroDraw({
      legColor: '#304848', bootColor: '#202236',
      outline: netMode ? netSelfColor() : (game.lov > 2 ? 'rgba(255,143,184,.75)' : 'rgba(255,255,255,.45)')
    }));
    if (netMode) {
      A.text(ctx, (netPlayers[netSelfIndex] || {}).nick || 'ТЫ', p.x, p.y - 34, {
        size: 9, color: netSelfColor(), align: 'center', shadow: false
      });
    }

    drawParticles();

    // HUD
    A.panel(ctx, 12, 10, 176, 62, { fill: 'rgba(8,10,22,.88)', border: '#9fa8d8' });
    A.heart(ctx, 32, 34, 16, '#ff4d6d', T * 4);
    A.text(ctx, 'HP ' + game.hp + '/' + game.maxHp, 46, 30, { size: 13, color: '#fff' });
    A.text(ctx, 'LOV ' + game.lov + '   EXP ' + game.exp, 46, 52, { size: 11, color: '#ffd98a' });
    A.px(ctx, 24, 42, 110, 4, '#22243c');
    A.px(ctx, 24, 42, 110 * Math.max(0, game.hp / game.maxHp), 4, '#ff5d7d');

    A.panel(ctx, 430, 10, 198, 54, { fill: 'rgba(8,10,22,.85)', border: '#9fa8d8' });
    A.text(ctx, room.name, 529, 26, { size: 11, color: '#e8ecff', align: 'center' });
    A.text(ctx, 'КВЕСТЫ ' + (game.questsDone || 0) + '/' + ((G.QUESTS || []).length) + '  ·  МЕСТ ' + Object.keys(ROOMS).length, 529, 48, { size: 9, color: '#ffd98a', align: 'center', shadow: false });
    for (let i = 0; i < BOSSES.length; i++) {
      const b = BOSSES[i];
      A.px(ctx, 438 + i * 19, 40, 12, 5, game.spared[b.id] ? '#8affc8' : game.defeated[b.id] ? '#ff8fb8' : '#3a3d5c');
    }

    drawCh2Objective();

    if (!game.dialogue) {
      const n = nearestNpc();
      if (n) A.text(ctx, 'Z — ' + (n.boss && !game.defeated[n.boss] ? 'ВСТРЕЧА' : 'ПОГОВОРИТЬ'), p.x, p.y - 48, { size: 11, color: '#fff2bd', align: 'center' });
    } else {
      game.dialogue.draw(26, 358, 588, 106);
    }

    if (toast.time > 0) {
      ctx.globalAlpha = Math.min(1, toast.time);
      A.panel(ctx, 90, 134, 460, 42, { fill: 'rgba(10,10,24,.94)', border: '#ff9ec0' });
      A.text(ctx, toast.text, 320, 162, { size: 12, color: '#fff', align: 'center' });
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- battle ---------------- */

  function mkBullet(x, y, vx, vy, o) {
    return Object.assign({
      x, y, vx, vy, r: 6, color: '#fff', life: 9, age: 0,
      kind: 'linear', shape: 'dot', rot: 0, spin: 0
    }, o || {});
  }

  const ATTACK_NAMES = {
    rain: 'ДОЖДЬ', side: 'БОКОВАЯ ВОЛНА', homing: 'СЛЕДОПЫТ', pincer: 'ТИСКИ',
    corner: 'УГЛОВАЯ ЛОВУШКА', ring: 'КОЛЬЦО', spiral: 'СПИРАЛЬ', cross: 'ПЕРЕКРЁСТ',
    laser: 'ПРИЦЕЛ', sweep: 'МЕТЛА', bounce: 'РИКОШЕТ', checker: 'ШАШКИ',
    feathers: 'ПЕРЬЯ', stamps: 'ШТАМПЫ', rocks: 'КАМНИ', beats: 'БИТ',
    fists: 'КУЛАКИ', wave: 'ВОЛНА', flare: 'ВСПЫШКА', drill: 'ДРЕЛЬ'
  };

  function makeBattle(boss, opts) {
    const b0 = opts && opts.ch2 ? chapter2Boss(boss) : boss;
    const arena = b0.id === 'huyet'
      ? { x: 150, y: 108, w: 340, h: 184 }
      : b0.id === 'afina'
        ? { x: 160, y: 106, w: 320, h: 186 }
        : { x: 172, y: 110, w: 296, h: 182 };
    return {
      boss: b0, arena, enemyHp: b0.hp, enemyMax: b0.hp,
      phase: 'entrance', timer: 0, turn: 0, duration: 4.6,
      bullets: [], warns: [], schedule: [], spawnI: 0,
      hx: arena.x + arena.w / 2, hy: arena.y + arena.h - 32,
      h2x: arena.x + arena.w / 2 + 36, h2y: arena.y + arena.h - 32,
      menuIndex: 0, sub: null, subIndex: 0,
      barPos: 0, barDir: 1, slash: 0, shake: 0, flash: 0,
      invuln: 0, dash: 0, dashCd: 0,
      h2Invuln: 0, h2Dash: 0, h2DashCd: 0, netSouls: [],
      usedActs: {}, spareReady: false,
      phaseIdx: 0, phase2: false, phase3: false,
      attackName: '', attackKey: '',
      campTime: 0, campCd: 0, campMsg: 0, campCorner: -1,
      hurtLock: 0, popups: [], winType: null, defeatedGo: false,
      dashUnlocked: true
    };
  }

  function startBattle(boss, opts) {
    game.battle = makeBattle(boss, opts);
    resetNetSouls(game.battle);
    game.dialogue = null;
    state = 'battle';
    AU.setTrack(boss.track || (boss.quest ? 'path' : (boss.id === 'huyet' ? 'huyet' : boss.id)));
    AU.sfx('select');
  }

  function sayBattle(lines, next) {
    game.dialogue = new Dialog(game.battle.boss.name, lines, () => { next(); });
    if (game.battle) game.dialogue.img = bossImage(game.battle.boss);
  }

  function buildSchedule(b) {
    const A0 = b.arena, c = b.boss.colors;
    const list = [];
    const add = (t, fn) => list.push({ t, fn });
    const cx = A0.x + A0.w / 2, bottom = A0.y + A0.h;
    const p2 = b.phaseIdx >= 1, p3 = b.phaseIdx >= 2;
    /* All six guys fight together: more bullets per wave AND several
       different patterns stacked in one turn. Every pattern keeps a gap. */
    const dense = !!b.boss.gang;
    const boost = n => dense ? Math.ceil(n * 1.5) : n;
    const pats = b.boss.patterns || [['rain', 'side']];
    const phasePats = pats[Math.min(b.phaseIdx, pats.length - 1)];
    const key = phasePats[(b.turn - 1) % phasePats.length];
    b.attackKey = key;
    b.attackName = ATTACK_NAMES[key] || 'АТАКА';

    const cols = Math.max(5, Math.round(A0.w / 52));
    const step = (A0.w - 52) / (cols - 1);
    const colX = i => A0.x + 26 + i * step;
    const randGap = () => Math.floor(Math.random() * cols);
    const playerGap = () => Math.max(0, Math.min(cols - 1, Math.round((b.hx - (A0.x + 26)) / step)));

    // Rows with guaranteed open column(s). In late phases the gap follows the
    // heart, so standing still in a corner stops working.
    function rainRows(count, o) {
      o = o || {};
      for (let w = 0; w < count; w++) {
        const gap = o.follow ? -1 : randGap();
        add((o.start || 0.35) + w * (o.step || 0.6), () => {
          const g = o.follow ? playerGap() : gap;
          const gaps = o.double ? [g, (g + Math.ceil(cols / 2)) % cols] : [g];
          for (let i = 0; i < cols; i++) {
            if (gaps.indexOf(i) >= 0) continue;
            b.bullets.push(mkBullet(colX(i) + (Math.random() - 0.5) * 5, A0.y - 12,
              o.spread ? (i - (cols - 1) / 2) * o.spread : (o.vx || 0), o.speed || 125, {
              r: o.r || 6, color: o.color || c.bullet, shape: o.shape || 'dot',
              kind: o.kind || 'linear', spin: o.spin || 0, life: o.life || 3.4,
              baseY: A0.y - 12, amp: o.amp || 0, f: o.f || 2
            }));
          }
        });
      }
    }

    // Classic three-bullet side wave: leaves a safe lane above and below.
    function side(t, o) {
      add(t, () => {
        const top = A0.y + 40, gap = (A0.h - 80) / 2;
        for (let i = 0; i < 3; i++) {
          const y = top + gap * i;
          const x = o.left ? A0.x - 16 : A0.x + A0.w + 16;
          b.bullets.push(mkBullet(x, y, o.left ? o.speed : -o.speed, 0, {
            r: o.r || 6, color: o.color || c.bullet, shape: o.shape || 'dot',
            spin: o.spin || 0, life: 3.6
          }));
        }
      });
    }

    function pincer() {
      add(0.55, () => {
        [bottom - 36, bottom - 74].forEach((y, k) => {
          b.bullets.push(mkBullet(A0.x - 16, y, 155 + k * 20, 0, { r: 6, color: c.bullet, shape: 'diamond', spin: 2, life: 3 }));
          b.bullets.push(mkBullet(A0.x + A0.w + 16, y, -(155 + k * 20), 0, { r: 6, color: c.bullet, shape: 'diamond', spin: -2, life: 3 }));
        });
        [-1, 0, 1].forEach(i => b.bullets.push(mkBullet(cx + i * 52, A0.y - 12, 0, 115, {
          r: 5, color: c.light, shape: 'dot', life: 3
        })));
      });
      if (p2) add(1.8, () => {
        [A0.y + 46, A0.y + 84].forEach((y, k) => {
          b.bullets.push(mkBullet(A0.x - 16, y, 170 + k * 15, 0, { r: 6, color: c.bullet, shape: 'diamond', spin: 2, life: 3 }));
          b.bullets.push(mkBullet(A0.x + A0.w + 16, y, -(170 + k * 15), 0, { r: 6, color: c.bullet, shape: 'diamond', spin: -2, life: 3 }));
        });
      });
    }

    // A short warning appears in the player's current corner, then three
    // bullets fan inward. The warning gives time to step out.
    function cornerTrap() {
      for (let wave = 0; wave < boost(p3 ? 3 : 2); wave++) {
        add(0.4 + wave * (dense ? 0.85 : 1.25), () => {
          const px = b.hx, py = b.hy;
          const left = px < cx, top = py < A0.y + A0.h / 2;
          const ex = left ? A0.x + 8 : A0.x + A0.w - 8;
          const ey = top ? A0.y + 8 : bottom - 8;
          b.warns.push({
            x: left ? A0.x : A0.x + A0.w - 78, y: top ? A0.y : bottom - 78,
            w: 78, h: 78, life: 0.55, max: 0.55, color: '#ff6d8f'
          });
          AU.sfx('warn');
          const ang = Math.atan2(py - ey, px - ex);
          for (let i = -1; i <= 1; i++) {
            const a = ang + i * 0.34;
            b.bullets.push(mkBullet(ex, ey, Math.cos(a) * 145, Math.sin(a) * 145, {
              r: 6, color: '#ff9ec0', shape: 'diamond', spin: 3, life: 3
            }));
          }
        });
      }
    }

    function homing() {
      const starts = [
        { x: A0.x - 14, y: A0.y + 40 },
        { x: A0.x + A0.w + 14, y: A0.y + 40 },
        { x: cx, y: bottom + 14 }
      ];
      (dense ? [0.45, 1.35, 2.25] : [0.45, 1.7]).forEach((t, wave) => add(t, () => {
        starts.slice(0, boost(p3 ? 3 : 2)).forEach((s, i) => {
          const a = Math.atan2(b.hy - s.y, b.hx - s.x) + (wave ? (i - 1) * 0.25 : 0);
          const speed = p3 ? 100 : 88;
          b.bullets.push(mkBullet(s.x, s.y, Math.cos(a) * speed, Math.sin(a) * speed, {
            r: 6, color: i % 2 ? '#ff8fb8' : c.light, shape: 'tear',
            kind: 'seek', speed, turn: p3 ? 1.25 : 0.85, life: 4.2, spin: 2
          }));
        });
      }));
    }

    function ringBurst() {
      add(0.55, () => {
        const n = boost(p3 ? 18 : 14), gapA = Math.random() * TAU;
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU;
          const diff = Math.abs(((a - gapA + Math.PI * 3) % TAU) - Math.PI);
          if (diff < 0.5) continue;
          b.bullets.push(mkBullet(cx, A0.y + 76, Math.cos(a) * 112, Math.sin(a) * 112, {
            r: 5, color: c.bullet, shape: 'dot', life: 3.2
          }));
        }
      });
    }

    function spiralBurst() {
      for (let w = 0; w < boost(p3 ? 6 : 4); w++) {
        add(0.4 + w * (dense ? 0.26 : 0.34), () => {
          for (let k = 0; k < (dense ? 6 : 4); k++) {
            const a = w * 0.62 + k * (dense ? TAU / 6 : Math.PI / 2);
            b.bullets.push(mkBullet(cx, A0.y + 76, Math.cos(a) * 96, Math.sin(a) * 96, {
              r: 5, color: k % 2 ? c.bullet : c.light, shape: 'diamond', spin: 4, life: 2.6
            }));
          }
        });
      }
    }

    function crossBurst() {
      add(0.5, () => {
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2;
          for (let j = 0; j < boost(3); j++) {
            const d = 26 + j * 28;
            b.bullets.push(mkBullet(cx + Math.cos(a) * d, A0.y + 72 + Math.sin(a) * d,
              Math.cos(a) * 118, Math.sin(a) * 118, {
              r: 5, color: i % 2 ? c.bullet : c.light, shape: 'dot', life: 3
            }));
          }
        }
      });
    }

    function sweepRows() {
      for (let w = 0; w < boost(p3 ? 5 : 4); w++) {
        add(0.35 + w * (dense ? 0.48 : 0.62), () => {
          const g = oFollow();
          for (let i = 0; i < cols; i++) {
            if (i === g) continue;
            b.bullets.push(mkBullet(colX(i), A0.y - 12, i < g ? 24 : -24, 138, {
              r: 6, color: c.bullet, shape: 'diamond', spin: 3, life: 3.2
            }));
          }
        });
      }
      function oFollow() { return p3 ? playerGap() : randGap(); }
    }

    // Two telegraphed columns aimed next to the heart. The aimed columns are
    // dangerous, but the lanes between and beside them stay open.
    function laserLanes() {
      const g = playerGap();
      /* The heart's own column stays open; only neighbours are aimed at. */
      (dense
        ? [Math.max(0, g - 2), Math.max(0, g - 1), Math.min(cols - 1, g + 1), Math.min(cols - 1, g + 2)]
        : [Math.max(0, g - 1), Math.min(cols - 1, g + 1)]).forEach(i => {
        const x = colX(i);
        b.warns.push({ x: x - 15, y: A0.y, w: 30, h: A0.h, life: 0.95, max: 0.95, color: '#ff5d7d' });
        AU.sfx('warn');
        add(1.0, () => {
          for (let k = 0; k < 7; k++) {
            b.bullets.push(mkBullet(x, A0.y - 10 + k * 29, 0, 235, {
              r: 5, color: '#ff6d8f', shape: 'diamond', spin: 5, life: 2.1
            }));
          }
        });
      });
    }

    function bounceShots() {
      (dense ? [0.45, 1.3, 2.15] : [0.45, 1.7]).forEach((t, wave) => add(t, () => {
        [-1, 1].forEach(s => b.bullets.push(mkBullet(
          s < 0 ? A0.x + 18 : A0.x + A0.w - 18, A0.y + 36 + wave * 46,
          s * 145, 74, {
            r: 7, color: c.light, shape: 'square', kind: 'bounce',
            bounces: 2, spin: 2, life: 3.6
          })));
      }));
    }

    function checkerRows() {
      for (let w = 0; w < boost(4); w++) {
        add(0.4 + w * 0.72, () => {
          const shift = w % 2;
          for (let i = 0; i < cols; i++) {
            if ((i + shift) % 2 === 0) continue;
            b.bullets.push(mkBullet(colX(i), A0.y - 12, 0, 122, {
              r: 5, color: c.bullet, shape: 'square', spin: 1.6, life: 3.2
            }));
          }
        });
      }
    }

    function rockFall() {
      const waves = boost(p3 ? 6 : 5);
      for (let w = 0; w < waves; w++) {
        add(0.4 + w * (dense ? 0.62 : 0.8), () => {
          for (let i = 0; i < boost(3); i++) {
            const x = A0.x + 55 + i * (A0.w - 110) / 2 + (Math.random() - 0.5) * 16;
            b.bullets.push(mkBullet(x, A0.y - 14, 0, 55, {
              r: 10, color: '#cfcfd8', shape: 'square', kind: 'accel',
              ay: p2 ? 92 : 62, spin: 1.4, life: 3.8
            }));
          }
        });
      }
    }

    function fistSlam() {
      /* Big square fists fall everywhere except a clearly marked safe lane. */
      const waves = boost(3);
      for (let w = 0; w < waves; w++) {
        add(0.5 + w * (dense ? 0.68 : 0.9), () => {
          const g = playerGap();
          const safe = dense ? 2 : 1;
          b.warns.push({
            x: colX(g) - step * (safe + 0.5), y: A0.y,
            w: step * (safe * 2 + 1), h: A0.h,
            life: 0.45, max: 0.45, color: '#8affc8'
          });
          for (let i = 0; i < cols; i++) {
            if (Math.abs(i - g) <= safe) continue;
            b.bullets.push(mkBullet(colX(i), A0.y - 16, 0, 145, {
              r: dense ? 14 : 12, color: '#ffd08a', shape: 'square', spin: 0.7, life: 3
            }));
          }
        });
      }
    }

    function waveSweep() {
      const waves = boost(2), lanes = boost(5);
      for (let w = 0; w < waves; w++) {
        add(0.45 + w * (dense ? 0.8 : 1.15), () => {
          const dir = w % 2 ? 1 : -1;
          for (let i = 0; i < lanes; i++) {
            const y = A0.y + 26 + i * (A0.h - 52) / (lanes - 1);
            b.bullets.push(mkBullet(dir > 0 ? A0.x - 16 : A0.x + A0.w + 16, y, dir * 132, 0, {
              r: 6, color: c.light, shape: 'diamond', spin: 2.5, life: 3.2,
              kind: 'sine', baseY: y, amp: dense ? 22 : 14, f: 2.4
            }));
          }
        });
      }
    }

    function flareBurst() {
      const centers = boost(2);
      for (let w = 0; w < centers; w++) {
        add(0.5 + w * 0.78, () => {
          const ox = A0.x + 54 + (A0.w - 108) * w / Math.max(1, centers - 1);
          const oy = A0.y + 72;
          const aim = Math.atan2(b.hy - oy, b.hx - ox);
          const n = boost(12);
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU;
            const diff = Math.abs(((a - aim + Math.PI * 3) % TAU) - Math.PI);
            if (diff < 0.55) continue;
            b.bullets.push(mkBullet(ox, oy, Math.cos(a) * 112, Math.sin(a) * 112, {
              r: 5, color: '#ffd08a', shape: 'diamond', spin: 3, life: 2.9
            }));
          }
        });
      }
    }

    function drillSpiral() {
      const arms = dense ? 6 : 4, waves = boost(6);
      for (let w = 0; w < waves; w++) {
        add(0.3 + w * (dense ? 0.24 : 0.34), () => {
          for (let k = 0; k < arms; k++) {
            const a = w * 0.52 + k * TAU / arms;
            b.bullets.push(mkBullet(cx, A0.y + 76, Math.cos(a) * 102, Math.sin(a) * 102, {
              r: 5, color: k % 2 ? c.bullet : c.light, shape: 'dot', life: 2.5
            }));
          }
        });
      }
    }

    function emit(k) {
      switch (k) {
        case 'rain': rainRows(boost(p3 ? 6 : 4), { follow: p2, double: p3 || dense, step: dense ? 0.42 : 0.6, speed: p2 ? 140 : 115, color: c.bullet }); break;
        case 'feathers': rainRows(boost(p3 ? 6 : 4), { follow: p2, spread: p2 ? 18 : 12, speed: 128, r: 6, shape: 'diamond', color: '#ffe6a0', spin: 3 }); break;
        case 'stamps': rainRows(boost(p3 ? 7 : 5), { follow: p2, double: p3 || dense, speed: p2 ? 165 : 140, r: 8, shape: 'square', color: '#ff6d8f', spin: 2.4 }); break;
        case 'beats': rainRows(boost(p3 ? 8 : 6), { follow: true, double: p3 || dense, start: 0.3, step: dense ? 0.34 : 0.46, speed: p2 ? 220 : 185, r: 5, color: '#ff8f6a', life: 2.8 }); break;
        case 'rocks': rockFall(); break;
        case 'side':
          side(0.9, { left: true, speed: p2 ? 190 : 150, r: 6, color: c.bullet });
          side(1.9, { left: false, speed: p2 ? 200 : 160, r: 6, color: c.light });
          if (p2 || dense) side(2.8, { left: true, speed: 210, r: 5, color: c.bullet });
          if (dense) side(3.6, { left: false, speed: 225, r: 5, color: '#ffd08a' });
          break;
        case 'pincer': pincer(); break;
        case 'corner': cornerTrap(); break;
        case 'homing': homing(); break;
        case 'ring': ringBurst(); break;
        case 'spiral': spiralBurst(); break;
        case 'cross': crossBurst(); break;
        case 'sweep': sweepRows(); break;
        case 'laser': laserLanes(); break;
        case 'bounce': bounceShots(); break;
        case 'checker': checkerRows(); break;
        case 'fists': fistSlam(); break;
        case 'wave': waveSweep(); break;
        case 'flare': flareBurst(); break;
        case 'drill': drillSpiral(); break;
        default: rainRows(4, { speed: 120 });
      }
    }
    emit(key);
    if (dense) {
      /* Six attackers = three different patterns at once, every turn. */
      const extras = phasePats.filter(k => k !== key);
      emit(extras.length ? extras[(b.turn - 1) % extras.length] : key);
      emit(extras.length > 1 ? extras[b.turn % extras.length] : key);
      b.attackName = 'ШЕСТЕРО · ' + b.attackName;
    }

    list.sort((a, c2) => a.t - c2.t);
    return list;
  }

  /* The smart man hits for the whole bar. In the FIRST duel that triggers his
     one-time scripted mercy (the 50 quests); everywhere else it is a real KO. */
  function playerHitDamage(b) {
    if (isSmartBoss(b.boss)) return game.maxHp + 1;
    return Math.max(1, Math.round(b.boss.atk * (game.spared[b.boss.id] ? 0.5 : 0.85)));
  }
  function fatalHit(b) {
    if (game.hp > 0) return false;
    /* First duel only: he wins, spares Галька and gives the 50 quests.
       The flag is set inside questDefeat, so this can never repeat. */
    if (isSmartBoss(b.boss) && !b.boss.rematch && !game.flags.smartLost) {
      questDefeat(b);
      return true;
    }
    game.hp = 0;
    state = 'gameover';
    AU.setTrack('title');
    return true;
  }

  function enemyAttack() {
    const b = game.battle;
    b.turn++;
    b.phase = 'dodge';
    b.timer = 0;
    b.bullets = [];
    b.warns = [];
    b.campTime = 0; b.campCd = 0; b.campMsg = 0; b.campCorner = -1;
    b.spawnI = 0;
    b.hx = b.arena.x + b.arena.w / 2;
    b.hy = b.arena.y + b.arena.h - 32;
    b.h2x = b.arena.x + b.arena.w / 2 + 36;
    b.h2y = b.arena.y + b.arena.h - 32;
    resetNetSouls(b);
    b.schedule = buildSchedule(b);
    b.duration = (b.schedule.length ? b.schedule[b.schedule.length - 1].t : 3) + 1.6;
    AU.sfx('charge');
  }

  function phaseIndexFor(b) {
    const ph = b.boss.phases || [{ at: 1 }];
    let idx = 0;
    for (let i = 0; i < ph.length; i++) {
      if (b.enemyHp <= b.enemyMax * ph[i].at) idx = i;
    }
    return idx;
  }

  function checkPhase(b, cont) {
    const idx = phaseIndexFor(b);
    if (idx <= b.phaseIdx) return false;
    b.phaseIdx = idx;
    b.phase2 = idx >= 1;
    b.phase3 = idx >= 2;
    b.shake = 18;
    b.flash = 0.5;
    AU.sfx('phase');
    const info = b.boss.phases[idx];
    sayBattle((info && info.say) || [], () => {
      if (b.enemyHp <= 0) victory(b, 'kill');
      else cont();
    });
    return true;
  }

  function afterAttack() {
    const b = game.battle;
    b.bullets = [];
    if (b.boss.scriptedLose && !isSmartBoss(b.boss) && b.turn >= 1) { questDefeat(b); return; }
    const taunt = b.boss.taunts[(b.turn - 1) % b.boss.taunts.length];
    sayBattle(taunt, () => { b.phase = 'menu'; b.sub = null; b.menuIndex = 0; });
  }

  /* The first duel with the smart man is meant to be lost. He stops the
     fight himself, spares Галька and leaves her the list of fifty orders. */
  function questDefeat(b) {
    b.phase = 'victory';
    b.winType = 'lost';
    b.bullets = [];
    b.invuln = 1.4;
    /* He stops at the last second. One hit of life left — no healing loop,
       no 9999 HP, no super damage. The list is the only reward. */
    game.hp = 1;
    AU.sfx('hurt');
    sayBattle(b.boss.lose || [{ who: 'sys', text: 'Ты проиграла.' }], () => {
      game.flags.smartLost = true;
      game.flags.qstart_q1 = true;
      saveGame();
      game.battle = null;
      state = 'world';
      enterRoom(game.roomId, { x: 320, y: 340 }, true);
      showToast('✦ УМНЫЙ МУЖЧИНА ПОЩАДИЛ ТЕБЯ. ВОЗЬМИ СПИСОК ИЗ 50 ДЕЛ.');
    });
  }

  function activeActs(b) {
    return (b.boss.acts || []).filter(a => !a.need || !!game.flags[a.need]);
  }

  function doAct(b, act) {
    b.usedActs[act.key] = true;
    game.flags[b.boss.id + act.key] = true;
    // data.js checks camelCase names (huyetBow, directorReport, ...)
    game.flags[b.boss.id + act.key.charAt(0).toUpperCase() + act.key.slice(1)] = true;
    const wasReady = b.spareReady;
    b.spareReady = b.boss.spareNeed.every(k => b.usedActs[k]);
    const lines = act.run(b.boss, game).slice();
    if (b.spareReady && !wasReady) {
      lines.push({ who: 'sys', text: '✦ 「ПОЩАДИТЬ」 теперь доступно.' });
      AU.sfx('spare');
      burst(b.arena.x + b.arena.w / 2, b.arena.y + 70, '#ffe6a0', 26);
    }
    sayBattle(lines, () => { b.phase = 'menu'; b.sub = null; b.subIndex = 0; });
  }

  function doAttack(b) {
    b.phase = 'attack';
    b.barPos = 0; b.barDir = 1;
    AU.sfx('charge');
  }

  function resolveAttack(b) {
    const acc = 1 - Math.abs(b.barPos - 0.5) * 2;
    const crit = acc > 0.94;
    let dmg;
    if (b.boss.gang) {
      /* Six guys share 2000 HP: exactly 50 per hit, 40 hits total. */
      dmg = 50;
    } else if (isSmartBoss(b.boss)) {
      /* 9999 HP remains. Small hits only — and no reward, no huge damage. */
      dmg = crit ? 2 : 1;
    } else {
      const base = 12 + game.lov * 3 - b.boss.def;
      dmg = Math.max(2, Math.round(base * (0.55 + acc * 0.85)));
      if (crit) dmg += 5;
    }
    b.enemyHp = Math.max(0, b.enemyHp - dmg);
    b.slash = 0.45;
    b.shake = 9;
    b.popups.push({ x: 430, y: 180, text: (crit ? 'ТОЧНО! ' : '') + '-' + dmg, life: 1.2, color: crit ? '#ffe680' : '#fff' });
    burst(330, 190, b.boss.colors.main, 20);
    AU.sfx('hit');

    b.phase = 'hitwait';
    b.timer = 0;
  }

  function victory(b, type) {
    b.winType = type;
    b.phase = 'victory';
    AU.sfx('win');
    AU.setTrack('victory');
    if (b.boss.gang) {
      /* Final fight of chapter 2: no chapter-1 rewards, no endings. */
      game.flags.crewBattleDone = true;
      game.hp = Math.min(game.maxHp, game.hp + 20);
      saveGame();
      if (G.accounts && G.accounts.recordGangWin) G.accounts.recordGangWin(game);
      showToast('✦ ШЕСТЬ РОВНЫХ ПАЦАНОВ ПОВЕРЖЕНЫ. ПОБЕДА ЗАСЧИТАНА В ТОПЕ ГЛАВЫ 2.');
      sayBattle(b.boss[type] || b.boss.kill, () => {
        game.battle = null;
        state = 'title';
        titleIndex = 0;
        AU.setTrack('title');
      });
      return;
    }
    if (b.boss.ch2) {
      const missions = G.CH2_MISSIONS || [];
      const idx = missions.findIndex(m => m.boss === b.boss.id);
      game.flags['ch2Done_' + b.boss.id] = true;
      game.ch2Mission = Math.max(game.ch2Mission, idx + 1);
      if (type === 'spare') { game.spares++; game.spared[b.boss.id] = true; }
      else { game.kills++; game.exp += b.boss.exp || 0; game.lov++; }
      game.maxHp += 5;
      game.hp = Math.min(game.maxHp, game.hp + 14);
      const skinJustUnlocked = type === 'kill' ? unlockSkinForBoss(b.boss.id) : null;
      burst(320, 200, type === 'spare' ? '#8affc8' : b.boss.colors.main, 60, 160);
      sayBattle(b.boss[type], () => {
        saveGame();
        game.battle = null;
        state = 'world';
        enterRoom('crew', { x: 320, y: 390 });
        if (game.ch2Mission >= missions.length) {
          showToast('✦ ВСЕ ПЕРЕХВАТЫ ГЛАВЫ 2 ВЫПОЛНЕНЫ. ИДИ К ЗАБОРУ.');
        } else {
          showToast((skinJustUnlocked ? '✦ СКИН ОТКРЫТ: ' + skinJustUnlocked + ' · ' : '') +
            '✦ ДЕЛО ЗАКРЫТО. СЛЕДУЮЩЕЕ У СТАРШЕГО ПАЦАНА.');
        }
      });
      return;
    }
    if (isSmartBoss(b.boss)) {
      /* No 9999-HP reward and no super damage any more. The list is the only
         thing he leaves behind; normally he simply kills Галька instead. */
      game.flags.smartLost = true;
      game.flags.qstart_q1 = true;
      if (b.boss.rematch) game.flags.smartRematchDone = true;
      burst(320, 200, '#ffe6a0', 60, 160);
      const lines = type === 'spare'
        ? [
            { who: 'boss', text: 'Ты выдержала. И всё равно пощадила.' },
            { who: 'sys', text: 'Он ушёл, оставив список из пятидесяти дел.' },
            { who: 'gal', text: 'Без объяснений. Поняла.' }
          ]
        : [
            { who: 'boss', text: 'Ты сделала 9999 ударов. Я посчитал.' },
            { who: 'sys', text: 'Он ушёл, оставив список из пятидесяти дел.' },
            { who: 'gal', text: 'Без объяснений. Поняла.' }
          ];
      sayBattle(lines, () => {
        saveGame();
        game.battle = null;
        state = 'world';
        enterRoom(game.roomId, { x: game.player.x, y: Math.min(420, game.player.y + 20) }, true);
        showToast('✦ СПИСОК УМНОГО МУЖЧИНЫ ПОЛУЧЕН. 50 ДЕЛ — БЕЗ БОНУСОВ.');
      });
      return;
    }
    if (b.boss.quest) {
      if (type === 'spare') game.flags['qspare_' + b.boss.id] = true;
      else game.exp += b.boss.exp || 0;
      if (b.boss.questId) {
        game.flags['qfoe_' + b.boss.questId] = true;
        game.flags['qitem_' + b.boss.questId] = true;
      }
      if (b.boss.rematch) game.flags.smartRematchDone = true;
      burst(320, 200, type === 'spare' ? '#8affc8' : b.boss.colors.main, 60, 160);
      sayBattle(b.boss[type], () => {
        saveGame();
        game.battle = null;
        state = 'world';
        enterRoom(game.roomId, { x: game.player.x, y: Math.min(420, game.player.y + 20) }, true);
        showToast(type === 'spare' ? '✦ РАЗОБРАЛАСЬ БЕЗ УБИЙСТВА. Вернись к тому, кто просил.' : '✦ РАЗОБРАЛАСЬ. Вернись к тому, кто просил.');
      });
      return;
    }
    if (type === 'spare') {
      game.spares++;
      game.spared[b.boss.id] = true;
    } else {
      game.kills++;
      game.exp += b.boss.exp;
      game.lov++;
    }
    game.defeated[b.boss.id] = true;
    game.maxHp += 5;
    game.hp = Math.min(game.maxHp, game.hp + 14);
    if (b.boss.id === 'abayunda') game.flags.dash = true;
    /* Only killing Машу or Пастуха opens their look. Spare leaves it locked. */
    const skinJustUnlocked = type === 'kill' ? unlockSkinForBoss(b.boss.id) : null;
    burst(320, 200, type === 'spare' ? '#8affc8' : b.boss.colors.main, 60, 160);
    sayBattle(b.boss[type], () => {
      saveGame();
      if (b.boss.final) { showEnding(); return; }
      const roomMap = {
        abayunda: 'school', afina: 'school', huyet: 'street', yasr: 'metro',
        loma: 'lomaRoom', byba: 'bybaRoom', petrunya: 'petrunyaRoom',
        masha: 'mashaRoom', pastuh: 'pastuhRoom', director: 'office'
      };
      const id = roomMap[b.boss.id];
      game.battle = null;
      state = 'world';
      enterRoom(id, ROOMS[id].spawn);
      showToast(skinJustUnlocked
        ? '✦ СКИН ОТКРЫТ: ' + skinJustUnlocked
        : type === 'spare' ? '✦ ДУША СПАСЕНА: ' + b.boss.name + '  (+5 макс. HP)' : '✦ ПОЛУЧЕНО EXP: ' + b.boss.exp + '  (+5 макс. HP)');
    });
  }

  function showChapter2Finale() {
    AU.setTrack('ending');
    sayCh2((G.CH2_FINALE || []).slice(), () => {
      state = 'ch2Choice';
      ch2ChoiceIndex = 0;
      ch2ChoiceLocked = false;
      AU.sfx('select');
    }, 'СТАРШИЙ ПАЦАН');
  }

  /* One entry point for taps, the OK button and the keyboard. */
  function confirmCh2Choice(row) {
    if (state !== 'ch2Choice' || game.dialogue || ch2ChoiceLocked) return false;
    const opts = (G.CH2_CHOICE || {}).options || [];
    if (row === null || row === undefined) row = ch2ChoiceIndex;
    if (!opts[row]) return false;
    ch2ChoiceIndex = row;
    ch2ChoiceLocked = true;
    AU.ensure();
    AU.sfx('select');
    finishChapter2Choice();
    return true;
  }

  function finishChapter2Choice() {
    const choice = (G.CH2_CHOICE || {}).options[ch2ChoiceIndex];
    if (!choice) return;
    game.ch2Choice = choice.id;
    game.ch2Done = true;
    progress.ch2Choice = choice.id;
    progress.ch2Done = true;
    saveProgress();
    saveGame();
    /* Chapter 2 gets its OWN leaderboard entry, separate from chapter 1. */
    if (G.accounts && G.accounts.recordChapter2) G.accounts.recordChapter2(game);
    if (choice.id === 'fight' && CREW_GANG) {
      /* Choosing to fight goes STRAIGHT into the six-guy battle. */
      sayCh2([
        { who: 'crew', text: 'Тогда пошли. Все шесть. Сразу.' },
        { who: 'gal', text: 'Без объяснений. Пятьдесят за удар.' },
        { who: 'sys', text: '✦ БОЙ: 2000 HP · 10 ФАЗ · ПО 3 АТАКИ ЗА ХОД · УРОН 50' }
      ], () => startBattle(CREW_GANG), 'СТАРШИЙ ПАЦАН');
      return;
    }
    sayCh2(choice.after.slice(), () => {
      state = 'title';
      titleIndex = 0;
      AU.setTrack('title');
    }, 'СТАРШИЙ ПАЦАН');
  }

  function showEnding() {
    state = 'ending';
    game.battle = null;
    game.chapter1Done = true;
    progress.chapter1Done = true;
    saveProgress();
    AU.setTrack('ending');
    if (G.accounts && G.accounts.recordCompletion) G.accounts.recordCompletion(game);
    const s = game.spares;
    let lines;
    if (s === BOSSES.length) {
      lines = [
        { who: 'sys', text: 'Ты вернулась домой. Ужин остыл. Кот не смотрел.' },
        { who: 'gal', text: 'Пятьдесят девять лет, а я всё ещё учу. Ладно. Урок кое-как получился.' },
        { who: 'sys', text: 'КОНЕЦ: МИРНЫЙ МАРШРУТ. Пощажены все ' + BOSSES.length + '.' }
      ];
    } else if (s === 0) {
      lines = [
        { who: 'sys', text: 'Ты вернулась домой. Тишина. Галька включила чайник — и то не помогло.' },
        { who: 'gal', text: 'Я победила. И что?' },
        { who: 'sys', text: 'КОНЕЦ: ХОЛОДНЫЙ СЧЁТ. 0 пощад. ' + BOSSES.length + ' осколков в кармане.' }
      ];
    } else {
      lines = [
        { who: 'sys', text: 'Ты вернулась домой. Дверь открылась не сразу.' },
        { who: 'gal', text: 'Сделала что смогла. Завтра снова на работу.' },
        { who: 'sys', text: 'КОНЕЦ: ОБЫЧНЫЙ ПУТЬ. Пощажено ' + s + ' из ' + BOSSES.length + '.' }
      ];
    }
    lines.push({ who: 'sys', text: 'Нажми Z, чтобы вернуться в меню.' });
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) {}
    say(lines, () => { state = 'title'; titleIndex = 0; AU.setTrack('title'); });
    game.dialogue.speaker = 'sys';
  }

  function updateBattle(dt) {
    const b = game.battle;
    if (!b) return;
    b.timer += dt;
    b.invuln = Math.max(0, b.invuln - dt);
    b.dash = Math.max(0, b.dash - dt);
    b.dashCd = Math.max(0, b.dashCd - dt);
    b.h2Invuln = Math.max(0, (b.h2Invuln || 0) - dt);
    b.h2Dash = Math.max(0, (b.h2Dash || 0) - dt);
    b.h2DashCd = Math.max(0, (b.h2DashCd || 0) - dt);
    b.slash = Math.max(0, b.slash - dt);
    b.shake = Math.max(0, b.shake - dt * 45);
    b.flash = Math.max(0, b.flash - dt * 2.5);
    for (let i = b.popups.length - 1; i >= 0; i--) {
      b.popups[i].life -= dt;
      b.popups[i].y -= dt * 26;
      if (b.popups[i].life <= 0) b.popups.splice(i, 1);
    }

    if (game.dialogue) { game.dialogue.update(dt); return; }

    if (b.phase === 'entrance') {
      if (b.timer > 1.5) sayBattle(b.boss.intro, () => enemyAttack());
    } else if (b.phase === 'dodge') {
      const A0 = b.arena, bottom = A0.y + A0.h;
      const mv = moveInput();
      const vx = mv.vx, vy = mv.vy;
      const speed = (b.dash > 0 ? 430 : 168) * dt * mv.mag;
      b.hx = Math.max(A0.x + 12, Math.min(A0.x + A0.w - 12, b.hx + vx * speed));
      b.hy = Math.max(A0.y + 12, Math.min(A0.y + A0.h - 12, b.hy + vy * speed));
      if (pressed.z && b.dashUnlocked && b.dashCd <= 0) {
        b.dash = 0.2; b.dashCd = 1.5; b.invuln = Math.max(b.invuln, 0.25);
        burst(b.hx, b.hy, '#8ff5ff', 10, 60);
        AU.sfx('bullet');
      }

      // Network player 2 (purple soul). Shared HP pool.
      if (netMode === 'host' && netPlayers.length > 1 && netPlayers[1]) {
        const inp = netInputFor(1);
        const m2 = inp && inp.v ? { vx: inp.v.x, vy: inp.v.y, mag: inp.v.mag } : { vx: 0, vy: 0, mag: 0 };
        const dash2 = takeNetZ(1);
        const s2 = (b.h2Dash > 0 ? 430 : 168) * dt * m2.mag;
        b.h2x = Math.max(A0.x + 12, Math.min(A0.x + A0.w - 12, b.h2x + m2.vx * s2));
        b.h2y = Math.max(A0.y + 12, Math.min(A0.y + A0.h - 12, b.h2y + m2.vy * s2));
        if (dash2 && b.dashUnlocked && b.h2DashCd <= 0) {
          b.h2Dash = 0.2; b.h2DashCd = 1.5; b.h2Invuln = Math.max(b.h2Invuln, 0.25);
          burst(b.h2x, b.h2y, netPlayers[1].color, 10, 60);
          AU.sfx('bullet');
        }
      }

      // Network guests 3-6: each controls its own soul, all share one HP pool.
      if (netMode === 'host' && b.netSouls) {
        b.netSouls.forEach(s => {
          s.invuln = Math.max(0, s.invuln - dt);
          s.dash = Math.max(0, s.dash - dt);
          s.dashCd = Math.max(0, s.dashCd - dt);
          const inp = netInputFor(s.i);
          if (inp && inp.v && inp.v.mag > 0) {
            const sp = (s.dash > 0 ? 430 : 168) * dt * inp.v.mag;
            s.x = Math.max(A0.x + 12, Math.min(A0.x + A0.w - 12, s.x + inp.v.x * sp));
            s.y = Math.max(A0.y + 12, Math.min(A0.y + A0.h - 12, s.y + inp.v.y * sp));
          }
          if (takeNetZ(s.i) && b.dashUnlocked && s.dashCd <= 0) {
            s.dash = 0.2; s.dashCd = 1.5; s.invuln = Math.max(s.invuln, 0.25);
            burst(s.x, s.y, s.color, 10, 60);
          }
        });
      }

      // Standing in a corner is never free: after a short warning the boss
      // fires from that exact corner. The shot is aimed at the current heart
      // position and is easy to step away from.
      const corners = [
        [A0.x + 30, A0.y + 30], [A0.x + A0.w - 30, A0.y + 30],
        [A0.x + 30, bottom - 30], [A0.x + A0.w - 30, bottom - 30]
      ];
      let nearCorner = -1;
      for (let i = 0; i < corners.length; i++) {
        if (Math.hypot(b.hx - corners[i][0], b.hy - corners[i][1]) < 42) nearCorner = i;
      }
      b.campCd = Math.max(0, b.campCd - dt);
      b.campMsg = Math.max(0, b.campMsg - dt);
      if (nearCorner >= 0) {
        if (nearCorner !== b.campCorner) { b.campCorner = nearCorner; b.campTime = 0; }
        b.campTime += dt;
      } else { b.campTime = 0; b.campCorner = -1; }
      if (nearCorner >= 0 && b.campTime > 1.0 && b.campCd <= 0) {
        const c = corners[nearCorner];
        b.warns.push({
          x: nearCorner % 2 ? A0.x + A0.w - 62 : A0.x,
          y: nearCorner < 2 ? A0.y : bottom - 62,
          w: 62, h: 62, life: 0.42, max: 0.42, color: '#ff5d7d'
        });
        for (let i = -1; i <= 1; i++) {
          const a = Math.atan2(b.hy - c[1], b.hx - c[0]) + i * 0.22;
          b.bullets.push(mkBullet(c[0], c[1], 0, 0, {
            r: 6, color: '#ff9ec0', shape: 'diamond', spin: 3,
            kind: 'delayed', delay: 0.42, dx: Math.cos(a) * 158, dy: Math.sin(a) * 158, life: 3
          }));
        }
        b.campTime = 0; b.campCd = 2.2; b.campMsg = 1.0;
        AU.sfx('warn');
      }

      while (b.spawnI < b.schedule.length && b.timer >= b.schedule[b.spawnI].t) {
        b.schedule[b.spawnI].fn();
        b.spawnI++;
      }

      for (let i = b.warns.length - 1; i >= 0; i--) {
        b.warns[i].life -= dt;
        if (b.warns[i].life <= 0) b.warns.splice(i, 1);
      }

      for (let i = b.bullets.length - 1; i >= 0; i--) {
        const p = b.bullets[i];
        p.age += dt;
        if (p.kind === 'delayed' && p.age >= p.delay) {
          p.kind = 'linear'; p.vx = p.dx; p.vy = p.dy;
        }
        if (p.kind === 'seek') {
          const desired = Math.atan2(b.hy - p.y, b.hx - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let diff = ((desired - cur + Math.PI * 3) % TAU) - Math.PI;
          const turn = Math.min(Math.abs(diff), p.turn * dt) * Math.sign(diff);
          const a = cur + turn;
          p.vx = Math.cos(a) * p.speed;
          p.vy = Math.sin(a) * p.speed;
        }
        if (p.kind === 'sine') {
          if (p.baseY == null) p.baseY = p.y;
          p.baseY += p.vy * dt;
          p.y = p.baseY + Math.sin(p.age * p.f) * p.amp;
          p.x += p.vx * dt;
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        if (p.kind === 'accel') p.vy += p.ay * dt;
        if (p.kind === 'bounce') {
          if (p.x < A0.x + p.r && p.vx < 0 && p.bounces > 0) { p.x = A0.x + p.r; p.vx *= -1; p.bounces--; AU.sfx('bullet'); }
          if (p.x > A0.x + A0.w - p.r && p.vx > 0 && p.bounces > 0) { p.x = A0.x + A0.w - p.r; p.vx *= -1; p.bounces--; AU.sfx('bullet'); }
          if (p.y < A0.y + p.r && p.vy < 0 && p.bounces > 0) { p.y = A0.y + p.r; p.vy *= -1; p.bounces--; }
          if (p.y > bottom - p.r && p.vy > 0 && p.bounces > 0) { p.y = bottom - p.r; p.vy *= -1; p.bounces--; }
        }
        p.rot += p.spin * dt;
        if (p.age > p.life || p.x < A0.x - 50 || p.x > A0.x + A0.w + 50 || p.y < A0.y - 60 || p.y > A0.y + A0.h + 50) {
          b.bullets.splice(i, 1);
          continue;
        }
        if (b.invuln <= 0 && Math.hypot(p.x - b.hx, p.y - b.hy) < p.r + 7) {
          const dmg = playerHitDamage(b);
          game.hp -= dmg;
          b.invuln = 1.0;
          b.shake = 16;
          b.flash = 0.7;
          AU.sfx('hurt');
          burst(b.hx, b.hy, '#ff4d6d', 18);
          if (fatalHit(b)) return;
        } else if (netMode === 'host' && netPlayers.length > 1 && b.h2Invuln <= 0 && Math.hypot(p.x - b.h2x, p.y - b.h2y) < p.r + 7) {
          const dmg2 = playerHitDamage(b);
          game.hp -= dmg2;
          b.h2Invuln = 1.0;
          b.shake = 16;
          b.flash = 0.7;
          AU.sfx('hurt');
          burst(b.h2x, b.h2y, '#c77dff', 18);
          if (fatalHit(b)) return;
        } else if (netMode === 'host' && b.netSouls) {
          for (const s of b.netSouls) {
            if (s.invuln <= 0 && Math.hypot(p.x - s.x, p.y - s.y) < p.r + 7) {
              const dmg3 = playerHitDamage(b);
              game.hp -= dmg3;
              s.invuln = 1.0; b.shake = 16; b.flash = 0.7;
              AU.sfx('hurt');
              burst(s.x, s.y, s.color, 18);
              if (fatalHit(b)) return;
              break;
            }
          }
        }
      }
      if (b.timer >= b.duration && b.bullets.length === 0) afterAttack();
    } else if (b.phase === 'hitwait') {
      if (b.timer > 0.9) {
        if (b.enemyHp <= 0) victory(b, 'kill');
        else if (!checkPhase(b, enemyAttack)) enemyAttack();
      }
    } else if (b.phase === 'menu') {
      const items = 4;
      if (pressed.up) { b.menuIndex = (b.menuIndex + 2) % items; AU.sfx('move'); }
      if (pressed.down) { b.menuIndex = (b.menuIndex + 2) % items; AU.sfx('move'); }
      if (pressed.left) { b.menuIndex = (b.menuIndex + 1) % 2 + Math.floor(b.menuIndex / 2) * 2; AU.sfx('move'); }
      if (pressed.right) { b.menuIndex = (b.menuIndex + 1) % 2 + Math.floor(b.menuIndex / 2) * 2; AU.sfx('move'); }
      if (pressed.z) {
        AU.sfx('select');
        const labels = ['attack', 'mercy', 'act', 'item'];
        const choice = labels[b.menuIndex];
        if (choice === 'attack') doAttack(b);
        else if (choice === 'mercy') {
          if (b.spareReady) victory(b, 'spare');
          else sayBattle([{ who: 'sys', text: 'Пока нечего прощать. Попробуй 「ГОЛОС」.' }], () => { b.phase = 'menu'; });
        } else { b.sub = choice; b.subIndex = 0; b.phase = 'sub'; }
      }
    } else if (b.phase === 'sub') {
      const opts = b.sub === 'act' ? activeActs(b)
        : b.sub === 'item' ? [
          { key: 'pie', label: 'ПИРОЖОК  +12', count: game.inv.pie },
          { key: 'tea', label: 'ЧАЙ  +22', count: game.inv.tea },
          { key: 'candy', label: 'КОНФЕТА  +8', count: game.inv.candy }
        ] : [{ key: 'spare', label: b.spareReady ? 'ПОЩАДИТЬ!' : 'ПОЩАДИТЬ' }];
      if (pressed.up) { b.subIndex = (b.subIndex - 1 + opts.length) % opts.length; AU.sfx('move'); }
      if (pressed.down) { b.subIndex = (b.subIndex + 1) % opts.length; AU.sfx('move'); }
      if (pressed.x) { b.phase = 'menu'; b.sub = null; AU.sfx('back'); }
      if (pressed.z) {
        const o = opts[b.subIndex];
        if (b.sub === 'act') { AU.sfx('select'); doAct(b, o); }
        else if (b.sub === 'mercy') {
          if (b.spareReady) { AU.sfx('select'); victory(b, 'spare'); }
          else sayBattle([{ who: 'sys', text: 'Она ещё не готова отпустить тебя.' }], () => { b.phase = 'menu'; b.sub = null; });
        } else {
          if ((game.inv[o.key] || 0) <= 0) {
            AU.sfx('back');
            sayBattle([{ who: 'sys', text: 'Пусто. Нужно зайти в магазин... в другой раз.' }], () => { b.phase = 'menu'; b.sub = null; });
          } else {
            game.inv[o.key]--;
            const heal = { pie: 12, tea: 22, candy: 8 }[o.key];
            game.hp = Math.min(game.maxHp, game.hp + heal);
            burst(b.hx, b.hy, '#8affc8', 20);
            AU.sfx('spare');
            sayBattle([{ who: 'gal', text: 'Фух. Стало легче. (+' + heal + ' HP)' }], () => { b.phase = 'menu'; b.sub = null; });
          }
        }
      }
    } else if (b.phase === 'attack') {
      b.barPos += b.barDir * dt * 1.45;
      if (b.barPos >= 1) { b.barPos = 1; b.barDir = -1; }
      if (b.barPos <= 0) { b.barPos = 0; b.barDir = 1; }
      if (pressed.z) { AU.sfx('select'); resolveAttack(b); }
      if (pressed.x) { b.phase = 'menu'; AU.sfx('back'); }
    }
  }

  /* ---------------- battle drawing ---------------- */

  function drawBattle() {
    const b = game.battle;
    if (!b) return;
    ctx.save();
    if (b.shake > 0) ctx.translate((Math.random() - 0.5) * b.shake, (Math.random() - 0.5) * b.shake);

    A.drawBattleBG(ctx, b.boss, T);

    // enemy sprite — the director's son is deliberately tiny
    const pulse = b.phase2 ? 1 + Math.sin(T * 6) * 0.03 : 1;
    const tiny = b.boss.id === 'director' ? 0.72 : 1;
    if (b.boss.gang) {
      /* All six ровные пацаны are on screen at the same time. */
      const xs = [185, 239, 293, 347, 401, 455];
      xs.forEach((x, i) => {
        ctx.save();
        ctx.translate(x, 196); ctx.scale(pulse * 0.55, pulse * 0.55); ctx.translate(-x, -196);
        A.drawChar(ctx, bossImage(b.boss), x, 288 + (i % 2) * 6, Math.floor(T * 3) % 3, {
          width: 112, height: 132, legH: 20,
          legColor: '#1c2b26', bootColor: '#0a1010',
          tint: b.slash > 0 ? '#ffffff' : null, tintAlpha: 0.55,
          outline: (b.boss.gangColors || [])[i] || b.boss.colors.main,
          fallback: 'crew' + (i + 1)
        });
        ctx.restore();
      });
    } else {
      ctx.save();
      ctx.translate(320, 196); ctx.scale(pulse * tiny, pulse * tiny); ctx.translate(-320, -196);
      A.drawChar(ctx, bossImage(b.boss), 320, 288, Math.floor(T * 3) % 3, {
        width: 112, height: 132, legH: 20,
        legColor: b.boss.colors.dark, bootColor: '#111322',
        tint: b.slash > 0 ? '#ffffff' : null, tintAlpha: 0.55,
        outline: b.boss.colors.main,
        fallback: b.boss.id
      });
      ctx.restore();
    }

    if (b.boss.id === 'abayunda') {
      // stacked chins in front of the sprite
      for (let i = 0; i < 9; i++) {
        const y = 296 + i * 8 + Math.sin(T * 2 + i) * 2;
        ctx.globalAlpha = 0.9;
        A.px(ctx, 320 - 52 + i * 3, y, 104 - i * 6, 7, '#8fa4ff');
        A.px(ctx, 320 - 50 + i * 3, y + 7, 100 - i * 6, 3, '#18264f');
      }
      ctx.globalAlpha = 1;
    }

    if (b.slash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.slash * 3);
      ctx.translate(320, 196); ctx.rotate(-0.6);
      A.px(ctx, -150, -3, 300, 6, '#ffffff');
      A.px(ctx, -110, -14, 220, 2, b.boss.colors.main);
      ctx.restore();
    }

    // portrait + info
    A.portrait(ctx, bossImage(b.boss), 20, 24, 124, 124, {
      bg: b.boss.colors.dark, flash: b.slash > 0.2 ? (b.slash - 0.2) * 1.4 : 0,
      fallback: b.boss.id, t: T
    });
    A.px(ctx, 20, 24, 124, 4, b.boss.colors.main);
    A.px(ctx, 20, 144, 124, 4, b.boss.colors.main);
    A.text(ctx, b.boss.name, 158, 42, { size: 17, color: b.boss.colors.light });
    A.text(ctx, b.boss.title, 158, 60, { size: 10, color: '#b8c0e0' });
    A.px(ctx, 158, 70, 210, 11, '#1b1d33');
    A.px(ctx, 160, 72, 206 * Math.max(0, b.enemyHp / b.enemyMax), 7, b.spareReady ? '#8affc8' : b.boss.colors.main);
    A.text(ctx, 'HP ' + b.enemyHp + ' / ' + b.enemyMax + (b.boss.gang ? '  ×6' : ''), 158, 94, { size: 11, color: '#e8ecff' });
    A.text(ctx, 'АТК ' + b.boss.atk + '   ЗАЩ ' + b.boss.def, 158, 110, { size: 11, color: '#9fa8d8' });
    // phase pips + spare progress
    (b.boss.phases || []).forEach((ph, i) => {
      const on = i <= b.phaseIdx;
      A.px(ctx, 330 + i * 12, 103, 8, 8, on ? b.boss.colors.main : '#30334d');
    });
    b.boss.spareNeed.forEach((k, i) => {
      A.px(ctx, 158 + i * 14, 122, 10, 4, b.usedActs[k] ? '#8affc8' : '#343850');
    });

    // player HUD
    A.panel(ctx, 470, 20, 150, 54, { fill: 'rgba(8,10,22,.85)', border: '#9fa8d8' });
    A.heart(ctx, 492, 44, 14, '#ff4d6d', T * 5);
    A.text(ctx, 'ГАЛЬКА', 508, 39, { size: 11, color: '#fff' });
    A.text(ctx, 'HP ' + game.hp + '/' + game.maxHp, 508, 57, { size: 12, color: '#ff9fb0' });
    A.px(ctx, 480, 66, 128, 4, '#22243c');
    A.px(ctx, 480, 66, 128 * Math.max(0, game.hp / game.maxHp), 4, '#ff5d7d');
    if (netMode && netPlayers.length > 1) {
      A.panel(ctx, 470, 78, 150, 24, { fill: 'rgba(8,10,22,.85)', border: '#9b7ad8' });
      A.heart(ctx, 488, 91, 10, '#c77dff', T * 5);
      A.text(ctx, 'ИГРОК 2', 502, 88, { size: 10, color: '#fff' });
      A.text(ctx, 'ОБЩЕЕ HP ' + game.hp, 502, 98, { size: 9, color: '#d9b3ff', shadow: false });
    }

    // arena
    const ar = b.arena;
    A.px(ctx, ar.x - 5, ar.y - 5, ar.w + 10, ar.h + 10, '#05070f');
    A.px(ctx, ar.x - 2, ar.y - 2, ar.w + 4, 2, b.boss.colors.main);
    A.px(ctx, ar.x - 2, ar.y + ar.h, ar.w + 4, 2, b.boss.colors.main);
    A.px(ctx, ar.x - 2, ar.y, 2, ar.h, b.boss.colors.main);
    A.px(ctx, ar.x + ar.w, ar.y, 2, ar.h, b.boss.colors.main);

    if (b.phase === 'dodge' && b.attackName) {
      A.px(ctx, 244, 84, 152, 22, 'rgba(8,10,22,.92)');
      A.px(ctx, 244, 84, 152, 2, b.boss.colors.main);
      A.text(ctx, b.attackName + (b.phaseIdx ? ' · ФАЗА ' + (b.phaseIdx + 1) : ''), 320, 100, {
        size: 11, color: b.warns.length ? '#ff9ec0' : '#ffe6a0', align: 'center', shadow: false
      });
    }
    if (b.campMsg > 0 && b.phase === 'dodge') {
      ctx.globalAlpha = Math.min(1, b.campMsg * 2);
      A.text(ctx, 'НЕ ПРЯТАТЬСЯ!', ar.x + ar.w / 2, ar.y + 34, {
        size: 12, color: '#ff9ec0', align: 'center'
      });
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(ar.x, ar.y, ar.w, ar.h); ctx.clip();

    // telegraphed danger zones
    b.warns.forEach(w => {
      const k = 1 - w.life / w.max;
      ctx.globalAlpha = 0.1 + 0.18 * k + 0.05 * Math.sin(T * 22);
      A.px(ctx, w.x, w.y, w.w, w.h, w.color);
      ctx.globalAlpha = 0.45 + 0.35 * Math.abs(Math.sin(T * 18));
      A.px(ctx, w.x, w.y, w.w, 2, w.color);
      A.px(ctx, w.x, w.y + w.h - 2, w.w, 2, w.color);
      A.px(ctx, w.x, w.y, 2, w.h, w.color);
      A.px(ctx, w.x + w.w - 2, w.y, 2, w.h, w.color);
      ctx.globalAlpha = 1;
    });

    b.bullets.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 7;
      if (p.shape === 'square') ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
      else if (p.shape === 'diamond') {
        ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r, 0); ctx.lineTo(0, p.r); ctx.lineTo(-p.r, 0); ctx.fill();
      } else if (p.shape === 'tear') {
        ctx.beginPath(); ctx.ellipse(0, 0, p.r * 0.8, p.r * 1.25, 0, 0, TAU); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });

    if (b.phase === 'dodge' || b.phase === 'hitwait') {
      const c1 = netMode ? (netPlayers[0] || {}).color || NET_COLORS[0] : (game.spared[b.boss.id] ? '#8affc8' : '#ff4d6d');
      if (b.invuln <= 0 || Math.floor(T * 16) % 2 === 0) {
        A.heart(ctx, b.hx, b.hy, 17, c1, T * 6);
      }
      if (b.dash > 0) {
        ctx.globalAlpha = 0.4;
        A.heart(ctx, b.hx, b.hy + 12, 14, '#8ff5ff', 0);
        ctx.globalAlpha = 1;
      }
      if (netMode && netPlayers.length > 1) {
        const c2 = (netPlayers[1] || {}).color || NET_COLORS[1];
        if (b.h2Invuln <= 0 || Math.floor(T * 16) % 2 === 0) {
          A.heart(ctx, b.h2x, b.h2y, 17, c2, T * 6 + 1.3);
        }
        if (b.h2Dash > 0) {
          ctx.globalAlpha = 0.4;
          A.heart(ctx, b.h2x, b.h2y + 12, 14, c2, 0);
          ctx.globalAlpha = 1;
        }
      }
      (b.netSouls || []).forEach(s => {
        if (s.invuln <= 0 || Math.floor(T * 16) % 2 === 0) A.heart(ctx, s.x, s.y, 17, s.color, T * 6 + s.i);
        if (s.dash > 0) { ctx.globalAlpha = 0.4; A.heart(ctx, s.x, s.y + 12, 14, s.color, 0); ctx.globalAlpha = 1; }
      });
    }
    ctx.restore();

    if (b.dashUnlocked && b.phase === 'dodge') {
      A.text(ctx, b.dashCd > 0 ? 'РЫВОК: ...' : 'Z — РЫВОК', ar.x + ar.w / 2, ar.y + ar.h + 16, {
        size: 10, color: b.dashCd > 0 ? '#6c7399' : '#8ff5ff', align: 'center'
      });
    }

    drawParticles();

    // bottom box
    const BX = 20, BY = 306, BW = 600, BH = 158;
    if (game.dialogue) {
      game.dialogue.draw(BX, BY, BW, BH);
    } else if (b.phase === 'attack') {
      A.panel(ctx, BX, BY, BW, BH, { border: '#ff9ec0' });
      A.text(ctx, 'УДАР! Нажми Z в центре', 320, 340, { size: 17, color: '#fff', align: 'center' });
      A.px(ctx, 70, 374, 500, 22, '#191b30');
      A.px(ctx, 70, 374, 500, 2, '#aeb7e8');
      A.px(ctx, 70, 394, 500, 2, '#aeb7e8');
      A.px(ctx, 310, 368, 20, 34, '#4c6b5f');
      A.px(ctx, 316, 364, 8, 42, '#8affc8');
      const mx = 70 + b.barPos * 480;
      A.px(ctx, mx - 3, 362, 6, 46, '#fff');
      A.text(ctx, 'ТОЧНОСТЬ: ' + Math.round((1 - Math.abs(b.barPos - 0.5) * 2) * 100) + '%', 320, 430, { size: 12, color: '#ffe6a0', align: 'center' });
    } else if (b.phase === 'menu' || b.phase === 'sub') {
      A.panel(ctx, BX, BY, BW, BH, { border: '#f0f2ff' });
      A.text(ctx, b.phase === 'sub' ? (b.sub === 'act' ? 'ГОЛОС' : b.sub === 'item' ? 'ВЕЩИ' : 'ПОЩАДИТЬ') : 'ЧТО ДЕЛАТЬ?',
        46, 342, { size: 16, color: '#ffe6a0' });
      const hints = [
        'Нанести урон. Всё решает тайминг.',
        b.spareReady ? 'Она готова отпустить тебя.' : 'Пока не сработает — не проси.',
        'Поговори. Узнай, что её мучает.',
        'Пирожок, чай, конфета...'
      ];
      A.text(ctx, hints[b.menuIndex], 46, 380, { size: 12, color: '#b9c2ea' });
      A.text(ctx, '↑↓←→ выбор   Z подтвердить   X назад', 46, 430, { size: 11, color: '#7780a8' });

      if (b.phase === 'menu') {
        const labels = ['УДАРИТЬ', 'ПОЩАДИТЬ', 'ГОЛОС', 'ВЕЩИ'];
        const cols = [390, 500], rows = [340, 392];
        for (let i = 0; i < 4; i++) {
          const x = cols[i % 2], y = rows[Math.floor(i / 2)];
          const sel = b.menuIndex === i;
          A.px(ctx, x, y - 24, 100, 38, sel ? '#f0f2ff' : '#242842');
          A.text(ctx, labels[i], x + 50, y, { size: 13, color: sel ? '#141529' : '#eef2ff', align: 'center', shadow: false });
          if (sel && Math.floor(T * 2) % 2 === 0) A.text(ctx, '▶', x - 12, y, { size: 12, color: '#ffe6a0', shadow: false });
          if (i === 1 && b.spareReady) A.px(ctx, x + 90, y - 32, 7, 7, '#8affc8');
        }
      } else {
        const opts = b.sub === 'act' ? activeActs(b).map(a => ({ label: a.label }))
          : b.sub === 'item' ? [
            { label: 'ПИРОЖОК ×' + game.inv.pie }, { label: 'ЧАЙ ×' + game.inv.tea }, { label: 'КОНФЕТА ×' + game.inv.candy }
          ] : [{ label: b.spareReady ? 'ПОЩАДИТЬ!' : 'ПОЩАДИТЬ' }];
        opts.forEach((o, i) => {
          const y = 334 + i * 30;
          const sel = b.subIndex === i;
          A.text(ctx, (sel ? '▶ ' : '   ') + o.label, 370, y, { size: 14, color: sel ? '#ffe6a0' : '#c6ceef', shadow: false });
        });
      }
    } else if (b.phase === 'victory') {
      A.panel(ctx, BX, BY, BW, BH);
      A.text(ctx, b.winType === 'spare' ? 'ДУША ПОЩАДИЛА' : 'ПОБЕДА', 320, 380, { size: 26, color: b.winType === 'spare' ? '#8affc8' : '#ffe6a0', align: 'center' });
    }

    b.popups.forEach(p => {
      ctx.globalAlpha = Math.min(1, p.life);
      A.text(ctx, p.text, p.x, p.y, { size: 22, color: p.color, align: 'center' });
      ctx.globalAlpha = 1;
    });

    if (b.phase === 'entrance') {
      ctx.globalAlpha = Math.min(1, b.timer * 2) * Math.min(1, (1.5 - b.timer) * 3 + 0.2);
      A.px(ctx, 0, 210, 640, 80, 'rgba(5,6,16,.88)');
      A.text(ctx, 'ВСТРЕЧА!', 320, 245, { size: 34, color: '#fff', align: 'center' });
      A.text(ctx, b.boss.name, 320, 275, { size: 18, color: b.boss.colors.main, align: 'center' });
      ctx.globalAlpha = 1;
    }

    if (b.flash > 0) {
      ctx.globalAlpha = b.flash * 0.4;
      A.px(ctx, 0, 0, 640, 480, '#ff0000');
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------------- title / gameover / ending ---------------- */

  function chapterOptions() {
    return [
      { label: 'ГЛАВА 1 · ПОДЗЕМНЫЙ РИТМ', open: true },
      { label: 'ГЛАВА 2 · ПРИШИТЫЕ ПАЦАНЫ' + (progress.chapter1Done || game.chapter1Done ? '' : ' · Закрыта'),
        open: !!(progress.chapter1Done || game.chapter1Done) },
      { label: 'ГЛАВА 3 · ' +
          ((game.ch2Choice || progress.ch2Choice) === 'fight' ? 'ДРАКА · в разработке' :
           (game.ch2Choice || progress.ch2Choice) === 'run' ? 'ПРЕДАТЕЛЬСТВО · в разработке' : 'в разработке'), open: false }
    ];
  }

  function drawChapterSelect() {
    A.drawBattleBG(ctx, BOSSES[BOSSES.length - 1], T * 0.25);
    A.px(ctx, 70, 70, 500, 340, 'rgba(8,8,20,0.9)');
    A.text(ctx, 'ВЫБОР ГЛАВЫ', 320, 112, { size: 30, color: '#ffe6a0', align: 'center' });
    chapterOptions().forEach((o, i) => {
      const sel = i === chapterIndex;
      A.text(ctx, (sel ? '▶ ' : '   ') + o.label, 320, 212 + i * 60, {
        size: 16, color: !o.open ? '#6d7398' : sel ? '#ffe6a0' : '#c8cff0', align: 'center'
      });
      if (!o.open) A.text(ctx, 'ЗАКРЫТА', 320, 232 + i * 60, { size: 9, color: '#ff9ec0', align: 'center', shadow: false });
    });
    A.text(ctx, 'Первая глава открывает вторую. Выбор в конце второй влияет на третью.', 320, 370, {
      size: 10, color: '#8affc8', align: 'center', shadow: false
    });
  }

  function titleOptions() {
    const opts = ['НОВАЯ ИГРА', 'ВЫБОР ГЛАВЫ'];
    if (hasSave()) opts.push('ПРОДОЛЖИТЬ');
    const locked = lockedSkinNames();
    opts.push('СКИН: ' + G.heroSkin() + (locked.length ? ' · ЗАКР: ' + locked.join(',') : ''));
    opts.push('АККАУНТ И ТОПЫ');
    opts.push('СОЗДАТЬ ЛОББИ');
    opts.push('ВОЙТИ ПО КОДУ');
    return opts;
  }

  function drawTitle() {
    const g = ctx.createLinearGradient(0, 0, 0, 480);
    g.addColorStop(0, '#1b1236'); g.addColorStop(0.6, '#0e1228'); g.addColorStop(1, '#070814');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 480);

    const rnd = A.rand(42);
    for (let i = 0; i < 80; i++) {
      const x = (rnd() * 640 + Math.sin(T * 0.6 + i) * 12 + 640) % 640;
      const y = (rnd() * 480 - T * (4 + i % 7) + 480 * 5) % 480;
      ctx.globalAlpha = 0.2 + 0.5 * Math.abs(Math.sin(T + i));
      A.px(ctx, x, y, 2, 2, i % 5 ? '#9ea8e0' : '#ff9ec0');
    }
    ctx.globalAlpha = 1;

    // floating heroine (current skin + little legs)
    A.drawChar(ctx, heroImage(), 320, 238 + Math.sin(T * 1.8) * 4, Math.floor(T * 3) % 3, heroDraw({
      width: 76, height: 88, legH: 16, legColor: '#304848', bootColor: '#202236', outline: '#ff8fb8'
    }));

    A.text(ctx, 'ГАЛЬКА', 320, 96, { size: 62, color: '#fff', align: 'center', shadowColor: '#ff5d8f', shadowX: 4, shadowY: 5 });
    A.text(ctx, 'ПОДЗЕМНЫЙ РИТМ', 320, 128, { size: 17, color: '#ffb3ce', align: 'center' });
    A.px(ctx, 170, 142, 300, 2, '#6e5a9c');

    const opts = titleOptions();
    opts.forEach((o, i) => {
      const y = 274 + i * 24;
      const sel = titleIndex === i;
      A.text(ctx, (sel ? '▶ ' : '   ') + o, 320, y, { size: 15, color: sel ? '#ffe6a0' : '#aab3dd', align: 'center', shadow: false });
    });
    const netOnline = G.net && G.net.status() === 'online';
    A.text(ctx, 'ЛОББИ: ' + (netOnline ? 'СЕРВЕР НА СВЯЗИ · ' + (G.netui ? G.netui.lobbyCount() : 0) + ' АКТИВНЫХ' : 'НЕТ СВЯЗИ — ПРОВЕРЬ ИНТЕРНЕТ'), 320, 222, {
      size: 9, color: netOnline ? '#8affc8' : '#ff9ec0', align: 'center', shadow: false
    });

    // boss thumbnails — all ten story bosses
    BOSSES.forEach((b, i) => {
      const x = 20 + i * 61;
      const beaten = game.defeated[b.id];
      ctx.globalAlpha = beaten ? 0.95 : 0.55;
      A.portrait(ctx, G.images[b.id], x, 408, 48, 52, { bg: b.colors.dark, t: T });
      ctx.globalAlpha = 1;
      A.text(ctx, b.name.length > 6 ? b.name.slice(0, 5) + '…' : b.name, x + 24, 476, { size: 8, color: beaten ? b.colors.light : '#8790bb', align: 'center' });
      if (beaten) A.text(ctx, game.spared[b.id] ? '♥' : '×', x + 43, 418, { size: 11, color: game.spared[b.id] ? '#8affc8' : '#ff8fb8', align: 'center' });
    });
    A.text(ctx, Object.keys(ROOMS).length + ' МЕСТ · ' + (G.QUESTS || []).length + ' КВЕСТОВ · ' + BOSSES.length + ' БОССОВ ПО 3 ФАЗЫ · ГАЛЬКЕ 59', 320, 158, { size: 10, color: '#8e98c6', align: 'center' });
    if (progress.chapter1Done || game.chapter1Done) {
      A.text(ctx, 'ГЛАВА 2 ОТКРЫТА · ВЫБЕРИ «ВЫБОР ГЛАВЫ»', 320, 176, { size: 11, color: '#8affc8', align: 'center', shadow: false });
    }
  }

  function drawGameOver() {
    A.px(ctx, 0, 0, 640, 480, '#080810');
    A.text(ctx, 'ТЫ ОЧНУЛАСЬ...', 320, 200, { size: 38, color: '#ff8fb8', align: 'center' });
    A.text(ctx, 'Галька открыла глаза. В кармане — холодный осколок. Пора обратно.', 320, 246, { size: 13, color: '#b8c0e0', align: 'center' });
    if (Math.floor(T * 2) % 2 === 0) A.text(ctx, 'Нажми Z, чтобы подняться', 320, 310, { size: 15, color: '#fff', align: 'center' });
  }

  function drawCh2Choice() {
    A.drawBattleBG(ctx, BOSSES.find(b => b.final) || BOSSES[BOSSES.length - 1], T * 0.3);
    A.px(ctx, 70, 70, 500, 340, 'rgba(8,8,20,0.88)');
    const ch = G.CH2_CHOICE || {};
    A.text(ctx, ch.title || 'ВЫБОР ГАЛЬКИ', 320, 112, { size: 30, color: '#ffe6a0', align: 'center' });
    A.text(ctx, ch.question || 'ЧТО ДЕЛАТЬ?', 320, 158, { size: 14, color: '#fff4c8', align: 'center', shadow: false });
    (ch.options || []).forEach((o, i) => {
      const sel = i === ch2ChoiceIndex;
      A.panel(ctx, 120, 210 + i * 48, 400, 42, {
        fill: sel ? 'rgba(70,52,20,.92)' : 'rgba(18,20,42,.92)',
        border: sel ? '#ffe6a0' : '#6b72a8'
      });
      A.text(ctx, (sel ? '▶ ' : '   ') + o.label, 320, 232 + i * 48, {
        size: 17, color: sel ? '#ffe6a0' : '#c3caf0', align: 'center'
      });
    });
    A.text(ctx, 'ТЫКНИ ПО СТРОКЕ ИЛИ НАЖМИ ОК', 320, 330, { size: 10, color: '#ffe6a0', align: 'center', shadow: false });
    A.text(ctx, 'ГЛАВА 3 ЗАВИСИТ ОТ ЭТОГО ВЫБОРА', 320, 390, { size: 11, color: '#8affc8', align: 'center', shadow: false });
  }

  function drawEnding() {
    A.drawBattleBG(ctx, BOSSES.find(b => b.final) || BOSSES[BOSSES.length - 1], T * 0.3);
    if (game.dialogue) game.dialogue.draw(40, 300, 560, 152);
  }

  /* ---------------- loop ---------------- */

  function update(dt) {
    T += dt;
    toast.time = Math.max(0, toast.time - dt);
    ch2MarkerCooldown = Math.max(0, ch2MarkerCooldown - dt);

    if (G.netui && G.netui.isOpen && G.netui.isOpen()) {
      clearPressed();
      return;
    }

    const ACC = G.accounts;
    if (ACC) {
      if (ACC.isOpen && ACC.isOpen()) {
        clearPressed();
        return;
      }
      if (ACC.tick && ACC.tick()) {
        clearPressed();
        return;
      }
      liveTick += dt;
      if (liveTick >= 1) {
        liveTick = 0;
        if (ACC.updateLive) ACC.updateLive(game);
      }
    }

    if (netMode) {
      netSendT += dt;
      if (netSendT >= NET_INPUT_DT) {
        netSendT = 0;
        const mv = moveInput();
        G.net.sendInput({ v: { x: mv.vx, y: mv.vy, mag: mv.mag }, z: !!pressed.z, x: !!pressed.x });
      }
    }

    if (netMode === 'client') {
      /* The guest may close the host's text box locally; the host keeps theirs. */
      if (game.dialogue && (pressed.z || pressed.x)) {
        netDialogueDismissed = netDialogueSig;
        game.dialogue = null;
        AU.sfx('select');
      }
      predictLocalPlayer(dt);
      predictBattleSoul(dt);
      applyNetSnapshot(dt);
      updateParticles(dt);
      clearPressed();
      return;
    }

    if (state === 'title') {
      const opts = titleOptions(), n = opts.length;
      if (titleIndex >= n) titleIndex = 0;
      if (pressed.up) { titleIndex = (titleIndex - 1 + n) % n; AU.sfx('move'); }
      if (pressed.down) { titleIndex = (titleIndex + 1) % n; AU.sfx('move'); }
      if (pressed.z) {
        AU.ensure(); AU.sfx('select');
        const o = opts[titleIndex];
        if (o.indexOf('СКИН') === 0) {
          const changed = setSkin(skinIndex + 1);
          AU.sfx(changed ? 'select' : 'move');
          if (!changed && lockedSkinNames().length) showToast('Убей Машу и Пастуха — откроешь их скины. Пощада не считается.');
          clearPressed();
          return;
        }
        if (o.indexOf('АККАУНТ') === 0) {
          if (G.accounts && G.accounts.open) G.accounts.open();
          clearPressed();
          return;
        }
        if (o === 'СОЗДАТЬ ЛОББИ' || o === 'ВОЙТИ ПО КОДУ') {
          if (G.netui && G.netui.open) G.netui.open();
          clearPressed();
          return;
        }
        if (o === 'ВЫБОР ГЛАВЫ') {
          state = 'chapterSelect';
          titleIndex = 0;
          clearPressed();
          return;
        }
        if (o === 'ПРОДОЛЖИТЬ') { if (!loadGame()) newGame(); }
        else newGame();
        state = 'world';
        if (!game.dialogue) {
          say([{ who: 'sys', text: 'Галька проснулась. Восьмой год в школе. Шестой — с классом 6 «И». Сегодня опять кричать.' },
               { who: 'gal', text: 'Чай. Потом школа. Без объяснений.' }]);
        }
      }
    } else if (state === 'chapterSelect') {
      const opts = chapterOptions(), n = opts.length;
      if (chapterIndex >= n) chapterIndex = 0;
      if (pressed.up) { chapterIndex = (chapterIndex - 1 + n) % n; AU.sfx('move'); }
      if (pressed.down) { chapterIndex = (chapterIndex + 1) % n; AU.sfx('move'); }
      if (pressed.z) {
        const o = opts[chapterIndex];
        if (!o.open) {
          AU.sfx('back');
          showToast((progress.chapter1Done || game.chapter1Done) ? 'ГЛАВА 3 В РАЗРАБОТКЕ.' : 'Сначала пройди ГЛАВУ 1.');
        } else if (chapterIndex === 0) {
          newGame();
          state = 'world';
          say([{ who: 'sys', text: 'Галька проснулась. Восьмой год в школе. Шестой — с классом 6 «И». Сегодня опять кричать.' },
               { who: 'gal', text: 'Чай. Потом школа. Без объяснений.' }]);
        } else {
          startChapter2();
        }
        clearPressed();
        return;
      }
      if (pressed.x) { state = 'title'; titleIndex = 0; clearPressed(); return; }
    } else if (state === 'ch2Choice') {
      /* After choosing, the closing text must play instead of re-choosing. */
      if (game.dialogue) {
        game.dialogue.update(dt);
        clearPressed();
        return;
      }
      const n = (G.CH2_CHOICE || {}).options ? G.CH2_CHOICE.options.length : 0;
      if (!ch2ChoiceLocked && n && pressed.up) { ch2ChoiceIndex = (ch2ChoiceIndex - 1 + n) % n; AU.sfx('move'); }
      if (!ch2ChoiceLocked && n && pressed.down) { ch2ChoiceIndex = (ch2ChoiceIndex + 1) % n; AU.sfx('move'); }
      if (pressed.z) { confirmCh2Choice(ch2ChoiceIndex); clearPressed(); }
    } else if (state === 'world') {
      updateOverworld(dt);
    } else if (state === 'battle') {
      updateBattle(dt);
    } else if (state === 'gameover') {
      if (pressed.z) {
        AU.ensure();
        game.hp = game.maxHp;
        game.battle = null;
        state = 'world';
        enterRoom(game.roomId, { x: game.player.x || 320, y: Math.min(420, game.player.y || 400) }, true);
        AU.setTrack(ROOMS[game.roomId].track);
      }
    } else if (state === 'ending') {
      if (game.dialogue) game.dialogue.update(dt);
    }

    if (netMode === 'host') {
      netStateT += dt;
      if (netStateT >= NET_STATE_DT) {
        netStateT = 0;
        G.net.sendState(netSnapshot());
      }
    }

    updateParticles(dt);

    if (game.fade) {
      const f = game.fade;
      if (f.phase === 'in') {
        f.a += dt * 3.4;
        if (f.a >= 1) { f.a = 1; f.phase = 'out'; if (f.cb) { f.cb(); f.cb = null; } }
      } else {
        f.a -= dt * 3.4;
        if (f.a <= 0) game.fade = null;
      }
    }

    if (netMode === 'host') {
      Object.keys(netInputs).forEach(id => { if (netInputs[id]) netInputs[id].z = false; });
    }
    clearPressed();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (state === 'title') drawTitle();
    else if (state === 'chapterSelect') drawChapterSelect();
    else if (state === 'ch2Choice') drawCh2Choice();
    else if (state === 'world') drawOverworld();
    else if (state === 'battle') drawBattle();
    else if (state === 'gameover') drawGameOver();
    else if (state === 'ending') drawEnding();

    if (game.fade) {
      ctx.globalAlpha = Math.max(0, Math.min(1, game.fade.a));
      A.px(ctx, 0, 0, W, H, '#05060d');
      ctx.globalAlpha = 1;
    }
    if (G.imageErrors.length) {
      A.panel(ctx, 20, 20, 600, 44, { fill: 'rgba(60,8,20,.95)', border: '#ff6d8f' });
      A.text(ctx, 'НЕТ КАРТИНОК: ' + G.imageErrors.join(', ') + ' — проверь папку assets на сайте', 320, 47, {
        size: 13, color: '#ffd9ec', align: 'center'
      });
    }
  }

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    AU.tick();
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  G.net.on('input', d => { netInputs[d.id] = d.data; });
  G.net.on('state', s => {
    if (!s || netMode !== 'client') return;
    const lob = G.net.lobby && G.net.lobby();
    if (s.lobby && lob && s.lobby !== lob.code) return;      // old lobby packet
    if (s.seq && s.seq <= netAppliedSeq) return;             // out-of-order packet
    if (s.seq) netAppliedSeq = s.seq;
    netSnap = s;
  });
  G.net.on('left', () => {
    netMode = ''; netPlayers = []; netInputs = {}; netSnap = null; netLastSnapRef = null;
    netSnapSeq = 0; netAppliedSeq = 0; netLastRoom = '';
    netSig = { inv: '', flags: '', defeated: '', spared: '', dialogue: '' };
  });

  G.debug = {
    game, startBattle, bossById, crewGang: () => CREW_GANG, questFoeFor, questBossById, npcTalk, enterRoom, getState: () => state, say, makeBattle, buildSchedule,
    startNewGame: newGame, startChapter2, chapterOptions, ch2Objective, routeExitTo,
    syncChapterNpcs, activeCh2MarkerNear, roomExits,
    chapterProgress: () => Object.assign({}, progress),
    unlockChapter2: () => { progress.chapter1Done = true; game.chapter1Done = true; saveProgress(); },
    netSnap: () => netSnap,
    netInfo: () => ({
      mode: netMode, selfIndex: netSelfIndex,
      players: netPlayers.map(p => ({ id: p.id, nick: p.nick, x: Math.round(p.x), y: Math.round(p.y), color: p.color })),
      hasSnapshot: !!netSnap, inputs: Object.keys(netInputs).length
    }),
    step: (dt, key) => { if (key) pressed[key] = true; update(dt || 0.016); draw(); },
    stepMany: (n, dt, key) => {
      for (let i = 0; i < (n || 1); i++) {
        if (key && i === 0) pressed[key] = true;
        update(dt || 0.016); draw();
      }
    },
    attack: () => { if (game.battle) resolveAttack(game.battle); },
    setEnemyHp: v => { if (game.battle) game.battle.enemyHp = v; },
    spare: () => { if (game.battle) victory(game.battle, 'spare'); },
    enemyAttack: () => { if (game.battle) enemyAttack(); },
    heroSkin: () => G.heroSkin(),
    setHeroSkin: setSkin,
    isSkinUnlocked,
    unlockSkinForBoss,
    lockedSkinNames
  };
})(window.GALKA = window.GALKA || {});
