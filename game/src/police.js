// police.js — the Palmera Bay Police Department: wanted stars, heat decay,
// police car and foot-cop chases, ramming, busts, and the spray shop.
import { makeCar, stepCarPhysics, POLICE_MODEL, drawCar } from './vehicles.js';
import { nearestRoadPoint } from './city.js';
import { hurtPlayer } from './player.js';

export const MAX_WANTED = 5;
const HEAT_COOL_SECONDS = 9;

export function makePoliceState() {
  return {
    wanted: 0, heatTimer: 0, bustTimer: 0, sirenTimer: 0,
    spawnTimer: 0, sprayCooldown: 0,
  };
}

/** Raise the wanted level and log the crime. */
export function addWanted(S, stars, reason) {
  const pol = S.police;
  const before = pol.wanted;
  pol.wanted = Math.min(MAX_WANTED, pol.wanted + stars);
  pol.heatTimer = 0;
  if (pol.wanted > before) {
    S.feed.push({ text: `WANTED ${'★'.repeat(pol.wanted)} — ${reason}`, kind: 'police' });
    S.audio.sirenBurst();
    if (pol.wanted >= 3) S.feed.push({ text: 'PBPD dispatch: all units, suspect is dangerous. Pursue.', kind: 'police' });
  }
}

/** Heat cools when no police can see the player; spray shop clears it for cash. */
export function stepWanted(S, dt) {
  const pol = S.police;
  const p = S.player;
  if (pol.wanted === 0) return;
  const nearCop = S.cops.some((c) => c.health > 0 && Math.hypot(c.x - p.x, c.y - p.y) < 420)
    || S.cars.some((c) => c.driver === 'police' && Math.hypot(c.x - p.x, c.y - p.y) < 460);
  if (nearCop) {
    pol.heatTimer = 0;
  } else {
    pol.heatTimer += dt;
    if (pol.heatTimer >= HEAT_COOL_SECONDS) {
      pol.wanted -= 1;
      pol.heatTimer = 0;
      S.feed.push({ text: `Heat cooling down… wanted now ${'★'.repeat(pol.wanted) || 'clear'}.`, kind: 'good' });
      S.rep = Math.min(999, S.rep + 2);
    }
  }
  // Spray shop: drive in and pay to wipe the heat.
  pol.sprayCooldown = Math.max(0, pol.sprayCooldown - dt);
  if (pol.wanted > 0 && pol.sprayCooldown <= 0) {
    const shop = S.city.sprayShop;
    if (Math.hypot(p.x - shop.x, p.y - shop.y) < 90) {
      const price = 40 * pol.wanted;
      if (S.cash >= price) {
        S.cash -= price;
        pol.wanted = 0;
        pol.sprayCooldown = 20;
        S.feed.push({ text: `Spray shop: fresh paint, clean plates. Heat cleared for $${price}.`, kind: 'good' });
        S.audio.chime();
      } else {
        S.feed.push({ text: `Spray shop wants $${price} — you can't afford it yet.`, kind: 'bad' });
        pol.sprayCooldown = 5;
      }
    }
  }
}

/** Keep the right number of police units hunting the player. */
export function stepPolice(S, dt) {
  const pol = S.police;
  const p = S.player;
  const wantCars = pol.wanted >= 4 ? 3 : pol.wanted >= 2 ? 2 : pol.wanted >= 1 ? 1 : 0;
  const wantCops = p.onFoot ? (pol.wanted >= 2 ? 2 : pol.wanted >= 1 ? 1 : 0) : 0;
  pol.spawnTimer -= dt;
  const policeCars = S.cars.filter((c) => c.driver === 'police');
  if (pol.wanted > 0 && pol.spawnTimer <= 0) {
    if (policeCars.length < wantCars) spawnPoliceCar(S);
    if (S.cops.filter((c) => c.health > 0).length < wantCops) spawnFootCop(S);
    pol.spawnTimer = 1.2;
  }
  // Police cars that lost the trail far away despawn.
  for (let i = S.cars.length - 1; i >= 0; i--) {
    const car = S.cars[i];
    if (car.driver !== 'police') continue;
    if (pol.wanted === 0 || Math.hypot(car.x - p.x, car.y - p.y) > 1600) {
      car.driver = 'parked';
      car.speed = 0;
    }
  }
  for (const car of policeCars) chaseWithCar(S, car, dt);
  for (const cop of S.cops) chaseOnFoot(S, cop, dt);
  stepBust(S, dt);
  // Siren ambience while wanted.
  if (pol.wanted > 0) {
    pol.sirenTimer -= dt;
    if (pol.sirenTimer <= 0) { S.audio.sirenLoop(); pol.sirenTimer = 2.4; }
  }
}

function spawnPoliceCar(S) {
  const p = S.player;
  const angle = Math.random() * Math.PI * 2;
  const spot = nearestRoadPoint(p.x + Math.cos(angle) * 520, p.y + Math.sin(angle) * 520);
  const car = makeCar(spot.x, spot.y, Math.atan2(p.y - spot.y, p.x - spot.x), POLICE_MODEL, 'police');
  car.speed = 220;
  S.cars.push(car);
  S.feed.push({ text: 'PBPD unit responding — sirens on the Strip.', kind: 'police' });
}

function spawnFootCop(S) {
  const p = S.player;
  const angle = Math.random() * Math.PI * 2;
  S.cops.push({
    x: p.x + Math.cos(angle) * 320, y: p.y + Math.sin(angle) * 320,
    angle: 0, speed: 0, health: 100, shootCooldown: 1 + Math.random(),
    bustHold: 0,
  });
}

/** A police car steers at the player and rams; it brakes hard to block. */
function chaseWithCar(S, car, dt) {
  const p = S.player;
  const tx = p.onFoot ? p.x : p.x;
  const ty = p.onFoot ? p.y : p.y;
  const want = Math.atan2(ty - car.y, tx - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const dist = Math.hypot(tx - car.x, ty - car.y);
  const steer = Math.max(-1, Math.min(1, diff * 2.2));
  // Tail the player rather than pinning them against a wall.
  const throttle = dist > 120 ? 1 : dist > 60 ? 0.4 : 0.15;
  const brake = dist < 70 ? 0.7 : 0;
  stepCarPhysics(car, { throttle, steer, brake }, dt, S.city, (c, imp) => {
    S.particles.push({ kind: 'spark', x: c.x, y: c.y, life: 0.2, max: 0.2, size: 8 });
  });
  // Ram damage when the interceptor hits the player's car or the player.
  const playerCar = !p.onFoot ? S.cars.find((c) => c.id === p.carId) : null;
  car.ramCooldown = Math.max(0, (car.ramCooldown || 0) - dt);
  if (playerCar) {
    const d = Math.hypot(car.x - playerCar.x, car.y - playerCar.y);
    if (d < 46 && Math.abs(car.speed) > 80 && car.ramCooldown <= 0) {
      playerCar.damage += 3;
      car.damage += 2;
      car.ramCooldown = 0.6;
      S.audio.crash();
    }
  } else if (p.onFoot) {
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < 30 && Math.abs(car.speed) > 60) hurtPlayer(S, 22);
  }
}

/** A foot cop runs at the player and shoots when close. */
function chaseOnFoot(S, cop, dt) {
  if (cop.health <= 0) return;
  const p = S.player;
  const dx = p.x - cop.x;
  const dy = p.y - cop.y;
  const d = Math.hypot(dx, dy);
  const speed = 215;
  cop.x += (dx / (d || 1)) * speed * dt;
  cop.y += (dy / (d || 1)) * speed * dt;
  cop.angle = Math.atan2(dy, dx);
  cop.shootCooldown -= dt;
  if (d < 320 && d > 60 && cop.shootCooldown <= 0) {
    cop.shootCooldown = 1.1 + Math.random() * 0.6;
    const spread = (Math.random() - 0.5) * 0.14;
    S.bullets.push({
      x: cop.x + Math.cos(cop.angle) * 16, y: cop.y + Math.sin(cop.angle) * 16,
      vx: Math.cos(cop.angle + spread) * 820, vy: Math.sin(cop.angle + spread) * 820,
      life: 0.7, from: 'cop', damage: 9,
    });
    S.audio.enemyShot();
  }
  if (d < 40 && p.onFoot) {
    cop.bustHold += dt;
  } else {
    cop.bustHold = 0;
  }
}

/** Held still by a cop for two seconds: busted. A moving car is never busted. */
function stepBust(S, dt) {
  const pol = S.police;
  const p = S.player;
  const held = S.cops.some((c) => c.health > 0 && c.bustHold > 1.6);
  let playerSpeed = p.speed;
  if (!p.onFoot) {
    const car = S.cars.find((c) => c.id === p.carId);
    playerSpeed = car ? Math.abs(car.speed) : 0;
  }
  const cornered = !p.onFoot && playerSpeed < 30 && S.cars.some((c) => c.driver === 'police' && c.id !== p.carId && Math.hypot(c.x - p.x, c.y - p.y) < 52);
  if (held || (cornered && pol.wanted > 0 && p.health > 0)) {
    pol.bustTimer += dt;
    if (pol.bustTimer > 2.5) {
      S.mode = 'busted';
      S.audio.busted();
    }
  } else {
    pol.bustTimer = Math.max(0, pol.bustTimer - dt * 2);
  }
}

/** Draw foot cops: navy uniforms with a badge dot. */
export function drawCop(ctx, cop, time) {
  if (cop.health <= 0) return;
  ctx.save();
  ctx.translate(cop.x, cop.y);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(2, 4, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(cop.angle);
  ctx.fillStyle = '#1c3a6e';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath(); ctx.arc(8, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath(); ctx.arc(4, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#16283f';
  ctx.fillRect(8, -2, 12, 4);
  ctx.restore();
}

export { drawCar };
