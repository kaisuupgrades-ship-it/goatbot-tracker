// Pre-loaded demo picks — example data for demo mode
export const DEMO_CONTEST = {
  id: 'demo',
  user_id: 'demo',
  name: 'My Picks',
  start_date: '2026-04-01',
  bankroll: 100,
};

export const DEMO_PICKS = [
  {
    id: 'pick-1',
    user_id: 'demo',
    date: '2026-04-02',
    sport: 'MLB',
    team: 'Atlanta Braves',
    bet_type: 'Moneyline',
    matchup: 'ATL Braves at ARI Diamondbacks',
    odds: -118,
    book: 'FanDuel',
    result: 'WIN',
    profit: 0.847,
    notes: 'Reynaldo Lopez vs Ryne Nelson — clean pitching mismatch',
  },
  {
    id: 'pick-2',
    user_id: 'demo',
    date: '2026-04-03',
    sport: 'MLB',
    team: 'Pittsburgh Pirates',
    bet_type: 'Moneyline',
    matchup: 'BAL Orioles at PIT Pirates',
    odds: 105,
    book: 'FanDuel',
    result: 'WIN',
    profit: 1.05,
    notes: 'Mitch Keller home opener, Konnor Griffin debut, BAL depleted',
  },
];

// ── localStorage persistence for demo mode ──────────────────────────────────

const PICKS_KEY   = 'goatbot_demo_picks';
const CONTEST_KEY = 'goatbot_demo_contest';

export function loadDemoPicks() {
  if (typeof window === 'undefined') return DEMO_PICKS;
  try {
    const stored = localStorage.getItem(PICKS_KEY);
    return stored ? JSON.parse(stored) : DEMO_PICKS;
  } catch { return DEMO_PICKS; }
}

export function saveDemoPicks(picks) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
}

export function loadDemoContest() {
  if (typeof window === 'undefined') return DEMO_CONTEST;
  try {
    const stored = localStorage.getItem(CONTEST_KEY);
    return stored ? JSON.parse(stored) : DEMO_CONTEST;
  } catch { return DEMO_CONTEST; }
}

export function saveDemoContest(contest) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONTEST_KEY, JSON.stringify(contest));
}

export function clearDemoData() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PICKS_KEY);
  localStorage.removeItem(CONTEST_KEY);
}

// Generate a simple UUID for new demo picks
export function demoId() {
  return 'pick-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}
