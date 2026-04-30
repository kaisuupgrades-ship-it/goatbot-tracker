/**
 * Stadium DB + helpers — shared between client (ScoreboardTab) and server
 * (api/sports enrichment). Single source of truth for lat/lon, dome flags,
 * and ESPN abbreviation aliases.
 */

export const MLB_STADIUMS = {
  ARI: { lat: 33.445, lon: -112.067, name: 'Chase Field',           retractable: true },
  ATL: { lat: 33.890, lon: -84.468,  name: 'Truist Park',           orientation: 58  },
  BAL: { lat: 39.284, lon: -76.622,  name: 'Oriole Park',           orientation: 30  },
  BOS: { lat: 42.347, lon: -71.097,  name: 'Fenway Park',           orientation: 90  },
  CHC: { lat: 41.948, lon: -87.656,  name: 'Wrigley Field',         orientation: 180 },
  CWS: { lat: 41.830, lon: -87.634,  name: 'Guaranteed Rate Field', orientation: 5   },
  CIN: { lat: 39.097, lon: -84.507,  name: 'Great American BP',     orientation: 25  },
  CLE: { lat: 41.496, lon: -81.685,  name: 'Progressive Field',     orientation: 30  },
  COL: { lat: 39.756, lon: -104.994, name: 'Coors Field',           orientation: 20  },
  DET: { lat: 42.339, lon: -83.048,  name: 'Comerica Park',         orientation: 20  },
  HOU: { lat: 29.757, lon: -95.355,  name: 'Minute Maid Park',      retractable: true },
  KC:  { lat: 39.051, lon: -94.480,  name: 'Kauffman Stadium',      orientation: 40  },
  LAA: { lat: 33.800, lon: -117.883, name: 'Angel Stadium',         orientation: 35  },
  LAD: { lat: 34.074, lon: -118.240, name: 'Dodger Stadium',        orientation: 35  },
  MIA: { lat: 25.778, lon: -80.220,  name: 'loanDepot park',        retractable: true },
  MIL: { lat: 43.028, lon: -87.971,  name: 'American Family Field', retractable: true },
  MIN: { lat: 44.982, lon: -93.278,  name: 'Target Field',          orientation: 20  },
  NYM: { lat: 40.757, lon: -73.846,  name: 'Citi Field',            orientation: 35  },
  NYY: { lat: 40.829, lon: -73.926,  name: 'Yankee Stadium',        orientation: 60  },
  OAK: { lat: 37.752, lon: -122.201, name: 'Oakland Coliseum',      orientation: 28  },
  PHI: { lat: 39.906, lon: -75.167,  name: 'Citizens Bank Park',    orientation: 10  },
  PIT: { lat: 40.447, lon: -80.006,  name: 'PNC Park',              orientation: 35  },
  SD:  { lat: 32.707, lon: -117.157, name: 'Petco Park',            orientation: 25  },
  SEA: { lat: 47.591, lon: -122.333, name: 'T-Mobile Park',         retractable: true },
  SF:  { lat: 37.778, lon: -122.389, name: 'Oracle Park',           orientation: 50  },
  STL: { lat: 38.623, lon: -90.193,  name: 'Busch Stadium',         orientation: 10  },
  TB:  { lat: 27.768, lon: -82.653,  name: 'Tropicana Field',       dome: true },
  TEX: { lat: 32.747, lon: -97.083,  name: 'Globe Life Field',      retractable: true },
  TOR: { lat: 43.641, lon: -79.389,  name: 'Rogers Centre',         retractable: true },
  WSH: { lat: 38.873, lon: -77.007,  name: 'Nationals Park',        orientation: 33  },
};

export const NFL_STADIUMS = {
  BUF: { lat: 42.774, lon: -78.787,  name: 'Highmark Stadium',       orientation: 0   },
  NE:  { lat: 42.091, lon: -71.264,  name: 'Gillette Stadium',        orientation: 0   },
  NYG: { lat: 40.813, lon: -74.074,  name: 'MetLife Stadium',         orientation: 0   },
  NYJ: { lat: 40.813, lon: -74.074,  name: 'MetLife Stadium',         orientation: 0   },
  PHI: { lat: 39.901, lon: -75.168,  name: 'Lincoln Financial Field', orientation: 0   },
  PIT: { lat: 40.447, lon: -80.016,  name: 'Acrisure Stadium',        orientation: 0   },
  BAL: { lat: 39.278, lon: -76.623,  name: 'M&T Bank Stadium',        orientation: 0   },
  CLE: { lat: 41.506, lon: -81.699,  name: 'Cleveland Browns Stadium',orientation: 0   },
  CIN: { lat: 39.095, lon: -84.516,  name: 'Paycor Stadium',          orientation: 0   },
  TEN: { lat: 36.166, lon: -86.771,  name: 'Nissan Stadium',          orientation: 0   },
  JAX: { lat: 30.324, lon: -81.638,  name: 'EverBank Stadium',        orientation: 0   },
  HOU: { lat: 29.685, lon: -95.411,  name: 'NRG Stadium',             dome: true },
  IND: { lat: 39.760, lon: -86.164,  name: 'Lucas Oil Stadium',       dome: true },
  KC:  { lat: 39.049, lon: -94.484,  name: 'Arrowhead Stadium',       orientation: 0   },
  DEN: { lat: 39.744, lon: -105.020, name: "Empower Field",           orientation: 0   },
  LAC: { lat: 33.953, lon: -118.339, name: 'SoFi Stadium',            dome: true },
  LAR: { lat: 33.953, lon: -118.339, name: 'SoFi Stadium',            dome: true },
  LV:  { lat: 36.091, lon: -115.184, name: 'Allegiant Stadium',       dome: true },
  SEA: { lat: 47.595, lon: -122.332, name: 'Lumen Field',             orientation: 0   },
  SF:  { lat: 37.403, lon: -121.970, name: "Levi's Stadium",          orientation: 0   },
  ARI: { lat: 33.527, lon: -112.263, name: 'State Farm Stadium',      dome: true },
  MIA: { lat: 25.958, lon: -80.239,  name: 'Hard Rock Stadium',       orientation: 0   },
  TB:  { lat: 27.976, lon: -82.503,  name: 'Raymond James Stadium',   orientation: 0   },
  ATL: { lat: 33.755, lon: -84.401,  name: 'Mercedes-Benz Stadium',   dome: true },
  NO:  { lat: 29.951, lon: -90.081,  name: 'Caesars Superdome',       dome: true },
  CAR: { lat: 35.226, lon: -80.853,  name: 'Bank of America Stadium', orientation: 0   },
  CHI: { lat: 41.862, lon: -87.617,  name: 'Soldier Field',           orientation: 0   },
  GB:  { lat: 44.501, lon: -88.062,  name: 'Lambeau Field',           orientation: 0   },
  MIN: { lat: 44.974, lon: -93.258,  name: 'U.S. Bank Stadium',       dome: true },
  DET: { lat: 42.340, lon: -83.046,  name: 'Ford Field',              dome: true },
  DAL: { lat: 32.748, lon: -97.093,  name: 'AT&T Stadium',            retractable: true },
  WAS: { lat: 38.908, lon: -76.864,  name: 'Northwest Stadium',       orientation: 0   },
};

// ESPN sometimes returns different abbreviations than our stadium DB keys
export const MLB_ESPN_ALIASES = {
  'CHW': 'CWS',  // Chicago White Sox (ESPN uses CHW, our DB uses CWS)
  'WSH': 'WSH',  // Washington Nationals — both the same, kept for clarity
};
export const NFL_ESPN_ALIASES = {
  'WAS': 'WAS',  // Washington Commanders — ESPN uses WAS
};

export function getStadiumInfo(sport, homeAbbr) {
  if (!homeAbbr) return null;
  if (sport === 'mlb') {
    const key = MLB_ESPN_ALIASES[homeAbbr] ?? homeAbbr;
    return MLB_STADIUMS[key] || null;
  }
  if (sport === 'nfl') {
    const key = NFL_ESPN_ALIASES[homeAbbr] ?? homeAbbr;
    return NFL_STADIUMS[key] || null;
  }
  return null;
}

// Sports where weather is never relevant (indoor arenas)
export const INDOOR_SPORTS = new Set(['nba', 'nhl', 'ncaab', 'wnba']);
