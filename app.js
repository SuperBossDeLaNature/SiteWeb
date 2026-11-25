(() => {
'use strict';

/* ---------- Constantes & outils ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const THEMES = window.QUIZ_THEMES;
const DEFAULT_N = 7, N_OPTIONS = [5, 7, 10, 15, 20], TIME = 20, REVEAL_MS = 2600;

const cfg = window.QUIZ_CONFIG || {};
const sbReady = !!(window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/VOTRE/.test(cfg.SUPABASE_URL));
const sb = sbReady ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
};
const me = { id: store.get('md_id') || Math.random().toString(36).slice(2, 10), name: store.get('md_name') || '' };
store.set('md_id', me.id);

let G = null;           // duel en cours
let room = null;        // salon en ligne
let pending = 'online'; // après les réglages : online | solo | rematch
let setup = null;       // réglages en cours de saisie

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
function placeSnd(id){
  const bar = document.getElementById('sndbar'), sc = document.getElementById(id); if (!bar || !sc) return;
  const slot = sc.querySelector('.snd-slot');
  if (slot){ slot.appendChild(bar); bar.classList.add('compact'); }
  else { sc.prepend(bar); bar.classList.remove('compact'); }
}
function show(id){ placeSnd(id); $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if (id !== 's-rev-read') document.body.classList.remove('reading'); window.scrollTo(0,0); }
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, rnd){ const a = arr.slice(); for (let i = a.length - 1; i > 0; i--){
  const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const newSeed = () => Math.floor(Math.random() * 2147483647);
const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hue(s){ let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function setAv(elm, name){
  const n = (name || '?').trim() || '?';
  elm.textContent = n.charAt(0).toUpperCase(); elm.style.background = `hsl(${hue(n)} 65% 45%)`;
}

/* ---------- Bruitages (WebAudio, aucun fichier) ---------- */
// Sons doux : sinusoïdes en "cloche" (fondamentale + harmonique discrète), attaque progressive,
// extinction exponentielle, filtre passe-bas. Aucune onde carrée ni en dents de scie.
const TICK = { calm: 0.5, tense: 0.33, final: 0.2 };   // secondes entre deux tics : normal, 5 dernières s, 3 dernières s
const TIMER_SOUND = 'minuterie';   // 'minuterie' (tic-tac mécanique de minuteur) ou 'cocotte' (souffle de vapeur)
const Sfx = (() => {
  let ctx = null, out = null, mix = null, noiseBuf = null, tickGain = null, clicks = null, muted = store.get('md_mute') === '1';
  let vol = parseFloat(store.get('md_vol'));
  if (!(vol >= 0 && vol <= 1)) vol = 0.5;          // curseur de volume (0 à 1), mémorisé
  const gainOf = v => v * v * 0.8;                 // courbe douce : 0,5 = 4 fois moins fort que le maximum
  function ensure(){
    if (!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
        const master = ctx.createGain(); master.gain.value = gainOf(vol);
        lp.connect(master); master.connect(ctx.destination);
        out = lp; mix = master;
      } catch(e){ ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function note(f, d, vol, delay, o){
    if (muted) return;
    const c = ensure(); if (!c) return;
    o = o || {};
    const t = c.currentTime + (delay || 0);
    [[1, 1], [2, 0.18]].forEach(([mul, rel]) => {   // [rapport de fréquence, volume relatif]
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * mul, t);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo * mul, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * rel, t + (o.attack || 0.015));
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + d + 0.05);
    });
  }
  // Souffle de vapeur : bruit blanc passé dans un filtre passe-bande qui glisse de f0 à f1.
  function puff(d, vol, f0, f1, q){
    if (muted) return;
    const c = ensure(); if (!c) return;
    if (!noiseBuf){
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(bp); bp.connect(g); g.connect(mix);
    src.start(t, Math.random() * 0.5); src.stop(t + d + 0.05);
  }
  // Minuterie : « tic-tac » d'horloge mécanique classique (tic aigu, tac plus creux). Les tics sont programmés d'avance sur
  // l'horloge audio (cadence parfaitement régulière), plus rapides et plus appuyés quand le temps se vide.
  function makeClicks(c){
    const sr = c.sampleRate, n = Math.floor(sr * 0.09), TAU = 2 * Math.PI;
    const rnd = () => Math.random() * 2 - 1;
    // Tic-tac d'horloge mécanique : claquement sec de l'échappement (avec son petit « rebond »),
    // résonance creuse du boîtier et léger choc grave. Le « tic » est plus aigu, le « tac » plus creux.
    const clock = (f1, f2, fLow, decay, thunk) => {
      const b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++){
        const t = i / sr, u = t - 0.006;
        let v = rnd() * Math.exp(-t / 0.0008) * 0.6                                           // claquement
              + (Math.sin(TAU * f1 * t) * 0.55 + Math.sin(TAU * f2 * t) * 0.25) * Math.exp(-t / decay)   // boîtier
              + Math.sin(TAU * fLow * t) * Math.exp(-t / 0.015) * thunk;                      // choc grave
        if (u > 0) v += rnd() * Math.exp(-u / 0.0008) * 0.25;                                 // rebond de l'ancre
        d[i] = v * Math.min(1, t / 0.0003);
      }
      return b;
    };
    return [clock(1650, 2480, 260, 0.012, 0.30), clock(1180, 1770, 200, 0.016, 0.35)];
  }
  function startTicking(total){
    stopTicking();
    if (muted || TIMER_SOUND !== 'minuterie') return;
    const c = ensure(); if (!c) return;
    if (!clicks) clicks = makeClicks(c);
    const bus = tickGain = c.createGain(); bus.gain.value = 1; bus.connect(mix);
    const t0 = c.currentTime + 0.05;
    for (let e = 0, k = 0; e < total; k++){
      const rem = total - e;
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = clicks[k % 2];
      g.gain.value = rem <= 3 ? 0.18 : rem <= 5 ? 0.13 : 0.085;
      src.connect(g); g.connect(bus);
      src.start(t0 + e);
      e += rem <= 3 ? TICK.final : rem <= 5 ? TICK.tense : TICK.calm;
    }
  }
  function stopTicking(){ if (tickGain){ try { tickGain.disconnect(); } catch(e){} tickGain = null; } }
  function ring(){                                       // sonnerie de réveil mécanique : petit marteau qui trille
    for (let i = 0; i < 12; i++) note(1865, .12, .08 * (1 - i * .04), i * .065);
  }
  return {
    unlock: ensure,
    startTicking, stopTicking, ring,
    getVol: () => vol,
    setVol(v){ vol = Math.min(1, Math.max(0, v)); store.set('md_vol', String(vol)); if (mix) mix.gain.value = gainOf(vol); },
    preview(){ note(784, .25, .12); },
    isMuted: () => muted,
    toggle(){ muted = !muted; store.set('md_mute', muted ? '1' : '0'); if (muted) stopTicking(); if (!muted){ ensure(); this.tap(); } return muted; },
    tap(){ note(660, .09, .05); },
    beep(){ note(523, .3, .10); },                                   // 3, 2, 1
    go(){ note(784, .5, .11); note(1047, .6, .09, .09); },
    // Chrono « cocotte-minute » : une bouffée de vapeur par seconde, de plus en plus forte et aiguë,
    // puis deux par seconde dans les 3 dernières secondes.
    tick(urgent, last){
      if (TIMER_SOUND !== 'cocotte') return;
      if (last) puff(.17, .17, 2900, 4200, 1.1);
      else if (urgent) puff(.22, .13, 2400, 3500, 1.0);
      else puff(.32, .075, 1900, 2700, 0.9);
    },
    correct(){ note(659, .35, .13); note(880, .4, .12, .09); note(1319, .55, .09, .18); },   // petit arpège brillant
    wrong(){ note(294, .45, .11, 0, { slideTo: 220, attack: .03 }); },                     // « bloup » grave et doux
    opp(){ note(880, .12, .04); },
    win(){ [523, 659, 784, 1047].forEach((f, i) => note(f, .45, .12, i * .12)); note(1319, .9, .1, .5); },
    lose(){ [440, 392, 349].forEach((f, i) => note(f, .55, .09, i * .22, { slideTo: f * .97 })); },
    draw(){ note(523, .4, .1); note(523, .5, .09, .22); }
  };
})();
['pointerdown', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, () => Sfx.unlock(), { passive: true }));
document.addEventListener('click', e => { if (e.target.closest('.btn,.tcard,.pill,.icon-btn,.link')) Sfx.tap(); });
function refreshSnd(){ $$('.snd').forEach(b => b.textContent = Sfx.isMuted() ? '🔇' : '🔊'); }
$$('.snd').forEach(b => b.onclick = () => { Sfx.toggle(); refreshSnd(); });
refreshSnd();
placeSnd((document.querySelector('.screen.active')||{}).id);
function syncVol(){ $$('.vol').forEach(r => { r.value = Math.round(Sfx.getVol() * 100); }); }
$$('.vol').forEach(r => {
  r.oninput = () => { Sfx.setVol(r.value / 100); syncVol(); };
  r.onchange = () => { if (Sfx.isMuted()){ Sfx.toggle(); refreshSnd(); } Sfx.preview(); };
});
syncVol();

/* ---------- Questions : chapitres, tirage déterministe ---------- */
// Questions admissibles d'un thème pour une sélection de chapitres (chs = null : tous).
const LVL = [{ d: 1, n: 'Facile', ic: '🟢' }, { d: 2, n: 'Moyen', ic: '🟡' }, { d: 3, n: 'Difficile', ic: '🔴' }];
const qLvl = q => q.d || 2;
function pool(th, chs, lv){
  return th.questions.map((_, i) => i).filter(i => {
    const q = th.questions[i];
    if (lv && lv.length && !lv.includes(qLvl(q))) return false;
    if (!chs || !th.chapters) return true;
    return chs.includes(q.h === undefined ? -1 : q.h);
  });
}
// Même graine + mêmes réglages => mêmes questions, même ordre de propositions chez les deux joueurs.
function build(themeKey, seed, n, chs, lv){
  const th = THEMES.find(t => t.key === themeKey);
  let ids = pool(th, chs, lv);
  if (!ids.length) ids = pool(th, chs, null);
  if (!ids.length) ids = pool(th, null, null);
  const order = shuffle(ids, mulberry(seed)).slice(0, Math.min(n || DEFAULT_N, ids.length));
  return order.map((qi, k) => {
    const q = th.questions[qi];
    const chap = (th.chapters && th.chapters[q.h]) || '';
    // Vrai/Faux : deux boutons dans un ordre fixe (Vrai à gauche, Faux à droite).
    if (typeof q.vf === 'boolean')
      return { text: q.q, choices: ['Vrai', 'Faux'], correct: q.vf ? 0 : 1, exp: q.e || '', chap, vf: true, d: qLvl(q) };
    const perm = shuffle(q.c.map((_, j) => j), mulberry(seed + k + 1));
    return { text: q.q, choices: perm.map(p => q.c[p]), correct: perm.indexOf(0), exp: q.e || '', chap, d: qLvl(q) };
  });
}
function cfgLabel(c){
  if (!c) return '';
  const th = THEMES.find(t => t.key === c.themeKey);
  let s = `${th.name} · ${c.n} questions`;
  if (c.lv && c.lv.length && c.lv.length < 3) s += ' · ' + c.lv.map(d => LVL[d - 1].n).join(' + ');
  if (c.chs && th.chapters) s += ' · ' + c.chs.map(i => th.chapters[i]).join(', ');
  return s;
}

let wl = null;
async function keepAwake(){ try { if ('wakeLock' in navigator) wl = await navigator.wakeLock.request('screen'); } catch(e){} }

/* ---------- Accueil ---------- */
$('#name').value = me.name;
$('#net-note').textContent = sb
  ? 'Mode en ligne actif ✓'
  : "Mode en ligne non configuré (voir config.js). L'entraînement contre un bot fonctionne déjà.";
const urlRoom = clean(new URLSearchParams(location.search).get('room'));
if (urlRoom){ $('#code').value = urlRoom; toast('Invitation détectée : choisis un pseudo puis « Rejoindre un salon privé »'); }

function needName(){
  const v = $('#name').value.trim();
  if (!v){ toast('Choisis un pseudo'); $('#name').focus(); return false; }
  me.name = v.slice(0, 14); store.set('md_name', me.name); return true;
}
function needOnline(){ if (!sb){ toast('Mode en ligne non configuré (voir config.js)'); return false; } return true; }

$('#btn-pub').onclick  = () => { if (!needName() || !needOnline()) return; pending = 'public'; renderThemes(); show('s-themes'); };
$('#btn-priv').onclick = () => { if (!needName() || !needOnline()) return; pending = 'private'; renderThemes(); show('s-themes'); };
$('#btn-solo').onclick   = () => { if (!needName()) return; pending = 'solo'; renderThemes(); show('s-themes'); };
$('#btn-join').onclick   = () => {
  if (!needName() || !needOnline()) return;
  const c = clean($('#code').value);
  if (c.length !== 4){ toast('Le code fait 4 caractères'); return; }
  openRoom(c, 'guest');
};

/* ---------- Thèmes ---------- */
function renderThemes(){
  const g = $('#theme-grid'); g.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.className = 'tcard'; b.style.setProperty('--c', t.color);
    const nch = t.chapters ? ` · ${t.chapters.length} chapitres` : '';
    b.innerHTML = `<span class="ti">${t.icon}</span><span class="tn">${esc(t.name)}</span><span class="tc">${t.questions.length} questions${nch}</span>`;
    b.onclick = () => openSetup(t.key);
    g.appendChild(b);
  });
}
$('#themes-back').onclick = () => {
  if (pending === 'rematch') show('s-result');
  else { document.documentElement.style.removeProperty('--accent'); show('s-home'); }
};

/* ---------- Réglages : chapitres + nombre de questions ---------- */
const selArg = th => (th.chapters && setup.sel.size < th.chapters.length) ? [...setup.sel].sort((a, b) => a - b) : null;
const selLv = () => setup.lv.size === 3 ? null : [...setup.lv].sort();
function savedLv(){ try { const a = JSON.parse(store.get('md_lv') || 'null'); if (Array.isArray(a) && a.length) return a.filter(d => d >= 1 && d <= 3); } catch(e){} return [1]; }

function openSetup(key){
  const th = THEMES.find(t => t.key === key);
  setup = { key, sel: new Set((th.chapters || []).map((_, i) => i)), n: parseInt(store.get('md_n'), 10) || DEFAULT_N, lv: new Set(savedLv()) };
  document.documentElement.style.setProperty('--accent', th.color);
  renderSetup();
  show('s-setup');
}
function renderSetup(){
  const th = THEMES.find(t => t.key === setup.key);
  $('#setup-title').textContent = th.name;
  const hasCh = !!(th.chapters && th.chapters.length);
  const box = $('#chap-chips'); box.innerHTML = '';
  $('#chap-all').hidden = !hasCh;
  if (hasCh){
    th.chapters.forEach((name, i) => {
      const cnt = th.questions.filter(q => q.h === i).length;
      const b = el('button', 'pill' + (setup.sel.has(i) ? ' on' : ''), `${name} · ${cnt}`);
      b.onclick = () => { setup.sel.has(i) ? setup.sel.delete(i) : setup.sel.add(i); renderSetup(); };
      box.appendChild(b);
    });
  } else {
    box.appendChild(el('p', 'hint', "Ce thème n'a pas encore de chapitres : toutes ses questions sont utilisées."));
  }
  const lvb = $('#lv-chips'); lvb.innerHTML = '';
  LVL.forEach(L => {
    const cnt = pool(th, selArg(th), [L.d]).length;
    const b = el('button', 'pill' + (setup.lv.has(L.d) ? ' on' : ''));
    b.append(el('span', '', `${L.ic} ${L.n}`), el('small', '', String(cnt)));
    b.onclick = () => {
      if (setup.lv.has(L.d)){ if (setup.lv.size > 1) setup.lv.delete(L.d); } else setup.lv.add(L.d);
      renderSetup();
    };
    lvb.appendChild(b);
  });
  const avail = pool(th, selArg(th), selLv()).length;
  $('#pool-hint').textContent = avail
    ? `${avail} question${avail > 1 ? 's' : ''} disponible${avail > 1 ? 's' : ''}`
    : 'Choisis au moins un chapitre';
  const nb = $('#n-chips'); nb.innerHTML = '';
  const std = N_OPTIONS.filter(x => x <= avail);
  const opts = (avail === 0 || std.includes(avail)) ? std : std.concat([avail]);
  const eff = Math.min(setup.n, avail);
  opts.forEach(x => {
    const b = el('button', 'pill' + (x === eff ? ' on' : ''), N_OPTIONS.includes(x) ? String(x) : `Toutes (${x})`);
    b.onclick = () => { setup.n = x; renderSetup(); };
    nb.appendChild(b);
  });
  const go = $('#setup-go');
  go.disabled = avail === 0;
  go.textContent = pending === 'public' ? 'Créer le salon public' : pending === 'private' ? 'Créer le salon privé' : pending === 'rematch' ? 'Lancer le duel' : 'Lancer';
}
$('#chap-all').onclick = () => {
  const th = THEMES.find(t => t.key === setup.key);
  if (setup.sel.size === th.chapters.length) setup.sel.clear();
  else th.chapters.forEach((_, i) => setup.sel.add(i));
  renderSetup();
};
$('#setup-back').onclick = () => show('s-themes');
$('#setup-go').onclick = () => {
  const th = THEMES.find(t => t.key === setup.key);
  const chs = selArg(th), lv = selLv();
  const avail = pool(th, chs, lv).length;
  if (!avail) return;
  store.set('md_n', String(setup.n)); store.set('md_lv', JSON.stringify([...setup.lv]));
  const c = { themeKey: setup.key, n: Math.min(setup.n, avail), chs, lv };
  if (pending === 'solo') beginMatch({ mode: 'solo', ...c, seed: newSeed(), opp: { id: 'bot', name: 'Bot' } });
  else if (pending === 'public') openRoom(randomCode(), 'host', c, true);
  else if (pending === 'private') openRoom(randomCode(), 'host', c, false);
  else if (pending === 'rematch') hostStart(c);
};

/* ---------- Salon en ligne (Supabase Realtime) ---------- */
function randomCode(){
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

function openRoom(code, role, c, pub){
  leaveRoom();
  room = { code, role, cfg: c || null, joined: false, resync: false, opp: null, pub: !!pub, t0: Date.now(), auto: !!pub && role === 'host' };
  connect();
  showLobby();
  if (role === 'guest') setTimeout(() => {
    if (room && room.code === code && !room.opp && $('#s-lobby').classList.contains('active'))
      $('#lb-status').textContent = 'Salon introuvable ou hôte absent. Vérifie le code.';
  }, 7000);
}

function connect(){
  if (room.ch){ try { sb.removeChannel(room.ch); } catch(e){} }
  const ch = sb.channel('mediduel:' + room.code, { config: { broadcast: { self: false }, presence: { key: me.id } } });
  room.ch = ch;
  ch.on('presence', { event: 'sync' }, onPresence);
  ['start', 'q', 'ans', 'end', 'rematch_req', 'need_state', 'state', 'full'].forEach(ev =>
    ch.on('broadcast', { event: ev }, ({ payload }) => onMsg(ev, payload || {})));
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED'){
      room.joined = true;
      ch.track({ id: me.id, name: me.name, role: room.role, t: room.t0 });
      if (room.resync){ room.resync = false; if (room.role === 'guest' && G) send('need_state', {}); }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
      room.joined = false; toast('Connexion perdue…');
    } else if (status === 'CLOSED'){ room.joined = false; }
  });
}

function leaveRoom(){
  if (room && room.ch){ try { sb.removeChannel(room.ch); } catch(e){} }
  room = null; pubUpdate();
}
function send(event, payload){
  if (room && room.ch && room.joined) room.ch.send({ type: 'broadcast', event, payload });
}

function onPresence(){
  if (!room) return;
  const list = Object.values(room.ch.presenceState()).flat();
  const others = list.filter(p => p.id !== me.id);
  if (room.role === 'host'){
    // Un seul adversaire : le premier arrivé. Les suivants sont prévenus que le salon est complet.
    const guests = others.filter(p => p.role === 'guest').sort((a, b) => (a.t || 0) - (b.t || 0));
    const keep = (G && G.opp && guests.find(p => p.id === G.opp.id)) || (room.opp && guests.find(p => p.id === room.opp.id)) || guests[0] || null;
    room.opp = keep;
    guests.filter(p => keep && p.id !== keep.id).forEach(p => send('full', { to: p.id }));
  } else room.opp = others.find(p => p.role === 'host') || null;
  renderLobby(); pubUpdate();
  // Duel trouvé par le matchmaking : l'hôte lance dès que l'adversaire est arrivé.
  if (room.role === 'host' && room.auto && room.opp && !G){ room.auto = false; setTimeout(() => { if (room && room.opp && !G) hostStart(room.cfg); }, 1200); }
}

function showLobby(){ renderLobby(); show('s-lobby'); }
function renderLobby(){
  if (!room) return;
  $('#lb-code').textContent = room.code;
  $('#lb-kind').textContent = room.pub ? 'Salon public · code' : 'Code du salon privé';
  $('#lb-pubnote').hidden = !(room.pub && room.role === 'host');
  $('#btn-share').hidden = room.role !== 'host';
  setAv($('#lb-av-me'), me.name); $('#lb-nm-me').textContent = me.name;
  const av = $('#lb-av-opp');
  if (room.opp){ setAv(av, room.opp.name); av.classList.remove('ghost-av'); $('#lb-nm-opp').textContent = room.opp.name; }
  else { av.textContent = '?'; av.style.background = ''; av.classList.add('ghost-av'); $('#lb-nm-opp').textContent = 'En attente…'; }
  const start = $('#lb-start');
  if (room.role === 'host'){
    start.hidden = false; start.disabled = !room.opp;
    $('#lb-status').textContent = (room.opp ? `${room.opp.name} est là ! ` : room.pub ? 'En attente d’un adversaire… ' : 'Partage le code ou le lien. ') + cfgLabel(room.cfg);
  } else {
    start.hidden = true;
    $('#lb-status').textContent = room.opp
      ? `Connecté au salon de ${room.opp.name}. Il va lancer le duel…`
      : 'Connexion au salon…';
  }
}
$('#lb-start').onclick = () => hostStart(room.cfg);
$('#lb-leave').onclick = () => { leaveRoom(); show('s-home'); };
$('#btn-share').onclick = async () => {
  const url = location.href.split('?')[0].split('#')[0] + '?room=' + room.code;
  const text = `Je te défie sur Supa BossuDeLaNaturu ! Code : ${room.code}`;
  if (navigator.share){ try { await navigator.share({ title: 'Supa BossuDeLaNaturu', text, url }); return; } catch(e){} }
  try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch(e){ toast(url); }
};

function hostStart(c){
  if (!room || room.role !== 'host' || !c) return;
  if (!room.opp){ toast("Aucun adversaire dans le salon"); return; }
  const seed = newSeed();
  room.cfg = c;
  send('start', { theme: c.themeKey, seed, n: c.n, chs: c.chs, lv: c.lv || null, guest: room.opp.id });
  beginMatch({ mode: 'online', themeKey: c.themeKey, seed, n: c.n, chs: c.chs, lv: c.lv || null, opp: room.opp });
  pubUpdate();
}

function onMsg(ev, p){
  if (!room) return;
  switch (ev){
    case 'full':
      if (room.role !== 'guest' || p.to !== me.id || (G && G.mode === 'online')) return;
      toast('Ce salon est déjà complet'); leaveRoom(); show('s-home');
      break;
    case 'start':
      if (room.role !== 'guest') return;
      if (p.guest && p.guest !== me.id){ if (!G){ toast('Ce salon vient d’être complété par quelqu’un d’autre'); leaveRoom(); show('s-home'); } return; }
      room.cfg = { themeKey: p.theme, n: p.n, chs: p.chs || null, lv: p.lv || null };
      beginMatch({ mode: 'online', themeKey: p.theme, seed: p.seed, n: p.n, chs: p.chs || null, lv: p.lv || null,
        opp: room.opp || { id: null, name: 'Adversaire' } });
      break;
    case 'q':
      if (room.role !== 'guest') return;
      if (!G){ send('need_state', {}); return; }
      stopCountdown(); clearInterval(G.tick);
      showQuestion(p.i);
      break;
    case 'ans':
      if (!G) return;
      G.answers[p.i] = G.answers[p.i] || {};
      G.answers[p.i].opp = { choice: p.choice, correct: p.correct, pts: p.pts };
      if (p.i === G.idx){ paint(); Sfx.opp(); }
      updateScores(); checkAdvance(p.i);
      break;
    case 'end':
      if (G && room.role === 'guest' && !G.done) finish();
      break;
    case 'rematch_req':
      if (room.role === 'host' && G) hostStart(G.cfg);
      break;
    case 'need_state':
      if (room.role === 'host' && G)
        send('state', { theme: G.cfg.themeKey, seed: G.seed, n: G.cfg.n, chs: G.cfg.chs, lv: G.cfg.lv || null, idx: G.idx, done: !!G.done,
          answers: G.answers.map(a => a ? { me: a.me || null, opp: a.opp || null } : null) });
      break;
    case 'state':
      if (room.role !== 'guest') return;
      if (!G || G.seed !== p.seed)
        beginMatch({ mode: 'online', themeKey: p.theme, seed: p.seed, n: p.n, chs: p.chs || null, lv: p.lv || null,
          opp: room.opp || { id: null, name: 'Adversaire' }, skipCd: true });
      p.answers.forEach((a, i) => {
        if (!a) return;
        G.answers[i] = G.answers[i] || {};
        if (a.me && !G.answers[i].opp) G.answers[i].opp = a.me;   // vue inversée côté invité
        if (a.opp && !G.answers[i].me) G.answers[i].me = a.opp;
      });
      if (p.done){ if (!G.done) finish(); return; }
      if (p.idx >= 0 && G.idx !== p.idx){
        stopCountdown(); clearInterval(G.tick);
        showQuestion(p.idx);
        if (G.answers[p.idx] && G.answers[p.idx].me){ G.locked = true; clearInterval(G.tick); Sfx.stopTicking(); }
      }
      paint(); updateScores();
      break;
  }
}

// Reprise après verrouillage du téléphone / coupure réseau
function tryReconnect(){
  if (!room || !sb || document.visibilityState !== 'visible') return;
  if (room.ch && room.ch.state === 'joined') return;
  room.joined = false; room.resync = true; connect();
}
document.addEventListener('visibilitychange', tryReconnect);
window.addEventListener('online', tryReconnect);

/* ---------- Salons publics ---------- */
// Canal commun : chaque hôte d'un salon public en attente s'y déclare (Presence) ; l'accueil affiche la liste.
const PUB = { ch: null, ready: false, list: [], tracked: false, refresh: null };

function pubInit(){
  if (!sb || (PUB.ch && PUB.ch.state !== 'closed' && PUB.ch.state !== 'errored')) return;
  if (PUB.ch){ try { sb.removeChannel(PUB.ch); } catch(e){} }
  const ch = sb.channel('mediduel:public', { config: { presence: { key: me.id } } });
  PUB.ch = ch; PUB.ready = false; PUB.tracked = false;
  ch.on('presence', { event: 'sync' }, pubSync);
  ch.subscribe(st => {
    if (st === 'SUBSCRIBED'){ PUB.ready = true; pubUpdate(); pubSync(); }
    else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED'){ PUB.ready = false; PUB.tracked = false; pubRender(); }
  });
}
// Mon salon public est-il ouvert (hôte, personne d'autre, pas de duel) ? -> visible dans la liste.
function pubUpdate(){
  if (!PUB.ch || !PUB.ready) return;
  const open = !!(room && room.pub && room.role === 'host' && !room.opp && !G);
  if (open){
    const c = room.cfg;
    PUB.ch.track({ id: me.id, name: me.name, code: room.code, label: cfgLabel(c), color: (THEMES.find(t => t.key === c.themeKey) || {}).color, since: room.t0 });
    PUB.tracked = true;
  } else if (PUB.tracked){ try { PUB.ch.untrack(); } catch(e){} PUB.tracked = false; }
}
function pubSync(){
  if (!PUB.ch) return;
  const seen = new Set();
  PUB.list = Object.values(PUB.ch.presenceState()).flat()
    .filter(p => p && p.id && p.code && p.id !== me.id && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => (a.since || 0) - (b.since || 0));
  pubRender();
}
function ago(ts){
  const s = Math.max(0, Math.round((Date.now() - (ts || Date.now())) / 1000));
  return s < 60 ? "à l'instant" : `depuis ${Math.round(s / 60)} min`;
}
function pubRender(){
  const box = $('#pub-list'); if (!box) return;
  box.innerHTML = '';
  $('#pub-n').textContent = PUB.list.length;
  $('#pub-dot').classList.toggle('off', !PUB.list.length);
  if (!sb){ box.appendChild(el('div', 'mm-empty', 'Mode en ligne non configuré.')); return; }
  if (!PUB.ready){ box.appendChild(el('div', 'mm-empty', 'Connexion…')); return; }
  if (!PUB.list.length){
    box.appendChild(el('div', 'mm-empty', 'Aucun salon public pour l’instant. Crée le tien : il apparaîtra ici chez tout le monde.'));
    return;
  }
  PUB.list.forEach(p => {
    const row = el('div', 'mm-row');
    const av = el('div', 'av'); setAv(av, p.name);
    const info = el('div', 'mm-info');
    info.append(el('span', 'mm-nm', p.name), el('span', 'mm-c', `${p.label || ''} · ${ago(p.since)}`));
    const b = el('button', 'btn primary', 'Rejoindre');
    b.onclick = () => { if (!needName() || !needOnline()) return; openRoom(p.code, 'guest'); };
    row.append(av, info, b); box.appendChild(row);
  });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pubInit(); });
window.addEventListener('online', pubInit);
pubInit(); pubRender();
clearInterval(PUB.refresh); PUB.refresh = setInterval(() => { if ($('#s-home').classList.contains('active')) pubRender(); }, 20000);


/* ---------- Duel ---------- */
const isDriver = () => G && (G.mode === 'solo' || (room && room.role === 'host'));
const total = who => G.answers.reduce((s, a) => s + ((a && a[who] && a[who].pts) || 0), 0);

function beginMatch({ mode, themeKey, seed, n, chs, lv, opp, skipCd }){
  clearTimers();
  const th = THEMES.find(t => t.key === themeKey);
  const questions = build(themeKey, seed, n, chs, lv);
  G = { mode, theme: th, seed, opp, cfg: { themeKey, n, chs: chs || null, lv: lv || null }, questions, nq: questions.length,
        idx: -1, answers: [], locked: true, adv: {}, done: false, lastTick: null };
  document.documentElement.style.setProperty('--accent', th.color);
  setAv($('#av-me'), me.name);  $('#nm-me').textContent = me.name;
  setAv($('#av-opp'), opp.name); $('#nm-opp').textContent = opp.name;
  $('#qtext').textContent = ''; $('#choices').innerHTML = ''; $('#exp').hidden = true;
  $('#chip-opp').textContent = ''; $('#qn').textContent = `0/${G.nq}`;
  updateScores();
  show('s-game');
  keepAwake();
  if (skipCd) return;
  countdown(() => { if (isDriver()) nextQ(0); });
}

function countdown(cb){
  const ov = $('#countdown'); let n = 3; ov.hidden = false; ov.textContent = n; Sfx.beep();
  G.cd = setInterval(() => {
    n--;
    if (n > 0){ ov.textContent = n; Sfx.beep(); }
    else { stopCountdown(); Sfx.go(); cb(); }
  }, 900);
}
function stopCountdown(){ if (G && G.cd){ clearInterval(G.cd); G.cd = null; } $('#countdown').hidden = true; }
function clearTimers(){ if (G){ clearInterval(G.tick); clearInterval(G.cd); clearTimeout(G.wd); clearTimeout(G.t2); clearTimeout(G.botT); } }

function nextQ(i){
  showQuestion(i);
  if (G.mode === 'online') send('q', { i });
}

function showQuestion(i){
  const g = G;
  g.idx = i; g.locked = false; g.qStart = performance.now(); g.lastTick = TIME; g.answers[i] = g.answers[i] || {};
  const q = g.questions[i];
  $('#qn').textContent = `${i + 1}/${g.nq}` + (i === g.nq - 1 ? ' · ×2' : '') + ' ' + LVL[(q.d || 2) - 1].ic;
  $('#qtext').textContent = q.text;
  const box = $('#choices'); box.innerHTML = '';
  box.classList.toggle('vf', !!q.vf);
  q.choices.forEach((c, k) => {
    const b = document.createElement('button');
    b.className = 'ch' + (q.vf ? (k === 0 ? ' v' : ' f') : '');
    b.innerHTML = '<span class="lt"></span><span class="tx"></span><span class="tag"></span>';
    b.children[0].textContent = q.vf ? (k === 0 ? '✓' : '✗') : 'ABCD'[k]; b.children[1].textContent = c;
    b.onclick = () => answer(k);
    box.appendChild(b);
  });
  $('#exp').hidden = true;
  const bar = $('#bar'); bar.style.width = '100%'; bar.classList.remove('low'); bar.parentElement.classList.remove('urgent');
  clearInterval(g.tick);
  g.tick = setInterval(() => {
    const rem = TIME - (performance.now() - g.qStart) / 1000;
    bar.style.width = Math.max(0, rem / TIME * 100) + '%';
    bar.classList.toggle('low', rem <= 5);
    bar.parentElement.classList.toggle('urgent', rem <= 5);
    if (rem <= 0){ answer(-1); return; }
    // tic-tac chaque seconde, deux fois par seconde pendant les 3 dernières
    const s = rem <= 3 ? Math.ceil(rem * 2) + 1000 : Math.ceil(rem);
    if (g.lastTick !== s && !g.locked){ g.lastTick = s; Sfx.tick(rem <= 5, rem <= 3); }
  }, 100);
  Sfx.startTicking(TIME);
  if (g.mode === 'solo') scheduleBot(i);
  if (isDriver() && g.mode === 'online'){
    clearTimeout(g.wd);
    // Garde-fou : si l'adversaire ne répond jamais (déconnecté), on avance quand même.
    g.wd = setTimeout(() => {
      if (G !== g || g.idx !== i || !g.answers[i] || g.answers[i].opp) return;
      g.answers[i].opp = { choice: -1, correct: false, pts: 0 };
      paint(); updateScores(); checkAdvance(i);
    }, (TIME + 5) * 1000);
  }
  paint();
}

function points(ok, remaining, i){
  const pts = ok ? Math.round(60 + 40 * remaining / TIME) : 0;
  return i === G.nq - 1 ? pts * 2 : pts;
}

function answer(k){
  if (!G || G.locked) return;
  G.locked = true; clearInterval(G.tick);
  const i = G.idx, q = G.questions[i];
  const rem = Math.max(0, TIME - (performance.now() - G.qStart) / 1000);
  const ok = k === q.correct;
  const pts = points(ok, rem, i);
  G.answers[i].me = { choice: k, correct: ok, pts };
  if (G.mode === 'online') send('ans', { i, choice: k, correct: ok, pts });
  Sfx.stopTicking();
  $('#bar').parentElement.classList.remove('urgent');
  if (ok) Sfx.correct(); else { if (k < 0) Sfx.ring(); else Sfx.wrong(); shake(); }
  if (navigator.vibrate) navigator.vibrate(ok ? 20 : [70, 40, 70, 40, 110]);
  paint(); updateScores(); checkAdvance(i);
  if (G.mode === 'solo' && G.botFire) G.botFire();
}

function shake(){
  const sc = $('#s-game');
  sc.classList.remove('shake'); void sc.offsetWidth; sc.classList.add('shake');
  setTimeout(() => sc.classList.remove('shake'), 500);
}

function paint(){
  if (!G || G.idx < 0) return;
  const i = G.idx, a = G.answers[i] || {}, q = G.questions[i];
  $$('#choices .ch').forEach((b, k) => {
    b.disabled = !!a.me;
    b.classList.remove('correct', 'wrong', 'dim');
    const tag = b.querySelector('.tag'); tag.textContent = '';
    if (a.me){
      if (k === q.correct) b.classList.add('correct');
      else if (k === a.me.choice) b.classList.add('wrong');
      else b.classList.add('dim');
      if (a.opp && a.opp.choice === k) tag.textContent = G.opp.name.slice(0, 8);
    }
  });
  const exp = $('#exp'); exp.hidden = !a.me;
  if (a.me) exp.textContent = (a.me.correct ? '✓ ' : '✗ ') + (q.vf ? q.choices[q.correct] + '. ' : '') + q.exp;
  const chip = $('#chip-opp');
  if (a.opp){
    chip.textContent = a.opp.choice < 0 ? 'temps écoulé' : (a.opp.correct ? '✓ juste' : '✗ faux');
    chip.className = 'chip ' + (a.opp.choice < 0 ? '' : (a.opp.correct ? 'ok' : 'ko'));
  } else { chip.textContent = ''; chip.className = 'chip'; }
}

function updateScores(){
  $('#sc-me').textContent = total('me');
  $('#sc-opp').textContent = total('opp');
}

// Seul l'hôte (ou le mode solo) fait avancer la partie.
function checkAdvance(i){
  if (!isDriver()) return;
  const g = G, a = g.answers[i];
  if (!(a && a.me && a.opp) || g.adv[i]) return;
  g.adv[i] = true; clearTimeout(g.wd);
  g.t2 = setTimeout(() => {
    if (G !== g) return;
    if (i < g.nq - 1) nextQ(i + 1);
    else { if (g.mode === 'online') send('end', {}); finish(); }
  }, REVEAL_MS);
}

function scheduleBot(i){
  const g = G, q = g.questions[i];
  const t = 2500 + Math.random() * 13000, ok = Math.random() < 0.65;
  // En entraînement, le bot répond tout de suite si tu réponds avant lui (ses points restent ceux de son temps prévu).
  const fire = g.botFire = () => {
    clearTimeout(g.botT); g.botFire = null;
    if (G !== g || g.idx !== i || g.answers[i].opp) return;
    const wrong = q.choices.map((_, x) => x).filter(x => x !== q.correct);
    const choice = ok ? q.correct : wrong[Math.floor(Math.random() * wrong.length)];
    g.answers[i].opp = { choice, correct: ok, pts: points(ok, TIME - t / 1000, i) };
    paint(); updateScores(); Sfx.opp(); checkAdvance(i);
  };
  g.botT = setTimeout(fire, t);
}

/* ---------- Résultats & revue des questions ---------- */
function finish(){
  if (!G || G.done) return;
  G.done = true; clearTimers(); G.locked = true; $('#bar').parentElement.classList.remove('urgent'); Sfx.stopTicking();
  const m = total('me'), o = total('opp');
  const v = $('#verdict');
  v.textContent = m > o ? 'Victoire !' : m < o ? 'Défaite' : 'Égalité';
  v.className = 'verdict ' + (m > o ? 'win' : m < o ? 'lose' : 'draw');
  m > o ? Sfx.win() : m < o ? Sfx.lose() : Sfx.draw();
  setAv($('#rf-av-me'), me.name);   $('#rf-nm-me').textContent = me.name;   $('#rf-sc-me').textContent = m;
  setAv($('#rf-av-opp'), G.opp.name); $('#rf-nm-opp').textContent = G.opp.name; $('#rf-sc-opp').textContent = o;
  const good = G.answers.filter(a => a && a.me && a.me.correct).length;
  $('#rv-sum').textContent = `${good}/${G.nq} bonnes réponses · ${cfgLabel(G.cfg)}`;
  renderReview(false);
  const isGuest = G.mode === 'online' && room && room.role === 'guest';
  $('#btn-other').hidden = isGuest;
  const rm = $('#btn-rematch'); rm.disabled = false; rm.textContent = 'Revanche';
  show('s-result');
  if (G.mode === 'online' && room && room.role === 'host') saveMatch(m, o);
}

function renderReview(onlyErr){
  $('#rv-all').classList.toggle('on', !onlyErr);
  $('#rv-err').classList.toggle('on', !!onlyErr);
  const box = $('#review'); box.innerHTML = '';
  const mark = r => r ? `${r.correct ? '✓' : '✗'} ${r.pts}` : '–';
  const cls = r => r ? (r.correct ? 'ok' : 'ko') : '';
  G.questions.forEach((q, i) => {
    const a = G.answers[i] || {};
    const okMe = !!(a.me && a.me.correct);
    if (onlyErr && okMe) return;
    const d = el('details', 'rv ' + (okMe ? 'ok' : 'ko'));
    const s = el('summary');
    s.append(el('span', 'rv-n', 'Q' + (i + 1)), el('span', 'rv-t', q.text),
             el('span', 'rv-m ' + cls(a.me), mark(a.me)), el('span', 'rv-o ' + cls(a.opp), mark(a.opp)));
    const b = el('div', 'rv-b');
    if (q.chap) b.appendChild(el('div', 'rv-ch', q.chap));
    b.appendChild(el('div', 'rv-a ok', '✓ ' + q.choices[q.correct]));
    if (a.me && !a.me.correct)
      b.appendChild(el('div', 'rv-a ko', 'Ta réponse : ' + (a.me.choice >= 0 ? q.choices[a.me.choice] : 'temps écoulé')));
    if (a.opp)
      b.appendChild(el('div', 'rv-a', G.opp.name + ' : ' + (a.opp.choice >= 0 ? q.choices[a.opp.choice] : 'temps écoulé')));
    b.appendChild(el('div', 'rv-e', q.exp));
    d.append(s, b); box.appendChild(d);
  });
  if (!box.children.length) box.appendChild(el('p', 'hint center', 'Aucune erreur, bravo !'));
}
$('#rv-all').onclick = () => { if (G) renderReview(false); };
$('#rv-err').onclick = () => { if (G) renderReview(true); };

function saveMatch(hs, gs){
  if (!sb) return;
  try {
    sb.from('matches').insert({ room: room.code, theme: G.theme.key, host_name: me.name,
      guest_name: G.opp.name, host_score: hs, guest_score: gs }).then(() => {}, () => {});
  } catch(e){}
}

$('#btn-rematch').onclick = () => {
  if (!G) return;
  if (G.mode === 'solo') beginMatch({ mode: 'solo', ...G.cfg, seed: newSeed(), opp: G.opp });
  else if (room && room.role === 'host') hostStart(G.cfg);
  else if (room){ send('rematch_req', {}); const b = $('#btn-rematch'); b.disabled = true; b.textContent = "Demande envoyée…"; }
};
$('#btn-other').onclick = () => {
  pending = (G && G.mode === 'solo') ? 'solo' : 'rematch';
  renderThemes(); show('s-themes');
};
function goHome(){ clearTimers(); Sfx.stopTicking(); G = null; leaveRoom(); document.documentElement.style.removeProperty('--accent'); show('s-home'); }
$('#btn-home').onclick = goHome;
$('#btn-quit').onclick = () => { if (confirm('Quitter le duel ?')) goHome(); };


/* ---------- Tableau des scores (victoires / défaites par joueur) ---------- */
const Board = { rows: null, theme: 'all', err: null };
const normName = n => String(n || '').trim().toLowerCase();

async function boardLoad(){
  Board.rows = null; Board.err = null; boardRender();
  if (!sb){ Board.err = "Mode en ligne non configuré (voir config.js)."; boardRender(); return; }
  try {
    const all = [];
    for (let from = 0; from < 20000; from += 1000){
      const { data, error } = await sb.from('matches')
        .select('theme,host_name,guest_name,host_score,guest_score')
        .order('created_at', { ascending: false }).range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    Board.rows = all;
  } catch(e){
    Board.err = /matches|relation|schema/i.test((e && e.message) || '')
      ? "La table des duels n'existe pas encore : colle supabase-setup.sql dans Supabase > SQL Editor."
      : "Impossible de charger les scores pour l'instant.";
  }
  boardRender();
}

function boardStats(rows){
  const P = new Map();
  const get = n => {
    const k = normName(n);
    if (!P.has(k)) P.set(k, { name: String(n).trim(), w: 0, l: 0, d: 0, pts: 0 });
    return P.get(k);
  };
  rows.forEach(r => {
    if (normName(r.host_name) === normName(r.guest_name)) return;
    const h = get(r.host_name), g = get(r.guest_name);
    h.pts += r.host_score; g.pts += r.guest_score;
    if (r.host_score > r.guest_score){ h.w++; g.l++; }
    else if (r.host_score < r.guest_score){ g.w++; h.l++; }
    else { h.d++; g.d++; }
  });
  return [...P.values()].map(p => ({ ...p, n: p.w + p.l + p.d, pct: (p.w + p.l + p.d) ? p.w / (p.w + p.l + p.d) : 0 }))
    .sort((a, b) => b.w - a.w || b.pct - a.pct || a.l - b.l || b.pts - a.pts);
}

function boardRender(){
  const f = $('#board-filter'); f.innerHTML = '';
  const used = new Set((Board.rows || []).map(r => r.theme));
  const opts = [{ key: 'all', name: 'Toutes les matières' }, ...THEMES.filter(t => used.has(t.key)).map(t => ({ key: t.key, name: t.icon + ' ' + t.name }))];
  if (!opts.some(o => o.key === Board.theme)) Board.theme = 'all';
  opts.forEach(o => {
    const b = el('button', 'pill' + (o.key === Board.theme ? ' on' : ''), o.name);
    b.onclick = () => { Board.theme = o.key; boardRender(); };
    f.appendChild(b);
  });
  const box = $('#board'); box.innerHTML = '';
  if (Board.err){ box.appendChild(el('p', 'hint center', Board.err)); return; }
  if (!Board.rows){ box.appendChild(el('p', 'hint center', 'Chargement…')); return; }
  const rows = Board.theme === 'all' ? Board.rows : Board.rows.filter(r => r.theme === Board.theme);
  const st = boardStats(rows);
  if (!st.length){ box.appendChild(el('p', 'hint center', 'Aucun duel joué pour l\'instant. Le premier à gagner prend la tête !')); return; }
  const head = el('div', 'bd-row bd-head');
  ['#', 'Joueur', 'V', 'D', 'N', '%'].forEach(t => head.appendChild(el('span', '', t)));
  box.appendChild(head);
  st.forEach((p, i) => {
    const r = el('div', 'bd-row' + (normName(p.name) === normName(me.name) ? ' me' : ''));
    const medal = ['🥇', '🥈', '🥉'][i] || String(i + 1);
    const who = el('span', 'bd-who'); const av = el('div', 'av sm'); setAv(av, p.name);
    who.append(av, el('span', 'bd-nm', p.name));
    r.append(el('span', 'bd-rk', medal), who, el('span', 'bd-w', p.w), el('span', 'bd-l', p.l),
             el('span', 'bd-d', p.d), el('span', 'bd-p', Math.round(p.pct * 100) + '%'));
    box.appendChild(r);
  });
}
$('#btn-board').onclick = () => { show('s-board'); boardLoad(); };
$('#board-back').onclick = () => show('s-home');


/* ---------- Révision : résumés de cours avec bulles de définitions ---------- */
const REV = { cur: null, loading: {} };
const revIndex = window.REVISION_INDEX || [];

function revRenderList(){
  const box = $('#rev-list'); box.innerHTML = '';
  const ues = [...new Set(revIndex.map(r => r.ue))];
  ues.forEach(ue => {
    box.appendChild(el('h3', 'rev-ue', ue));
    const g = el('div', 'theme-grid');
    revIndex.filter(r => r.ue === ue).forEach(r => {
      const b = document.createElement('button');
      b.className = 'tcard'; b.style.setProperty('--c', r.color);
      b.innerHTML = `<span class="ti">${r.icon}</span><span class="tn">${esc(r.title)}</span><span class="tc">${r.nsec} parties · ${r.nterms} mots expliqués</span>`;
      b.onclick = () => revOpen(r.key);
      g.appendChild(b);
    });
    box.appendChild(g);
  });
}

function revLoad(key){
  if (window.REVISION && window.REVISION[key]) return Promise.resolve(window.REVISION[key]);
  if (REV.loading[key]) return REV.loading[key];
  return REV.loading[key] = new Promise((ok, ko) => {
    const sc = document.createElement('script');
    sc.src = 'revision/' + key + '.js';
    sc.onload = () => (window.REVISION && window.REVISION[key]) ? ok(window.REVISION[key]) : ko();
    sc.onerror = () => { delete REV.loading[key]; ko(); };
    document.head.appendChild(sc);
  });
}

async function revOpen(key){
  let d;
  try { d = await revLoad(key); } catch(e){ toast('Impossible de charger ce cours'); return; }
  REV.cur = d;
  document.documentElement.style.setProperty('--accent', d.color);
  $('#revr-title').textContent = d.icon + ' ' + d.title;
  const toc = $('#revr-toc'); toc.innerHTML = ''; toc.hidden = true;
  d.toc.forEach((t, i) => {
    const a = el('button', 'rv-toc-i', t);
    a.onclick = () => { toc.hidden = true; const h = document.getElementById('s' + i); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    toc.appendChild(a);
  });
  $('#revr-doc').innerHTML = d.html;
  document.body.classList.add('reading');
  show('s-rev-read');
  glHide();
}
$('#btn-rev').onclick = () => { revRenderList(); show('s-rev'); };
$('#rev-back').onclick = () => show('s-home');
$('#revr-back').onclick = () => { glHide(); document.body.classList.remove('reading'); document.documentElement.style.removeProperty('--accent'); show('s-rev'); };
$('#revr-toc-btn').onclick = () => { const t = $('#revr-toc'); t.hidden = !t.hidden; };
$('#revr-up').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

/* Bulle : définition + images d'exemple (Wikipédia, chargées à la demande) */
const GL = { el: null, t: null, hideT: null, cache: {} };
const canHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
const BAD_IMG = /(icon|logo|flag|drapeau|symbol|disambig|question_book|nuvola|crystal|commons-|wikiquote|wiktionary|wikibooks|wikiversity|edit-clear|padlock|ambox|portal|star_of_life|stub|loudspeaker|speaker|increase|decrease|steady|red_pog|blue_pog|searchtool|info_simple|emblem|oojs|gnome|p_medicine|caduceus|rod_of_asclepius)/i;

function wikiImages(title){
  if (!title) return Promise.resolve(null);
  if (GL.cache[title]) return GL.cache[title];
  const api = 'https://fr.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&redirects=1&titles=' + encodeURIComponent(title);
  const page = 'https://fr.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
  const get = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch(e){ return null; } };
  return GL.cache[title] = (async () => {
    const [lead, all] = await Promise.all([
      get(api + '&action=query&prop=pageimages&piprop=thumbnail&pithumbsize=400'),
      get(api + '&action=query&generator=images&gimlimit=25&prop=imageinfo&iiprop=url|mime&iiurlwidth=360')
    ]);
    const imgs = [];
    const p0 = lead && lead.query && lead.query.pages && lead.query.pages[0];
    if (p0 && p0.missing) return { imgs, page: null };
    if (p0 && p0.thumbnail) imgs.push(p0.thumbnail.source);
    const files = (all && all.query && all.query.pages) || [];
    files.forEach(f => {
      const ii = (f.imageinfo || [])[0]; if (!ii || imgs.length >= 3) return;
      if (BAD_IMG.test(f.title || '') || !/image\/(jpeg|png|svg|gif|webp)/.test(ii.mime || '')) return;
      const u = ii.thumburl || ii.url;
      const key = s => decodeURIComponent((s || '').split('/').pop()).replace(/^\d+px-/, '').replace(/\.png$/, '');
      if (u && !imgs.some(x => key(x) === key(u))) imgs.push(u);
    });
    return { imgs, page };
  })();
}

function glShow(span){
  if (!REV.cur) return;
  const t = REV.cur.gl[span.dataset.t]; if (!t) return;
  clearTimeout(GL.hideT);
  if (GL.t === span && !$('#gl-pop').hidden) return;
  $$('.gl.on').forEach(x => x.classList.remove('on'));
  span.classList.add('on');
  GL.t = span;
  const pop = $('#gl-pop');
  const shown = span.textContent.trim();
  $('#gl-n').textContent = shown.charAt(0).toUpperCase() + shown.slice(1);
  const note = (REV.cur.ctx || {})[span.dataset.s + ':' + span.dataset.t] || (REV.cur.ctx || {})['*:' + span.dataset.t];
  const cx = $('#gl-ctx'); cx.textContent = note || ''; cx.hidden = !note;
  $('#gl-d').textContent = t.d;
  const xs = t.x || {}; const xp = xs[shown] || xs[Object.keys(xs).find(k => k.toLowerCase() === shown.toLowerCase())] || '';
  const xe = $('#gl-xp'); xe.textContent = xp; xe.hidden = !xp;
  const box = $('#gl-img'); box.innerHTML = ''; const src = $('#gl-src'); src.hidden = true;
  if (t.w){
    box.appendChild(el('div', 'gl-load', 'Chargement des images…'));
    wikiImages(t.w).then(res => {
      if (GL.t !== span) return;
      box.innerHTML = '';
      if (!res || !res.imgs.length){ if (res && res.page){ src.href = res.page; src.textContent = 'En savoir plus : Wikipédia ↗'; src.hidden = false; } return; }
      src.textContent = 'Images : Wikipédia ↗';
      res.imgs.forEach(u => {
        const im = document.createElement('img'); im.loading = 'lazy'; im.alt = t.n; im.src = u;
        im.onerror = () => im.remove();
        im.onclick = () => window.open(u, '_blank', 'noopener');
        box.appendChild(im);
      });
      src.href = res.page; src.hidden = false;
      glPlace();
    });
  }
  pop.hidden = false;
  glPlace();
}
function glPlace(){
  const pop = $('#gl-pop'), span = GL.t; if (!span || pop.hidden) return;
  const sheet = !canHover || window.innerWidth < 640;
  pop.classList.toggle('sheet', sheet);
  if (sheet){ pop.style.left = pop.style.top = ''; return; }
  const r = span.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 8 && r.top - h - 8 > 8) y = r.top - h - 8;
  pop.style.left = (x + window.scrollX) + 'px'; pop.style.top = (y + window.scrollY) + 'px';
}
function glHide(){ clearTimeout(GL.hideT); $('#gl-pop').hidden = true; $$('.gl.on').forEach(x => x.classList.remove('on')); GL.t = null; }
function glHideSoon(){ clearTimeout(GL.hideT); GL.hideT = setTimeout(glHide, 280); }

const doc = $('#revr-doc');
doc.addEventListener('click', e => { const s = e.target.closest('.gl'); if (s){ e.stopPropagation(); glShow(s); } });
doc.addEventListener('keydown', e => { const s = e.target.closest('.gl'); if (s && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); glShow(s); } });
if (canHover){
  doc.addEventListener('mouseover', e => { const s = e.target.closest('.gl'); if (s) glShow(s); });
  doc.addEventListener('mouseout', e => { const s = e.target.closest('.gl'); if (s && !s.contains(e.relatedTarget)) glHideSoon(); });
  $('#gl-pop').addEventListener('mouseenter', () => clearTimeout(GL.hideT));
  $('#gl-pop').addEventListener('mouseleave', glHideSoon);
}
$('#gl-x').onclick = glHide;
document.addEventListener('click', e => { if (!$('#gl-pop').hidden && !e.target.closest('#gl-pop') && !e.target.closest('.gl')) glHide(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') glHide(); });
window.addEventListener('resize', glPlace);

})();
