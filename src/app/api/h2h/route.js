import { NextResponse } from 'next/server';

export const maxDuration = 30;

// Sport -> ESPN path
const SPORT_MAP = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
};

// Cache for up to 1 hour (H2H history doesn't change mid-game)
const CACHE = new Map();
const CACHE_TTL = 60 * 60 * 1000;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sport  = searchParams.get('sport') || 'mlb';
  const team1  = searchParams.get('team1');   // ESPN team ID for "home" perspective
  const team2  = searchParams.get('team2');
  const abbrHome = searchParams.get('abbrHome') || '?'; // for display
  const abbrAway = searchParams.get('abbrAway') || '?';

  const espnPath = SPORT_MAP[sport];
  if (!espnPath || !team1 || !team2) {
    return NextResponse.json({ error: 'Missing required params: sport, team1, team2' }, { status: 400 });
  }

  const cacheKey = `${sport}-${team1}-${team2}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const allGames = [];

  for (const year of years) {
    if (allGames.length >= 20) break; // already have enough history
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team1}/schedule?season=${year}&seasontype=2`;
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of (data.events || [])) {
        const comp  = event.competitions?.[0];
        if (!comp) continue;

        // Must be completed
        const completed = event.status?.type?.completed || comp.status?.type?.completed;
        if (!completed) continue;

        // Must involve team2
        const comps = comp.competitors || [];
        const isH2H = comps.some(c => String(c.team?.id) === String(team2));
        if (!isH2H) continue;

        const t1 = comps.find(c => String(c.team?.id) === String(team1));
        const t2 = comps.find(c => String(c.team?.id) === String(team2));
        if (!t1 || !t2) continue;

        const s1 = parseInt(t1.score ?? 0);
        const s2 = parseInt(t2.score ?? 0);
        const t1Won = t1.winner === true || (!t1.winner && !t2.winner && s1 > s2);

        const isHome = t1.homeAway === 'home';
        allGames.push({
          date:    event.date?.substring(0, 10) || '',
          season:  year,
          score1:  s1,
          score2:  s2,
          t1Won,
          isHome,   // true = team1 was home
        });
      }
    } catch {
      // Skip year on error
    }
  }

  // Sort newest first
  allGames.sort((a, b) => (b.date > a.date ? 1 : -1));
  const last20 = allGames.slice(0, 20);

  const wins   = last20.filter(g => g.t1Won).length;
  const losses = last20.filter(g => !g.t1Won).length;

  const result = {
    abbrHome,
    abbrAway,
    record: { wins, losses, total: last20.length },
    games: last20,   // newest-first, each: { date, season, score1, score2, t1Won, isHome }
  };

  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return NextResponse.json(result);
}
