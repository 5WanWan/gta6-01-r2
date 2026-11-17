// traffic.js — Palmera Bay's living streets: traffic cars that follow the roads,
// stop for each other and honk, plus pedestrians who stroll the sidewalks and
// flee from gunfire and crashes.
import { V_ROADS, H_ROADS, ROAD_HALF, districtAtPoint } from './city.js';
import { makeCar, stepCarPhysics, carHitTest, drawCar } from './vehicles.js';

const PED_NAMES = ['Tomas', 'Lena', 'Rafi', 'June', 'Omar', 'Priya', 'Diego', 'Marta', 'Ken', 'Sofia', 'Ivo', 'Nadia'];
const PED_SHIRTS = ['#e86a92', '#4a90d9', '#f2b134', '#7fb069', '#9b5de5', '#ef8354', '#2ec4b6', '#e0e0e0'];
const TRAFFIC_COUNT = 26;
const PED_COUNT = 46;

/** Spawn traffic cars on roads and pedestrians on sidewalks. */
export function spawnTraffic(S, rand) {
  S.cars = S.cars || [];
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const car = spawnTrafficCar(S, rand);
    if (car) S.cars.push(car);
  }
  // Parked cars the player can steal, near the safehouse and around town.
  for (let i = 0; i < 10; i++) {
    const vx = V_ROADS[Math.floor(rand() * V_ROADS.length)];
    const hy = H_ROADS[Math.floor(rand() * H_ROADS.length)];
    const parked = makeCar(
      vx + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF - 14),
      hy + (rand() - 0.5) * 120,
      rand() < 0.5 ? 0 : Math.PI,
      S.carModels[Math.floor(rand() * S.carModels.length)],
      'parked',
    );
    parked.x = Math.max(60, Math.min(3140, parked.x));
    parked.y = Math.max(60, Math.min(2340, parked.y));
    S.cars.push(parked);
  }
  S.peds = [];
  for (let i = 0; i < PED_COUNT; i++) S.peds.push(spawnPed(S, rand));
}

function spawnTrafficCar(S, rand) {
  const vertical = rand() < 0.5;
  const model = S.carModels[Math.floor(rand() * S.carModels.length)];
  let x;
  let y;
  let angle;
  if (vertical) {
    x = V_ROADS[Math.floor(rand() * V_ROADS.length)] + (rand() < 0.5 ? -22 : 22);
    y = 120 + rand() * 2160;
    angle = rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    x = 260 + rand() * 2880;
    y = H_ROADS[Math.floor(rand() * H_ROADS.length)] + (rand() < 0.5 ? -22 : 22);
    angle = rand() < 0.5 ? 0 : Math.PI;
  }
  const car = makeCar(x, y, angle, model, 'traffic');
  car.speed = 90 + rand() * 70;
  car.cruise = car.speed;
  car.route = vertical ? 'v' : 'h';
  return car;
}

function spawnPed(S, rand) {
  const vertical = rand() < 0.5;
  let x;
  let y;
  if (vertical) {
    x = V_ROADS[Math.floor(rand() * V_ROADS.length)] + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 16);
    y = 120 + rand() * 2160;
  } else {
    x = 260 + rand() * 2880;
    y = H_ROADS[Math.floor(rand() * H_ROADS.length)] + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 16);
  }
  return {
    x, y, angle: rand() * Math.PI * 2, speed: 26 + rand() * 22,
    name: PED_NAMES[Math.floor(rand() * PED_NAMES.length)],
    shirt: PED_SHIRTS[Math.floor(rand() * PED_SHIRTS.length)],
    health: 100, alive: true, fleeing: false, fleeX: 0, fleeY: 0,
    target: null, pause: 0, walkPhase: rand() * 6,
  };
}

/** Pick a new sidewalk waypoint for a strolling pedestrian. */
export function retargetPed(S, ped, rand) {
  const vertical = rand() < 0.5;
  if (vertical) {
    const vx = V_ROADS[Math.floor(rand() * V_ROADS.length)];
    ped.target = { x: vx + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 16), y: 120 + rand() * 2160 };
  } else {
    const hy = H_ROADS[Math.floor(rand() * H_ROADS.length)];
    ped.target = { x: 260 + rand() * 2880, y: hy + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 16) };
  }
}

export function stepTraffic(S, dt) {
  const rand = Math.random;
  for (const car of S.cars) {
    if (car.driver !== 'traffic') continue;
    // Car ahead? Brake and honk.
    let blocked = false;
    const aheadX = car.x + Math.cos(car.angle) * 46;
    const aheadY = car.y + Math.sin(car.angle) * 46;
    for (const other of S.cars) {
      if (other === car) continue;
      if (Math.hypot(other.x - aheadX, other.y - aheadY) < 34) { blocked = true; break; }
    }
    const p = S.player;
    if (!p.onFoot && Math.hypot(p.x - aheadX, p.y - aheadY) < 34) blocked = true;
    if (blocked && car.horn <= 0 && Math.random() < dt * 0.4) {
      car.horn = 0.5;
      S.audio.honk();
    }
    car.horn = Math.max(0, car.horn - dt);
    // At an intersection, sometimes turn onto the crossing road.
    const onV = V_ROADS.some((vx) => Math.abs(car.x - vx) < 26);
    const onH = H_ROADS.some((hy) => Math.abs(car.y - hy) < 26);
    if (onV && onH && Math.random() < dt * 0.35) {
      const turns = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
      const turn = turns[Math.floor(rand() * turns.length)];
      car.angle = turn;
      car.route = Math.abs(Math.cos(turn)) > 0.5 ? 'h' : 'v';
    }
    const throttle = blocked ? 0 : 0.7;
    const brake = blocked ? 1 : 0;
    // Ease back to cruise speed instead of flooring it.
    if (!blocked && car.speed < car.cruise) car.speed += 40 * dt;
    stepCarPhysics(car, { throttle, steer: 0, brake }, dt, S.city, (c, imp) => onTrafficCrash(S, c, imp));
    // Despawn far traffic and respawn near the player to keep streets busy.
    const dist = Math.hypot(car.x - S.player.x, car.y - S.player.y);
    if (dist > 1500) {
      const fresh = spawnTrafficCar(S, Math.random);
      car.x = fresh.x; car.y = fresh.y; car.angle = fresh.angle;
      car.speed = fresh.speed; car.cruise = fresh.cruise; car.model = fresh.model; car.damage = 0;
    }
  }
}

function onTrafficCrash(S, car, impact) {
  S.particles.push({ kind: 'spark', x: car.x, y: car.y, life: 0.2, max: 0.2, size: 8 });
  // Nearby pedestrians scatter.
  for (const ped of S.peds) {
    if (ped.alive && Math.hypot(ped.x - car.x, ped.y - car.y) < 220) {
      ped.fleeing = true;
      ped.fleeX = (ped.x - car.x) / 220;
      ped.fleeY = (ped.y - car.y) / 220;
    }
  }
}

export function stepPeds(S, dt) {
  for (const ped of S.peds) {
    if (!ped.alive) continue;
    ped.walkPhase += dt * 6;
    if (ped.fleeing) {
      const sp = 190;
      ped.x += ped.fleeX * sp * dt;
      ped.y += ped.fleeY * sp * dt;
      ped.angle = Math.atan2(ped.fleeY, ped.fleeX);
      if (Math.random() < dt * 0.25) ped.fleeing = false;
      continue;
    }
    if (ped.pause > 0) { ped.pause -= dt; continue; }
    if (!ped.target) retargetPed(S, ped, Math.random);
    const dx = ped.target.x - ped.x;
    const dy = ped.target.y - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) {
      ped.target = null;
      ped.pause = 0.5 + Math.random() * 2.5;
      continue;
    }
    ped.x += (dx / d) * ped.speed * dt;
    ped.y += (dy / d) * ped.speed * dt;
    ped.angle = Math.atan2(dy, dx);
    // Flee gunfire and fast cars nearby.
    if (S.bullets.length > 0) {
      for (const b of S.bullets) {
        if (Math.hypot(b.x - ped.x, b.y - ped.y) < 160) {
          ped.fleeing = true;
          ped.fleeX = (ped.x - b.x) / 160;
          ped.fleeY = (ped.y - b.y) / 160;
          break;
        }
      }
    }
  }
}

/** Draw all pedestrians, sorted with the player by Y in main. */
export function drawPed(ctx, ped, time) {
  if (!ped.alive) return;
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(2, 4, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(ped.angle);
  const step = Math.sin(ped.walkPhase) * 3;
  ctx.fillStyle = '#2b3a4a';
  ctx.fillRect(-5, -7 + step, 10, 4);
  ctx.fillRect(-5, 3 - step, 10, 4);
  ctx.fillStyle = ped.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath(); ctx.arc(3, 0, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1c2733';
  ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath(); ctx.arc(4, 0, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (ped.fleeing) {
    ctx.fillStyle = '#ff5a4e';
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', ped.x, ped.y - 16);
  }
}

/** Run over a pedestrian while driving: they go down, the law notices. */
export function checkPedCollisions(S) {
  const p = S.player;
  if (p.onFoot) return;
  const car = S.cars.find((c) => c.id === p.carId);
  if (!car || Math.abs(car.speed) < 60) return;
  for (const ped of S.peds) {
    if (!ped.alive) continue;
    if (carHitTest(car, ped.x, ped.y, 6)) {
      ped.alive = false;
      S.police.addWanted(S, 1, 'Hit a pedestrian');
      S.feed.push({ text: `${ped.name} was hit by your car — witnesses called it in.`, kind: 'bad' });
      S.audio.crash();
      S.stats.pedsDown = (S.stats.pedsDown || 0) + 1;
    }
  }
}
