// hud.js — the HUD: health/cash/REP/wanted, objective banner, event feed,
// weapon and speed, plus the minimap with districts, markers and the player
// arrow, and all menu / end-screen wiring.
import { DISTRICTS, WORLD_W, WORLD_H } from './city.js';
import { MISSIONS, currentMission, objectiveText } from './missions.js';

export function makeHud() {
  return {
    el: {
      hud: document.getElementById('hud'),
      healthFill: document.getElementById('healthFill'),
      cash: document.getElementById('cash'),
      rep: document.getElementById('rep'),
      wanted: document.getElementById('wanted'),
      objTitle: document.getElementById('objTitle'),
      objText: document.getElementById('objText'),
      objTimer: document.getElementById('objTimer'),
      minimap: document.getElementById('minimap'),
      feed: document.getElementById('feed'),
      weapon: document.getElementById('weapon'),
      ammo: document.getElementById('ammo'),
      speed: document.getElementById('speed'),
      carName: document.getElementById('carName'),
      menu: document.getElementById('menu'),
      pauseMenu: document.getElementById('pauseMenu'),
      endScreen: document.getElementById('endScreen'),
      missionScreen: document.getElementById('missionScreen'),
      missionList: document.getElementById('missionList'),
      saveInfo: document.getElementById('saveInfo'),
    },
    lastFeedCount: 0,
  };
}

export function showMenu(hud, S, save) {
  hud.el.hud.classList.add('hidden');
  hud.el.pauseMenu.classList.add('hidden');
  hud.el.endScreen.classList.add('hidden');
  hud.el.missionScreen.classList.add('hidden');
  hud.el.menu.classList.remove('hidden');
  document.getElementById('btnContinue').classList.toggle('hidden', !save);
  hud.el.saveInfo.textContent = save
    ? `Save found: $${save.cash} · REP ${save.rep} · ${save.missionsCompleted.length}/6 jobs done · saved ${new Date(save.savedAt).toLocaleString()}.`
    : 'No save yet — a fresh start on the bay.';
  hud.el.missionList.innerHTML = MISSIONS.map((m) => {
    const done = S.mission.completed.includes(m.id);
    const locked = S.rep < m.rep;
    const cls = done ? '' : locked ? 'locked' : '';
    const mark = done ? '✓ ' : locked ? '🔒 ' : '▸ ';
    return `<div class="${cls}">${mark}<b>${m.title}</b> — $${m.cash} · +${m.repReward} REP${locked ? ` (needs REP ${m.rep})` : ''}</div>`;
  }).join('');
}

export function hideMenu(hud) {
  hud.el.menu.classList.add('hidden');
  hud.el.hud.classList.remove('hidden');
}

export function showPause(hud, on) {
  hud.el.pauseMenu.classList.toggle('hidden', !on);
}

export function showEnd(hud, kind, S) {
  const title = document.getElementById('endTitle');
  const sub = document.getElementById('endSub');
  const stats = document.getElementById('endStats');
  if (kind === 'busted') {
    title.textContent = 'BUSTED';
    sub.textContent = 'The PBPD finally caught up with Mara Voss.';
    stats.textContent = `You kept $${Math.floor(S.cash / 2)} of your $${S.cash} — the rest went to bail. REP stays: the city remembers.`;
    S.cash = Math.floor(S.cash / 2);
  } else {
    title.textContent = 'WASTED';
    sub.textContent = 'Palmera Bay is not done with you yet.';
    stats.textContent = `Mara wakes up at the Marina clinic. $${S.cash} · REP ${S.rep} · ${S.mission.completed.length}/6 jobs done.`;
  }
  hud.el.hud.classList.add('hidden');
  hud.el.endScreen.classList.remove('hidden');
}

export function showMissionComplete(hud, result, S) {
  document.getElementById('msTitle').textContent = 'JOB DONE';
  document.getElementById('msSub').textContent = `${result.title} — the crew pays on time.`;
  document.getElementById('msStats').textContent = `+$${result.cash} cash · +${result.rep} REP (now ${S.rep}) · ${S.mission.completed.length}/6 jobs done.`;
  hud.el.missionScreen.classList.remove('hidden');
}

export function hideEndScreens(hud) {
  hud.el.endScreen.classList.add('hidden');
  hud.el.missionScreen.classList.add('hidden');
  hud.el.pauseMenu.classList.add('hidden');
  hud.el.hud.classList.remove('hidden');
}

/** Push a line into the radio/event feed (newest on top, max 6 shown). */
export function pushFeed(S, text, kind) {
  S.feed.push({ text, kind: kind || '' });
  if (S.feed.length > 30) S.feed.splice(0, S.feed.length - 30);
}

export function renderHud(hud, S) {
  const p = S.player;
  hud.el.healthFill.style.width = `${Math.max(0, p.health)}%`;
  hud.el.healthFill.style.background = p.health > 50
    ? 'linear-gradient(90deg,#37d67a,#a8e63f)'
    : p.health > 25 ? 'linear-gradient(90deg,#ffb62e,#ff7840)' : 'linear-gradient(90deg,#ff5a4e,#c22)';
  hud.el.cash.textContent = `$${S.cash}`;
  hud.el.rep.textContent = `REP ${S.rep}`;
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < S.police.wanted ? '★' : '<span class="off">★</span>';
  hud.el.wanted.innerHTML = stars;
  const m = currentMission(S);
  hud.el.objTitle.textContent = m ? m.title.toUpperCase() : 'PALMERA BAY — CROWN WON';
  hud.el.objText.textContent = objectiveText(S);
  let timerText = '';
  if (S.mission.active && S.mission.clock) timerText = `⏱ ${Math.ceil(S.mission.clock)}s left`;
  else if (S.mission.active && S.mission.timer && currentMission(S) && currentMission(S).steps[S.mission.step] && currentMission(S).steps[S.mission.step].type === 'heat') {
    const surviveFor = currentMission(S).steps[S.mission.step].text.includes('45') ? 45 : 60;
    timerText = `⏱ survive ${Math.max(0, Math.ceil(surviveFor - S.mission.timer))}s`;
  }
  hud.el.objTimer.textContent = timerText;
  // Weapon / speed / car.
  hud.el.weapon.innerHTML = `PISTOL <span id="ammo">${p.ammo} / ${p.reserve}</span>`;
  let speedMph = 0;
  let carName = '';
  if (!p.onFoot) {
    const car = S.cars.find((c) => c.id === p.carId);
    if (car) {
      speedMph = Math.round(Math.abs(car.speed) * 0.16);
      carName = `${car.model.name}${car.damage > 55 ? ' — SMOKING!' : ''}`;
    }
  } else {
    speedMph = Math.round(p.speed * 0.16);
  }
  hud.el.speed.textContent = `${speedMph} mph`;
  hud.el.carName.textContent = carName;
  // Feed: re-render only when it grew.
  if (S.feed.length !== hud.lastFeedCount) {
    hud.lastFeedCount = S.feed.length;
    const recent = S.feed.slice(-6).reverse();
    hud.el.feed.innerHTML = recent.map((f) => `<div class="${f.kind}">${escapeHtml(f.text)}</div>`).join('');
  }
  drawMinimap(hud, S);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimap: districts, roads, spray shop, safehouse, mission marker, cops, player. */
export function drawMinimap(hud, S) {
  const cv = hud.el.minimap;
  const ctx = cv.getContext('2d');
  const w = cv.width;
  const h = cv.height;
  const sx = w / WORLD_W;
  const sy = h / WORLD_H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e2a3a';
  ctx.fillRect(0, 0, w, h);
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(d.x0 * sx, d.y0 * sy, (d.x1 - d.x0) * sx, (d.y1 - d.y0) * sy);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#2f9fd8';
  ctx.fillRect(0, 0, 130 * sx, h);
  ctx.strokeStyle = '#3a3f4a';
  ctx.lineWidth = 2;
  for (const vx of [300, 700, 1100, 1500, 1900, 2300, 2700, 3100]) {
    ctx.beginPath(); ctx.moveTo(vx * sx, 0); ctx.lineTo(vx * sx, h); ctx.stroke();
  }
  for (const hy of [200, 600, 1000, 1400, 1800, 2200]) {
    ctx.beginPath(); ctx.moveTo(0, hy * sy); ctx.lineTo(w, hy * sy); ctx.stroke();
  }
  ctx.font = 'bold 8px Trebuchet MS, sans-serif';
  ctx.fillStyle = 'rgba(10,40,60,.8)';
  ctx.textAlign = 'center';
  ctx.fillText('MARINA', 520 * sx, 300 * sy);
  ctx.fillText('OLD TOWN', 1450 * sx, 300 * sy);
  ctx.fillText('PALM HILLS', 2650 * sx, 300 * sy);
  ctx.fillText('NEON STRIP', 1550 * sx, 1700 * sy);
  ctx.fillText('DOCKS', 2700 * sx, 1700 * sy);
  // Safehouse + spray shop.
  ctx.fillStyle = '#37d67a';
  ctx.fillRect(S.city.safehouse.x * sx - 3, S.city.safehouse.y * sy - 3, 6, 6);
  ctx.fillStyle = '#ff9a3d';
  ctx.beginPath(); ctx.arc(S.city.sprayShop.x * sx, S.city.sprayShop.y * sy, 4, 0, Math.PI * 2); ctx.fill();
  // Mission marker: pulsing diamond.
  const target = S.missionTarget;
  if (target) {
    const pulse = 5 + Math.sin(performance.now() / 180) * 2;
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(target.x * sx, target.y * sy - pulse);
    ctx.lineTo(target.x * sx + pulse, target.y * sy);
    ctx.lineTo(target.x * sx, target.y * sy + pulse);
    ctx.lineTo(target.x * sx - pulse, target.y * sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Police dots.
  ctx.fillStyle = '#2d7bff';
  for (const car of S.cars) {
    if (car.driver === 'police') {
      ctx.beginPath(); ctx.arc(car.x * sx, car.y * sy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const cop of S.cops) {
    if (cop.health > 0) {
      ctx.beginPath(); ctx.arc(cop.x * sx, cop.y * sy, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Player arrow.
  const p = S.player;
  ctx.save();
  ctx.translate(p.x * sx, p.y * sy);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#ff5a4e';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Border + label.
  ctx.strokeStyle = 'rgba(255,214,120,.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}
