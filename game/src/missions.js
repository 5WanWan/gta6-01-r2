// missions.js — "The Coral Crown": six jobs for Mara Voss. A generic objective
// engine (go to, steal, deliver, collect, survive, lose the heat) runs the arc,
// and REP gates the later jobs.
import { addWanted } from './police.js';

export const MISSIONS = [
  {
    id: 'm1', title: 'M1 — First Wheels', rep: 0, cash: 150, repReward: 15,
    intro: 'A Coral Runner is parked by the Marina. Take it. Deliver it to the safehouse.',
    steps: [
      { type: 'goto', x: 322, y: 780, r: 70, text: 'Get to the Coral Runner on Coral Ave' },
      { type: 'steal', text: 'Steal the Coral Runner (press F)' },
      { type: 'deliver', x: 700, y: 600, r: 80, text: 'Deliver the car to Mara\u2019s Safehouse' },
    ],
  },
  {
    id: 'm2', title: 'M2 — The Pickup', rep: 15, cash: 250, repReward: 20,
    intro: 'A package waits under the Neon Strip sign. Grab it — and shake the tail.',
    steps: [
      { type: 'goto', x: 1522, y: 1700, r: 70, text: 'Reach the package on the Neon Strip' },
      { type: 'collect', x: 1522, y: 1700, r: 60, text: 'Pick up the package' },
      { type: 'loseheat', text: 'Lose the tail — get your wanted level to zero' },
    ],
  },
  {
    id: 'm3', title: 'M3 — Heat Wave', rep: 35, cash: 400, repReward: 25,
    intro: 'The whole PBPD is awake. Three stars, one hour of night. Survive it.',
    steps: [
      { type: 'heat', stars: 3, text: 'Heat is on — 3 stars. Survive 45 seconds' },
      { type: 'loseheat', text: 'Now shake them — wanted back to zero' },
    ],
  },
  {
    id: 'm4', title: 'M4 — Harbor Lights', rep: 60, cash: 600, repReward: 25,
    intro: 'Night run at the Docks. Three crates, no questions, one delivery to the Marina.',
    steps: [
      { type: 'goto', x: 2700, y: 2050, r: 80, text: 'Reach the Docks Gate after dark' },
      { type: 'collect', x: 2700, y: 1980, r: 60, text: 'Crate 1 of 3' },
      { type: 'collect', x: 2700, y: 2120, r: 60, text: 'Crate 2 of 3' },
      { type: 'collect', x: 2300, y: 2050, r: 60, text: 'Crate 3 of 3' },
      { type: 'deliver', x: 700, y: 900, r: 80, text: 'Deliver the crates to the Marina' },
    ],
  },
  {
    id: 'm5', title: 'M5 — The Vault Run', rep: 85, cash: 900, repReward: 30,
    intro: 'Three stops, one clock. The vault crew pays by the second — be fast.',
    steps: [
      { type: 'timed', x: 1100, y: 600, r: 70, seconds: 110, text: 'Stop 1 of 3 — Old Town vault (110s)' },
      { type: 'timed', x: 2300, y: 1000, r: 70, seconds: 0, text: 'Stop 2 of 3 — Palm Hills vault' },
      { type: 'timed', x: 1500, y: 1800, r: 70, seconds: 0, text: 'Stop 3 of 3 — Neon Strip vault' },
      { type: 'deliver', x: 700, y: 600, r: 80, text: 'Bring the haul home to the Safehouse' },
    ],
  },
  {
    id: 'm6', title: 'M6 — Crown of Palmera', rep: 115, cash: 2000, repReward: 50,
    intro: 'Five stars. The whole city is watching. Outrun the law and take the Crown.',
    steps: [
      { type: 'heat', stars: 5, text: 'FIVE STARS. Survive 60 seconds' },
      { type: 'goto', x: 700, y: 600, r: 90, text: 'Reach the Safehouse and claim the Coral Crown' },
    ],
  },
];

/** Fresh mission runtime state. */
export function makeMissionState() {
  return {
    index: 0, step: 0, active: false, timer: 0, clock: 0, failed: false,
    completed: [], failedCount: 0,
  };
}

/** Can the player start mission i? REP gates the later jobs. */
export function canStartMission(S, i) {
  return i < MISSIONS.length && S.rep >= MISSIONS[i].rep && !S.mission.completed.includes(MISSIONS[i].id);
}

export function currentMission(S) {
  return S.mission.index < MISSIONS.length ? MISSIONS[S.mission.index] : null;
}

export function currentStep(S) {
  const m = currentMission(S);
  if (!m || !S.mission.active) return null;
  return m.steps[S.mission.step] || null;
}

export function startMission(S, index) {
  const m = MISSIONS[index];
  if (!m) return false;
  S.mission.index = index;
  S.mission.step = 0;
  S.mission.active = true;
  S.mission.failed = false;
  S.mission.timer = 0;
  S.mission.clock = 0;
  S.feed.push({ text: `${m.title}: ${m.intro}`, kind: 'good' });
  S.audio.missionStart();
  if (m.id === 'm4') S.night = true;
  return true;
}

/** Auto-start the next unlocked job when the player has none active. */
export function maybeAutoStart(S) {
  if (S.mission.active) return;
  const next = MISSIONS.findIndex((m, i) => !S.mission.completed.includes(m.id) && S.rep >= m.rep);
  if (next >= 0) startMission(S, next);
}

export function failMission(S, reason) {
  const m = currentMission(S);
  S.mission.active = false;
  S.mission.failed = true;
  S.mission.failedCount += 1;
  S.mission.step = 0;
  S.mission.timer = 0;
  S.mission.clock = 0;
  S.night = false;
  S.police.wanted = Math.min(S.police.wanted, 1);
  S.feed.push({ text: `Job failed — ${reason}. The job is still open; try again.`, kind: 'bad' });
  S.audio.fail();
  if (m) S.feed.push({ text: `Press J to retry ${m.title}.`, kind: '' });
}

export function completeMission(S) {
  const m = currentMission(S);
  if (!m) return;
  S.cash += m.cash;
  S.rep += m.repReward;
  S.mission.completed.push(m.id);
  S.mission.active = false;
  S.mission.step = 0;
  S.mission.timer = 0;
  S.mission.clock = 0;
  S.night = false;
  S.stats.missionsDone = (S.stats.missionsDone || 0) + 1;
  S.feed.push({ text: `${m.title} complete! +$${m.cash}, +${m.repReward} REP.`, kind: 'good' });
  S.audio.missionDone();
  S.mode = 'missionComplete';
  S.missionResult = { title: m.title, cash: m.cash, rep: m.repReward };
  // Unlock note for the next job.
  const next = MISSIONS[S.mission.index + 1];
  if (next) S.feed.push({ text: `Next job unlocked at REP ${next.rep}: ${next.title}.`, kind: 'good' });
  else S.feed.push({ text: 'THE CORAL CROWN IS YOURS. Palmera Bay remembers Mara Voss.', kind: 'good' });
}

function advanceStep(S) {
  const m = currentMission(S);
  S.mission.step += 1;
  S.mission.timer = 0;
  S.audio.chime();
  if (S.mission.step >= m.steps.length) completeMission(S);
}

/** The objective engine: one tick per frame while a job is active. */
export function stepMissions(S, dt) {
  if (!S.mission.active) return;
  const m = currentMission(S);
  if (!m) return;
  const step = currentStep(S);
  if (!step) return;
  const p = S.player;
  const inCar = !p.onFoot;
  const dist = step.x !== undefined ? Math.hypot(p.x - step.x, p.y - step.y) : Infinity;
  switch (step.type) {
    case 'goto':
      if (dist < step.r) advanceStep(S);
      break;
    case 'collect':
      if (dist < step.r) {
        S.feed.push({ text: `Picked up: ${step.text}.`, kind: 'good' });
        advanceStep(S);
      }
      break;
    case 'steal':
      if (!p.onFoot) advanceStep(S);
      break;
    case 'deliver':
      if (!p.onFoot && dist < step.r) advanceStep(S);
      break;
    case 'loseheat':
      if (S.police.wanted === 0) advanceStep(S);
      break;
    case 'heat': {
      if (S.mission.timer === 0) {
        addWanted(S, step.stars - S.police.wanted > 0 ? step.stars - S.police.wanted : 0, `${step.stars}-star heat`);
        S.police.wanted = Math.max(S.police.wanted, step.stars);
      }
      S.mission.timer += dt;
      const surviveFor = step.text.includes('45') ? 45 : 60;
      if (S.mission.timer >= surviveFor) advanceStep(S);
      break;
    }
    case 'timed': {
      // One shared vault clock across all three stops.
      if (step.seconds > 0 && !S.mission.clock) S.mission.clock = step.seconds;
      if (S.mission.clock) {
        S.mission.clock -= dt;
        if (S.mission.clock <= 0) { failMission(S, 'the vault clock ran out'); return; }
      }
      if (dist < step.r) {
        if (S.mission.clock) S.feed.push({ text: `Stop hit with ${Math.ceil(S.mission.clock)}s to spare.`, kind: 'good' });
        advanceStep(S);
      }
      break;
    }
    default:
      break;
  }
}

/** Where the current objective marker sits (for the map and minimap). */
export function objectiveTarget(S) {
  const step = currentStep(S);
  if (!step || step.x === undefined) return null;
  return { x: step.x, y: step.y, r: step.r || 70 };
}

/** One-line objective text for the HUD banner. */
export function objectiveText(S) {
  const m = currentMission(S);
  if (!m) return 'All six jobs done — the Coral Crown is yours. Free roam.';
  if (!S.mission.active) return `${m.title} — press J to start (needs REP ${m.rep})`;
  const step = currentStep(S);
  return step ? `${m.title}: ${step.text}` : m.title;
}
