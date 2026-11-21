// 기존 저장 키를 유지하여 이름/버전 변경 후에도 즐겨찾기와 이력을 보존합니다.
const key = 'seoul-trail-v1';
const emptyState = () => ({
  version: 2, user: null, favorites: [], saved: [], records: [], reviews: [], plans: [],
  routes: {}, checklists: {}, journals: {}, activeSession: null,
  profile: { experience: 1, fitness: 1, minutes: 180, transport: 'transit' }
});

export function normalizeState(input) {
  const result = emptyState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const name of ['favorites', 'saved']) result[name] = Array.isArray(input[name]) ? [...new Set(input[name].filter(x => typeof x === 'string'))] : [];
  result.records = Array.isArray(input.records) ? input.records.filter(r => r && typeof r.id === 'string' && typeof r.mountainId === 'string' && Number.isFinite(r.km) && r.km >= 0 && Number.isFinite(r.minutes) && r.minutes >= 0 && Array.isArray(r.points)) : [];
  for (const name of ['reviews', 'plans']) result[name] = Array.isArray(input[name]) ? input[name].filter(r => r && typeof r.id === 'string' && typeof r.mountainId === 'string') : [];
  result.user = input.user && typeof input.user.id === 'string' && typeof input.user.name === 'string' ? input.user : null;
  const profile = input.profile || {};
  for (const name of ['experience', 'fitness']) if ([1, 2, 3].includes(Number(profile[name]))) result.profile[name] = Number(profile[name]);
  if ([90, 120, 180, 240, 300].includes(Number(profile.minutes))) result.profile.minutes = Number(profile.minutes);
  if (['transit', 'car'].includes(profile.transport)) result.profile.transport = profile.transport;
  for (const name of ['routes', 'checklists', 'journals']) if (input[name] && typeof input[name] === 'object' && !Array.isArray(input[name])) result[name] = input[name];
  for (const [id, route] of Object.entries(result.routes)) {
    if (!route || typeof route.name !== 'string' || !Number.isFinite(route.km) || !Array.isArray(route.segments)
      || route.segments.some(segment => !Array.isArray(segment) || segment.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat)>90 || Math.abs(p.lng)>180))) delete result.routes[id];
  }
  for (const [id, list] of Object.entries(result.checklists)) if (!Array.isArray(list)) delete result.checklists[id];
  const active = input.activeSession;
  if (active && typeof active.id === 'string' && typeof active.mountainId === 'string' && Number.isFinite(active.startedAt) && Number.isFinite(active.km) && active.km >= 0 && Array.isArray(active.points)) result.activeSession = active;
  return result;
}

export function readStore() {
  try { return normalizeState(JSON.parse(localStorage.getItem(key) || 'null')); }
  catch { return emptyState(); }
}
export const state = readStore();
export function persist() {
  try { localStorage.setItem(key, JSON.stringify(state)); return true; }
  catch { return false; }
}
export function uid() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
