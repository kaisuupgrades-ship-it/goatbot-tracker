/**
 * teamNormalizer.js
 *
 * Deterministic team/player name normalization. No AI required.
 *
 * When a user or the parse-slip AI returns "Detroit" for an MLB pick,
 * normalizeTeam("Detroit", "MLB") returns "Detroit Tigers" — the full
 * official name that ESPN returns in scoreboard data.
 *
 * This is the single source of truth for team name normalization.
 * All aliases are lowercase for case-insensitive matching.
 */

const TEAM_MAP = {
  MLB: [
    { name: 'Arizona Diamondbacks',   aliases: ['diamondbacks', 'd-backs', 'dbacks', 'ari', 'arizona'] },
    { name: 'Atlanta Braves',          aliases: ['braves', 'atl', 'atlanta'] },
    { name: 'Baltimore Orioles',       aliases: ['orioles', 'bal', 'baltimore', 'o\'s', 'os'] },
    { name: 'Boston Red Sox',          aliases: ['red sox', 'bos', 'boston', 'sox', 'redsox'] },
    { name: 'Chicago White Sox',       aliases: ['white sox', 'chw', 'cws', 'chicago white', 'whitesox'] },
    { name: 'Chicago Cubs',            aliases: ['cubs', 'chc', 'north side'] },
    { name: 'Cincinnati Reds',         aliases: ['reds', 'cin', 'cincinnati'] },
    { name: 'Cleveland Guardians',     aliases: ['guardians', 'cle', 'cleveland'] },
    { name: 'Colorado Rockies',        aliases: ['rockies', 'col', 'colorado'] },
    { name: 'Detroit Tigers',          aliases: ['tigers', 'det', 'detroit'] },
    { name: 'Houston Astros',          aliases: ['astros', 'hou', 'houston'] },
    { name: 'Kansas City Royals',      aliases: ['royals', 'kc', 'kcr', 'kansas city'] },
    { name: 'Los Angeles Angels',      aliases: ['angels', 'laa', 'anaheim', 'la angels', 'halos'] },
    { name: 'Los Angeles Dodgers',     aliases: ['dodgers', 'lad', 'la dodgers', 'la'] },
    { name: 'Miami Marlins',           aliases: ['marlins', 'mia', 'miami', 'fla', 'florida'] },
    { name: 'Milwaukee Brewers',       aliases: ['brewers', 'mil', 'milwaukee'] },
    { name: 'Minnesota Twins',         aliases: ['twins', 'min', 'minnesota'] },
    { name: 'New York Mets',           aliases: ['mets', 'nym', 'ny mets'] },
    { name: 'New York Yankees',        aliases: ['yankees', 'nyy', 'ny yankees', 'yanks', 'new york yankees'] },
    { name: 'Oakland Athletics',       aliases: ['athletics', 'oak', 'oakland', "a's", 'as', 'sac', 'sacramento'] },
    { name: 'Philadelphia Phillies',   aliases: ['phillies', 'phi', 'philadelphia', 'phils'] },
    { name: 'Pittsburgh Pirates',      aliases: ['pirates', 'pit', 'pittsburgh'] },
    { name: 'San Diego Padres',        aliases: ['padres', 'sd', 'sdp', 'san diego'] },
    { name: 'San Francisco Giants',    aliases: ['giants', 'sf', 'sfg', 'san francisco'] },
    { name: 'Seattle Mariners',        aliases: ['mariners', 'sea', 'seattle', 'm\'s', 'ms'] },
    { name: 'St. Louis Cardinals',     aliases: ['cardinals', 'stl', 'st louis', 'st. louis', 'cards', 'redbirds'] },
    { name: 'Tampa Bay Rays',          aliases: ['rays', 'tb', 'tbr', 'tampa', 'tampa bay'] },
    { name: 'Texas Rangers',           aliases: ['rangers', 'tex', 'texas'] },
    { name: 'Toronto Blue Jays',       aliases: ['blue jays', 'tor', 'toronto', 'jays', 'bluejays'] },
    { name: 'Washington Nationals',    aliases: ['nationals', 'wsh', 'was', 'washington', 'nats'] },
  ],

  NBA: [
    { name: 'Atlanta Hawks',           aliases: ['hawks', 'atl', 'atlanta'] },
    { name: 'Boston Celtics',          aliases: ['celtics', 'bos', 'boston'] },
    { name: 'Brooklyn Nets',           aliases: ['nets', 'bkn', 'brooklyn'] },
    { name: 'Charlotte Hornets',       aliases: ['hornets', 'cha', 'charlotte'] },
    { name: 'Chicago Bulls',           aliases: ['bulls', 'chi', 'chicago'] },
    { name: 'Cleveland Cavaliers',     aliases: ['cavaliers', 'cle', 'cleveland', 'cavs'] },
    { name: 'Dallas Mavericks',        aliases: ['mavericks', 'dal', 'dallas', 'mavs'] },
    { name: 'Denver Nuggets',          aliases: ['nuggets', 'den', 'denver'] },
    { name: 'Detroit Pistons',         aliases: ['pistons', 'det', 'detroit'] },
    { name: 'Golden State Warriors',   aliases: ['warriors', 'gsw', 'golden state', 'gs', 'dubs'] },
    { name: 'Houston Rockets',         aliases: ['rockets', 'hou', 'houston'] },
    { name: 'Indiana Pacers',          aliases: ['pacers', 'ind', 'indiana'] },
    { name: 'Los Angeles Clippers',    aliases: ['clippers', 'lac', 'la clippers', 'clips'] },
    { name: 'Los Angeles Lakers',      aliases: ['lakers', 'lal', 'la lakers', 'la'] },
    { name: 'Memphis Grizzlies',       aliases: ['grizzlies', 'mem', 'memphis', 'grizz'] },
    { name: 'Miami Heat',              aliases: ['heat', 'mia', 'miami'] },
    { name: 'Milwaukee Bucks',         aliases: ['bucks', 'mil', 'milwaukee'] },
    { name: 'Minnesota Timberwolves',  aliases: ['timberwolves', 'min', 'minnesota', 'twolves', 'wolves'] },
    { name: 'New Orleans Pelicans',    aliases: ['pelicans', 'nop', 'new orleans', 'pels'] },
    { name: 'New York Knicks',         aliases: ['knicks', 'nyk', 'new york', 'ny knicks', 'ny'] },
    { name: 'Oklahoma City Thunder',   aliases: ['thunder', 'okc', 'oklahoma', 'oklahoma city'] },
    { name: 'Orlando Magic',           aliases: ['magic', 'orl', 'orlando'] },
    { name: 'Philadelphia 76ers',      aliases: ['76ers', 'phi', 'philadelphia', 'sixers', '76', 'philly'] },
    { name: 'Phoenix Suns',            aliases: ['suns', 'phx', 'phoenix'] },
    { name: 'Portland Trail Blazers',  aliases: ['trail blazers', 'blazers', 'por', 'portland', 'trailblazers'] },
    { name: 'Sacramento Kings',        aliases: ['kings', 'sac', 'sacramento'] },
    { name: 'San Antonio Spurs',       aliases: ['spurs', 'sas', 'san antonio'] },
    { name: 'Toronto Raptors',         aliases: ['raptors', 'tor', 'toronto'] },
    { name: 'Utah Jazz',               aliases: ['jazz', 'uta', 'utah'] },
    { name: 'Washington Wizards',      aliases: ['wizards', 'wsh', 'washington', 'wiz'] },
  ],

  NFL: [
    { name: 'Arizona Cardinals',       aliases: ['cardinals', 'ari', 'arizona', 'az cards', 'az cardinals'] },
    { name: 'Atlanta Falcons',         aliases: ['falcons', 'atl', 'atlanta'] },
    { name: 'Baltimore Ravens',        aliases: ['ravens', 'bal', 'baltimore'] },
    { name: 'Buffalo Bills',           aliases: ['bills', 'buf', 'buffalo'] },
    { name: 'Carolina Panthers',       aliases: ['panthers', 'car', 'carolina'] },
    { name: 'Chicago Bears',           aliases: ['bears', 'chi', 'chicago'] },
    { name: 'Cincinnati Bengals',      aliases: ['bengals', 'cin', 'cincinnati'] },
    { name: 'Cleveland Browns',        aliases: ['browns', 'cle', 'cleveland'] },
    { name: 'Dallas Cowboys',          aliases: ['cowboys', 'dal', 'dallas', "america's team"] },
    { name: 'Denver Broncos',          aliases: ['broncos', 'den', 'denver'] },
    { name: 'Detroit Lions',           aliases: ['lions', 'det', 'detroit'] },
    { name: 'Green Bay Packers',       aliases: ['packers', 'gb', 'green bay', 'gnb'] },
    { name: 'Houston Texans',          aliases: ['texans', 'hou', 'houston'] },
    { name: 'Indianapolis Colts',      aliases: ['colts', 'ind', 'indianapolis', 'indy'] },
    { name: 'Jacksonville Jaguars',    aliases: ['jaguars', 'jax', 'jacksonville', 'jags'] },
    { name: 'Kansas City Chiefs',      aliases: ['chiefs', 'kc', 'kcr', 'kansas city'] },
    { name: 'Las Vegas Raiders',       aliases: ['raiders', 'lv', 'lvr', 'las vegas', 'oakland', 'vegas'] },
    { name: 'Los Angeles Chargers',    aliases: ['chargers', 'lac', 'la chargers', 'sd chargers'] },
    { name: 'Los Angeles Rams',        aliases: ['rams', 'lar', 'la rams', 'st louis rams'] },
    { name: 'Miami Dolphins',          aliases: ['dolphins', 'mia', 'miami', 'fins'] },
    { name: 'Minnesota Vikings',       aliases: ['vikings', 'min', 'minnesota', 'vikes'] },
    { name: 'New England Patriots',    aliases: ['patriots', 'ne', 'new england', 'pats'] },
    { name: 'New Orleans Saints',      aliases: ['saints', 'no', 'new orleans', 'nos'] },
    { name: 'New York Giants',         aliases: ['giants', 'nyg', 'ny giants'] },
    { name: 'New York Jets',           aliases: ['jets', 'nyj', 'ny jets'] },
    { name: 'Philadelphia Eagles',     aliases: ['eagles', 'phi', 'philadelphia', 'philly', 'birds'] },
    { name: 'Pittsburgh Steelers',     aliases: ['steelers', 'pit', 'pittsburgh', 'stillers'] },
    { name: 'San Francisco 49ers',     aliases: ['49ers', 'sf', 'sfg', 'san francisco', 'niners', '49'] },
    { name: 'Seattle Seahawks',        aliases: ['seahawks', 'sea', 'seattle', 'hawks'] },
    { name: 'Tampa Bay Buccaneers',    aliases: ['buccaneers', 'tb', 'tampa', 'tampa bay', 'bucs'] },
    { name: 'Tennessee Titans',        aliases: ['titans', 'ten', 'tennessee'] },
    { name: 'Washington Commanders',   aliases: ['commanders', 'wsh', 'washington', 'redskins', 'football team'] },
  ],

  NHL: [
    { name: 'Anaheim Ducks',           aliases: ['ducks', 'ana', 'anaheim'] },
    { name: 'Boston Bruins',           aliases: ['bruins', 'bos', 'boston', 'b\'s'] },
    { name: 'Buffalo Sabres',          aliases: ['sabres', 'buf', 'buffalo'] },
    { name: 'Calgary Flames',          aliases: ['flames', 'cgy', 'calgary'] },
    { name: 'Carolina Hurricanes',     aliases: ['hurricanes', 'car', 'carolina', 'canes'] },
    { name: 'Chicago Blackhawks',      aliases: ['blackhawks', 'chi', 'chicago', 'hawks'] },
    { name: 'Colorado Avalanche',      aliases: ['avalanche', 'col', 'colorado', 'avs'] },
    { name: 'Columbus Blue Jackets',   aliases: ['blue jackets', 'cbj', 'columbus', 'jackets'] },
    { name: 'Dallas Stars',            aliases: ['stars', 'dal', 'dallas'] },
    { name: 'Detroit Red Wings',       aliases: ['red wings', 'det', 'detroit', 'wings'] },
    { name: 'Edmonton Oilers',         aliases: ['oilers', 'edm', 'edmonton'] },
    { name: 'Florida Panthers',        aliases: ['panthers', 'fla', 'florida'] },
    { name: 'Los Angeles Kings',       aliases: ['kings', 'lak', 'la kings', 'la'] },
    { name: 'Minnesota Wild',          aliases: ['wild', 'min', 'minnesota'] },
    { name: 'Montreal Canadiens',      aliases: ['canadiens', 'mtl', 'montreal', 'habs'] },
    { name: 'Nashville Predators',     aliases: ['predators', 'nsh', 'nashville', 'preds'] },
    { name: 'New Jersey Devils',       aliases: ['devils', 'njd', 'new jersey', 'nj'] },
    { name: 'New York Islanders',      aliases: ['islanders', 'nyi', 'ny islanders', 'isles'] },
    { name: 'New York Rangers',        aliases: ['rangers', 'nyr', 'ny rangers', 'new york'] },
    { name: 'Ottawa Senators',         aliases: ['senators', 'ott', 'ottawa', 'sens'] },
    { name: 'Philadelphia Flyers',     aliases: ['flyers', 'phi', 'philadelphia'] },
    { name: 'Pittsburgh Penguins',     aliases: ['penguins', 'pit', 'pittsburgh', 'pens'] },
    { name: 'San Jose Sharks',         aliases: ['sharks', 'sjs', 'san jose'] },
    { name: 'Seattle Kraken',          aliases: ['kraken', 'sea', 'seattle'] },
    { name: 'St. Louis Blues',         aliases: ['blues', 'stl', 'st louis', 'st. louis'] },
    { name: 'Tampa Bay Lightning',     aliases: ['lightning', 'tb', 'tbl', 'tampa', 'tampa bay', 'bolts'] },
    { name: 'Toronto Maple Leafs',     aliases: ['maple leafs', 'tor', 'toronto', 'leafs'] },
    { name: 'Utah Hockey Club',        aliases: ['utah hc', 'utc', 'utah', 'hockey club'] },
    { name: 'Vancouver Canucks',       aliases: ['canucks', 'van', 'vancouver'] },
    { name: 'Vegas Golden Knights',    aliases: ['golden knights', 'vgk', 'vegas', 'las vegas', 'knights'] },
    { name: 'Washington Capitals',     aliases: ['capitals', 'wsh', 'washington', 'caps'] },
    { name: 'Winnipeg Jets',           aliases: ['jets', 'wpg', 'winnipeg'] },
  ],
};

/**
 * Given a raw team name and sport, return the normalized full official name.
 *
 * Examples:
 *   normalizeTeam("detroit", "MLB")  → "Detroit Tigers"
 *   normalizeTeam("Cubs", "MLB")     → "Chicago Cubs"
 *   normalizeTeam("GS", "NBA")       → "Golden State Warriors"
 *   normalizeTeam("Padres", "MLB")   → "San Diego Padres"
 *   normalizeTeam("Liverpool FC", "Soccer") → "Liverpool FC" (no change)
 *
 * Returns the original string unchanged if no match is found.
 */
export function normalizeTeam(team, sport) {
  if (!team || !sport) return team;

  const sportKey = sport.toUpperCase();
  const teams = TEAM_MAP[sportKey];
  if (!teams) return team; // Soccer, Other, UFC — no normalization needed

  const teamLower = team.toLowerCase().trim();

  for (const t of teams) {
    // Exact full name match (case-insensitive)
    if (t.name.toLowerCase() === teamLower) return t.name;

    // Alias match
    for (const alias of t.aliases) {
      if (alias === teamLower) return t.name;
      // Partial: "tigers" is in "detroit tigers" — match if alias is a full word in the input
      if (teamLower === alias) return t.name;
    }
  }

  // Second pass: fuzzy — team input is fully contained in official name or vice versa
  for (const t of teams) {
    const officialLower = t.name.toLowerCase();
    if (officialLower.includes(teamLower) || teamLower.includes(officialLower)) {
      return t.name;
    }
    for (const alias of t.aliases) {
      if (teamLower.includes(alias) || alias.includes(teamLower)) {
        return t.name;
      }
    }
  }

  return team; // No match — return as-is
}

/**
 * Normalize a full parsed pick object in place.
 * Fixes team name + ensures sport casing is correct.
 */
export function normalizeParsedPick(parsed) {
  if (!parsed) return parsed;
  // Handle array of picks
  if (Array.isArray(parsed)) {
    return parsed.map(p => normalizeParsedPick(p));
  }
  if (parsed.team && parsed.sport) {
    parsed.team = normalizeTeam(parsed.team, parsed.sport);
  }
  return parsed;
}
