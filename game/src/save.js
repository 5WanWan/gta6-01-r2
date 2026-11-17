// save.js — localStorage save and load for Palmera Bay progress.
const SAVE_KEY = 'palmera-bay-save-v1';

/** Snapshot the parts of the game worth keeping between visits. */
export function saveGame(S) {
  const data = {
    version: 1,
    savedAt: Date.now(),
    cash: S.cash,
    rep: S.rep,
    health: S.player.health,
    ammo: S.player.ammo,
    missionsCompleted: S.mission.completed.slice(),
    missionIndex: S.mission.index,
    stats: S.stats,
    playerX: S.player.x,
    playerY: S.player.y,
  };
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Read a save, or null when there is none / it is unreadable. */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadSave() !== null;
}

/** Apply a save onto a fresh state object. */
export function applySave(S, data) {
  S.cash = data.cash || 0;
  S.rep = data.rep || 0;
  S.player.health = data.health || 100;
  S.player.ammo = data.ammo || 24;
  S.mission.completed = Array.isArray(data.missionsCompleted) ? data.missionsCompleted.slice() : [];
  S.mission.index = typeof data.missionIndex === 'number' ? data.missionIndex : 0;
  S.stats = Object.assign({}, S.stats, data.stats || {});
  if (typeof data.playerX === 'number') S.player.x = data.playerX;
  if (typeof data.playerY === 'number') S.player.y = data.playerY;
  // Resume at the next unfinished job.
  const next = S.mission.completed.length;
  S.mission.index = Math.min(next, 5);
}
