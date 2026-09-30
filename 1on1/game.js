const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const menu = document.getElementById("menu");
const toast = document.getElementById("toast");
const modeLabel = document.getElementById("modeLabel");
const scoreLabel = document.getElementById("scoreLabel");
const clockLabel = document.getElementById("clockLabel");
const stick = document.getElementById("stick");
const nub = document.getElementById("nub");

const keys = new Set();
const input = { x: 0, y: 0, shoot: false, drive: false, steal: false };
const modes = {
  duel: { title: "Duelo", seconds: 120 },
  threes: { title: "Triples", seconds: 60 },
  dunks: { title: "Mates", seconds: 60 }
};

let state = resetState("duel");
let last = performance.now();
let messageTimer = 0;

function resetState(mode) {
  return {
    mode,
    running: false,
    over: false,
    time: modes[mode].seconds,
    playerScore: 0,
    rivalScore: 0,
    streak: 0,
    combo: 0,
    possession: "player",
    nextAiShot: 0.7,
    shotClock: 12,
    player: { x: 330, y: 350, vx: 0, vy: 0, facing: 1, jumping: 0, cool: 0 },
    rival: { x: 640, y: 350, vx: 0, vy: 0, facing: -1, jumping: 0, cool: 0 },
    ball: { x: 350, y: 324, z: 20, vx: 0, vy: 0, vz: 0, held: "player", flight: null }
  };
}

function start(mode) {
  state = resetState(mode);
  state.running = true;
  menu.hidden = true;
  modeLabel.textContent = modes[mode].title;
  show(mode === "duel" ? "Primero a dominar la media pista" : mode === "threes" ? "Cinco puestos, suelta en la zona" : "Corre, salta y machaca cerca del aro");
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => start(button.dataset.mode));
});

document.getElementById("shootBtn").addEventListener("pointerdown", () => (input.shoot = true));
document.getElementById("shootBtn").addEventListener("pointerup", () => (input.shoot = false));
document.getElementById("driveBtn").addEventListener("pointerdown", () => (input.drive = true));
document.getElementById("driveBtn").addEventListener("pointerup", () => (input.drive = false));
document.getElementById("stealBtn").addEventListener("pointerdown", () => (input.steal = true));
document.getElementById("stealBtn").addEventListener("pointerup", () => (input.steal = false));

stick.addEventListener("pointerdown", moveStick);
stick.addEventListener("pointermove", moveStick);
stick.addEventListener("pointerup", clearStick);
stick.addEventListener("pointercancel", clearStick);

window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if (event.key === " " || event.key.toLowerCase() === "z") input.shoot = true;
  if (event.key.toLowerCase() === "x") input.steal = true;
  if (event.key.toLowerCase() === "shift") input.drive = true;
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
  if (event.key === " " || event.key.toLowerCase() === "z") input.shoot = false;
  if (event.key.toLowerCase() === "x") input.steal = false;
  if (event.key.toLowerCase() === "shift") input.drive = false;
});

function moveStick(event) {
  stick.setPointerCapture(event.pointerId);
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const len = Math.hypot(dx, dy) || 1;
  const max = rect.width * 0.28;
  const mag = Math.min(max, len);
  input.x = (dx / len) * (mag / max);
  input.y = (dy / len) * (mag / max);
  nub.style.transform = `translate(${(dx / len) * mag}px, ${(dy / len) * mag}px)`;
}

function clearStick() {
  input.x = 0;
  input.y = 0;
  nub.style.transform = "translate(0, 0)";
}

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  const dx = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
  const dy = (keys.has("arrowdown") || keys.has("s") ? 1 : 0) - (keys.has("arrowup") || keys.has("w") ? 1 : 0);
  const ix = dx || input.x;
  const iy = dy || input.y;
  if (messageTimer > 0) messageTimer -= dt;
  if (messageTimer <= 0) toast.hidden = true;
  if (!state.running || state.over) return;
  state.time -= dt;
  state.shotClock -= dt;
  if (state.time <= 0) endGame();

  movePlayer(state.player, ix, iy, input.drive, dt);
  updateRival(dt);
  if (input.shoot && state.player.cool <= 0 && state.ball.held === "player") playerAction();
  if (input.steal && state.player.cool <= 0) stealAction();
  updateBall(dt);
  state.player.cool = Math.max(0, state.player.cool - dt);
  state.rival.cool = Math.max(0, state.rival.cool - dt);
  updateHud();
}

function movePlayer(p, ix, iy, sprint, dt) {
  const speed = sprint ? 310 : 220;
  p.vx = ix * speed;
  p.vy = iy * speed * 0.72;
  p.x = clamp(p.x + p.vx * dt, 130, 840);
  p.y = clamp(p.y + p.vy * dt, 245, 470);
  if (Math.abs(ix) > 0.05) p.facing = Math.sign(ix);
}

function updateRival(dt) {
  const r = state.rival;
  const p = state.player;
  if (state.mode !== "duel") {
    r.x += (760 - r.x) * dt * 2;
    r.y += (310 - r.y) * dt * 2;
    return;
  }
  if (state.ball.held === "rival") {
    const targetX = state.nextAiShot > 0 ? 700 : 806;
    const targetY = state.nextAiShot > 0 ? 330 : 350;
    r.x += clamp(targetX - r.x, -180 * dt, 180 * dt);
    r.y += clamp(targetY - r.y, -120 * dt, 120 * dt);
    state.nextAiShot -= dt;
    if (state.nextAiShot <= 0 && r.cool <= 0) shoot("rival");
  } else {
    r.x += clamp(p.x + 55 - r.x, -210 * dt, 210 * dt);
    r.y += clamp(p.y - r.y, -130 * dt, 130 * dt);
  }
  r.facing = r.x > p.x ? -1 : 1;
}

function playerAction() {
  if (state.mode === "dunks" && distance(state.player, { x: 800, y: 350 }) < 95 && input.drive) {
    score("player", 2, "Mate limpio");
    resetPossession("rival");
    state.player.cool = 0.7;
    return;
  }
  shoot("player");
}

function stealAction() {
  state.player.cool = 0.45;
  if (state.ball.held === "rival" && distance(state.player, state.rival) < 78 && Math.random() < 0.5) {
    state.ball.held = "player";
    state.possession = "player";
    show("Robo");
  } else if (state.ball.flight && state.ball.flight.by === "rival" && distance(state.player, state.ball) < 85) {
    resetPossession("player");
    show("Tapón");
  }
}

function shoot(by) {
  const actor = by === "player" ? state.player : state.rival;
  const hoop = { x: by === "player" ? 807 : 153, y: 306 };
  const d = distance(actor, hoop);
  const three = by === "player" ? actor.x < 600 : actor.x > 360;
  const sweet = state.mode === "threes" ? Math.abs(actor.x - 515) < 45 || Math.abs(actor.x - 385) < 45 || Math.abs(actor.x - 265) < 45 : d < 300;
  const odds = clamp(0.82 - d / 650 + (sweet ? 0.14 : 0) - (input.drive ? 0.06 : 0), 0.18, 0.88);
  const made = Math.random() < odds;
  state.ball.held = null;
  state.ball.flight = { by, made, t: 0, dur: 0.72, sx: actor.x, sy: actor.y - 35, ex: hoop.x, ey: hoop.y, points: three ? 3 : 2 };
  actor.cool = 0.85;
}

function updateBall(dt) {
  const b = state.ball;
  if (b.held) {
    const holder = b.held === "player" ? state.player : state.rival;
    b.x = holder.x + holder.facing * 26;
    b.y = holder.y - 24 + Math.sin(performance.now() / 95) * 5;
    b.z = 20;
    return;
  }
  if (!b.flight) return;
  const f = b.flight;
  f.t += dt / f.dur;
  const t = clamp(f.t, 0, 1);
  b.x = lerp(f.sx, f.ex, t);
  b.y = lerp(f.sy, f.ey, t) - Math.sin(t * Math.PI) * 130;
  b.z = 30 + Math.sin(t * Math.PI) * 110;
  if (t >= 1) {
    if (f.made) {
      score(f.by, state.mode === "dunks" ? Math.max(2, state.combo) : f.points, f.points === 3 ? "Triple" : "Canasta");
      resetPossession(f.by === "player" ? "rival" : "player");
    } else {
      show("Rebote");
      resetPossession(Math.random() < 0.58 ? "player" : "rival");
    }
  }
}

function score(by, points, text) {
  if (by === "player") {
    state.playerScore += points;
    state.streak += 1;
    state.combo = Math.min(5, state.combo + 1);
  } else {
    state.rivalScore += points;
    state.streak = 0;
  }
  show(`${text} +${points}`);
  if (state.mode !== "duel" && by === "player") state.time += 1.5;
}

function resetPossession(next) {
  state.ball.flight = null;
  state.ball.held = next;
  state.possession = next;
  state.nextAiShot = 0.8 + Math.random() * 1.6;
  state.shotClock = 12;
  if (next === "rival") {
    state.rival.x = 660;
    state.rival.y = 350;
  }
}

function endGame() {
  state.over = true;
  state.running = false;
  const won = state.playerScore >= state.rivalScore;
  show(won ? "Victoria" : "Partido terminado");
  setTimeout(() => {
    menu.hidden = false;
  }, 1000);
}

function updateHud() {
  const m = Math.max(0, Math.floor(state.time / 60));
  const s = Math.max(0, Math.floor(state.time % 60)).toString().padStart(2, "0");
  scoreLabel.textContent = state.mode === "duel" ? `${state.playerScore} - ${state.rivalScore}` : `${state.playerScore} pts`;
  clockLabel.textContent = `${m}:${s}`;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCourt();
  drawHoop(143, 300, -1);
  drawHoop(817, 300, 1);
  const people = [state.player, state.rival].sort((a, b) => a.y - b.y);
  people.forEach((p) => drawPlayer(p, p === state.player ? "#f4c04d" : "#63c7d4", p === state.player ? "#24201a" : "#121c20"));
  drawBall();
}

function drawCourt() {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#9c5a2c");
  g.addColorStop(1, "#6f381d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 960, 540);
  ctx.fillStyle = "rgba(255,255,255,.13)";
  for (let x = 80; x < 940; x += 70) ctx.fillRect(x, 0, 2, 540);
  ctx.strokeStyle = "#f6e6be";
  ctx.lineWidth = 5;
  ctx.strokeRect(80, 80, 800, 390);
  ctx.beginPath();
  ctx.arc(480, 305, 74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(155, 305, 118, -1.15, 1.15);
  ctx.arc(805, 305, 118, Math.PI - 1.15, Math.PI + 1.15);
  ctx.stroke();
  ctx.fillStyle = "rgba(30,20,12,.26)";
  ctx.fillRect(80, 250, 170, 115);
  ctx.fillRect(710, 250, 170, 115);
}

function drawHoop(x, y, side) {
  ctx.strokeStyle = "#f8f4ea";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x + side * 38, y - 78);
  ctx.lineTo(x + side * 38, y + 65);
  ctx.stroke();
  ctx.fillStyle = "#e74d2f";
  ctx.fillRect(x - 18, y - 35, 36, 8);
  ctx.strokeStyle = "#f8f4ea";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y - 23, 29, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlayer(p, jersey, trim) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.beginPath();
  ctx.ellipse(0, 18, 38, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(-18, -65, 36, 20);
  ctx.fillStyle = jersey;
  ctx.fillRect(-24, -45, 48, 58);
  ctx.fillStyle = "#f0b276";
  ctx.beginPath();
  ctx.arc(0, -76, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(-18, 12, 14, 45);
  ctx.fillRect(4, 12, 14, 45);
  ctx.fillRect(-30, -28, 12, 44);
  ctx.fillRect(18, -28, 12, 44);
  ctx.fillStyle = "#fff7db";
  ctx.font = "700 19px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(p === state.player ? "23" : "33", 0, -12);
  ctx.restore();
}

function drawBall() {
  const b = state.ball;
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + 18, 17, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d36b2a";
  ctx.beginPath();
  ctx.arc(b.x, b.y - b.z * 0.12, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5b2b16";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(b.x, b.y - b.z * 0.12, 15, -0.8, 0.8);
  ctx.moveTo(b.x - 15, b.y - b.z * 0.12);
  ctx.lineTo(b.x + 15, b.y - b.z * 0.12);
  ctx.stroke();
}

function show(text) {
  toast.textContent = text;
  toast.hidden = false;
  messageTimer = 1.3;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

updateHud();
requestAnimationFrame(loop);
