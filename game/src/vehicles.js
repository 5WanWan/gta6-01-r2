// vehicles.js — car definitions, driving physics, damage and smoke, and drawing.
import { hitsObstacle, isOnRoad, WORLD_W, WORLD_H } from './city.js';

export const CAR_MODELS = [
  { name: 'Coral Runner', color: '#ff5a4e', top: 430, accel: 300, grip: 3.2, len: 46, wid: 22 },
  { name: 'Sunset Coupe', color: '#ffd23e', top: 470, accel: 330, grip: 3.6, len: 44, wid: 20 },
  { name: 'Palm Cruiser', color: '#2fa8a0', top: 380, accel: 240, grip: 2.8, len: 52, wid: 24 },
  { name: 'Bay Taxi', color: '#ffb62e', top: 400, accel: 260, grip: 3.0, len: 46, wid: 22 },
  { name: 'Dune Pickup', color: '#7fb069', top: 390, accel: 250, grip: 2.9, len: 54, wid: 24 },
  { name: 'Neon GT', color: '#c04fd0', top: 520, accel: 380, grip: 4.0, len: 46, wid: 21 },
  { name: 'Harbor Van', color: '#e8e4da', top: 340, accel: 210, grip: 2.6, len: 56, wid: 25 },
  { name: 'Crown S', color: '#1c2733', top: 560, accel: 420, grip: 4.3, len: 48, wid: 21 },
];
export const POLICE_MODEL = { name: 'PBPD Interceptor', color: '#f2f2f2', top: 500, accel: 360, grip: 3.9, len: 48, wid: 22 };

let nextCarId = 1;

/** Create a car entity at a position. driver: 'player' | 'traffic' | 'police' | 'parked'. */
export function makeCar(x, y, angle, model, driver) {
  return {
    id: nextCarId++, x, y, angle, speed: 0,
    model, driver, damage: 0, smoke: 0, horn: 0,
    steer: 0, stuck: 0, despawn: 0, crashCooldown: 0, ramCooldown: 0,
  };
}

/** Advance one car under arcade physics. input: {throttle, steer, brake, reverse}. */
export function stepCarPhysics(car, input, dt, city, onCrash) {
  const m = car.model;
  const offRoad = !isOnRoad(car.x, car.y);
  const topSpeed = m.top * (offRoad ? 0.55 : 1) * (1 - car.damage * 0.004);
  if (input.throttle > 0) car.speed += m.accel * input.throttle * dt;
  if (input.reverse > 0) car.speed -= m.accel * 0.9 * input.reverse * dt;
  if (input.brake > 0) {
    // Handbrake: shed speed fast, but never drive the car backwards.
    const decel = m.accel * 1.6 * dt;
    car.speed = car.speed > 0 ? Math.max(0, car.speed - decel) : Math.min(0, car.speed + decel);
  }
  car.speed -= car.speed * 0.55 * dt; // drag
  if (input.throttle === 0 && input.brake === 0 && !input.reverse) car.speed -= Math.sign(car.speed) * 60 * dt;
  car.speed = Math.max(-140, Math.min(topSpeed, car.speed));
  if (Math.abs(car.speed) < 4) car.speed = 0;
  const drift = input.brake > 0 && Math.abs(car.speed) > 120 ? 1.7 : 1;
  car.angle += input.steer * m.grip * drift * dt * Math.min(1, Math.abs(car.speed) / 90) * Math.sign(car.speed || 1);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const half = m.len / 2;
  // Axis-separated movement so cars slide along walls instead of wedging.
  const speedBefore = car.speed;
  let hit = false;
  let bothBlocked = false;
  let xBlocked = false;
  let yBlocked = false;
  if (!hitsObstacle(city, nx, car.y, half * 0.65)) {
    car.x = Math.max(half, Math.min(WORLD_W - half, nx));
  } else { hit = true; xBlocked = true; }
  if (!hitsObstacle(city, car.x, ny, half * 0.65)) {
    car.y = Math.max(half, Math.min(WORLD_H - half, ny));
  } else { hit = true; yBlocked = true; }
  bothBlocked = xBlocked && yBlocked;
  if (hit) {
    const impact = Math.abs(speedBefore);
    // A single blocked axis is a wall scrape: lose momentum and slide along it.
    // Only a dead-end (both axes) bounces the car back.
    if (bothBlocked) car.speed *= -0.25;
    else car.speed *= 0.7;
    // One damage tick per scrape, not one per frame while wedged.
    car.crashCooldown = Math.max(0, car.crashCooldown - dt);
    if (impact > 90 && car.crashCooldown <= 0) {
      car.damage += impact * 0.06;
      car.crashCooldown = 0.5;
      if (onCrash) onCrash(car, impact);
    }
  } else {
    car.crashCooldown = Math.max(0, car.crashCooldown - dt);
  }
  if (car.damage > 55) car.smoke = Math.min(1, (car.damage - 55) / 45);
  if (car.damage >= 100) { car.speed *= 0.9; car.damage = 100; }
  return car;
}

/** Circle-vs-car test for bullets, peds and other cars. */
export function carHitTest(car, x, y, r) {
  const dx = x - car.x;
  const dy = y - car.y;
  const c = Math.cos(-car.angle);
  const s = Math.sin(-car.angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) < car.model.len / 2 + r && Math.abs(ly) < car.model.wid / 2 + r;
}

export function damageCar(car, amount, onCrash) {
  car.damage = Math.min(100, car.damage + amount);
  if (amount > 8 && onCrash) onCrash(car, amount * 8);
}

/** Draw one car: body, cabin, windshield, wheels, lights, police livery, smoke. */
export function drawCar(ctx, car, time) {
  const m = car.model;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-m.len / 2 + 4, -m.wid / 2 + 5, m.len, m.wid);
  // Wheels.
  ctx.fillStyle = '#14181d';
  const wy = m.wid / 2 - 1;
  ctx.fillRect(-m.len / 2 + 6, -wy - 3, 12, 6);
  ctx.fillRect(m.len / 2 - 18, -wy - 3, 12, 6);
  ctx.fillRect(-m.len / 2 + 6, wy - 3, 12, 6);
  ctx.fillRect(m.len / 2 - 18, wy - 3, 12, 6);
  // Body.
  ctx.fillStyle = m.color;
  roundRect(ctx, -m.len / 2, -m.wid / 2, m.len, m.wid, 7);
  ctx.fill();
  if (car.driver === 'police') {
    ctx.fillStyle = '#1c5fd6';
    ctx.fillRect(-m.len / 2 + 2, -m.wid / 2, m.len - 4, 7);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 9px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PBPD', 0, 3);
    const flash = Math.floor(time * 6) % 2 === 0;
    ctx.fillStyle = flash ? '#ff2d2d' : '#2d7bff';
    ctx.beginPath(); ctx.arc(-4, -m.wid / 2 + 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#2d7bff' : '#ff2d2d';
    ctx.beginPath(); ctx.arc(6, -m.wid / 2 + 2, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Cabin + windshield.
  ctx.fillStyle = 'rgba(20,40,60,.85)';
  roundRect(ctx, -m.len / 2 + 12, -m.wid / 2 + 4, m.len - 26, m.wid - 8, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,220,255,.5)';
  ctx.fillRect(m.len / 2 - 16, -m.wid / 2 + 5, 5, m.wid - 10);
  // Headlights and damage.
  ctx.fillStyle = '#fff8c0';
  ctx.fillRect(m.len / 2 - 2, -m.wid / 2 + 3, 2, 5);
  ctx.fillRect(m.len / 2 - 2, m.wid / 2 - 8, 2, 5);
  if (car.damage > 25) {
    ctx.fillStyle = 'rgba(30,30,30,.55)';
    ctx.fillRect(-m.len / 2 + 2, -m.wid / 2 + 2, 12, 8);
  }
  ctx.restore();
  // Smoke trail when badly damaged.
  if (car.smoke > 0) {
    ctx.fillStyle = `rgba(80,80,80,${0.25 + car.smoke * 0.4})`;
    ctx.beginPath();
    ctx.arc(car.x - Math.cos(car.angle) * m.len / 2 + (Math.sin(time * 7 + car.id) * 4), car.y - Math.sin(car.angle) * m.len / 2, 6 + car.smoke * 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
