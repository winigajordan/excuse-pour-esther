// Le texte de content.txt est chiffré dans content.js (voir build-content.js) :
// la date saisie est la clé, il n'est lisible qu'avec la bonne date.
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// SHA-256 en JS pur : fonctionne partout (file://, http, tous navigateurs), sans WebCrypto
const sha256 = (() => {
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  const K = primes.map((p) => frac(Math.cbrt(p)));
  const H0 = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  return (bytes) => {
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, len * 8 >>> 0);
    dv.setUint32(total - 8, Math.floor(len / 536870912));
    const h = H0.slice(), w = new Uint32Array(64);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v));
    return out;
  };
})();

const concat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };

// déchiffre le texte avec la date ; lève une erreur si la date est mauvaise
function unseal(password) {
  const salt = b64(window.SEALED.salt), data = b64(window.SEALED.data);
  let k = concat(new TextEncoder().encode(password), salt);
  for (let i = 0; i < 20000; i++) k = sha256(k);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 32) {
    const ctr = new Uint8Array(4); new DataView(ctr.buffer).setUint32(0, i / 32, true);
    const ks = sha256(concat(k, ctr));
    for (let j = 0; j < 32 && i + j < data.length; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  const text = new TextDecoder().decode(out);
  if (!text.startsWith("ESTHER|")) throw new Error("mauvaise date");
  return text.slice(7);
}

let LETTER = [];

function parseContent(raw) {
  return raw
    .replace(/\uFFFC/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1)
    .map((p) => {
      const stamp = p.match(/^[—–-]+\s*(\d{1,2}:\d{2}\s*-\s*[\d/]+)$/);
      return stamp ? { stamp: stamp[1].replace(" - ", " · ") } : p;
    });
}

const $ = (id) => document.getElementById(id);

// ---------- sons (synthétisés, aucun fichier) ----------
const sfx = (() => {
  let ctx = null, muted = false, ambientTimer = null, ambientBus = null;
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  function tone(freq, dur, type = "sine", vol = 0.15, when = 0, slide = 0) {
    if (muted) return;
    const c = ac(), t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    tick: () => tone(1800, 0.04, "square", 0.04),
    wrong: () => { tone(160, 0.35, "sawtooth", 0.1); tone(120, 0.45, "sawtooth", 0.1, 0.12); },
    // validation d'une étape : petit carillon cristallin, plus aigu à chaque étape
    validate: (i = 0) => {
      const f = [523.3, 659.3, 784][i] || 784;
      tone(f, 1.2, "sine", 0.16);
      tone(f * 2, 0.9, "sine", 0.06, 0.02);
      tone(f * 1.5, 1.0, "triangle", 0.07, 0.09);
      tone(f * 3, 0.5, "sine", 0.03, 0.16);
    },
    // poignée : cliquetis de mécanisme qui s'accélère, puis verrou qui se dégage
    handle: () => {
      for (let i = 0; i < 14; i++) {
        const t = i * 0.07 * (1 - i * 0.02);
        tone(1100 + i * 90, 0.05, "square", 0.05, t);
        tone(220, 0.06, "triangle", 0.12, t);
      }
      tone(140, 0.45, "square", 0.22, 1.0, -70);
      tone(55, 0.8, "sine", 0.5, 1.0);
      tone(2400, 0.08, "square", 0.05, 1.02);
    },
    page: () => { tone(659.3, 1.2, "sine", 0.035); tone(987.8, 1.0, "sine", 0.02, 0.08); },
    clunk: () => { tone(90, 0.5, "square", 0.25, 0, -50); tone(60, 0.7, "sine", 0.4, 0.05); },
    chord: () => [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(f, 4, "sine", 0.09, i * 0.35)),
    // lecture de la lettre : petite mélodie douce en arpège, avec un écho
    startAmbient: () => {
      if (ambientTimer || muted) return;
      const c = ac();
      const bus = c.createGain();
      const echo = c.createDelay(1), fb = c.createGain(), wet = c.createGain();
      echo.delayTime.value = 0.5; fb.gain.value = 0.38; wet.gain.value = 0.5;
      bus.connect(c.destination); bus.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(c.destination);
      bus.gain.setValueAtTime(0, c.currentTime);
      bus.gain.linearRampToValueAtTime(1, c.currentTime + 5);
      ambientBus = bus;
      const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
      const pattern = [0, 1, 2, 1, 2, 1, 0, 1];
      let n = 0;
      const bell = (freq, dur, vol) => {
        const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
        o.type = "sine"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
      };
      const play = () => {
        const chord = chords[Math.floor(n / 8) % chords.length];
        if (n % 8 === 0) bell(chord[0] / 2, 5, 0.09);
        bell(chord[pattern[n % 8]] * 2, 2.8, 0.05);
        n++;
      };
      play();
      ambientTimer = setInterval(play, 700);
    },
    stopAmbient: () => {
      clearInterval(ambientTimer); ambientTimer = null;
      if (ambientBus) { ambientBus.gain.value = 0; ambientBus = null; }
    },
    toggle: () => { muted = !muted; if (muted) sfx.stopAmbient(); return muted; },
    unlock: () => { try { ac(); } catch (e) {} },
    get muted() { return muted; },
  };
})();



const FIELDS = [
  { key: "day",   label: "Jour",  min: 1,    max: 31,   pad: 2, step: "le jour", nuts: 31 },
  { key: "month", label: "Mois",  min: 1,    max: 12,   pad: 2, step: "le mois", nuts: 12 },
  { key: "year",  label: "Année", min: 2000, max: 2100, pad: 4, step: "l'année" },
];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];
const WRONG = [
  "Ce n'est pas celle-là… mais je ne lâche rien 💙",
  "Presque… cherche dans ton cœur 💙",
];
// Numéro WhatsApp de Jordan au format international, sans "+" ni espaces (ex. "33612345678").
// Laissé vide : WhatsApp s'ouvre et laisse choisir le contact.
const WHATSAPP_NUMBER = "221763299223";
const REPLIES = [
  { label: "Va te faire foutre, tu es un gros chien", msg: "Va te faire foutre, tu es un gros chien." },
  { label: "D'accord Jordan, mais j'ai besoin de temps et d'espace avant de revenir vers toi",
    msg: "D'accord Jordan, mais j'ai besoin de temps et d'espace avant de revenir vers toi." },
];
const REASSURE = "Peu importe ta décision, je serai toujours présent pour toi, promis 💙";
const HINT = "💡 La date où tout a commencé…";
const NUT_R = 108;      // rayon de la couronne d'écrous (px)
let nutCount = 0, lastOn = -1, msgTimer = null;

const values = { day: 1, month: 1, year: 2025 };
let stage = 0;      // 0 jour, 1 mois, 2 année, 3 tout validé
let attempts = 0;
let busy = false;
let ringAngle = 0;
let errorMsg = null;

const pad = (f, n) => String(n).padStart(f.pad, "0");
const wrap = (f, n) => (n > f.max ? f.min : n < f.min ? f.max : n);

const curField = () => FIELDS[Math.min(stage, 2)];
// un cran = un écrou pour le jour (31) et le mois (12), 14,4° pour l'année
const stepDeg = () => (curField().nuts ? 360 / curField().nuts : 14.4);

function buildNuts(n) {
  if (nutCount === n) return;
  const box = $("nuts");
  box.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.style.transform = `rotate(${(-i * 360) / n}deg) translateY(-${NUT_R}px)`;
    box.appendChild(s);
  }
  nutCount = n; lastOn = -1;
}

function applyRotation() {
  (curField().nuts ? $("nuts") : $("ring")).style.transform = `rotate(${ringAngle}deg)`;
}

// cale la roue sur la valeur courante (écrou actif en haut)
function syncDial() {
  const f = curField();
  $("dial").classList.toggle("nut-mode", !!f.nuts && stage < 3);
  if (f.nuts && stage < 3) {
    const box = $("nuts");
    box.style.transition = "none";
    buildNuts(f.nuts);
    ringAngle = ((values[f.key] - f.min) * 360) / f.nuts;
    applyRotation();
    void box.offsetWidth;
    box.style.transition = "";
  } else {
    applyRotation();
  }
}

function render(animate) {
  const f = curField();
  const v = values[f.key];
  $("lcdLabel").textContent = f.label;
  $("num").textContent = pad(f, v);
  $("num").classList.toggle("wide", f.pad === 4);
  $("sub").innerHTML = f.key === "month" ? MONTHS[v - 1] : "&nbsp;";
  if (f.nuts && stage < 3) {
    const kids = $("nuts").children;
    if (kids[lastOn]) kids[lastOn].classList.remove("on");
    lastOn = v - f.min;
    kids[lastOn].classList.add("on");
  }
  if (animate) { $("num").classList.remove("tick"); void $("num").offsetWidth; $("num").classList.add("tick"); }
}

function change(delta, rotate = true) {
  if (stage > 2 || busy) return;
  const f = FIELDS[stage];
  values[f.key] = wrap(f, values[f.key] + delta);
  if (rotate) {
    ringAngle += delta * stepDeg();
    applyRotation();
  }
  sfx.tick();
  render(true);
}

function stepMessage() {
  return stage === 3
    ? "Tourne la poignée pour vérifier 🔑"
    : `Étape ${stage + 1}/3 : tourne la roue ↻<br>puis valide`;
}

function hideHint() {
  clearTimeout(msgTimer);
  $("msg").classList.remove("hint-on");
  if (!busy) $("msg").innerHTML = stepMessage();
}

function tempMessage(text, ms = 7000) {
  $("msg").innerHTML = text;
  $("msg").classList.add("hint-on");
  clearTimeout(msgTimer);
  msgTimer = setTimeout(hideHint, ms);
}

function showStage() {
  const done = stage === 3;
  $("dots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < stage));
  $("validate").hidden = done;
  $("back").hidden = stage === 0;
  $("up").disabled = $("down").disabled = done;
  $("handle").disabled = !done;
  $("handle").classList.toggle("ready", done);
  syncDial();
  if (done) {
    $("lcdLabel").textContent = "Date";
    $("num").textContent = "♥";
    $("num").classList.remove("wide");
    $("sub").innerHTML = "&nbsp;";
    $("msg").innerHTML = "Tourne la poignée pour vérifier 🔑";
  } else {
    render(false);
    $("validate").textContent = "Valider " + FIELDS[stage].step;
    $("msg").innerHTML = errorMsg || stepMessage();
    errorMsg = null;
  }
}

function validate() {
  if (stage > 2 || busy) return;
  sfx.validate(stage);
  stage++;
  showStage();
}

function goBack() {
  if (stage === 0 || busy) return;
  sfx.tick();
  stage--;
  showStage();
}

function check() {
  if (stage !== 3 || busy) return;
  sfx.unlock();
  busy = true;
  const date = [values.day, values.month, values.year].map((v, i) => String(v).padStart(i < 2 ? 2 : 4, "0")).join("/");
  let ok = false;
  try { LETTER = parseContent(unseal(date)); ok = true; } catch (e) { /* mauvaise date */ }
  const handle = $("handle");
  sfx.handle();
  handle.classList.add("spin");
  setTimeout(() => handle.classList.remove("spin"), 1100);

  if (!ok) {
    attempts++;
    setTimeout(sfx.wrong, 1000);
    $("led").className = "led ko";
    $("door").classList.remove("shake"); void $("door").offsetWidth; $("door").classList.add("shake");
    if (attempts >= 2) $("hint").classList.add("urgent");
    errorMsg = attempts >= 3
      ? "Indice : la date où tout a commencé 💙"
      : WRONG[(attempts - 1) % WRONG.length];
    setTimeout(() => {
      $("led").className = "led";
      stage = 0;
      busy = false;
      showStage();
    }, 1600);
    return;
  }

  $("led").className = "led ok";
  $("msg").textContent = "Clic ! 💚";
  setTimeout(() => { $("safe").classList.add("open"); sfx.chord(); sfx.startAmbient(); }, 900);
  setTimeout(() => $("flash").classList.add("on"), 3200);
  setTimeout(showLetter, 4800);
}

function heartBurst(count = 30) {
  const box = $("hearts");
  const emojis = ["❤️", "💖", "💕", "💗", "😘"];
  for (let i = 0; i < count; i++) {
    const h = document.createElement("span");
    h.className = "heart";
    h.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    h.style.left = Math.random() * 100 + "vw";
    h.style.fontSize = 16 + Math.random() * 28 + "px";
    h.style.animationDuration = 4 + Math.random() * 5 + "s";
    h.style.animationDelay = Math.random() * 2 + "s";
    box.appendChild(h);
    setTimeout(() => h.remove(), 11000);
  }
}

// ---------- la lettre : une page à la fois, mot après mot ----------
let pages = [], pageIdx = 0, revealTimer = null, revealDone = true;
const KEY = "pas te perdre Esther";

function buildPage(p) {
  const el = $("page");
  el.className = "page " + p.type + (p.text.length > 230 ? " long" : "");
  el.replaceChildren();
  const txt = document.createElement("div");
  txt.className = "txt";
  el.append(txt);
  const parts = p.text.includes(KEY) ? p.text.split(KEY) : [p.text];
  const segs = [];
  parts.forEach((t, i) => { segs.push({ t, key: false }); if (i < parts.length - 1) segs.push({ t: KEY, key: true }); });
  const words = segs.reduce((n, s) => n + s.t.split(/\s+/).filter(Boolean).length, 0);
  const per = Math.min(0.09, 5 / Math.max(words, 1));
  let n = 0;
  segs.forEach((s) => {
    s.t.split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { txt.append(tok); return; }
      const w = document.createElement("span");
      w.className = "w" + (s.key ? " key" : "");
      w.textContent = tok;
      w.style.animationDelay = 0.35 + n++ * per + "s";
      txt.append(w);
    });
  });
  return (0.35 + n * per + 0.6) * 1000;
}

function goTo(i) {
  clearTimeout(revealTimer);
  pageIdx = Math.max(0, Math.min(i, pages.length - 1));
  const p = pages[pageIdx];
  let dur = 0;
  if (p.type === "reply") renderReply();
  else dur = buildPage(p);
  revealDone = false;
  $("page").style.animation = "none"; void $("page").offsetWidth; $("page").style.animation = "";
  $("progress").querySelectorAll("i").forEach((d, k) => d.classList.toggle("done", k <= pageIdx));
  const last = pageIdx === pages.length - 1;
  $("nextPage").textContent = last ? "Relire ↺" : "Continuer";
  $("nextPage").classList.remove("ready");
  $("prevPage").style.visibility = pageIdx === 0 ? "hidden" : "visible";
  sfx.page();
  if ((p.text && p.text.includes(KEY)) || p.type === "sign") heartBurst(28);
  revealTimer = setTimeout(finishReveal, dur);
}

// dernière page : répondre à Jordan, puis ouvrir WhatsApp avec le message préchargé
function renderReply() {
  const el = $("page");
  el.className = "page reply";
  el.replaceChildren();
  const box = document.createElement("div");
  box.className = "txt";
  box.innerHTML = `<p class="reply-title">Et maintenant, que lui réponds-tu ?</p>
    <div class="opts"></div>
    <p class="reassure" hidden>${REASSURE}</p>
    <button class="send" type="button" hidden>
      <span class="send-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.2 20.8l4.3-1.2A8.8 8.8 0 1 0 12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 8.6c-.4 3.2 2.7 6.2 6 6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      <span class="send-txt"><small>Valider et envoyer sur</small><b>WhatsApp</b></span>
      <span class="send-arrow">→</span>
    </button>`;
  el.append(box);
  const opts = box.querySelector(".opts"), reassure = box.querySelector(".reassure"), send = box.querySelector(".send");
  let chosen = -1;
  REPLIES.forEach((r, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt";
    b.textContent = r.label;
    b.addEventListener("click", () => {
      chosen = i;
      sfx.tick();
      opts.querySelectorAll(".opt").forEach((o, k) => o.classList.toggle("selected", k === i));
      reassure.hidden = false;
      send.hidden = false;
    });
    opts.append(b);
  });
  send.addEventListener("click", () => {
    if (chosen < 0) return;
    sfx.validate(2);
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(REPLIES[chosen].msg)}`;
    window.open(url, "_blank") || (location.href = url);
  });
}

function finishReveal() {
  revealDone = true;
  $("nextPage").classList.add("ready");
}

function skipReveal() {
  clearTimeout(revealTimer);
  $("page").querySelectorAll(".w").forEach((w) => { w.style.animationDelay = "0s"; w.style.animationDuration = ".01s"; });
  finishReveal();
}

function nextPage() {
  if (!revealDone) return skipReveal();
  goTo(pageIdx === pages.length - 1 ? 0 : pageIdx + 1);
}

function showLetter() {
  $("vaultScene").hidden = true;
  $("letterScene").hidden = false;
  $("flash").classList.remove("on");
  window.scrollTo(0, 0);
  pages = [
    { type: "title", text: "Pour Esther ❤️" },
    ...LETTER.map((item) => (typeof item === "string" ? { type: "text", text: item } : { type: "stamp", text: item.stamp })),
    { type: "sign", text: "— Moi, qui ne veux pas te perdre ❤️" },
    { type: "reply" },
  ];
  $("progress").innerHTML = pages.map(() => "<i></i>").join("");
  heartBurst(40);
  setInterval(() => heartBurst(6), 5000);
  setTimeout(() => goTo(0), 700);
}

$("nextPage").addEventListener("click", nextPage);
$("prevPage").addEventListener("click", () => goTo(pageIdx - 1));
$("page").addEventListener("click", () => { if (pages[pageIdx].type !== "reply") nextPage(); });

// ---------- interactions ----------
$("up").addEventListener("click", () => change(1));
$("down").addEventListener("click", () => change(-1));
$("validate").addEventListener("click", validate);
$("back").addEventListener("click", goBack);
$("hint").addEventListener("click", () => {
  sfx.tick();
  if ($("msg").classList.contains("hint-on")) hideHint();
  else tempMessage(HINT);
});
$("handle").addEventListener("click", check);

// tourner le cadran (glisser autour du centre) ou molette
(() => {
  const dial = $("dial"), ring = $("ring"), nuts = $("nuts");
  let dragging = false, last = 0, acc = 0;
  const angleAt = (e) => {
    const r = dial.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  dial.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".lcd")) return;
    dragging = true; last = angleAt(e); acc = 0;
    ring.style.transition = nuts.style.transition = "none";
    dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const a = angleAt(e);
    let d = a - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    last = a;
    if (stage > 2 || busy) return;
    ringAngle += d;
    applyRotation();
    acc += d;
    while (Math.abs(acc) >= stepDeg()) { const s = Math.sign(acc); change(s, false); acc -= s * stepDeg(); }
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    ring.style.transition = nuts.style.transition = "";
    const f = curField();
    if (f.nuts && stage < 3) { // cran : l'écrou choisi se cale en haut
      const base = ((values[f.key] - f.min) * 360) / f.nuts;
      ringAngle = base + 360 * Math.round((ringAngle - base) / 360);
      applyRotation();
    }
  };
  dial.addEventListener("pointerup", stop);
  dial.addEventListener("pointercancel", stop);
  dial.addEventListener("wheel", (e) => { e.preventDefault(); change(e.deltaY < 0 ? 1 : -1); }, { passive: false });
})();

document.addEventListener("keydown", (e) => {
  if (!$("letterScene").hidden) {
    if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); if (pages[pageIdx].type !== "reply") nextPage(); }
    else if (e.key === "ArrowLeft") goTo(pageIdx - 1);
    return;
  }
  if (e.key === "ArrowUp") change(1);
  else if (e.key === "ArrowDown") change(-1);
  else if (e.key === "Enter") (stage === 3 ? check : validate)();
});

document.addEventListener("pointerdown", sfx.unlock, { once: true });

showStage();

// animations d'arrière-plan : étoiles et petites lueurs qui montent
(() => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const stars = $("bgStars"), orbs = $("orbs");
  for (let i = 0; i < 90; i++) {
    const s = document.createElement("span");
    s.className = "bg-star";
    const size = rnd(1, 3);
    s.style.cssText = `left:${rnd(0, 100)}%;top:${rnd(0, 100)}%;width:${size}px;height:${size}px;` +
      `animation-duration:${rnd(2, 5)}s;animation-delay:${rnd(0, 4)}s`;
    stars.appendChild(s);
  }
  for (let i = 0; i < 14; i++) {
    const o = document.createElement("span");
    o.className = "orb";
    const size = rnd(14, 44);
    o.style.cssText = `left:${rnd(0, 100)}%;width:${size}px;height:${size}px;--dx:${rnd(-60, 60)}px;` +
      `animation-duration:${rnd(14, 28)}s;animation-delay:${rnd(-20, 0)}s`;
    orbs.appendChild(o);
  }
})();

// désactive le zoom (pincement iOS, Ctrl+molette, Ctrl +/-/0, double-tap)
["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
  document.addEventListener(t, (e) => e.preventDefault()));
document.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
});
let lastTouch = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouch < 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });
