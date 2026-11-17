// player.js — Mara Voss on foot: movement, aiming, pistol and punch combat,
// entering and exiting cars, and getting hurt.
import { hitsObstacle, resolveCollision, WORLD_W, WORLD_H } from './city.js';
import { carHitTest, damageCar } from './vehicles.js';

export const WALK_SPEED = 185;
export const SPRINT_SPEED = 285;
export const PLAYER_RADIUS = 13;

export function makePlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2, health: 100, onFoot: true, carId: 0,
    weapon: 'pistol', ammo: 24, reserve: 96, sprint: false,
    shootCooldown: 0, punchCooldown: 0, hurtFlash: 0, speed: 0,
  };
}

/** Move on foot from WASD input; returns nothing, mutates player. */
export function stepPlayerOnFoot(S, dt) {
  const p = S.player;
  const inp = S.input;
  let mx = (inp.keys.d ? 1 : 0) - (inp.keys.a ? 1 : 0);
  let my = (inp.keys.s ? 1 : 0) - (inp.keys.w ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }
  p.sprint = !!inp.keys.shift && len > 0;
  const speed = p.sprint ? SPRINT_SPEED : WALK_SPEED;
  p.speed = len > 0 ? speed : 0;
  const nx = p.x + mx * speed * dt;
  const ny = p.y + my * speed * dt;
  const fixed = resolveCollision(S.city, nx, ny, PLAYER_RADIUS, p.x, p.y);
  p.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_W - PLAYER_RADIUS, fixed.x));
  p.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_H - PLAYER_RADIUS, fixed.y));
  // Aim at the mouse in world space.
  const wx = S.camera.x + inp.mouse.x;
  const wy = S.camera.y + inp.mouse.y;
  p.angle = Math.atan2(wy - p.y, wx - p.x);
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  if (inp.mouseDown && p.shootCooldown <= 0) fireWeapon(S);
}

/** Fire the pistol toward the aim, or punch when out of ammo and close in. */
export function fireWeapon(S) {
  const p = S.player;
  if (p.ammo > 0) {
    p.ammo -= 1;
    p.shootCooldown = 0.22;
    const spread = (Math.random() - 0.5) * 0.06;
    S.bullets.push({
      x: p.x + Math.cos(p.angle) * 18, y: p.y + Math.sin(p.angle) * 18,
      vx: Math.cos(p.angle + spread) * 900, vy: Math.sin(p.angle + spread) * 900,
      life: 0.6, from: 'player', damage: 34,
    });
    S.audio.shot();
    addMuzzle(S, p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20);
  } else if (p.punchCooldown <= 0) {
    p.punchCooldown = 0.45;
    const reach = 34;
    const px = p.x + Math.cos(p.angle) * reach;
    const py = p.y + Math.sin(p.angle) * reach;
    let hitSomething = false;
    for (const ped of S.peds) {
      if (!ped.alive || ped.fleeing) continue;
      if (Math.hypot(ped.x - px, ped.y - py) < 26) { knockPed(S, ped, p.angle); hitSomething = true; }
    }
    for (const cop of S.cops) {
      if (Math.hypot(cop.x - px, cop.y - py) < 26) { cop.health -= 40; hitSomething = true; }
    }
    if (hitSomething) S.audio.punch();
  }
}

function addMuzzle(S, x, y) {
  S.particles.push({ kind: 'muzzle', x, y, life: 0.08, max: 0.08, size: 14 });
}

function knockPed(S, ped, angle) {
  ped.fleeing = true;
  ped.fleeX = Math.cos(angle);
  ped.fleeY = Math.sin(angle);
  ped.health -= 50;
  if (ped.health <= 0) ped.alive = false;
  S.stats.punches = (S.stats.punches || 0) + 1;
}

/** Bullets fly, hit cars, peds, cops and buildings. */
export function stepBullets(S, dt) {
  for (let i = S.bullets.length - 1; i >= 0; i--) {
    const b = S.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) {
      // Buildings stop bullets.
      if (hitsObstacle(S.city, b.x, b.y, 1)) dead = true;
    }
    if (!dead && b.from === 'player') {
      for (const ped of S.peds) {
        if (ped.alive && Math.hypot(ped.x - b.x, ped.y - b.y) < 14) {
          ped.health -= b.damage;
          ped.fleeing = true;
          ped.fleeX = Math.sign(b.vx); ped.fleeY = Math.sign(b.vy);
          if (ped.health <= 0) { ped.alive = false; onPedDown(S, ped); }
          dead = true; break;
        }
      }
      if (!dead) for (const cop of S.cops) {
        if (cop.health > 0 && Math.hypot(cop.x - b.x, cop.y - b.y) < 14) {
          cop.health -= b.damage;
          if (cop.health <= 0) { S.stats.copsDown = (S.stats.copsDown || 0) + 1; S.police.addWanted(S, 1, 'Cop down'); }
          dead = true; break;
        }
      }
      if (!dead) for (const car of S.cars) {
        if (car.driver !== 'player' && carHitTest(car, b.x, b.y, 2)) {
          damageCar(car, 6, (c, imp) => onCarShot(S, c, imp));
          dead = true; break;
        }
      }
    }
    if (!dead && b.from === 'cop') {
      const p = S.player;
      if (p.onFoot && Math.hypot(p.x - b.x, p.y - b.y) < 14) {
        hurtPlayer(S, 9);
        dead = true;
      } else if (!p.onFoot) {
        const car = S.cars.find((c) => c.id === p.carId);
        if (car && carHitTest(car, b.x, b.y, 2)) { damageCar(car, 2); dead = true; }
      }
    }
    if (dead) {
      S.particles.push({ kind: 'spark', x: b.x, y: b.y, life: 0.15, max: 0.15, size: 6 });
      S.bullets.splice(i, 1);
    }
  }
}

function onPedDown(S, ped) {
  S.police.addWanted(S, 1, 'Pedestrian down');
  S.feed.push({ text: 'A pedestrian went down — witnesses called it in.', kind: 'bad' });
  S.stats.pedsDown = (S.stats.pedsDown || 0) + 1;
}

function onCarShot(S, car, impact) {
  if (car.driver === 'traffic' || car.driver === 'parked') {
    S.police.addWanted(S, 1, 'Shots fired at traffic');
  }
}

/** Damage the player; returns true when wasted. */
export function hurtPlayer(S, amount) {
  const p = S.player;
  if (p.health <= 0) return true;
  p.health = Math.max(0, p.health - amount);
  p.hurtFlash = 0.25;
  if (p.health <= 0) {
    S.mode = 'wasted';
    S.audio.wasted();
  }
  return p.health <= 0;
}

/** Find the nearest car the player could enter or steal. */
export function nearestCar(S, maxDist) {
  const p = S.player;
  let best = null;
  let bestD = maxDist;
  for (const car of S.cars) {
    if (car.driver === 'police') continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/** E: get in the nearest car (owned or empty). F: steal a parked/traffic car. */
export function tryEnterCar(S, steal) {
  const p = S.player;
  if (!p.onFoot) return;
  const car = nearestCar(S, 70);
  if (!car) return;
  if (car.driver === 'parked' || car.driver === 'traffic') {
    if (!steal) {
      S.feed.push({ text: `That ${car.model.name} isn't yours — press F to steal it.`, kind: '' });
      return;
    }
    car.driver = 'player';
    S.stats.carsStolen = (S.stats.carsStolen || 0) + 1;
    S.police.addWanted(S, 1, `Stole a ${car.model.name}`);
    S.feed.push({ text: `Stole a ${car.model.name}! The city saw that.`, kind: 'bad' });
    S.audio.steal();
  }
  p.onFoot = false;
  p.carId = car.id;
  S.audio.door();
}

/** E while driving: step out beside the car. */
export function exitCar(S) {
  const p = S.player;
  const car = S.cars.find((c) => c.id === p.carId);
  if (!car) { p.onFoot = true; return; }
  car.driver = 'parked';
  car.speed = 0;
  const side = Math.PI / 2;
  p.x = car.x + Math.cos(car.angle + side) * 34;
  p.y = car.y + Math.sin(car.angle + side) * 34;
  const fixed = resolveCollision(S.city, p.x, p.y, PLAYER_RADIUS, car.x, car.y);
  p.x = fixed.x; p.y = fixed.y;
  p.onFoot = true;
  p.carId = 0;
  S.audio.door();
}

/** Draw Mara: a coral-jacketed driver with a pistol when armed. */
export function drawPlayer(ctx, p, time) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(2, 4, 13, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(p.angle);
  // Legs (walk cycle when moving).
  const step = p.speed > 10 ? Math.sin(time * 14) * 4 : 0;
  ctx.fillStyle = '#233246';
  ctx.fillRect(-6, -8 + step, 12, 5);
  ctx.fillRect(-6, 3 - step, 12, 5);
  // Coral jacket body.
  ctx.fillStyle = p.hurtFlash > 0 && Math.floor(time * 20) % 2 === 0 ? '#ffffff' : '#ff5a4e';
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23e';
  ctx.fillRect(8, -3, 8, 6);
  // Head + hair.
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath(); ctx.arc(4, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1c2733';
  ctx.beginPath(); ctx.arc(1, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath(); ctx.arc(5, 0, 6, 0, Math.PI * 2); ctx.fill();
  // Pistol.
  if (p.weapon === 'pistol') {
    ctx.fillStyle = '#222';
    ctx.fillRect(10, -2, 12, 4);
  }
  ctx.restore();
}
