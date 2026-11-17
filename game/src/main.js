// main.js — Palmera Bay bootstrap and game loop. Fixed 1/60 s steps, a camera
// that follows Mara, canvas world rendering, and ?shot= staging for screenshots:
// ?shot=chase|drive|mission|city starts the live game in that staged scene
// (menu skipped, traffic and police already running) and ?seed= fixes the city.
import { generateCity, drawCity, nearestRoadPoint, isOnRoad, WORLD_W, WORLD_H, V_ROADS, H_ROADS } from './city.js';
import { makePlayer, stepPlayerOnFoot, stepBullets, hurtPlayer, tryEnterCar, exitCar, drawPlayer, nearestCar } from './player.js';
import { CAR_MODELS, POLICE_MODEL, makeCar, stepCarPhysics, drawCar } from './vehicles.js';
import { spawnTraffic, stepTraffic, stepPeds, drawPed, checkPedCollisions } from './traffic.js';
import { makePoliceState, addWanted, stepWanted, stepPolice, drawCop } from './police.js';
import { makeMissionState, startMission, maybeAutoStart, stepMissions, objectiveTarget, objectiveText, currentMission, MISSIONS } from './missions.js';
import { makeHud, showMenu, hideMenu, showPause, showEnd, showMissionComplete, hideEndScreens, pushFeed, renderHud } from './hud.js';
import { makeAudio } from './audio.js';
import { saveGame, loadSave, applySave } from './save.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const VIEW_W = 1280;
const VIEW_H = 720;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const hud = makeHud();

/** The whole game state, one object every system reads and writes. */
const S = {
  seed,
  city: generateCity(seed),
  carModels: CAR_MODELS,
  player: makePlayer(700, 660),
  cars: [],
  peds: [],
  cops: [],
  bullets: [],
  particles: [],
  pickups: [],
  police: makePoliceState(),
  mission: makeMissionState(),
  missionResult: null,
  missionTarget: null,
  feed: [],
  stats: { carsStolen: 0, missionsDone: 0, pedsDown: 0, copsDown: 0, punches: 0 },
  cash: 200,
  rep: 0,
  night: false,
  time: 0,
  mode: 'menu',
  camera: { x: 0, y: 0 },
  audio: makeAudio(),
  input: {
    keys: {},
    mouse: { x: VIEW_W / 2, y: VIEW_H / 2 },
    mouseDown: false,
  },
  autopilot: null,
  shotReady: false,
};
S.police.addWanted = (state, stars, reason) => addWanted(state, stars, reason);

/** Debug probe for headless tests: player, car, camera and autopilot target. */
window.__dbg = () => {
  const p = S.player;
  const car = S.cars.find((c) => c.id === p.carId);
  return {
    px: Math.round(p.x), py: Math.round(p.y), onFoot: p.onFoot,
    car: car ? { x: Math.round(car.x), y: Math.round(car.y), angle: car.angle.toFixed(2), speed: Math.round(car.speed), damage: Math.round(car.damage), model: car.model.name } : null,
    cam: { x: Math.round(S.camera.x), y: Math.round(S.camera.y) },
    target: S.autoTarget || null,
    keys: S.input.keys,
  };
};

spawnTraffic(S, Math.random);
// A few parked cars right by the safehouse so the first job is findable.
for (const [px, py, mi] of [[322, 780, 0], [340, 900, 1], [1134, 420, 3], [1522, 1650, 5]]) {
  const car = makeCar(px, py, Math.PI / 2, CAR_MODELS[mi], 'parked');
  S.cars.push(car);
}

function announce(message) {
  status.textContent = message;
}

/** Camera follows the player (or their car), clamped to the world. */
function updateCamera() {
  const p = S.player;
  let tx = p.x - VIEW_W / 2;
  let ty = p.y - VIEW_H / 2;
  if (!p.onFoot) {
    const car = S.cars.find((c) => c.id === p.carId);
    if (car) {
      tx = car.x + Math.cos(car.angle) * 60 - VIEW_W / 2;
      ty = car.y + Math.sin(car.angle) * 60 - VIEW_H / 2;
    }
  }
  S.camera.x += (Math.max(0, Math.min(WORLD_W - VIEW_W, tx)) - S.camera.x) * 0.12;
  S.camera.y += (Math.max(0, Math.min(WORLD_H - VIEW_H, ty)) - S.camera.y) * 0.12;
}

/** One fixed step of simulation. */
function step(dt) {
  S.time += dt;
  S.crashFeedCooldown = Math.max(0, (S.crashFeedCooldown || 0) - dt);
  const p = S.player;
  const inp = S.input;
  if (S.mode !== 'play') return;
  // Driving or on foot.
  if (p.onFoot) {
    stepPlayerOnFoot(S, dt);
  } else {
    const car = S.cars.find((c) => c.id === p.carId);
    if (car) {
      const throttle = inp.keys.w ? 1 : 0;
      const reverse = inp.keys.s ? 1 : 0;
      const brake = inp.keys.space ? 1 : 0;
      const steer = (inp.keys.a ? -1 : 0) + (inp.keys.d ? 1 : 0);
      const before = car.damage;
      stepCarPhysics(car, { throttle, steer, brake, reverse }, dt, S.city, (c, imp) => {
        S.audio.crash();
        if (imp > 200 && (S.crashFeedCooldown || 0) <= 0) {
          pushFeed(S, 'You smashed into something solid.', 'bad');
          S.crashFeedCooldown = 4;
        }
      });
      if (car.damage > before && car.damage >= 100 && Math.random() < dt * 0.2) {
        // Wrecked car: Mara bails out.
        pushFeed(S, `Your ${car.model.name} is wrecked — bail out!`, 'bad');
        exitCar(S);
      }
      p.x = car.x;
      p.y = car.y;
      p.angle = car.angle;
      p.speed = Math.abs(car.speed);
      S.audio.engine(car.speed, car.model.top);
      // Speeding past a police car draws heat (once per few seconds).
      if (Math.abs(car.speed) > 430) {
        S.police.speedingCooldown = Math.max(0, (S.police.speedingCooldown || 0) - dt);
        if (S.police.speedingCooldown <= 0) {
          for (const pc of S.cars) {
            if (pc.driver === 'police' && Math.hypot(pc.x - car.x, pc.y - car.y) < 260) {
              addWanted(S, 1, 'Speeding past a PBPD unit');
              S.police.speedingCooldown = 5;
              break;
            }
          }
        }
      }
    } else {
      p.onFoot = true;
      p.carId = 0;
    }
  }
  stepBullets(S, dt);
  stepTraffic(S, dt);
  stepPeds(S, dt);
  stepPolice(S, dt);
  stepWanted(S, dt);
  stepMissions(S, dt);
  checkPedCollisions(S);
  // Ammo pickups: a pistol box spawns near the safehouse when low.
  if (p.ammo < 6 && !S.pickups.find((k) => k.kind === 'ammo')) {
    S.pickups.push({ kind: 'ammo', x: 700, y: 660 });
  }
  for (let i = S.pickups.length - 1; i >= 0; i--) {
    const k = S.pickups[i];
    if (Math.hypot(p.x - k.x, p.y - k.y) < 30) {
      if (k.kind === 'ammo') {
        p.ammo += 24;
        p.reserve += 48;
        pushFeed(S, 'Picked up pistol ammo (+24).', 'good');
        S.audio.chime();
      }
      S.pickups.splice(i, 1);
    }
  }
  // Particles fade.
  for (let i = S.particles.length - 1; i >= 0; i--) {
    S.particles[i].life -= dt;
    if (S.particles[i].life <= 0) S.particles.splice(i, 1);
  }
  // Mission marker for HUD/minimap.
  S.missionTarget = objectiveTarget(S);
  // Busted / wasted transitions are set by their systems; show the screens.
  if (S.mode === 'busted' || S.mode === 'wasted') {
    showEnd(hud, S.mode, S);
    saveGame(S);
    S.mode = 'over';
  }
  if (S.mode === 'missionComplete') {
    showMissionComplete(hud, S.missionResult, S);
    saveGame(S);
    S.mode = 'over';
  }
  updateCamera();
}

/** Draw the world, entities, markers and particles for this frame. */
function draw() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.translate(-Math.round(S.camera.x), -Math.round(S.camera.y));
  drawCity(ctx, S.city, S.camera, VIEW_W, VIEW_H, S.night);
  // Spray shop marker.
  const shop = S.city.sprayShop;
  ctx.fillStyle = '#ff9a3d';
  ctx.fillRect(shop.x - 26, shop.y - 26, 52, 52);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SPRAY', shop.x, shop.y - 2);
  ctx.fillText('SHOP', shop.x, shop.y + 11);
  // Safehouse marker.
  const sh = S.city.safehouse;
  ctx.fillStyle = '#37d67a';
  ctx.beginPath(); ctx.arc(sh.x, sh.y, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Trebuchet MS, sans-serif';
  ctx.fillText('H', sh.x, sh.y + 4);
  // Mission objective marker: pulsing ring + beacon.
  const target = S.missionTarget;
  if (target) {
    const pulse = 1 + Math.sin(S.time * 4) * 0.15;
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(target.x, target.y, target.r * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,210,62,.25)';
    ctx.beginPath(); ctx.arc(target.x, target.y, target.r * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(target.x, target.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a5200';
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.fillText('▼', target.x, target.y - target.r - 8);
  }
  // Ammo pickups.
  for (const k of S.pickups) {
    ctx.fillStyle = '#37d67a';
    ctx.fillRect(k.x - 12, k.y - 12, 24, 24);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Trebuchet MS, sans-serif';
    ctx.fillText('AMMO', k.x, k.y + 4);
  }
  // Cars, peds and cops sorted roughly by Y for a top-down feel.
  const drawables = [];
  for (const car of S.cars) drawables.push({ y: car.y, fn: () => drawCar(ctx, car, S.time) });
  for (const ped of S.peds) drawables.push({ y: ped.y, fn: () => drawPed(ctx, ped, S.time) });
  for (const cop of S.cops) drawables.push({ y: cop.y, fn: () => drawCop(ctx, cop, S.time) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.fn();
  // Player on foot draws above cars when overlapping.
  if (S.player.onFoot) drawPlayer(ctx, S.player, S.time);
  // Bullets.
  ctx.strokeStyle = '#fff2a0';
  ctx.lineWidth = 3;
  for (const b of S.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Particles.
  for (const pt of S.particles) {
    const a = Math.max(0, pt.life / pt.max);
    if (pt.kind === 'muzzle') {
      ctx.fillStyle = `rgba(255,220,90,${a})`;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * a, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255,180,60,${a})`;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
  }
  // Off-screen mission direction arrow at the viewport edge.
  if (target) {
    const vx = target.x - S.camera.x;
    const vy = target.y - S.camera.y;
    if (vx < 40 || vx > VIEW_W - 40 || vy < 40 || vy > VIEW_H - 40) {
      const cx = Math.max(50, Math.min(VIEW_W - 50, vx));
      const cy = Math.max(50, Math.min(VIEW_H - 50, vy));
      const ang = Math.atan2(vy - cy, vx - cx);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-4, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffd23e';
      ctx.font = 'bold 13px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(Math.hypot(target.x - S.player.x, target.y - S.player.y) / 40)}m`, cx, cy + 26);
    }
  }
  ctx.restore();
  // Vignette + hurt flash.
  if (S.player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(255,40,30,${S.player.hurtFlash * 0.9})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (S.night) {
    ctx.fillStyle = 'rgba(20,16,70,.14)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/** Keyboard + mouse input. */
function bindInput() {
  const keymap = { w: 'w', a: 'a', s: 's', d: 'd', shift: 'shift', ' ': 'space', e: 'e', f: 'f', j: 'j', p: 'p', m: 'm' };
  window.addEventListener('keydown', (ev) => {
    const k = keymap[ev.key.toLowerCase()];
    if (k) S.input.keys[k] = true;
    if (ev.key === ' ') ev.preventDefault();
    if (ev.repeat) return;
    S.audio.ensure();
    if (k === 'm') {
      const muted = S.audio.toggleMute();
      pushFeed(S, muted ? 'Sound muted.' : 'Sound on.', '');
    }
    if (k === 'p' && (S.mode === 'play' || S.mode === 'paused')) togglePause();
    if (k === 'e' && S.mode === 'play') {
      if (S.player.onFoot) tryEnterCar(S, false);
      else exitCar(S);
    }
    if (k === 'f' && S.mode === 'play' && S.player.onFoot) tryEnterCar(S, true);
    if (k === 'j' && S.mode === 'play' && !S.mission.active) {
      const idx = MISSIONS.findIndex((m, i) => !S.mission.completed.includes(m.id) && S.rep >= m.rep);
      if (idx >= 0) startMission(S, idx);
      else pushFeed(S, 'No job unlocked yet — earn REP by finishing jobs and cooling heat.', '');
    }
  });
  window.addEventListener('keyup', (ev) => {
    const k = keymap[ev.key.toLowerCase()];
    if (k) S.input.keys[k] = false;
  });
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    S.input.mouse.x = (ev.clientX - rect.left) * (VIEW_W / rect.width);
    S.input.mouse.y = (ev.clientY - rect.top) * (VIEW_H / rect.height);
  });
  canvas.addEventListener('mousedown', (ev) => {
    S.audio.ensure();
    if (ev.button === 0) S.input.mouseDown = true;
  });
  window.addEventListener('mouseup', () => { S.input.mouseDown = false; });
  document.getElementById('btnStart').addEventListener('click', () => startNewGame());
  document.getElementById('btnContinue').addEventListener('click', () => startNewGame(true));
  document.getElementById('btnHow').addEventListener('click', () => {
    document.getElementById('howto').classList.toggle('hidden');
  });
  document.getElementById('btnResume').addEventListener('click', () => togglePause());
  document.getElementById('btnSaveQuit').addEventListener('click', () => {
    saveGame(S);
    S.mode = 'menu';
    showMenu(hud, S, loadSave());
    announce('Saved. Main menu.');
  });
  document.getElementById('btnRetry').addEventListener('click', () => {
    hideEndScreens(hud);
    respawn(S);
    S.mode = 'play';
    announce('Back on the streets.');
  });
  document.getElementById('btnEndMenu').addEventListener('click', () => {
    S.mode = 'menu';
    showMenu(hud, S, loadSave());
  });
  document.getElementById('btnNext').addEventListener('click', () => {
    hideEndScreens(hud);
    S.mode = 'play';
    maybeAutoStart(S);
  });
  document.getElementById('btnFreeRoam').addEventListener('click', () => {
    hideEndScreens(hud);
    S.mode = 'play';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.mode === 'play') togglePause();
  });
}

function togglePause() {
  if (S.mode === 'play') {
    S.mode = 'paused';
    showPause(hud, true);
    announce('Paused.');
  } else if (S.mode === 'paused') {
    S.mode = 'play';
    showPause(hud, false);
    announce('Playing.');
  }
}

function respawn(S) {
  const p = S.player;
  p.health = 100;
  p.onFoot = true;
  p.carId = 0;
  p.x = S.city.safehouse.x;
  p.y = S.city.safehouse.y;
  p.ammo = Math.max(p.ammo, 24);
  S.police.wanted = 0;
  S.cops = [];
  for (const car of S.cars) if (car.driver === 'police') { car.driver = 'parked'; car.speed = 0; }
  S.mission.active = false;
  S.mission.timer = 0;
  S.mission.clock = 0;
  S.night = false;
  pushFeed(S, 'Mara is back at the Safehouse. The jobs are still open.', 'good');
}

function startNewGame(continueSave) {
  S.audio.ensure();
  if (continueSave) {
    const data = loadSave();
    if (data) applySave(S, data);
  } else {
    S.cash = 200;
    S.rep = 0;
    S.mission = makeMissionState();
    S.stats = { carsStolen: 0, missionsDone: 0, pedsDown: 0, copsDown: 0, punches: 0 };
    S.player = makePlayer(700, 660);
  }
  S.player.health = 100;
  S.police = makePoliceState();
  S.cops = [];
  S.bullets = [];
  S.particles = [];
  S.feed = [];
  S.night = false;
  hideMenu(hud);
  hideEndScreens(hud);
  S.mode = 'play';
  pushFeed(S, 'RADIO PBPD: quiet night on the bay… for now.', 'police');
  pushFeed(S, 'Mara Voss is back in Palmera Bay. Press J to start your first job.', 'good');
  maybeAutoStart(S);
  announce('Playing Palmera Bay.');
}

/** --- Shot staging: live scenes for the four screenshots. --- */

/** Autopilot: pure pursuit along a path of intersections. The car steers for a
 * point on the path a short way ahead of it, so turns flow through intersections
 * instead of cutting corners into buildings. */
function nearestIntersection(x, y) {
  const vx = V_ROADS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const hy = H_ROADS.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  return { x: vx, y: hy, vi: V_ROADS.indexOf(vx), hi: H_ROADS.indexOf(hy) };
}

function adjacentIntersection(pt, dx, dy) {
  const vi = pt.vi + dx;
  const hi = pt.hi + dy;
  if (vi < 0 || vi >= V_ROADS.length || hi < 0 || hi >= H_ROADS.length) return null;
  return { x: V_ROADS[vi], y: H_ROADS[hi], vi, hi };
}

function pickNextWaypoint(S, last, prev) {
  // Prefer continuing straight along the path's last segment.
  const dx = prev ? Math.sign(last.x - prev.x) : 0;
  const dy = prev ? Math.sign(last.y - prev.y) : 0;
  const options = [];
  if (dx !== 0 || dy !== 0) {
    const straight = adjacentIntersection(last, dx, dy);
    if (straight) options.push(straight, straight);
  }
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cand = adjacentIntersection(last, ox, oy);
    if (cand) options.push(cand);
  }
  // Stay off the map's edge intersections: the camera clamps there and the
  // car ends up hidden behind the HUD. Only use an edge when nothing else fits.
  const interior = options.filter((o) => o.vi > 0 && o.vi < V_ROADS.length - 1 && o.hi > 0 && o.hi < H_ROADS.length - 1);
  const pool = interior.length > 0 ? interior : options;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** A point `dist` px ahead along the autopilot's path from the car's projection. */
function lookaheadAlongPath(S, car, dist) {
  const a = S.autoPath[0];
  const b = S.autoPath[1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let t = ((car.x - a.x) * (b.x - a.x) + (car.y - a.y) * (b.y - a.y)) / (segLen * segLen);
  t = Math.max(0, Math.min(1, t));
  const px = a.x + (b.x - a.x) * t;
  const py = a.y + (b.y - a.y) * t;
  let remaining = dist;
  let lx = px;
  let ly = py;
  for (let i = 0; i < S.autoPath.length - 1 && remaining > 0; i++) {
    const p0 = i === 0 ? { x: px, y: py } : S.autoPath[i];
    const p1 = S.autoPath[i + 1];
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (d >= remaining) {
      lx = p0.x + ((p1.x - p0.x) / d) * remaining;
      ly = p0.y + ((p1.y - p0.y) / d) * remaining;
      remaining = 0;
    } else {
      remaining -= d;
      lx = p1.x; ly = p1.y;
    }
  }
  return { x: lx, y: ly };
}

function autopilotDrive(S, dt) {
  const p = S.player;
  const car = S.cars.find((c) => c.id === p.carId);
  if (!car) return;
  const inp = S.input.keys;
  if (Math.abs(car.speed) < 25) S.stuckTime = (S.stuckTime || 0) + dt;
  else S.stuckTime = 0;
  if ((S.stuckTime || 0) > 0.8) {
    inp.w = false; inp.s = true; inp.a = true; inp.d = false; inp.space = false;
    if (S.stuckTime > 2.2) S.stuckTime = 0;
    return;
  }
  // Keep a 3-point path of intersections ahead of the car.
  if (!S.autoPath || S.autoPath.length < 3) {
    const start = nearestIntersection(car.x, car.y);
    S.autoPath = [start];
    // First step: continue in the car's current heading, so a staged start
    // never has to turn on the spot at full speed.
    const hx = Math.abs(Math.cos(car.angle)) > 0.7 ? Math.sign(Math.cos(car.angle)) : 0;
    const hy = Math.abs(Math.sin(car.angle)) > 0.7 ? Math.sign(Math.sin(car.angle)) : 0;
    const first = (hx !== 0 || hy !== 0) ? adjacentIntersection(start, hx, hy) : null;
    S.autoPath.push(first || pickNextWaypoint(S, start, null));
    while (S.autoPath.length < 3) {
      const last = S.autoPath[S.autoPath.length - 1];
      const prev = S.autoPath.length > 1 ? S.autoPath[S.autoPath.length - 2] : null;
      S.autoPath.push(pickNextWaypoint(S, last, prev));
    }
  }
  // Advance past waypoints the car has nearly reached.
  while (S.autoPath.length > 2) {
    const a = S.autoPath[0];
    const b = S.autoPath[1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = ((car.x - a.x) * (b.x - a.x) + (car.y - a.y) * (b.y - a.y)) / (segLen * segLen);
    if (t > 0.85 || Math.hypot(car.x - a.x, car.y - a.y) < 40) {
      S.autoPath.shift();
      const last = S.autoPath[S.autoPath.length - 1];
      const prev = S.autoPath[S.autoPath.length - 2];
      S.autoPath.push(pickNextWaypoint(S, last, prev));
    } else break;
  }
  // Pure pursuit: a point 70 px ahead along the path from the car's projection.
  // Off the road (shoved into a block), aim straight back at the nearest road.
  let lx;
  let ly;
  if (!isOnRoad(car.x, car.y)) {
    const road = nearestRoadPoint(car.x, car.y);
    lx = road.x;
    ly = road.y;
  } else {
    const look = lookaheadAlongPath(S, car, 70);
    lx = look.x;
    ly = look.y;
  }
  const want = Math.atan2(ly - car.y, lx - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  inp.w = Math.abs(diff) < 0.5 || Math.abs(car.speed) < 80;
  inp.s = false;
  inp.a = diff < -0.08;
  inp.d = diff > 0.08;
  // Brake into a sharp turn, but never below a crawl — a stopped car cannot turn.
  inp.space = Math.abs(diff) > 0.5 && Math.abs(car.speed) > 80;
  // Slow down well before a bend in the path, not at the corner itself.
  const corner = S.autoPath[1];
  const after = S.autoPath[2];
  if (corner && after) {
    const seg1x = corner.x - S.autoPath[0].x;
    const seg1y = corner.y - S.autoPath[0].y;
    const seg2x = after.x - corner.x;
    const seg2y = after.y - corner.y;
    const bends = seg1x * seg2x + seg1y * seg2y <= 0;
    const distToCorner = Math.hypot(corner.x - car.x, corner.y - car.y);
    if (bends && distToCorner < 320 && Math.abs(car.speed) > 150) {
      inp.w = false;
      inp.space = true;
    }
  }
}

function autopilotWalk(S, dt) {
  const target = S.missionTarget;
  if (!target) return;
  const p = S.player;
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  S.input.keys.w = dy < -20;
  S.input.keys.s = dy > 20;
  S.input.keys.a = dx < -20;
  S.input.keys.d = dx > 20;
  S.input.mouse.x = VIEW_W / 2 + dx * 0.4;
  S.input.mouse.y = VIEW_H / 2 + dy * 0.4;
}

function stageShot(name) {
  S.mode = 'play';
  hideMenu(hud);
  S.cash = 1240;
  S.rep = 60;
  if (name === 'chase') {
    // Mara in a Neon GT, three PBPD interceptors behind, 3 stars, M3 active.
    const car = makeCar(1500, 1400, 0, CAR_MODELS[5], 'player');
    S.cars.push(car);
    S.player.onFoot = false;
    S.player.carId = car.id;
    car.speed = 380;
    S.player.x = car.x; S.player.y = car.y;
    S.police.wanted = 3;
    for (let i = 0; i < 3; i++) {
      const pc = makeCar(1500 - 90 - i * 70, 1400 + (i - 1) * 44, 0, POLICE_MODEL, 'police');
      pc.speed = 330;
      S.cars.push(pc);
    }
    S.mission.index = 2;
    startMission(S, 2);
    S.mission.timer = 12;
    S.autopilot = autopilotDrive;
    pushFeed(S, 'PBPD: suspect fleeing east on Strip Blvd — all units respond!', 'police');
    pushFeed(S, 'M3 — Heat Wave: survive the chase, then lose them.', 'good');
    pushFeed(S, 'Traffic cam: Neon GT doing 90 past the Strip.', 'police');
    S.camera.x = car.x - VIEW_W / 2;
    S.camera.y = car.y - VIEW_H / 2;
  } else if (name === 'drive') {
    // Cruising the Neon Strip in traffic, M1 objective on the map.
    const car = makeCar(1500, 1400, Math.PI / 2, CAR_MODELS[1], 'player');
    S.cars.push(car);
    S.player.onFoot = false;
    S.player.carId = car.id;
    car.speed = 260;
    S.player.x = car.x; S.player.y = car.y;
    S.mission.index = 0;
    startMission(S, 0);
    S.mission.step = 2;
    S.autopilot = autopilotDrive;
    pushFeed(S, 'RADIO: traffic building on the Strip — drive careful.', 'police');
    pushFeed(S, 'M1 — First Wheels: deliver the Sunset Coupe to the Safehouse.', 'good');
    S.camera.x = car.x - VIEW_W / 2;
    S.camera.y = car.y - VIEW_H / 2;
  } else if (name === 'mission') {
    // On foot at the Neon Strip package, pistol out, M2 active, peds fleeing.
    // Mara starts a street away so the frame catches her mid-approach.
    S.player.x = 1330;
    S.player.y = 1560;
    S.player.ammo = 18;
    S.mission.index = 1;
    startMission(S, 1);
    S.autopilot = autopilotWalk;
    for (const ped of S.peds) {
      if (Math.hypot(ped.x - S.player.x, ped.y - S.player.y) < 260) {
        ped.fleeing = true;
        ped.fleeX = (ped.x - S.player.x) / 260;
        ped.fleeY = (ped.y - S.player.y) / 260;
      }
    }
    S.bullets.push({ x: S.player.x + 40, y: S.player.y - 10, vx: 800, vy: -160, life: 0.4, from: 'player', damage: 0 });
    pushFeed(S, 'RADIO PBPD: shots reported near the Neon Strip.', 'police');
    pushFeed(S, 'A bystander is running for cover!', 'bad');
    S.camera.x = S.player.x - VIEW_W / 2;
    S.camera.y = S.player.y - VIEW_H / 2;
  } else if (name === 'city') {
    // Mission complete: M4 done at dusk by the Docks, completion screen over the city.
    S.night = true;
    S.player.x = 2620;
    S.player.y = 2020;
    S.cash = 2140;
    S.rep = 85;
    S.mission.completed = ['m1', 'm2', 'm3', 'm4'];
    S.mission.index = 4;
    S.mission.active = false;
    S.missionResult = { title: 'M4 — Harbor Lights', cash: 600, rep: 25 };
    S.mode = 'missionComplete';
    showMissionComplete(hud, S.missionResult, S);
    S.mode = 'over';
    S.camera.x = S.player.x - VIEW_W / 2;
    S.camera.y = S.player.y - VIEW_H / 2;
    pushFeed(S, 'M4 — Harbor Lights complete! +$600, +25 REP.', 'good');
    pushFeed(S, 'Next job unlocked at REP 85: M5 — The Vault Run.', 'good');
  }
  S.missionTarget = objectiveTarget(S);
  // Run the live simulation forward so the frame is mid-action, not posed.
  // The mission scene warms up only briefly: Mara must still be approaching.
  const warmup = name === 'city' ? 40 : name === 'mission' ? 45 : 150;
  for (let i = 0; i < warmup; i++) {
    if (S.autopilot) S.autopilot(S, STEP);
    if (S.mode === 'play') step(STEP);
    else updateCamera();
  }
  // A fresh tracer for the mission frame, fired after the warmup.
  if (name === 'mission') {
    S.bullets.push({ x: S.player.x + 40, y: S.player.y - 10, vx: 800, vy: -160, life: 0.4, from: 'player', damage: 0 });
    S.particles.push({ kind: 'muzzle', x: S.player.x + 22, y: S.player.y - 6, life: 0.08, max: 0.08, size: 14 });
  }
  draw();
  renderHud(hud, S);
  window.__shotReady = true;
}

/** --- Main loop. --- */
function runGame() {
  bindInput();
  showMenu(hud, S, loadSave());
  let accumulator = 0;
  let last = performance.now();
  let hudTick = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (S.mode === 'play') {
      if (S.autopilot) S.autopilot(S, STEP);
      while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
        if (S.mode !== 'play') break;
      }
    } else {
      accumulator = 0;
    }
    draw();
    hudTick += 1;
    if (hudTick % 3 === 0 && S.mode !== 'menu') renderHud(hud, S);
    // Debug hook for the soak test: live state, readable headlessly.
    window.__palmera = {
      mode: S.mode, time: S.time, cash: S.cash, rep: S.rep,
      wanted: S.police.wanted, health: S.player.health,
      cars: S.cars.length, pedsAlive: S.peds.filter((p) => p.alive).length,
      mission: currentMission(S) ? currentMission(S).id : null,
      missionActive: S.mission.active, missionStep: S.mission.step,
      completed: S.mission.completed.slice(),
    };
  }
  requestAnimationFrame(frame);
}

if (shot) {
  bindInput();
  stageShot(shot);
  // Keep the staged scene alive and moving after the warmup.
  let last = performance.now();
  let accumulator = 0;
  function shotFrame(now) {
    requestAnimationFrame(shotFrame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (S.mode === 'play') {
      if (S.autopilot) S.autopilot(S, STEP);
      while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
        if (S.mode !== 'play') break;
      }
      draw();
      renderHud(hud, S);
    }
    window.__palmera = {
      mode: S.mode, time: S.time, cash: S.cash, rep: S.rep,
      wanted: S.police.wanted, health: S.player.health,
      cars: S.cars.length, pedsAlive: S.peds.filter((p) => p.alive).length,
      mission: currentMission(S) ? currentMission(S).id : null,
      missionActive: S.mission.active, missionStep: S.mission.step,
      completed: S.mission.completed.slice(),
    };
  }
  requestAnimationFrame(shotFrame);
} else {
  runGame();
}
