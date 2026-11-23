/* ГАЛЬКА — pixel art drawn in code + portrait helper */
(function (G) {
  const art = {};
  const TAU = Math.PI * 2;

  art.px = function (ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  art.text = function (ctx, str, x, y, o) {
    o = o || {};
    const size = o.size || 14;
    ctx.font = (o.weight || 'bold') + ' ' + size + 'px "Consolas","Courier New",monospace';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.shadow !== false) {
      ctx.fillStyle = o.shadowColor || '#080912';
      ctx.fillText(str, x + (o.shadowX == null ? 2 : o.shadowX), y + (o.shadowY == null ? 2 : o.shadowY));
    }
    ctx.fillStyle = o.color || '#f2f5ff';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
  };

  art.measure = function (ctx, str, size, weight) {
    ctx.font = (weight || 'bold') + ' ' + (size || 14) + 'px "Consolas","Courier New",monospace';
    return ctx.measureText(str).width;
  };

  art.wrap = function (ctx, str, maxW, size, weight) {
    ctx.font = (weight || 'bold') + ' ' + (size || 14) + 'px "Consolas","Courier New",monospace';
    const words = String(str).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };

  art.panel = function (ctx, x, y, w, h, o) {
    o = o || {};
    art.px(ctx, x + 4, y + 4, w, h, 'rgba(0,0,0,.55)');
    art.px(ctx, x, y, w, h, o.fill || '#0b0d1c');
    art.px(ctx, x, y, w, 3, o.border || '#e8ecff');
    art.px(ctx, x, y + h - 3, w, 3, o.border || '#e8ecff');
    art.px(ctx, x, y, 3, h, o.border || '#e8ecff');
    art.px(ctx, x + w - 3, y, 3, h, o.border || '#e8ecff');
    if (o.inner) {
      art.px(ctx, x + 5, y + 5, w - 10, 2, o.inner);
      art.px(ctx, x + 5, y + h - 7, w - 10, 2, o.inner);
    }
  };

  art.heart = function (ctx, x, y, size, color, beat) {
    const m = Math.max(2, Math.round(size / 7));
    const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
    const wob = beat ? Math.round(Math.sin(beat) * 1) : 0;
    ctx.save();
    ctx.fillStyle = color || '#ff4d6d';
    ctx.shadowColor = color || '#ff4d6d';
    ctx.shadowBlur = 12;
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < 7; c++)
        if (rows[r][c] === '1') ctx.fillRect(Math.round(x + (c - 3) * m), Math.round(y + (r - 2.5) * m) + wob, m, m);
    ctx.restore();
  };

  art.rand = function (seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  };

  /* ---------- main heroine ---------- */

  art.drawGal = function (ctx, cx, feetY, frame, o) {
    o = o || {};
    const s = o.scale || 2;
    const flip = !!o.flip;
    const bob = (frame === 1 || frame === 2) ? -Math.round(Math.sin(frame * 2.1) * 1) : 0;
    const ox = cx - 7 * s;
    const oy = feetY - 22 * s + bob * s;

    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (o.mirror) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
    if (flip) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }

    const C = o.colors || {};
    const coat = C.coat || '#304848';
    const coatHi = C.coatHi || '#557477';
    const hair = C.hair || '#494866';
    const hairHi = C.hairHi || '#8283a8';
    const skin = C.skin || '#d9b3a6';
    const scarf = C.scarf || '#c16185';

    function P(x, y, w, h, c) { art.px(ctx, ox + x * s, oy + y * s, w * s, h * s, c); }

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(cx, feetY + 1, 11 * s, 3 * s, 0, 0, TAU);
    ctx.fill();

    // boots + legs
    P(3, 19, 3, 3, '#202236'); P(8, 19, 3, 3, '#202236');
    P(3, 21, 4, 1, '#121423'); P(7, 21, 4, 1, '#121423');
    P(4, 16, 2, 3, '#35364f'); P(8, 16, 2, 3, '#35364f');

    // coat body
    P(3, 8, 8, 8, coat);
    P(3, 8, 2, 8, coatHi);
    P(10, 9, 1, 7, '#22383f');
    P(4, 14, 6, 1, '#1d2f37');
    P(3, 15, 8, 1, scarf);
    P(6, 9, 1, 6, '#1f3339');

    // arms
    if (frame === 1) { P(1, 10, 2, 5, coat); P(1, 15, 2, 1, skin); }
    else if (frame === 2) { P(11, 10, 2, 5, coat); P(11, 15, 2, 1, skin); }
    else { P(2, 10, 2, 6, coat); P(10, 10, 2, 6, coat); P(2, 16, 2, 1, skin); P(10, 16, 2, 1, skin); }

    // head & hair
    if (o.dir === 'up') {
      P(4, 2, 6, 6, hair); P(3, 3, 1, 5, hair); P(10, 3, 1, 5, hair);
      P(5, 3, 2, 3, hairHi); P(8, 6, 2, 1, coatHi);
    } else {
      P(4, 3, 6, 5, skin);
      P(5, 8, 4, 1, '#b98c81');
      P(3, 1, 8, 3, hair);
      P(3, 3, 2, 4, hair); P(9, 3, 2, 5, hair);
      P(4, 1, 3, 1, hairHi); P(5, 2, 2, 1, hairHi);
      P(3, 6, 1, 3, hairHi);
      if (o.dir === 'left') { P(4, 5, 1, 1, '#202034'); }
      else { P(8, 5, 1, 1, '#202034'); P(9, 5, 1, 1, '#202034'); }
      P(7, 7, 1, 1, '#9b5f63');
    }

    if (o.aura) {
      ctx.globalAlpha = 0.25 + 0.12 * Math.sin(frame * 3);
      ctx.strokeStyle = o.aura;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, feetY - 18 * s, 15 * s, 24 * s, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---------- attached picture + little pixel legs ---------- */

  art.drawChar = function (ctx, img, cx, feetY, frame, o) {
    o = o || {};
    const w = o.width || 38, h = o.height || 48, legH = o.legH || 12;
    const walking = frame === 1 || frame === 2;
    const swing = walking ? (frame === 1 ? 2 : -2) : 0;
    const bob = walking ? -Math.abs(swing) / 2 : 0;
    const top = feetY - legH - h + bob;
    const bottom = top + h;
    const leg = o.legColor || '#33354d', boot = o.bootColor || '#191a2b';

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(cx, feetY + 1, w * 0.55, 4, 0, 0, TAU); ctx.fill();

    // two little legs with boots
    art.px(ctx, cx - 11 + swing, bottom - 2, 8, legH + 2, leg);
    art.px(ctx, cx + 3 - swing, bottom - 2, 8, legH + 2, leg);
    art.px(ctx, cx - 12 + swing, feetY - 4, 10, 4, boot);
    art.px(ctx, cx + 2 - swing, feetY - 4, 10, 4, boot);
    art.px(ctx, cx - 12 + swing, feetY - 1, 10, 2, '#0d0e19');
    art.px(ctx, cx + 2 - swing, feetY - 1, 10, 2, '#0d0e19');

    // dark backing so light images still read as a character
    art.px(ctx, cx - w / 2 - 2, top - 2, w + 4, h + 4, '#0b0c18');

    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w / 2, top, w, h); ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      let scale;
      if (o.fit === 'cover') scale = Math.max(w / iw, h / ih);
      else if (o.fit === 'stretch') scale = 1;
      else scale = Math.min(w / iw, h / ih);
      const dw = o.fit === 'stretch' ? w : iw * scale;
      const dh = o.fit === 'stretch' ? h : ih * scale;
      let dx = cx - dw / 2 + (o.offsetX || 0);
      const dy = top + h - dh + (o.offsetY || 0);
      ctx.imageSmoothingEnabled = false;
      if (o.flip) {
        ctx.translate(cx * 2, 0); ctx.scale(-1, 1);
        dx = cx - dw / 2 - (o.offsetX || 0);
      }
      ctx.drawImage(img, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
    } else if (o.fallback) {
      art.drawBossSprite(ctx, o.fallback, cx, bottom - h / 2, 0, h / 24);
    } else {
      art.drawGal(ctx, cx, bottom, frame, { dir: 'down', scale: Math.max(1, h / 22) });
    }
    if (o.tint) {
      ctx.globalAlpha = o.tintAlpha || 0.2;
      ctx.fillStyle = o.tint;
      ctx.fillRect(cx - w / 2, top, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // slim outline
    ctx.strokeStyle = o.outline || 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(cx - w / 2) + 0.5, Math.round(top) + 0.5, w - 1, h - 1);
  };

  /* ---------- boss monster sprites ---------- */

  art.drawBossSprite = function (ctx, id, cx, cy, t, scale, hurt) {
    const s = scale || 4;
    const bob = Math.sin(t * 2) * 3;
    ctx.save();
    if (hurt > 0) ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 28));


    function P(x, y, w, h, c) { art.px(ctx, cx + (x - 8) * s, cy + (y - 12) * s + bob, w * s, h * s, c); }

    if (id === 'abayunda') {
      // cloak wisp
      ctx.fillStyle = 'rgba(90,120,255,.12)';
      ctx.beginPath(); ctx.ellipse(cx, cy + bob, 13 * s, 12 * s, 0, 0, TAU); ctx.fill();
      P(6, 3, 4, 3, '#a9b8ff'); P(5, 5, 6, 2, '#dfe6ff');
      P(4, 6, 8, 9, '#293b73'); P(3, 8, 10, 7, '#1b2a55');
      P(3, 13, 2, 5, '#141f41'); P(6, 14, 2, 6, '#1b2a55'); P(9, 14, 2, 5, '#141f41'); P(12, 13, 2, 5, '#1b2a55');
      P(6, 7, 2, 1, '#9fd8ff'); P(10, 7, 2, 1, '#9fd8ff');
      P(4, 10, 8, 1, '#5065b8');
      P(2, 11, 2, 4, '#293b73'); P(14, 11, 2, 4, '#293b73');
      P(7, 1, 1, 3, '#7d8cff'); P(11, 0, 1, 3, '#7d8cff');
    } else if (id === 'huyet') {
      P(5, 3, 6, 5, '#c9c9d2');
      P(4, 1, 8, 3, '#e6e6ee');
      P(4, 5, 8, 3, '#a9a9b5');
      P(5, 6, 6, 6, '#d8d8e0'); // beard
      P(6, 7, 4, 4, '#f0f0f4');
      P(6, 4, 1, 1, '#2a2a33'); P(9, 4, 1, 1, '#2a2a33');
      P(6, 4, 4, 1, '#4b4b57');
      P(4, 11, 8, 7, '#4c4c59');
      P(3, 12, 2, 5, '#3b3b46'); P(11, 12, 2, 5, '#3b3b46');
      P(6, 12, 2, 5, '#8a8a99');
      P(13, 8, 1, 12, '#6e5b4a'); P(12, 19, 3, 1, '#6e5b4a');
      P(5, 18, 3, 2, '#2c2c35'); P(9, 18, 3, 2, '#2c2c35');
    } else if (id === 'afina') {
      ctx.fillStyle = 'rgba(255,222,150,.16)';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4 * s + bob, 15 * s, 13 * s, 0, 0, TAU); ctx.fill();
      // wings
      P(0, 5, 4, 3, '#f6f2e6'); P(1, 8, 3, 3, '#e8dfc9'); P(2, 11, 2, 3, '#d8c9ac');
      P(12, 5, 4, 3, '#f6f2e6'); P(12, 8, 3, 3, '#e8dfc9'); P(12, 11, 2, 3, '#d8c9ac');
      P(5, 3, 6, 5, '#f4d0b2');
      P(4, 1, 8, 3, '#f0e2b8'); P(5, 0, 6, 2, '#fffbe8');
      P(6, 4, 1, 1, '#6a4a44'); P(9, 4, 1, 1, '#6a4a44');
      P(5, 8, 6, 8, '#f7f5ee'); P(4, 11, 8, 4, '#e8d9b8');
      P(6, 16, 2, 3, '#d8a860'); P(9, 16, 2, 3, '#d8a860');
      P(6, -2, 4, 1, '#ffe9a0'); P(7, -3, 2, 1, '#fff6cc');
      P(5, 9, 1, 5, '#d8a860'); P(10, 9, 1, 5, '#d8a860');
    } else if (id === 'yasr') {
      P(5, 3, 6, 5, '#e0b49c');
      P(4, 1, 9, 3, '#182033'); P(3, 2, 2, 5, '#1c2944'); P(11, 2, 2, 4, '#1c2944');
      P(4, 0, 3, 2, '#222c45'); P(7, 0, 3, 2, '#222c45'); P(10, 1, 2, 2, '#222c45');
      P(4, 4, 2, 1, '#2a2f45'); P(10, 4, 2, 1, '#2a2f45');
      P(3, 5, 1, 2, '#35d0ff'); P(12, 5, 1, 2, '#ff5b3d');
      P(4, 8, 8, 8, '#1848a8');
      P(4, 9, 2, 6, '#f04800'); P(10, 9, 2, 6, '#f04800');
      P(6, 9, 4, 6, '#0e2a66');
      P(7, 10, 2, 2, '#4dd8ff');
      P(2, 9, 2, 6, '#1848a8'); P(12, 9, 2, 6, '#1848a8');
      P(5, 16, 3, 3, '#131a30'); P(9, 16, 3, 3, '#131a30');
      P(6, -1, 1, 2, '#ff5b3d'); P(10, -1, 1, 2, '#35d0ff');
    } else if (id === 'director') {
      // fallback: director's son with a glowing tablet
      P(5, 3, 6, 5, '#d6a98f');
      P(4, 1, 8, 3, '#2c203c'); P(3, 2, 2, 5, '#2c203c'); P(11, 2, 2, 4, '#2c203c');
      P(6, 4, 1, 1, '#241436'); P(9, 4, 1, 1, '#241436');
      P(4, 8, 8, 8, '#3a2a4c');
      P(2, 9, 4, 6, '#d974a8'); P(3, 10, 3, 4, '#ff6d8f');
      P(10, 9, 5, 6, '#151521'); P(11, 10, 3, 4, '#ffd9ec');
      P(5, 16, 3, 3, '#241436'); P(9, 16, 3, 3, '#241436');
    } else {
      P(5, 5, 6, 6, '#888899'); P(6, 7, 1, 1, '#fff'); P(9, 7, 1, 1, '#fff');
      P(4, 11, 8, 7, '#55556a');
    }
    ctx.restore();
  };

  /* ---------- portrait ---------- */

  art.portrait = function (ctx, img, x, y, w, h, o) {
    o = o || {};
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    art.px(ctx, x, y, w, h, o.bg || '#121527');
    if (img && img.complete && img.naturalWidth > 0) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const scale = Math.max(w / iw, h / ih) * (o.zoom || 1);
      const dw = iw * scale, dh = ih * scale;
      let sx = x + (w - dw) / 2 + (o.offsetX || 0);
      let sy = y + (h - dh) / 2 + (o.offsetY || 0);
      if (o.flip) {
        ctx.translate(x * 2 + w, 0);
        ctx.scale(-1, 1);
        sx = x + (w - dw) / 2 - (o.offsetX || 0);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, Math.round(sx), Math.round(sy), Math.round(dw), Math.round(dh));
    } else if (o.fallback) {
      art.drawBossSprite(ctx, o.fallback, x + w / 2, y + h / 2 + 20, o.t || 0, 2.4);
    }
    if (o.tint) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = o.tint;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
    if (o.flash > 0) {
      ctx.globalAlpha = Math.min(1, o.flash);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  };

  /* ---------- overworld rooms ---------- */

  const roomPal = {
    home:   { sky: '#1b1228', far: '#2a1d3d', ground: '#3a2b3f', edge: '#50394d', dot: '#ffd79a' },
    school: { sky: '#131a26', far: '#20323c', ground: '#4a3d3a', edge: '#8fb9a8', dot: '#fff0c0' },
    street: { sky: '#111528', far: '#232b44', ground: '#2c2f42', edge: '#6f7895', dot: '#ffd88a' },
    park:   { sky: '#0b1a24', far: '#15323a', ground: '#253b39', edge: '#4e8d72', dot: '#b8ffd0' },
    metro:  { sky: '#081420', far: '#102b3c', ground: '#152a3a', edge: '#35c8c0', dot: '#7fffe8' },
    office: { sky: '#1a1126', far: '#2c1c3c', ground: '#3a2b42', edge: '#d8a860', dot: '#ffd9ec' },
    corridor:  { sky: '#161d2c', far: '#26384a', ground: '#3d4655', edge: '#8fb9c8', dot: '#e8f4ff' },
    canteen:   { sky: '#231c28', far: '#3a2c38', ground: '#4a3a3a', edge: '#e8b878', dot: '#ffe0a8' },
    yard:      { sky: '#1a2333', far: '#2c3b52', ground: '#3a4149', edge: '#7f9db0', dot: '#ffd88a' },
    kiosk:     { sky: '#141a2c', far: '#25314b', ground: '#2e3548', edge: '#a9c0ff', dot: '#fff0c0' },
    vestibule: { sky: '#0d1722', far: '#1b3242', ground: '#223a48', edge: '#5ad8c0', dot: '#a8ffec' },
    tunnel:    { sky: '#09121d', far: '#122a3a', ground: '#17303e', edge: '#35d8d0', dot: '#8fffe0' },
    staffroom: { sky: '#1d1628', far: '#312540', ground: '#403345', edge: '#d8a860', dot: '#ffd9ec' },
    path:      { sky: '#101426', far: '#222a44', ground: '#2b3046', edge: '#8fa0d0', dot: '#ffe0a8' },
    hub:       { sky: '#161027', far: '#2c2246', ground: '#332a48', edge: '#c77dff', dot: '#ffd98a' },
    dvor:      { sky: '#101c1f', far: '#1e3730', ground: '#2b3b32', edge: '#8fd0a0', dot: '#c8ffd0' },
    podezd:    { sky: '#121522', far: '#252b42', ground: '#303448', edge: '#9aa8d8', dot: '#ffe6a0' },
    cherdak:   { sky: '#171222', far: '#2c2340', ground: '#3a2f48', edge: '#d8b878', dot: '#ffd9ec' },
    podval:    { sky: '#0b1118', far: '#172430', ground: '#1d2c36', edge: '#6fa8b8', dot: '#a8e0e8' },
    sport:     { sky: '#141c24', far: '#243648', ground: '#2e4250', edge: '#ff9ec0', dot: '#fff0c0' },
    labor:     { sky: '#181418', far: '#30242c', ground: '#3b2e34', edge: '#d8a860', dot: '#ffe0b0' }
  };

  art.drawRoom = function (ctx, id, t, Gstate) {
    const p = roomPal[id] || roomPal[id.replace(/\d+$/, '')] || roomPal.path;
    const rnd = art.rand(id.length * 977 + id.charCodeAt(0) * 31);
    art.px(ctx, 0, 0, 640, 480, p.sky);

    // sky / ceiling gradient bands
    for (let i = 0; i < 12; i++) {
      ctx.globalAlpha = 0.05 + i * 0.008;
      art.px(ctx, 0, i * 22, 640, 22, p.far);
    }
    ctx.globalAlpha = 1;

    if (id === 'corridor') {
      art.px(ctx, 0, 0, 640, 360, '#1c2635');
      // lockers
      for (let x = 0; x < 640; x += 46) {
        art.px(ctx, x + 4, 70, 38, 190, x % 92 ? '#33465a' : '#2b3b4d');
        art.px(ctx, x + 8, 78, 30, 2, '#6f8ca0');
        art.px(ctx, x + 8, 250, 30, 2, '#6f8ca0');
        art.px(ctx, x + 34, 160, 3, 12, '#c8d8e0');
        for (let s = 0; s < 3; s++) art.px(ctx, x + 10 + s * 8, 96, 3, 3, '#8fb9c8');
      }
      art.px(ctx, 0, 264, 640, 8, '#1a2330');
      // classroom doors
      [80, 350].forEach(x => {
        art.px(ctx, x, 104, 96, 160, '#3c4f60');
        art.px(ctx, x + 8, 112, 80, 144, '#496276');
        art.px(ctx, x + 72, 180, 6, 8, '#e8d9a0');
        art.text(ctx, x === 80 ? '6 Б' : '6 А', x + 48, 152, { size: 14, color: '#d8ecff', align: 'center', shadow: false });
      });
      // notice board
      art.px(ctx, 240, 90, 100, 66, '#7a5d46');
      art.px(ctx, 245, 95, 90, 56, '#d8d0b4');
      for (let i = 0; i < 4; i++) art.px(ctx, 250 + i * 20, 104 + (i % 2) * 14, 16, 20, i % 2 ? '#9fb8d8' : '#e8b8b0');
      // ceiling lights and floor
      [120, 320, 520].forEach(x => {
        art.px(ctx, x, 26, 84, 8, '#dff0ff');
        ctx.fillStyle = 'rgba(220,240,255,.06)';
        ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x + 84, 34); ctx.lineTo(x + 128, 360); ctx.lineTo(x - 44, 360); ctx.fill();
      });
      art.px(ctx, 0, 360, 640, 120, p.ground);
      for (let x = 0; x < 640; x += 40) art.px(ctx, x, 360, 2, 120, 'rgba(0,0,0,.18)');
      for (let y = 384; y < 480; y += 32) art.px(ctx, 0, y, 640, 2, 'rgba(0,0,0,.14)');
    } else if (id === 'canteen') {
      art.px(ctx, 0, 0, 640, 350, '#2a202c');
      for (let y = 20; y < 350; y += 20) art.px(ctx, 0, y, 640, 1, 'rgba(255,255,255,.04)');
      // menu board
      art.px(ctx, 220, 40, 200, 74, '#1d362f');
      art.px(ctx, 226, 46, 188, 62, '#25453b');
      art.text(ctx, 'МЕНЬЮ: КАША / ЧАЙ', 320, 72, { size: 13, color: '#d8f0d8', align: 'center', shadow: false });
      art.text(ctx, 'И ПИРОЖОК', 320, 94, { size: 12, color: '#ffe6a0', align: 'center', shadow: false });
      // serving counter
      art.px(ctx, 60, 250, 520, 22, '#8a6a52');
      art.px(ctx, 60, 272, 520, 12, '#5b4638');
      for (let x = 80; x < 580; x += 60) {
        art.px(ctx, x, 232, 40, 18, '#c8ccd0');
        art.px(ctx, x + 6, 226, 28, 6, '#eef2f4');
        if (x % 120 === 80) art.px(ctx, x + 14, 220, 12, 6, '#d8a860');
      }
      // tables
      [[100, 360], [460, 360], [280, 420]].forEach(q => {
        art.px(ctx, q[0], q[1], 100, 12, '#7a5c48');
        art.px(ctx, q[0] + 8, q[1] + 12, 8, 30, '#4c3a30');
        art.px(ctx, q[0] + 84, q[1] + 12, 8, 30, '#4c3a30');
      });
      art.px(ctx, 0, 340, 640, 140, p.ground);
      for (let x = 0; x < 640; x += 28) art.px(ctx, x, 340, 2, 140, 'rgba(0,0,0,.12)');
    } else if (id === 'yard') {
      art.px(ctx, 0, 0, 640, 330, p.sky);
      // school facade
      art.px(ctx, 60, 60, 520, 270, '#38465c');
      for (let x = 80; x < 580; x += 70) {
        art.px(ctx, x, 90, 46, 54, '#16283c');
        art.px(ctx, x + 4, 94, 38, 46, '#3a6070');
        art.px(ctx, x + 21, 94, 2, 46, '#22394a');
      }
      art.px(ctx, 270, 210, 100, 120, '#2a384c');
      art.text(ctx, 'ШКОЛА', 320, 246, { size: 15, color: '#e8d9a0', align: 'center', shadow: false });
      art.px(ctx, 0, 320, 640, 160, p.ground);
      for (let y = 342; y < 480; y += 26) art.px(ctx, 0, y, 640, 2, 'rgba(255,255,255,.04)');
      // puddles and climbing frame
      art.px(ctx, 120, 410, 70, 8, 'rgba(120,180,210,.22)');
      art.px(ctx, 440, 380, 90, 8, 'rgba(120,180,210,.18)');
      art.px(ctx, 380, 330, 4, 80, '#6f8294'); art.px(ctx, 470, 330, 4, 80, '#6f8294');
      art.px(ctx, 376, 330, 102, 6, '#6f8294');
      for (let x = 382; x < 476; x += 18) art.px(ctx, x, 336, 3, 30, '#8a9cae');
      // fence
      for (let x = 0; x < 640; x += 24) art.px(ctx, x, 300, 5, 50, '#4c5a68');
      art.px(ctx, 0, 312, 640, 4, '#4c5a68');
    } else if (id === 'kiosk') {
      art.px(ctx, 0, 0, 640, 340, p.sky);
      [0, 440].forEach((x, i) => {
        art.px(ctx, x, 120 - i * 30, 180, 220, '#222b40');
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++)
          art.px(ctx, x + 18 + c * 48, 140 - i * 30 + r * 40, 22, 20, (r + c) % 3 ? '#ffd88a' : '#171d2e');
      });
      art.px(ctx, 0, 330, 640, 150, p.ground);
      // kiosk body
      art.px(ctx, 210, 190, 220, 160, '#3d4b60');
      art.px(ctx, 190, 180, 260, 18, '#d8a860');
      for (let x = 192; x < 450; x += 24) art.px(ctx, x, 180, 12, 18, '#ffd9ec');
      art.px(ctx, 226, 226, 188, 90, '#17243a');
      art.text(ctx, 'ГАЗЕТЫ', 320, 250, { size: 18, color: '#ffe6a0', align: 'center', shadow: false });
      for (let i = 0; i < 7; i++) art.px(ctx, 234 + i * 25, 270 + (i % 2) * 8, 18, 26, ['#e8e0d0','#c8d8f0','#f0c8d8'][i % 3]);
      art.px(ctx, 210, 350, 220, 10, '#263244');
    } else if (id === 'vestibule') {
      art.px(ctx, 0, 0, 640, 400, '#11212e');
      for (let x = 0; x <= 640; x += 32) art.px(ctx, x, 0, 1, 400, 'rgba(90,216,192,.10)');
      for (let y = 0; y <= 400; y += 32) art.px(ctx, 0, y, 640, 1, 'rgba(90,216,192,.08)');
      // turnstiles
      [170, 320, 470].forEach(x => {
        art.px(ctx, x - 10, 250, 20, 120, '#294858');
        art.px(ctx, x - 24, 300, 48, 8, '#4c8290');
        art.px(ctx, x - 6, 262, 12, 6, '#5ad8c0');
      });
      // exit sign
      art.px(ctx, 250, 70, 140, 40, '#0a2836');
      art.text(ctx, 'ВЫХОД ↑', 320, 98, { size: 15, color: '#8fffe0', align: 'center', shadow: false });
      art.px(ctx, 0, 400, 640, 80, p.ground);
      for (let x = 0; x < 640; x += 26) art.px(ctx, x, 400, 2, 80, 'rgba(0,0,0,.2)');
    } else if (id === 'tunnel') {
      art.px(ctx, 0, 0, 640, 400, '#081620');
      // tiled arches
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 130;
        ctx.strokeStyle = 'rgba(53,216,208,.18)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, 230, 90, Math.PI, 0); ctx.stroke();
        art.px(ctx, x - 92, 230, 4, 170, 'rgba(53,216,208,.16)');
        art.px(ctx, x + 88, 230, 4, 170, 'rgba(53,216,208,.16)');
      }
      // pipes and neon
      art.px(ctx, 0, 60, 640, 10, '#1d3a48');
      art.px(ctx, 0, 76, 640, 5, '#2d5666');
      art.px(ctx, 0, 340 + Math.sin(t * 2) * 3, 640, 3, 'rgba(53,216,208,.35)');
      // graffiti
      art.text(ctx, 'ДЫШИ В ТАКТ', 458, 268, { size: 12, color: 'rgba(140,255,224,.75)', align: 'center', shadow: false });
      art.text(ctx, '↗', 470, 290, { size: 20, color: 'rgba(255,120,90,.7)', align: 'center', shadow: false });
      art.px(ctx, 0, 400, 640, 80, p.ground);
      art.px(ctx, 0, 420, 640, 5, '#24414f');
      art.px(ctx, 0, 452, 640, 5, '#24414f');
    } else if (id === 'staffroom') {
      art.px(ctx, 0, 0, 640, 350, '#241a32');
      for (let x = 0; x < 640; x += 22) art.px(ctx, x, 0, 1, 350, 'rgba(255,255,255,.025)');
      // shelves with folders
      [30, 500].forEach(x => {
        art.px(ctx, x, 60, 110, 260, '#3b2c4c');
        for (let r = 0; r < 5; r++) {
          art.px(ctx, x + 4, 70 + r * 50, 102, 5, '#5a4470');
          for (let i = 0; i < 7; i++) art.px(ctx, x + 8 + i * 14, 78 + r * 50, 11, 34 - (i % 3) * 7, ['#d8a860','#8d7ab8','#c16185','#4e8a92'][i % 4]);
        }
      });
      // wall clock
      art.px(ctx, 306, 40, 28, 28, '#e8e0c8');
      art.px(ctx, 320, 46, 2, 9, '#2a2a38'); art.px(ctx, 320, 54, 8, 2, '#2a2a38');
      // desks
      [[150, 300], [400, 300]].forEach(q => {
        art.px(ctx, q[0], q[1], 120, 14, '#6a4a3a');
        art.px(ctx, q[0] + 10, q[1] + 14, 10, 40, '#4e362c');
        art.px(ctx, q[0] + 100, q[1] + 14, 10, 40, '#4e362c');
        art.px(ctx, q[0] + 20, q[1] - 10, 34, 8, '#e8e0d0');
        art.px(ctx, q[0] + 70, q[1] - 6, 20, 12, '#b83248');
      });
      art.px(ctx, 0, 350, 640, 130, p.ground);
      ctx.fillStyle = 'rgba(255,217,138,.08)';
      ctx.beginPath(); ctx.moveTo(280, 60); ctx.lineTo(360, 60); ctx.lineTo(470, 480); ctx.lineTo(170, 480); ctx.fill();
    } else if (id === 'home') {
      // wall planks
      for (let y = 40; y < 360; y += 18) art.px(ctx, 0, y, 640, 1, 'rgba(255,255,255,.045)');
      art.px(ctx, 0, 356, 640, 124, p.ground);
      for (let x = 0; x < 640; x += 26) art.px(ctx, x, 356, 1, 124, 'rgba(0,0,0,.16)');
      // window
      art.px(ctx, 430, 70, 130, 120, '#0a0d24');
      art.px(ctx, 430, 70, 130, 5, '#6c5570');
      art.px(ctx, 430, 185, 130, 5, '#6c5570');
      art.px(ctx, 430, 70, 5, 120, '#6c5570');
      art.px(ctx, 555, 70, 5, 120, '#6c5570');
      art.px(ctx, 495, 70, 3, 120, '#6c5570');
      art.px(ctx, 430, 128, 130, 3, '#6c5570');
      // moon + stars
      art.px(ctx, 520, 90, 28, 28, '#f6f1d0');
      art.px(ctx, 516, 96, 36, 18, '#f6f1d0');
      for (let i = 0; i < 14; i++) art.px(ctx, 440 + rnd() * 110, 80 + rnd() * 95, 2, 2, '#fff');
      // bed
      art.px(ctx, 60, 250, 150, 22, '#7d4f66');
      art.px(ctx, 60, 224, 150, 30, '#3c3350');
      art.px(ctx, 66, 230, 52, 18, '#e8d9df');
      art.px(ctx, 60, 270, 12, 40, '#2a2337'); art.px(ctx, 198, 270, 12, 40, '#2a2337');
      // shelf & books
      art.px(ctx, 250, 120, 110, 8, '#6a4c5c');
      for (let i = 0; i < 7; i++) art.px(ctx, 256 + i * 14, 88 + rnd() * 8, 10, 32 - rnd() * 10, ['#c16185','#6fa8a0','#d7b36a','#7770ad'][i % 4]);
      // rug + lamp
      art.px(ctx, 250, 380, 180, 60, '#5b3458');
      art.px(ctx, 262, 392, 156, 36, '#75476b');
      art.px(ctx, 336, 300, 6, 60, '#c0a06b');
      art.px(ctx, 314, 286, 50, 18, '#ffcf8a');
      ctx.fillStyle = 'rgba(255,207,138,.10)';
      ctx.beginPath(); ctx.arc(339, 300, 90, 0, TAU); ctx.fill();
    } else if (id === 'school') {
      // classroom wall + board
      art.px(ctx, 0, 0, 640, 360, '#1d2b30');
      for (let y = 20; y < 360; y += 16) art.px(ctx, 0, y, 640, 1, 'rgba(255,255,255,.035)');
      art.px(ctx, 130, 54, 380, 170, '#16302c');
      art.px(ctx, 126, 50, 388, 6, '#b08a5e');
      art.px(ctx, 126, 224, 388, 8, '#b08a5e');
      art.text(ctx, 'УРОК 1: ДОРОГА ДОМОЙ', 320, 92, { size: 16, color: '#d8f0d8', align: 'center', shadow: false });
      art.px(ctx, 180, 108, 280, 2, 'rgba(216,240,216,.5)');
      art.text(ctx, '1. Не теряйся', 190, 142, { size: 12, color: '#b8d8c8', shadow: false });
      art.text(ctx, '2. Спрашивай дорогу', 190, 170, { size: 12, color: '#b8d8c8', shadow: false });
      art.text(ctx, '3. Возвращайся', 190, 198, { size: 12, color: '#b8d8c8', shadow: false });
      // windows
      [40, 540].forEach(x => {
        art.px(ctx, x, 70, 60, 110, '#0d1826');
        art.px(ctx, x + 4, 74, 52, 102, '#254660');
        art.px(ctx, x + 28, 74, 3, 102, '#1a3042');
        art.px(ctx, x + 4, 122, 52, 3, '#1a3042');
      });
      // clock + poster
      art.px(ctx, 310, 18, 20, 20, '#e8e0c8');
      art.px(ctx, 320, 22, 2, 8, '#2a2a38'); art.px(ctx, 320, 28, 7, 2, '#2a2a38');
      art.px(ctx, 44, 210, 50, 62, '#c16185');
      art.text(ctx, '★', 69, 248, { size: 24, color: '#ffe6a0', align: 'center', shadow: false });
      // floor + desks
      art.px(ctx, 0, 360, 640, 120, p.ground);
      for (let x = 0; x < 640; x += 30) art.px(ctx, x, 360, 1, 120, 'rgba(0,0,0,.14)');
    } else if (id === 'street') {
      art.px(ctx, 0, 0, 640, 340, p.sky);
      // buildings
      [0, 120, 300, 470].forEach((x, i) => {
        const bh = 150 + i * 34;
        art.px(ctx, x, 340 - bh, 110, bh, i % 2 ? '#242b40' : '#2b334a');
        for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
          const lit = (r + c + i) % 3 !== 0;
          art.px(ctx, x + 12 + c * 24, 340 - bh + 18 + r * 26, 12, 12, lit ? '#ffd88a' : '#151a2b');
        }
      });
      art.px(ctx, 0, 330, 640, 150, p.ground);
      for (let y = 340; y < 480; y += 24) art.px(ctx, 0, y, 640, 1, 'rgba(255,255,255,.04)');
      // crosswalk
      for (let x = 30; x < 620; x += 54) art.px(ctx, x, 430, 30, 8, '#9aa2bc');
      // lampposts + bench
      [110, 520].forEach(x => {
        art.px(ctx, x, 190, 5, 150, '#5c637c');
        art.px(ctx, x - 12, 178, 29, 14, '#ffd88a');
        ctx.fillStyle = 'rgba(255,216,138,.10)'; ctx.beginPath(); ctx.arc(x, 185, 55, 0, TAU); ctx.fill();
      });
      art.px(ctx, 150, 350, 110, 10, '#7a5d4c');
      art.px(ctx, 150, 362, 110, 6, '#5c463a');
      art.px(ctx, 158, 368, 8, 18, '#3a2e2a'); art.px(ctx, 244, 368, 8, 18, '#3a2e2a');
      // sign
      art.px(ctx, 420, 250, 70, 26, '#1d5d68');
      art.text(ctx, 'ШКОЛА', 455, 269, { size: 12, color: '#9fffe8', align: 'center', shadow: false });
    } else if (id === 'park') {
      art.px(ctx, 0, 0, 640, 320, p.sky);
      for (let i = 0; i < 40; i++) art.px(ctx, rnd() * 640, rnd() * 300, 2, 2, '#b8ffd0');
      art.px(ctx, 0, 310, 640, 170, p.ground);
      // trees
      for (let i = 0; i < 8; i++) {
        const x = 30 + i * 82 + rnd() * 18, y = 300 + rnd() * 130;
        art.px(ctx, x, y - 60, 9, 62, '#4a3a32');
        art.px(ctx, x - 22, y - 108, 52, 42, '#1e4a3c');
        art.px(ctx, x - 12, y - 122, 32, 24, '#2b6a52');
        art.px(ctx, x - 28, y - 92, 64, 8, '#1e4a3c');
      }
      // path + fountain
      ctx.fillStyle = '#5b5a4e';
      ctx.beginPath(); ctx.moveTo(280, 480); ctx.lineTo(370, 480); ctx.lineTo(345, 320); ctx.lineTo(295, 320); ctx.fill();
      art.px(ctx, 270, 330, 110, 24, '#7d8d8a');
      art.px(ctx, 320, 290, 8, 44, '#9fb8b0');
      ctx.fillStyle = 'rgba(150,230,210,.35)';
      ctx.beginPath(); ctx.ellipse(324, 300, 26 + Math.sin(t * 2) * 3, 8, 0, 0, TAU); ctx.fill();
      // fence
      for (let x = 0; x < 640; x += 36) art.px(ctx, x, 350, 6, 46, '#4d6a5c');
      art.px(ctx, 0, 366, 640, 4, '#4d6a5c');
    } else if (id === 'metro') {
      for (let x = 0; x <= 640; x += 24) art.px(ctx, x, 0, 1, 390, 'rgba(53,200,192,.10)');
      for (let y = 0; y <= 390; y += 24) art.px(ctx, 0, y, 640, 1, 'rgba(53,200,192,.10)');
      art.px(ctx, 0, 390, 640, 90, '#0b1a26');
      // columns
      [70, 570].forEach(x => {
        art.px(ctx, x, 90, 46, 300, '#173a4b');
        art.px(ctx, x + 6, 96, 8, 288, '#22546a');
        art.px(ctx, x - 6, 84, 58, 12, '#2b6478');
      });
      // neon signs
      art.px(ctx, 250, 80, 140, 44, '#071c2a');
      art.text(ctx, 'ВЫХОД ↑', 320, 110, { size: 16, color: '#5affe0', align: 'center', shadow: false });
      art.px(ctx, 262, 120, 116, 3, '#ff5b3d');
      // rails
      art.px(ctx, 0, 420, 640, 8, '#3b4a55');
      art.px(ctx, 0, 452, 640, 8, '#3b4a55');
      for (let x = 0; x < 640; x += 28) art.px(ctx, x, 424, 12, 4, '#6a7b88');
      art.px(ctx, 0, 404 + Math.sin(t * 4) * 3, 640, 2, 'rgba(90,255,224,.3)');
    } else if (id === 'office') {
      art.px(ctx, 0, 0, 640, 340, '#241735');
      for (let x = 0; x < 640; x += 24) art.px(ctx, x, 0, 1, 340, 'rgba(255,255,255,.025)');
      // bookcases
      [40, 500].forEach(x => {
        art.px(ctx, x, 70, 100, 280, '#3a2a4c');
        for (let r = 0; r < 5; r++) {
          art.px(ctx, x + 6, 82 + r * 54, 88, 5, '#5a4470');
          for (let i = 0; i < 7; i++) art.px(ctx, x + 10 + i * 12, 88 + r * 54, 9, 40 - (i % 3) * 6, ['#c16185','#8d7ab8','#d8a860','#4e8a92'][i % 4]);
        }
      });
      // portrait on wall
      art.px(ctx, 278, 60, 84, 96, '#8a6a44');
      art.px(ctx, 284, 66, 72, 84, '#2c2140');
      art.heart(ctx, 320, 108, 20, '#d974a8', 0);
      // desk
      art.px(ctx, 120, 300, 400, 24, '#6a4a3a');
      art.px(ctx, 140, 324, 360, 16, '#4e362c');
      art.px(ctx, 130, 340, 18, 100, '#3a2822'); art.px(ctx, 492, 340, 18, 100, '#3a2822');
      // papers + red seal
      art.px(ctx, 230, 288, 90, 12, '#e8e0d0');
      art.px(ctx, 240, 284, 70, 4, '#fff8e8');
      art.px(ctx, 400, 286, 24, 16, '#b83248');
      art.px(ctx, 404, 290, 16, 8, '#ff6d8f');
      // lamp light
      ctx.fillStyle = 'rgba(255,217,138,.09)';
      ctx.beginPath(); ctx.moveTo(300, 200); ctx.lineTo(380, 200); ctx.lineTo(460, 480); ctx.lineTo(220, 480); ctx.fill();
    }

    // floating dust / atmosphere
    for (let i = 0; i < 24; i++) {
      const x = (rnd() * 640 + Math.sin(t * 0.7 + i) * 18 + 640) % 640;
      const y = (rnd() * 480 - t * (8 + i % 5) + 480 * 4) % 480;
      ctx.globalAlpha = 0.12 + 0.12 * Math.sin(t + i);
      art.px(ctx, x, y, 2, 2, p.dot);
    }
    ctx.globalAlpha = 1;
  };

  /* ---------- battle backgrounds ---------- */

  art.drawBattleBG = function (ctx, boss, t) {
    const c = boss.colors;
    const g = ctx.createLinearGradient(0, 0, 0, 480);
    g.addColorStop(0, c.bgTop); g.addColorStop(1, c.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 480);

    const rnd = art.rand(boss.id.length * 313 + 7);
    if (boss.id === 'abayunda') {
      // a mountain of a thousand chins behind the boss
      for (let i = 0; i < 14; i++) {
        const y = 120 + i * 22 + Math.sin(t * 1.6 + i * 0.5) * 3;
        ctx.globalAlpha = 0.07 + (i % 2) * 0.03;
        ctx.fillStyle = '#a9c0ff';
        ctx.beginPath(); ctx.ellipse(320, y, 120 + i * 9, 13, 0, 0, TAU); ctx.fill();
      }
      for (let i = 0; i < 16; i++) {
        const x = (i * 43 + Math.sin(t * 0.5 + i) * 14) % 640;
        ctx.globalAlpha = 0.10;
        art.px(ctx, x, 120 + Math.sin(i * 2) * 40, 26, 340, '#6a7fd8');
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 40; i++) art.px(ctx, rnd() * 640, 100 + rnd() * 200, 2, 2, '#b8c8ff');
    } else if (boss.id === 'huyet') {
      for (let i = 0; i < 12; i++) {
        const x = (rnd() * 640 + t * 6) % 640;
        ctx.globalAlpha = 0.08; art.px(ctx, x, 80 + i * 32, 100, 18, '#d8d8e0');
      }
      ctx.globalAlpha = 1;
    } else if (boss.id === 'afina') {
      ctx.fillStyle = 'rgba(255,226,160,.10)';
      ctx.beginPath(); ctx.moveTo(320, 0); ctx.lineTo(640, 0); ctx.lineTo(500, 400); ctx.lineTo(140, 400); ctx.fill();
      for (let i = 0; i < 30; i++) {
        const y = (t * 18 + i * 17) % 480;
        art.px(ctx, (rnd() * 640 + 640) % 640, y, 2, 6, 'rgba(255,240,190,.5)');
      }
    } else if (boss.id === 'yasr') {
      for (let x = 0; x <= 640; x += 28) art.px(ctx, x, 0, 1, 480, 'rgba(80,180,255,.10)');
      for (let y = 0; y <= 480; y += 28) art.px(ctx, 0, y, 640, 1, 'rgba(255,90,60,.07)');
      art.px(ctx, 0, 340 + Math.sin(t * 3) * 6, 640, 2, 'rgba(90,255,230,.22)');
    } else if (boss.id === 'director') {
      // stacks of papers and red stamps in the dark
      for (let i = 0; i < 14; i++) {
        const x = (i * 91 + Math.sin(t * 0.8 + i) * 12 + 640) % 640;
        const y = 90 + i * 27;
        ctx.globalAlpha = 0.07;
        art.px(ctx, x, y, 90, 14, '#ffd9ec');
        art.px(ctx, x + 66, y + 2, 12, 8, '#ff6d8f');
      }
      ctx.globalAlpha = 1;
    }
    // vignette
    const v = ctx.createRadialGradient(320, 220, 80, 320, 240, 400);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, 640, 480);
  };

  G.art = art;
})(window.GALKA = window.GALKA || {});
