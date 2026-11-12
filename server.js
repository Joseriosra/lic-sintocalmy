'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8'));
const MOD_KEY = process.env.MOD_KEY || '';
const PORT = process.env.PORT || 3000;
const SEG = content.segundos * 1000;
// Si existe public/media/intro.mp4 se reproduce ese video; si no, se usa la secuencia animada del storyboard.
const VIDEO_SRC = fs.existsSync(path.join(__dirname, 'public', 'media', 'intro.mp4')) ? '/media/intro.mp4' : '';

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 15000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/', (req, res) => res.redirect('/participante.html'));

app.get('/api/qr', async (req, res) => {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const base = process.env.PUBLIC_URL || `${proto}://${req.get('host')}`;
  const url = `${base}/participante.html`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b4f45', light: '#ffffff' } });
  res.json({ url, svg });
});

// ---- Estado del juego ----
const steps = [{ t: 'lobby' }, { t: 'video' }, { t: 'caso' }];
content.preguntas.forEach((_, i) => {
  steps.push({ t: 'pregunta', q: i }, { t: 'alternativas', q: i }, { t: 'respuesta', q: i }, { t: 'ranking', q: i });
});
steps.push({ t: 'podio' }, { t: 'cierre' }, { t: 'refs' });

const game = { step: 0, endsAt: 0, locked: true, players: new Map(), timer: null };

function ranked() {
  return [...game.players.values()].sort((a, b) => b.score - a.score || a.time - b.time);
}
function brief(p, i) {
  return { name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 };
}
function counts() {
  const s = steps[game.step];
  const all = [...game.players.values()];
  const out = { total: all.filter(p => p.connected).length, joined: all.length };
  if (s.q !== undefined) out.answered = all.filter(p => p.answers[s.q] !== undefined).length;
  return out;
}
function publicState() {
  const s = steps[game.step];
  const st = { type: s.t, n: s.q !== undefined ? s.q + 1 : null, totalQ: content.preguntas.length,
    step: game.step, steps: steps.length, serverNow: Date.now(), counts: counts(), segundos: content.segundos,
    meta: { borrador: content.borrador, footer: content.footer, isi: content.isi } };
  const Q = s.q !== undefined ? content.preguntas[s.q] : null;
  if (s.t === 'lobby') { st.titulo = content.titulo; st.subtitulo = content.subtitulo; st.base = content.base; }
  if (s.t === 'video') st.video = { src: VIDEO_SRC, escenas: content.video.escenas };
  if (s.t === 'caso') st.caso = content.caso;
  if (s.t === 'pregunta') st.q = { enunciado: Q.enunciado, corta: Q.corta };
  if (s.t === 'alternativas') {
    st.q = { enunciado: Q.enunciado, alternativas: Q.alternativas, grande: Q.grande };
    st.endsAt = game.endsAt; st.locked = game.locked; st.segundos = content.segundos;
  }
  if (s.t === 'respuesta') {
    const dist = Q.alternativas.map(() => 0);
    game.players.forEach(p => { const a = p.answers[s.q]; if (a) dist[a.choice]++; });
    st.q = { enunciado: Q.enunciado, alternativas: Q.alternativas, grande: Q.grande, correcta: Q.correcta,
      justificacion: Q.justificacion, dato: Q.dato, dist };
  }
  if (s.t === 'ranking') st.ranking = ranked().slice(0, 5).map(brief);
  if (s.t === 'podio') { const r = ranked(); st.ranking = r.slice(0, 10).map(brief); }
  if (s.t === 'cierre') st.cierre = content.cierre;
  if (s.t === 'refs') st.refs = content.referencias;
  return st;
}
function meFor(p) {
  if (!p) return null;
  const r = ranked();
  const idx = r.findIndex(x => x.id === p.id);
  const s = steps[game.step];
  const last = s.q !== undefined ? p.answers[s.q] || null : null;
  return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: idx + 1, total: r.length, answer: last };
}
function sendState(sock) {
  const st = publicState();
  if (sock.data.player) st.me = meFor(game.players.get(sock.data.player));
  sock.emit('state', st);
}
function broadcastAll() {
  const base = publicState();
  const r = ranked();
  const s = steps[game.step];
  for (const sock of io.sockets.sockets.values()) {
    const st = { ...base };
    if (sock.data.player) {
      const p = game.players.get(sock.data.player);
      if (p) {
        const idx = r.findIndex(x => x.id === p.id);
        st.me = { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: idx + 1, total: r.length,
          answer: s.q !== undefined ? p.answers[s.q] || null : null };
      }
    }
    sock.emit('state', st);
  }
}
function broadcastCounts() {
  io.emit('counts', counts());
}
function lockNow() {
  game.locked = true;
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }
}
function goTo(i) {
  game.step = Math.max(0, Math.min(steps.length - 1, i));
  lockNow();
  if (steps[game.step].t === 'alternativas') {
    game.locked = false;
    game.endsAt = Date.now() + SEG;
    game.timer = setTimeout(() => { lockNow(); broadcastAll(); }, SEG + 150);
  }
  broadcastAll();
}

io.on('connection', socket => {
  socket.on('join', (d, ack) => {
    const token = String(d && d.token || '').slice(0, 64);
    if (!token) return ack && ack({ ok: false });
    let p = game.players.get(token);
    if (!p) {
      const name = String(d.name || '').trim().slice(0, 24) || 'Participante';
      p = { id: token, name, avatar: Math.max(0, Math.min(7, Number(d.avatar) || 0)), score: 0, time: 0, answers: {}, connected: true };
      game.players.set(token, p);
    }
    p.connected = true;
    socket.data.player = token;
    ack && ack({ ok: true });
    sendState(socket);
    broadcastCounts();
  });
  socket.on('resume', (d, ack) => {
    const p = game.players.get(String(d && d.token || ''));
    if (!p) { ack && ack({ ok: false }); return sendState(socket); }
    p.connected = true; socket.data.player = p.id;
    ack && ack({ ok: true, name: p.name, avatar: p.avatar });
    sendState(socket); broadcastCounts();
  });
  socket.on('answer', (d, ack) => {
    const p = game.players.get(socket.data.player);
    const s = steps[game.step];
    if (!p || s.t !== 'alternativas' || game.locked || Date.now() > game.endsAt + 300) return ack && ack({ ok: false });
    if (p.answers[s.q] !== undefined) return ack && ack({ ok: false, dup: true });
    const Q = content.preguntas[s.q];
    const choice = Number(d && d.choice);
    if (!(choice >= 0 && choice < Q.alternativas.length)) return ack && ack({ ok: false });
    const elapsed = Math.max(0, Math.min(SEG, SEG - (game.endsAt - Date.now())));
    const correct = choice === Q.correcta;
    const points = correct ? content.puntosBase + Math.round(content.puntosVelocidad * (1 - elapsed / SEG)) : 0;
    p.answers[s.q] = { choice, correct, points };
    p.score += points; p.time += elapsed;
    ack && ack({ ok: true });
    broadcastCounts();
  });
  socket.on('mod:auth', (d, ack) => {
    if (MOD_KEY && (!d || d.key !== MOD_KEY)) return ack && ack({ ok: false });
    socket.data.mod = true;
    ack && ack({ ok: true });
    sendState(socket);
  });
  const modOnly = fn => (...a) => { if (socket.data.mod) fn(...a); };
  socket.on('mod:next', modOnly(() => goTo(game.step + 1)));
  socket.on('mod:prev', modOnly(() => goTo(game.step - 1)));
  socket.on('mod:reset', modOnly(() => {
    game.players.forEach(p => { p.score = 0; p.time = 0; p.answers = {}; });
    goTo(0);
  }));
  socket.on('mod:kick', modOnly(() => {
    game.players.clear(); goTo(0);
    io.emit('kicked');
  }));
  socket.on('disconnect', () => {
    const p = game.players.get(socket.data.player);
    if (p && ![...io.sockets.sockets.values()].some(s => s.data.player === p.id)) { p.connected = false; broadcastCounts(); }
  });
});

server.listen(PORT, () => console.log(`LIC Sintocalmy escuchando en :${PORT}${MOD_KEY ? ' (clave de moderador activa)' : ''}`));
