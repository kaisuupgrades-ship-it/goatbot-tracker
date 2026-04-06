import { NextResponse } from 'next/server';

export const maxDuration = 15;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
  ufc:   'mma/ufc',
};

// Keywords that indicate a story is injury/roster/lineup related
const INJURY_KEYWORDS = [
  'injur', 'injury', 'injured', 'il ', 'injured list', 'disabled list',
  'day-to-day', 'dtd', 'out for', 'ruled out', 'questionable', 'doubtful',
  'probable', 'game-time', 'scratch', 'scratched', 'miss', 'missed', 'missing',
  'surgery', 'sprain', 'strain', 'fracture', 'torn', 'hamstring', 'knee',
  'ankle', 'shoulder', 'concussion', 'back injury', 'wrist', 'oblique',
  'lineup', 'starting', 'starter', 'roster', 'activated', 'placed on',
  'return', 'rehab', 'suspension', 'suspended', 'trade', 'traded', 'waived',
  'signed', 'undisclosed', 'illness',
];

function isInjuryArticle(article) {
  const text = `${article.headline || ''} ${article.description || ''} ${article.story || ''}`.toLowerCase();
  return INJURY_KEYWORDS.some(kw => text.includes(kw));
}

async function fetchESPN(path) {
  const res = await fetch(`${ESPN_BASE}/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${path}`);
  return res.json();
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sportParam = searchParams.get('sport') || 'mlb';
  const sport = sportParam === 'all' ? 'mlb' : sportParam;

  const sportPath = SPORT_PATHS[sport];
  if (!sportPath) {
    return NextResponse.json({ error: `Unknown sport: ${sport}` }, { status: 400 });
  }

  // Fetch news + injury roster in parallel
  const [newsResult, injuryResult] = await Promise.allSettled([
    fetchESPN(`${sportPath}/news`),
    fetchESPN(`${sportPath}/injuries`),
  ]);

  // ── Parse news articles ───────────────────────────────────────────────────
  const rawArticles = newsResult.status === 'fulfilled'
    ? (newsResult.value.articles || [])
    : [];

  // Sort by publish date descending
  const sorted = [...rawArticles].sort((a, b) => {
    const ta = a.published ? new Date(a.published).getTime() : 0;
    const tb = b.published ? new Date(b.published).getTime() : 0;
    return tb - ta;
  });

  // Injury articles first, then fill with general news if not enough
  const injuryArticles = sorted.filter(a => isInjuryArticle(a));
  const otherArticles  = sorted.filter(a => !isInjuryArticle(a));

  // Combine: injury articles first, pad with general news so we always have ~10
  const articles = [...injuryArticles, ...otherArticles].slice(0, 15).map(a => ({
    headline:    a.headline || '',
    description: a.description || a.story || '',
    published:   a.published || null,
    url:         a.links?.web?.href || null,
    imageUrl:    a.images?.[0]?.url || null,
    isInjury:    isInjuryArticle(a),
    team:        a.categories?.find(c => c.type === 'team')?.description || null,
  }));

  // ── Parse injury roster ───────────────────────────────────────────────────
  // ESPN injuries endpoint nests data as: { seasons: [{ teams: [{ injuries: [...] }] }] }
  // OR sometimes as flat { injuries: [...] } depending on sport. Handle both.
  let rawInjuries = [];
  if (injuryResult.status === 'fulfilled') {
    const injData = injuryResult.value;
    if (Array.isArray(injData.injuries)) {
      rawInjuries = injData.injuries;
    } else if (Array.isArray(injData.seasons)) {
      // Flatten: seasons -> teams -> injuries
      for (const season of injData.seasons) {
        for (const teamObj of (season.teams || [])) {
          const teamName = teamObj.team?.abbreviation || teamObj.team?.shortName || '';
          for (const inj of (teamObj.injuries || [])) {
            rawInjuries.push({ ...inj, _team: teamName });
          }
        }
      }
    }
  }

  // Prioritize key statuses: Out > Doubtful > Questionable > Day-to-Day > other
  const STATUS_PRIORITY = { out: 0, doubtful: 1, questionable: 2, 'day-to-day': 3 };
  const players = rawInjuries.map(entry => ({
    name:   entry.athlete?.displayName || entry.athlete?.shortName || entry.displayName || '?',
    team:   entry.team?.abbreviation || entry._team || '',
    status: entry.status || entry.type?.name || entry.type || '',
    detail: entry.details?.detail || entry.details?.type || entry.longComment || entry.shortComment || '',
    side:   entry.details?.side || '',
    date:   entry.date || null,
  }))
    .filter(p => p.name !== '?')
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status.toLowerCase()] ?? 99;
      const pb = STATUS_PRIORITY[b.status.toLowerCase()] ?? 99;
      return pa - pb;
    })
    .slice(0, 40);

  return NextResponse.json({ articles, players, sport });
}
