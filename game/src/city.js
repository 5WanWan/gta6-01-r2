// city.js — Palmera Bay itself: seeded map generation, districts, streets,
// buildings, parks, beach and pier, collision queries, and world rendering.
export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const ROAD_HALF = 58;

export const V_ROADS = [300, 700, 1100, 1500, 1900, 2300, 2700, 3100];
export const H_ROADS = [200, 600, 1000, 1400, 1800, 2200];
export const V_NAMES = ['Coral Ave', 'Palm Row', 'Sunset Blvd', 'Harbor Rd', 'Neon Ave', 'Crown St', 'Lagoon Way', 'Pier St'];
export const H_NAMES = ['Marina Dr', 'Ocean View', 'Old Town Rd', 'Strip Blvd', 'Dockside Ave', 'Hillside Ln'];

/** Small deterministic PRNG so a seed always builds the same city. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DISTRICTS = [
  { name: 'Marina', x0: 0, y0: 0, x1: 950, y1: 1150, ground: '#f2e3b3', accent: '#2fa8a0' },
  { name: 'Old Town', x0: 950, y0: 0, x1: 1950, y1: 1150, ground: '#ecd9a8', accent: '#c98a3d' },
  { name: 'Palm Hills', x0: 1950, y0: 0, x1: 3200, y1: 1150, ground: '#e3eec0', accent: '#5da24a' },
  { name: 'South Beach', x0: 0, y0: 1150, x1: 950, y1: 2400, ground: '#f6e7bd', accent: '#e07840' },
  { name: 'Neon Strip', x0: 950, y0: 1150, x1: 2150, y1: 2400, ground: '#e8d5ee', accent: '#c04fd0' },
  { name: 'Docks', x0: 2150, y0: 1150, x1: 3200, y1: 2400, ground: '#d8d2c2', accent: '#7a6a4a' },
];

const ROOF_COLORS = ['#d96a4a', '#e8a34c', '#7fb069', '#5b8dbf', '#b56ac2', '#c94f6d', '#8a7f8d', '#4fa8a0', '#e0c060'];
const WALL_COLORS = ['#f4e3c2', '#e8d5b0', '#dfe8ee', '#f0d0c0', '#d8e4d0', '#e8c8d8'];

/** Build the whole city from a seed: buildings, parks, trees, landmarks. */
export function generateCity(seed) {
  const rand = mulberry32(seed);
  const buildings = [];
  const parks = [];
  const trees = [];
  // Blocks sit between neighbouring roads; the west strip is beach, not blocks.
  for (let vi = 0; vi < V_ROADS.length - 1; vi++) {
    for (let hi = 0; hi < H_ROADS.length - 1; hi++) {
      const bx0 = V_ROADS[vi] + ROAD_HALF + 14;
      const by0 = H_ROADS[hi] + ROAD_HALF + 14;
      const bx1 = V_ROADS[vi + 1] - ROAD_HALF - 14;
      const by1 = H_ROADS[hi + 1] - ROAD_HALF - 14;
      if (bx0 >= bx1 || by0 >= by1) continue;
      const cx = (bx0 + bx1) / 2;
      const cy = (by0 + by1) / 2;
      const roll = rand();
      if (roll < 0.13) {
        // Park block: lawn + scattered palms.
        parks.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 });
        const n = 5 + Math.floor(rand() * 5);
        for (let t = 0; t < n; t++) trees.push({ x: bx0 + 20 + rand() * (bx1 - bx0 - 40), y: by0 + 20 + rand() * (by1 - by0 - 40), r: 9 + rand() * 7 });
        continue;
      }
      const d = districtAtPoint(cx, cy);
      const count = rand() < 0.45 ? 1 : rand() < 0.75 ? 2 : 4;
      if (count === 1) {
        const w = (bx1 - bx0) * (0.55 + rand() * 0.3);
        const h = (by1 - by0) * (0.55 + rand() * 0.3);
        buildings.push(makeBuilding(cx - w / 2, cy - h / 2, w, h, d, rand));
      } else if (count === 2) {
        const horizontal = rand() < 0.5;
        for (let k = 0; k < 2; k++) {
          const w = horizontal ? (bx1 - bx0) * (0.4 + rand() * 0.12) : (bx1 - bx0) * (0.8 + rand() * 0.1);
          const h = horizontal ? (by1 - by0) * (0.8 + rand() * 0.1) : (by1 - by0) * (0.38 + rand() * 0.12);
          const x = horizontal ? bx0 + k * ((bx1 - bx0) / 2) + 6 : bx0 + 8;
          const y = horizontal ? by0 + 8 : by0 + k * ((by1 - by0) / 2) + 6;
          buildings.push(makeBuilding(x, y, w - 12, h - 16, d, rand));
        }
      } else {
        for (let gx = 0; gx < 2; gx++) for (let gy = 0; gy < 2; gy++) {
          const w = (bx1 - bx0) / 2 - 22;
          const h = (by1 - by0) / 2 - 22;
          buildings.push(makeBuilding(bx0 + gx * ((bx1 - bx0) / 2) + 8, by0 + gy * ((by1 - by0) / 2) + 8, w, h, d, rand));
        }
      }
      // A few street palms along the block edge.
      if (rand() < 0.5) trees.push({ x: bx0 + 8, y: by0 + 8, r: 8 + rand() * 5 });
    }
  }
  return {
    seed, buildings, parks, trees,
    // Landmarks the missions and the minimap use.
    safehouse: { x: 700, y: 600, label: 'Mara\u2019s Safehouse' },
    sprayShop: { x: 1134, y: 820, label: 'Spray Shop — clear heat' },
    pier: { x: 60, y: 1180, w: 150, h: 46 },
    docksGate: { x: 2700, y: 2050, label: 'Docks Gate' },
    marina: { x: 700, y: 900, label: 'Marina' },
    strip: { x: 1522, y: 1700, label: 'Neon Strip' },
  };
}

function makeBuilding(x, y, w, h, district, rand) {
  return {
    x, y, w, h,
    district: district.name,
    wall: WALL_COLORS[Math.floor(rand() * WALL_COLORS.length)],
    roof: ROOF_COLORS[Math.floor(rand() * ROOF_COLORS.length)],
    tall: rand() < 0.22,
  };
}

/** Which district contains a point. */
export function districtAtPoint(x, y) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  return DISTRICTS[0];
}

/** Circle (x, y, r) against every building and the water; true when blocked. */
export function hitsObstacle(city, x, y, r) {
  if (x < 130 + r || x > WORLD_W - r || y < r || y > WORLD_H - r) return true;
  if (x < 210 + r && !(y > city.pier.y - 6 && y < city.pier.y + city.pier.h + 6)) return true; // beach water line, pier exempt
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
  }
  return false;
}

/** Push a circle out of buildings: returns corrected {x, y}. Cheap axis-separated resolve. */
export function resolveCollision(city, x, y, r, px, py) {
  let nx = x;
  let ny = y;
  if (hitsObstacle(city, nx, py, r)) nx = px;
  if (hitsObstacle(city, nx, ny, r)) ny = py;
  if (hitsObstacle(city, nx, ny, r)) { nx = px; ny = py; }
  return { x: nx, y: ny };
}

export function isOnRoad(x, y) {
  for (const vx of V_ROADS) if (Math.abs(x - vx) < ROAD_HALF) return true;
  for (const hy of H_ROADS) if (Math.abs(y - hy) < ROAD_HALF) return true;
  return false;
}

/** Nearest point on the road grid, for traffic spawning and routing. */
export function nearestRoadPoint(x, y) {
  let bestVx = V_ROADS[0];
  let bestD = Infinity;
  for (const vx of V_ROADS) if (Math.abs(x - vx) < bestD) { bestD = Math.abs(x - vx); bestVx = vx; }
  let bestHy = H_ROADS[0];
  bestD = Infinity;
  for (const hy of H_ROADS) if (Math.abs(y - hy) < bestD) { bestD = Math.abs(y - hy); bestHy = hy; }
  return Math.abs(x - bestVx) < Math.abs(y - bestHy) ? { x: bestVx, y } : { x, y: bestHy };
}

/** Draw the whole visible world: ground, water, beach, roads, parks, buildings, pier. */
export function drawCity(ctx, city, cam, viewW, viewH, night) {
  const x0 = Math.max(0, cam.x - 60);
  const y0 = Math.max(0, cam.y - 60);
  const x1 = Math.min(WORLD_W, cam.x + viewW + 60);
  const y1 = Math.min(WORLD_H, cam.y + viewH + 60);
  // Ground: district tints.
  ctx.fillStyle = '#e8d9a0';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(Math.max(x0, d.x0), Math.max(y0, d.y0), Math.min(x1, d.x1) - Math.max(x0, d.x0), Math.min(y1, d.y1) - Math.max(y0, d.y0));
  }
  // Water + sand on the west edge.
  ctx.fillStyle = '#2f9fd8';
  ctx.fillRect(x0, y0, Math.min(130, x1) - x0 > 0 ? Math.min(130, x1) - x0 : 0, y1 - y0);
  ctx.fillStyle = '#f7e8b8';
  ctx.fillRect(Math.max(x0, 130), y0, Math.min(215, x1) - Math.max(x0, 130), y1 - y0);
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(130, y0); ctx.lineTo(130, y1); ctx.stroke();
  // Parks.
  for (const p of city.parks) {
    if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue;
    ctx.fillStyle = '#8fce6a';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#6db34e';
    ctx.lineWidth = 3;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
  // Roads: asphalt, sidewalks, centre dashes.
  ctx.fillStyle = '#3a3f4a';
  for (const vx of V_ROADS) ctx.fillRect(vx - ROAD_HALF, y0, ROAD_HALF * 2, y1 - y0);
  for (const hy of H_ROADS) ctx.fillRect(x0, hy - ROAD_HALF, x1 - x0, ROAD_HALF * 2);
  ctx.fillStyle = '#c9c2ae';
  for (const vx of V_ROADS) {
    ctx.fillRect(vx - ROAD_HALF - 8, y0, 8, y1 - y0);
    ctx.fillRect(vx + ROAD_HALF, y0, 8, y1 - y0);
  }
  for (const hy of H_ROADS) {
    ctx.fillRect(x0, hy - ROAD_HALF - 8, x1 - x0, 8);
    ctx.fillRect(x0, hy + ROAD_HALF, x1 - x0, 8);
  }
  ctx.strokeStyle = '#ffd23e';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  ctx.beginPath();
  for (const vx of V_ROADS) { ctx.moveTo(vx, y0); ctx.lineTo(vx, y1); }
  for (const hy of H_ROADS) { ctx.moveTo(x0, hy); ctx.lineTo(x1, hy); }
  ctx.stroke();
  ctx.setLineDash([]);
  // Crosswalk stripes at intersections.
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const vx of V_ROADS) for (const hy of H_ROADS) {
    if (vx < x0 - 60 || vx > x1 + 60 || hy < y0 - 60 || hy > y1 + 60) continue;
    for (let k = -2; k <= 2; k++) ctx.fillRect(vx + k * 16 - 5, hy - ROAD_HALF + 6, 10, 12);
  }
  // Buildings with shadow, walls, roof and windows.
  for (const b of city.buildings) {
    if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    const inset = b.tall ? 10 : 6;
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    const cols = Math.max(1, Math.floor(b.w / 34));
    const rows = Math.max(1, Math.floor(b.h / 34));
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < rows; cy++) {
      ctx.fillRect(b.x + 12 + cx * 34, b.y + 12 + cy * 34, 12, 10);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  // Trees (palms): canopy + trunk dot.
  for (const t of city.trees) {
    if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
    ctx.fillStyle = '#3f8f3a';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6db34e';
    ctx.beginPath(); ctx.arc(t.x - 2, t.y - 2, t.r * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  // Pier planks out over the water.
  ctx.fillStyle = '#a8763e';
  ctx.fillRect(0, city.pier.y, city.pier.w, city.pier.h);
  ctx.strokeStyle = '#7a5228';
  ctx.lineWidth = 2;
  for (let px = 12; px < city.pier.w; px += 18) { ctx.beginPath(); ctx.moveTo(px, city.pier.y); ctx.lineTo(px, city.pier.y + city.pier.h); ctx.stroke(); }
  // Landmark labels and street names.
  ctx.fillStyle = 'rgba(10,40,60,.75)';
  ctx.font = 'bold 13px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MARINA', 520, 260);
  ctx.fillText('OLD TOWN', 1450, 260);
  ctx.fillText('PALM HILLS', 2650, 260);
  ctx.fillText('NEON STRIP', 1550, 1700);
  ctx.fillText('DOCKS', 2700, 1700);
  ctx.fillText('SOUTH BEACH', 520, 1700);
  ctx.fillText('PIER', 90, city.pier.y - 10);
  ctx.font = '11px Trebuchet MS, sans-serif';
  ctx.fillStyle = 'rgba(10,40,60,.55)';
  for (let i = 0; i < V_ROADS.length; i++) ctx.fillText(V_NAMES[i], V_ROADS[i], H_ROADS[0] - ROAD_HALF - 14);
  // Dusk tint for the night dock run.
  if (night) {
    ctx.fillStyle = 'rgba(30,20,80,.28)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
