'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import VoiceButton from '@/components/VoiceInput';
import { addPick } from '@/lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

// ────────────────────────────────────────────────────────────────────────────
// GOAT PICK CARD — premium result renderer
// ────────────────────────────────────────────────────────────────────────────

const CONF_STYLES = {
  ELITE:  { color: '#00D48B', bg: 'rgba(0,212,139,0.1)',  border: 'rgba(0,212,139,0.3)'  },
  HIGH:   { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.25)' },
  MEDIUM: { color: '#FFB800', bg: 'rgba(255,184,0,0.08)', border: 'rgba(255,184,0,0.25)'  },
  LOW:    { color: '#888',    bg: 'rgba(136,136,136,0.08)', border: 'rgba(136,136,136,0.2)'},
};

// Strip markdown formatting and source URLs from text
function stripMarkdown(text) {
  return (text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // **bold** → plain
    .replace(/\*([^*\n]{1,120})\*/g, '$1')        // *italic* → plain
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1') // [text](url) → text
    .replace(/https?:\/\/\S+/g, '')               // bare URLs
    .replace(/\s{2,}/g, ' ')                       // collapse extra spaces
    .trim();
}

function renderRichLines(text) {
  const lines = text.split('\n');
  // Pre-filter: remove source reference lines and bare URL lines
  const filtered = lines.filter(line => {
    const t = line.trim();
    if (!t) return true; // keep blank lines for spacing
    if (/^sources?:?\s*$/i.test(t)) return false;
    if (/^\[\d+\]\s*https?:\/\//.test(t)) return false;
    if (/^references?:?\s*$/i.test(t)) return false;
    const afterUrlStrip = t.replace(/https?:\/\/\S+/g, '').trim();
    if (!afterUrlStrip) return false; // line was only a URL
    return true;
  });

  return filtered.map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: '0.4rem' }} />;

    // Section headers — ALL CAPS words followed by colon
    if (/^[A-Z][A-Z\s\/\-]{3,}:/.test(line)) {
      return (
        <div key={i} style={{
          fontWeight: 700, color: '#FFB800', fontSize: '0.72rem',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          marginTop: '1rem', marginBottom: '0.2rem',
          borderBottom: '1px solid #1f1f1f', paddingBottom: '4px',
        }}>
          {stripMarkdown(line)}
        </div>
      );
    }
    // Numbered bullets
    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)[1];
      const body = stripMarkdown(line.replace(/^\d+\.\s*/, ''));
      return (
        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '4px' }}>
          <span style={{ color: '#FFB800', fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', flexShrink: 0, marginTop: '2px', minWidth: '16px' }}>{num}.</span>
          <span style={{ color: '#d0d0d0', fontSize: '0.87rem', lineHeight: 1.6 }}>{body}</span>
        </div>
      );
    }
    // Dash bullets
    if (/^[-•]\s/.test(line)) {
      const body = stripMarkdown(line.replace(/^[-•]\s*/, ''));
      return (
        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '3px' }}>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }}>›</span>
          <span style={{ color: '#d0d0d0', fontSize: '0.87rem', lineHeight: 1.6 }}>{body}</span>
        </div>
      );
    }
    // Regular line
    const clean = stripMarkdown(line);
    if (!clean) return null;
    return (
      <div key={i} style={{ color: '#bbb', fontSize: '0.87rem', lineHeight: 1.7 }}>
        {clean}
      </div>
    );
  });
}

// ── BetOS PICK CARD — AI-Powered Pick Report ────────────────────────────

// Parse key metrics out of the AI text
// ── Shared extraction helpers (used by parseReport + history rows) ────────────

// Robust confidence extractor — tries multiple AI output patterns
function extractConf(text) {
  const t = text || '';
  // Pattern 1: "CONFIDENCE: HIGH" (canonical, enforced by system prompt)
  const m1 = t.match(/CONFIDENCE\s*:\s*(LOW|MEDIUM|HIGH|ELITE)/i);
  if (m1) return m1[1].toUpperCase();
  // Pattern 2: "HIGH CONFIDENCE" or "ELITE confidence"
  const m2 = t.match(/\b(ELITE|HIGH|MEDIUM|LOW)\s+CONFIDENCE\b/i);
  if (m2) return m2[1].toUpperCase();
  // Pattern 3: "Confidence level is HIGH" / "confidence: **HIGH**"
  const m3 = t.match(/confidence\b[^:\n]*:\s*\**\s*(LOW|MEDIUM|HIGH|ELITE)\s*\**/i);
  if (m3) return m3[1].toUpperCase();
  // Pattern 4: "My confidence here is HIGH"
  const m4 = t.match(/\bconfidence(?:\s+(?:is|level|rating))[^:\n]{0,20}?(LOW|MEDIUM|HIGH|ELITE)/i);
  if (m4) return m4[1].toUpperCase();
  return null;
}

// Extract edge score from various AI formats
function extractEdge(text) {
  const t = text || '';
  const m1 = t.match(/EDGE\s+SCORE\s*:\s*(\d{1,2})\s*\/\s*10/i);
  if (m1) return parseInt(m1[1]);
  const m2 = t.match(/edge\s*(?:score|rating)?\s*[:\-]\s*(\d{1,2})\s*\/\s*10/i);
  if (m2) return parseInt(m2[1]);
  const m3 = t.match(/(\d{1,2})\s*\/\s*10\s+edge/i);
  if (m3) return parseInt(m3[1]);
  return null;
}

// Clean prompt for display — strip context prefixes and "Run a full BetOS analysis on"
function cleanPromptDisplay(prompt, maxLen = 72) {
  return (prompt || '')
    .replace(/^\[(?:Today|Target date|TOURNAMENT|EVENT|FUTURES)[^\]]*\]\n?/i, '')
    .replace(/^Run a full BetOS analysis on\s*/i, '')
    .replace(/^\[.*?\]\n?/g, '') // any remaining bracket prefixes
    .trim()
    .slice(0, maxLen);
}

function parseReport(text) {
  const t = text || '';

  // THE PICK — match "THE PICK:" followed by the actual bet on the same line
  // Be careful NOT to capture date context like "for April 5, 2026" when the AI
  // writes "Best Pick for April 5, 2026:" — only capture if line has team/odds content
  const pickM = t.match(/(?:^|\n)THE PICK\s*:\s*([^\n]{5,100})/im)
             || t.match(/(?:^|\n)(?:MY PICK|BEST PICK)\s*:\s*([^\n]{5,100})/im);
  let pick = pickM ? stripMarkdown(pickM[1]).trim() : null;
  // Sanity-check: reject if the "pick" looks like just a date phrase
  if (pick && /^for\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/)/i.test(pick)) pick = null;

  // CONFIDENCE — use robust extractor
  const conf = extractConf(t);

  // EDGE SCORE
  const edge = extractEdge(t);

  // ODDS (e.g. "-115", "+130", "ML -108")
  const oddsM = t.match(/(?:odds?|line|ml)[:\s]*([+-]\d{3,4})/i) || t.match(/([+-]\d{3,4})/);
  const odds  = oddsM ? oddsM[1] : null;

  // MARKET IMPLIED PROB — matches both old "WIN PROBABILITY" and new "MARKET IMPLIED PROB"
  const winPM = t.match(/(?:market\s*implied\s*prob(?:ability)?|win\s*prob(?:ability)?)[:\s]+(\d{1,3})%/i);
  const winProb = winPM ? parseInt(winPM[1]) : null;

  // KEY FACTORS — numbered/bulleted items (max 5)
  const factors = [];
  const lines = t.split('\n');
  let inFactors = false;
  for (const line of lines) {
    const clean = stripMarkdown(line).trim();
    if (/^(key factors?|key reasons?|why this pick|edge factors?|analysis)[:\s]*$/i.test(clean)) { inFactors = true; continue; }
    if (inFactors) {
      const bM = clean.match(/^[\d\-•›*]\s+(.+)/) || (clean.match(/^[A-Z]/) && !clean.match(/^[A-Z]{4,}/));
      const m  = clean.match(/^(?:[\d•\-›*]+\.?\s+)(.{10,})/);
      if (m) { factors.push(m[1].trim()); if (factors.length >= 5) break; }
      else if (clean && !/^[A-Z\s:]{5,}$/.test(clean) && factors.length > 0 && clean.length < 5) break;
    }
  }
  // Fallback: pull first 3 bullet/numbered lines anywhere in text
  if (factors.length === 0) {
    for (const line of lines) {
      const clean = stripMarkdown(line).trim();
      const m = clean.match(/^(?:[\d•\-›]+\.?\s+)(.{15,})/);
      if (m) { factors.push(m[1].trim()); if (factors.length >= 5) break; }
    }
  }

  // SPORT detection
  const sportM = t.match(/\b(MLB|NBA|NFL|NHL|NCAAF|NCAAB|MLS|UFC|tennis|golf)\b/i);
  const sport  = sportM ? sportM[1].toUpperCase() : null;

  return { pick, conf, edge, odds, winProb, factors, sport };
}

// Confidence score → numeric
function confToScore(conf) {
  return { ELITE: 95, HIGH: 78, MEDIUM: 58, LOW: 38 }[conf] || 60;
}
function confToColor(conf) {
  return { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888' }[conf] || '#FFB800';
}

// Mini SVG arc gauge
function ConfGauge({ pct, color, label }) {
  const r = 38, cx = 48, cy = 52;
  const startAngle = -210, sweepAngle = 240;
  const clamp = Math.min(Math.max(pct / 100, 0), 1);
  function polarToXY(deg, radius) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  function arc(startDeg, endDeg, r2) {
    const s = polarToXY(startDeg, r2);
    const e = polarToXY(endDeg, r2);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r2} ${r2} 0 ${large} 1 ${e.x} ${e.y}`;
  }
  const endAngle = startAngle + clamp * sweepAngle;
  return (
    <svg viewBox="0 0 96 60" width="96" height="60">
      {/* Track */}
      <path d={arc(startAngle, startAngle + sweepAngle, r)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" strokeLinecap="round" />
      {/* Fill */}
      {clamp > 0 && (
        <path d={arc(startAngle, endAngle, r)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
      )}
      {/* Label */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="14" fontWeight="900" fontFamily="IBM Plex Mono">{pct}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="6.5" fontFamily="sans-serif" letterSpacing="0.5">{label}</text>
    </svg>
  );
}

// Edge factor icon
function factorIcon(text) {
  const t = text.toLowerCase();
  if (/injur|health|il |out |doubtful/i.test(t)) return '🚑';
  if (/weather|wind|rain|cold|precip/i.test(t)) return '🌤';
  if (/line|move|sharp|steam|clv/i.test(t)) return '📊';
  if (/public|fade|square/i.test(t)) return '📉';
  if (/rest|fatigue|travel|back.to.back/i.test(t)) return '😴';
  if (/pitcher|starter|bullpen|goalie/i.test(t)) return '⚾';
  if (/trend|ats|over|under|total/i.test(t)) return '📈';
  if (/value|price|odds|number/i.test(t)) return '💰';
  if (/home|away|field|court/i.test(t)) return '🏟️';
  if (/streak|hot|cold|form/i.test(t)) return '🔥';
  return '⚡';
}

function exportReportToPDF(parsed, result, prompt, runTime) {
  const { pick, conf, edge, odds, winProb, factors, sport } = parsed;
  const ts = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const confColor = conf === 'ELITE' ? '#00D48B' : conf === 'HIGH' ? '#4ade80' : conf === 'MEDIUM' ? '#FFB800' : '#888';

  const cleanText = (result || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/https?:\/\/\S+/g, '').trim();

  const factorRows = (factors || []).slice(0, 6).map(f =>
    `<li style="margin-bottom:6px;color:#ccc;font-size:13px;">${f.text || f}</li>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>BetOS Pick Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Inter:wght@400;600;700;900&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#fff; color:#111; font-family:'Inter',sans-serif; padding:32px; max-width:760px; margin:0 auto; }
    @media print {
      body { padding:16px; }
      .no-print { display:none; }
    }
    .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #FFB800; padding-bottom:14px; margin-bottom:20px; }
    .brand { font-size:22px; font-weight:900; letter-spacing:0.08em; background:linear-gradient(90deg,#FFD700,#FF9500); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .subtitle { font-size:11px; color:#888; margin-top:2px; }
    .pick-box { background:#fffbe6; border:2px solid #FFB800; border-radius:12px; padding:18px 22px; margin-bottom:20px; }
    .pick-label { font-size:10px; font-weight:800; color:#888; text-transform:uppercase; letter-spacing:0.12em; margin-bottom:6px; }
    .pick-text { font-size:20px; font-weight:900; color:#111; line-height:1.3; }
    .metrics { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:20px; }
    .metric { background:#f8f8f8; border-radius:8px; padding:12px 14px; border:1px solid #e0e0e0; }
    .metric-label { font-size:9px; text-transform:uppercase; letter-spacing:0.1em; color:#888; margin-bottom:4px; }
    .metric-value { font-size:18px; font-weight:800; font-family:'IBM Plex Mono',monospace; }
    .section-title { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:#888; border-bottom:1px solid #e0e0e0; padding-bottom:6px; margin-bottom:12px; }
    .analysis-text { font-size:13px; line-height:1.75; color:#333; white-space:pre-wrap; word-break:break-word; }
    .footer { margin-top:28px; border-top:1px solid #e0e0e0; padding-top:12px; display:flex; justify-content:space-between; align-items:center; }
    .footer-ts { font-size:11px; color:#aaa; }
    .footer-brand { font-size:11px; font-weight:700; color:#FFB800; letter-spacing:0.1em; }
    .disclaimer { margin-top:16px; font-size:10px; color:#bbb; line-height:1.5; border:1px solid #eee; border-radius:6px; padding:10px 12px; background:#fafafa; }
    .print-btn { position:fixed; bottom:24px; right:24px; background:#FFB800; color:#000; border:none; border-radius:8px; padding:10px 20px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 4px 16px rgba(255,184,0,0.3); }
    .conf-badge { display:inline-block; padding:3px 10px; border-radius:4px; font-size:10px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; background:${confColor}22; color:${confColor}; border:1px solid ${confColor}44; margin-left:10px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">🎯 BetOS™</div>
      <div class="subtitle">AI-Powered Sports Betting OS · Pick Report</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:12px;color:#888;">${ts}</div>
      ${sport ? `<div style="font-size:12px;font-weight:700;color:#111;margin-top:2px;">${sport.toUpperCase()}</div>` : ''}
      ${runTime ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">Runtime: ${runTime}s</div>` : ''}
    </div>
  </div>

  ${pick ? `
  <div class="pick-box">
    <div class="pick-label">⚡ The Pick <span class="conf-badge">${conf || 'MEDIUM'}</span></div>
    <div class="pick-text">${pick}</div>
  </div>` : ''}

  <div class="metrics">
    ${conf ? `<div class="metric"><div class="metric-label">Confidence</div><div class="metric-value" style="color:${confColor}">${conf}</div></div>` : ''}
    ${edge ? `<div class="metric"><div class="metric-label">Edge Score</div><div class="metric-value">${edge}/10</div></div>` : ''}
    ${odds ? `<div class="metric"><div class="metric-label">Current Odds</div><div class="metric-value">${odds}</div></div>` : ''}
    ${winProb ? `<div class="metric"><div class="metric-label">Market Implied</div><div class="metric-value">${winProb}%</div></div>` : ''}
  </div>

  ${factors && factors.length > 0 ? `
  <div style="margin-bottom:20px">
    <div class="section-title">Key Factors</div>
    <ul style="list-style:none;padding:0">${factorRows}</ul>
  </div>` : ''}

  <div style="margin-bottom:20px">
    <div class="section-title">Full Analysis</div>
    <div class="analysis-text">${cleanText.slice(0, 8000)}</div>
  </div>

  ${prompt ? `
  <div style="margin-bottom:16px;padding:10px 14px;background:#f8f8f8;border-radius:6px;border:1px solid #eee;">
    <div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Original Query</div>
    <div style="font-size:12px;color:#555;">${prompt.replace(/^Run a full BetOS analysis on\s*/i, '').slice(0, 200)}</div>
  </div>` : ''}

  <div class="disclaimer">
    ⚠️ For entertainment and informational purposes only. BetOS reports are AI-generated analysis and do not constitute financial or gambling advice. Always gamble responsibly.
  </div>

  <div class="footer">
    <span class="footer-ts">Generated ${ts} · BetOS Intelligence</span>
    <span class="footer-brand">BetOS™</span>
  </div>

  <button class="print-btn no-print" onclick="window.print()">🖨 Save as PDF</button>

  <script>
    window.onload = function() {
      // Small delay to let fonts load
      setTimeout(function() { window.print(); }, 800);
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=820,height=900');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ── Team logo helpers ─────────────────────────────────────────────────────────

// Map each team name to its sport — used to detect correct sport from team names
const TEAM_SPORT_MAP = {
  // MLB
  'Arizona Diamondbacks':'mlb','Atlanta Braves':'mlb','Baltimore Orioles':'mlb',
  'Boston Red Sox':'mlb','Chicago Cubs':'mlb','Chicago White Sox':'mlb',
  'Cincinnati Reds':'mlb','Cleveland Guardians':'mlb','Colorado Rockies':'mlb',
  'Detroit Tigers':'mlb','Houston Astros':'mlb','Kansas City Royals':'mlb',
  'Los Angeles Angels':'mlb','Los Angeles Dodgers':'mlb','Miami Marlins':'mlb',
  'Milwaukee Brewers':'mlb','Minnesota Twins':'mlb','New York Mets':'mlb',
  'New York Yankees':'mlb','Oakland Athletics':'mlb','Athletics':'mlb',
  'Philadelphia Phillies':'mlb','Pittsburgh Pirates':'mlb','San Diego Padres':'mlb',
  'San Francisco Giants':'mlb','Seattle Mariners':'mlb','St. Louis Cardinals':'mlb',
  'Tampa Bay Rays':'mlb','Texas Rangers':'mlb','Toronto Blue Jays':'mlb',
  'Washington Nationals':'mlb',
  // NBA
  'Atlanta Hawks':'nba','Boston Celtics':'nba','Brooklyn Nets':'nba',
  'Charlotte Hornets':'nba','Chicago Bulls':'nba','Cleveland Cavaliers':'nba',
  'Dallas Mavericks':'nba','Denver Nuggets':'nba','Detroit Pistons':'nba',
  'Golden State Warriors':'nba','Houston Rockets':'nba','Indiana Pacers':'nba',
  'Los Angeles Clippers':'nba','Los Angeles Lakers':'nba','Memphis Grizzlies':'nba',
  'Miami Heat':'nba','Milwaukee Bucks':'nba','Minnesota Timberwolves':'nba',
  'New Orleans Pelicans':'nba','New York Knicks':'nba','Oklahoma City Thunder':'nba',
  'Orlando Magic':'nba','Philadelphia 76ers':'nba','Phoenix Suns':'nba',
  'Portland Trail Blazers':'nba','Sacramento Kings':'nba','San Antonio Spurs':'nba',
  'Toronto Raptors':'nba','Utah Jazz':'nba','Washington Wizards':'nba',
  // NFL
  'Arizona Cardinals':'nfl','Atlanta Falcons':'nfl','Baltimore Ravens':'nfl',
  'Buffalo Bills':'nfl','Carolina Panthers':'nfl','Chicago Bears':'nfl',
  'Cincinnati Bengals':'nfl','Cleveland Browns':'nfl','Dallas Cowboys':'nfl',
  'Denver Broncos':'nfl','Detroit Lions':'nfl','Green Bay Packers':'nfl',
  'Houston Texans':'nfl','Indianapolis Colts':'nfl','Jacksonville Jaguars':'nfl',
  'Kansas City Chiefs':'nfl','Las Vegas Raiders':'nfl','Los Angeles Chargers':'nfl',
  'Los Angeles Rams':'nfl','Miami Dolphins':'nfl','Minnesota Vikings':'nfl',
  'New England Patriots':'nfl','New Orleans Saints':'nfl','New York Giants':'nfl',
  'New York Jets':'nfl','Philadelphia Eagles':'nfl','Pittsburgh Steelers':'nfl',
  'San Francisco 49ers':'nfl','Seattle Seahawks':'nfl','Tampa Bay Buccaneers':'nfl',
  'Tennessee Titans':'nfl','Washington Commanders':'nfl',
  // NHL
  'Anaheim Ducks':'nhl','Arizona Coyotes':'nhl','Boston Bruins':'nhl',
  'Buffalo Sabres':'nhl','Calgary Flames':'nhl','Carolina Hurricanes':'nhl',
  'Chicago Blackhawks':'nhl','Colorado Avalanche':'nhl','Columbus Blue Jackets':'nhl',
  'Dallas Stars':'nhl','Detroit Red Wings':'nhl','Edmonton Oilers':'nhl',
  'Florida Panthers':'nhl','Los Angeles Kings':'nhl','Minnesota Wild':'nhl',
  'Montreal Canadiens':'nhl','Nashville Predators':'nhl','New Jersey Devils':'nhl',
  'New York Islanders':'nhl','New York Rangers':'nhl','Ottawa Senators':'nhl',
  'Philadelphia Flyers':'nhl','Pittsburgh Penguins':'nhl','San Jose Sharks':'nhl',
  'Seattle Kraken':'nhl','St. Louis Blues':'nhl','Tampa Bay Lightning':'nhl',
  'Toronto Maple Leafs':'nhl','Utah Hockey Club':'nhl','Vancouver Canucks':'nhl',
  'Vegas Golden Knights':'nhl','Washington Capitals':'nhl','Winnipeg Jets':'nhl',
};

// Per-sport abbr maps so we never cross-contaminate (e.g. 'det' in mlb vs nhl)
const SPORT_ABBR_MAP = {
  mlb: {
    'Arizona Diamondbacks':'ari','Atlanta Braves':'atl','Baltimore Orioles':'bal',
    'Boston Red Sox':'bos','Chicago Cubs':'chc','Chicago White Sox':'chw',
    'Cincinnati Reds':'cin','Cleveland Guardians':'cle','Colorado Rockies':'col',
    'Detroit Tigers':'det','Houston Astros':'hou','Kansas City Royals':'kc',
    'Los Angeles Angels':'laa','Los Angeles Dodgers':'lad','Miami Marlins':'mia',
    'Milwaukee Brewers':'mil','Minnesota Twins':'min','New York Mets':'nym',
    'New York Yankees':'nyy','Oakland Athletics':'oak','Athletics':'oak',
    'Philadelphia Phillies':'phi','Pittsburgh Pirates':'pit','San Diego Padres':'sd',
    'San Francisco Giants':'sf','Seattle Mariners':'sea','St. Louis Cardinals':'stl',
    'Tampa Bay Rays':'tb','Texas Rangers':'tex','Toronto Blue Jays':'tor',
    'Washington Nationals':'wsh',
  },
  nba: {
    'Atlanta Hawks':'atl','Boston Celtics':'bos','Brooklyn Nets':'bkn',
    'Charlotte Hornets':'cha','Chicago Bulls':'chi','Cleveland Cavaliers':'cle',
    'Dallas Mavericks':'dal','Denver Nuggets':'den','Detroit Pistons':'det',
    'Golden State Warriors':'gs','Houston Rockets':'hou','Indiana Pacers':'ind',
    'Los Angeles Clippers':'lac','Los Angeles Lakers':'lal','Memphis Grizzlies':'mem',
    'Miami Heat':'mia','Milwaukee Bucks':'mil','Minnesota Timberwolves':'min',
    'New Orleans Pelicans':'no','New York Knicks':'ny','Oklahoma City Thunder':'okc',
    'Orlando Magic':'orl','Philadelphia 76ers':'phi','Phoenix Suns':'phx',
    'Portland Trail Blazers':'por','Sacramento Kings':'sac','San Antonio Spurs':'sa',
    'Toronto Raptors':'tor','Utah Jazz':'utah','Washington Wizards':'wsh',
  },
  nfl: {
    'Arizona Cardinals':'ari','Atlanta Falcons':'atl','Baltimore Ravens':'bal',
    'Buffalo Bills':'buf','Carolina Panthers':'car','Chicago Bears':'chi',
    'Cincinnati Bengals':'cin','Cleveland Browns':'cle','Dallas Cowboys':'dal',
    'Denver Broncos':'den','Detroit Lions':'det','Green Bay Packers':'gb',
    'Houston Texans':'hou','Indianapolis Colts':'ind','Jacksonville Jaguars':'jax',
    'Kansas City Chiefs':'kc','Las Vegas Raiders':'lv','Los Angeles Chargers':'lac',
    'Los Angeles Rams':'lar','Miami Dolphins':'mia','Minnesota Vikings':'min',
    'New England Patriots':'ne','New Orleans Saints':'no','New York Giants':'nyg',
    'New York Jets':'nyj','Philadelphia Eagles':'phi','Pittsburgh Steelers':'pit',
    'San Francisco 49ers':'sf','Seattle Seahawks':'sea','Tampa Bay Buccaneers':'tb',
    'Tennessee Titans':'ten','Washington Commanders':'wsh',
  },
  nhl: {
    'Anaheim Ducks':'ana','Arizona Coyotes':'ari','Boston Bruins':'bos',
    'Buffalo Sabres':'buf','Calgary Flames':'cgy','Carolina Hurricanes':'car',
    'Chicago Blackhawks':'chi','Colorado Avalanche':'col','Columbus Blue Jackets':'cbj',
    'Dallas Stars':'dal','Detroit Red Wings':'det','Edmonton Oilers':'edm',
    'Florida Panthers':'fla','Los Angeles Kings':'lak','Minnesota Wild':'min',
    'Montreal Canadiens':'mtl','Nashville Predators':'nsh','New Jersey Devils':'njd',
    'New York Islanders':'nyi','New York Rangers':'nyr','Ottawa Senators':'ott',
    'Philadelphia Flyers':'phi','Pittsburgh Penguins':'pit','San Jose Sharks':'sjs',
    'Seattle Kraken':'sea','St. Louis Blues':'stl','Tampa Bay Lightning':'tb',
    'Toronto Maple Leafs':'tor','Utah Hockey Club':'utah','Vancouver Canucks':'van',
    'Vegas Golden Knights':'vgk','Washington Capitals':'wsh','Winnipeg Jets':'wpg',
  },
};

// Detect sport from team name — searches per-sport maps with exact → case-insensitive → partial
function detectTeamSport(name) {
  if (!name) return null;
  if (TEAM_SPORT_MAP[name]) return TEAM_SPORT_MAP[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_SPORT_MAP)) {
    if (k.toLowerCase() === lower) return v;
  }
  // Partial: last word match within each sport map (sport-scoped to avoid cross-contamination)
  const lastWord = name.trim().split(/\s+/).pop()?.toLowerCase();
  if (lastWord && lastWord.length > 3) {
    for (const [k, v] of Object.entries(TEAM_SPORT_MAP)) {
      if (k.toLowerCase().endsWith(lastWord)) return v;
    }
  }
  return null;
}

function getTeamAbbrForSport(sport, name) {
  if (!name || !sport) return null;
  const map = SPORT_ABBR_MAP[sport.toLowerCase()];
  if (!map) return null;
  if (map[name]) return map[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  // Partial: last word only (sport-scoped)
  const lastWord = name.trim().split(/\s+/).pop()?.toLowerCase();
  if (lastWord && lastWord.length > 3) {
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase().endsWith(lastWord)) return v;
    }
  }
  return null;
}

function teamLogoUrl(sport, name) {
  if (!name) return null;
  // Derive the correct sport from the team name itself — never trust the default 'mlb' fallback
  const resolvedSport = detectTeamSport(name) || sport?.toLowerCase();
  if (!resolvedSport) return null;
  const abbr = getTeamAbbrForSport(resolvedSport, name);
  if (!abbr) return null;
  return `https://a.espncdn.com/i/teamlogos/${resolvedSport}/500/${abbr}.png`;
}

// Extract "Away @ Home" matchup from a prompt string
function extractMatchup(prompt) {
  if (!prompt) return { away: null, home: null };
  const m = prompt.match(/on\s+(.+?)\s+@\s+(.+?)(?:\s*[\-—–]|\s*\(|,|\.\s|$)/i);
  if (!m) return { away: null, home: null };
  return { away: m[1].trim(), home: m[2].trim() };
}

// ── Quick "Add as Pick" helper — detects bet type from pick text ──────────────
function detectBetType(pickText) {
  if (!pickText) return 'Moneyline';
  const t = pickText.toLowerCase();
  if (/\bover\b/.test(t))  return 'Total (Over)';
  if (/\bunder\b/.test(t)) return 'Total (Under)';
  if (/[+-]\d+(\.\d+)?\b/.test(pickText.replace(/[+-]\d{3,4}/, ''))) return 'Spread';
  return 'Moneyline';
}

function GoatPickCard({ result, model, prompt, runTime, user, isDemo }) {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  // Add as Pick state
  const [addOpen, setAddOpen]       = useState(false);
  const [unitSize, setUnitSize]     = useState(1);
  const [addSaving, setAddSaving]   = useState(false);
  const [addDone, setAddDone]       = useState(false);
  // Export state
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting]   = useState(false);

  const parsed = useMemo(() => parseReport(result), [result]);
  const { pick, conf, edge, odds, winProb, factors, sport } = parsed;
  const confScore = conf ? confToScore(conf) : null;
  const confColor = conf ? confToColor(conf) : '#FFB800';
  const cs = CONF_STYLES[conf] || {};
  const ts = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Edge bar chart data
  const edgePct = edge ? Math.min(edge * 10, 100) : (confScore || 60);

  // Matchup extraction for logo display
  const { away: awayName, home: homeName } = useMemo(() => extractMatchup(prompt), [prompt]);
  const sportKey = (sport || 'mlb').toLowerCase();
  const awayLogoUrl = awayName ? teamLogoUrl(sportKey, awayName) : null;
  const homeLogoUrl = homeName ? teamLogoUrl(sportKey, homeName) : null;
  const hasMatchup  = !!(awayName && homeName);

  // ── Export as JPG (via /api/og/pick) ────────────────────────────────────
  async function downloadPickImage() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (pick)    params.set('pick', pick);
      if (conf)    params.set('conf', conf);
      if (edge)    params.set('edge', String(edge));
      if (odds)    params.set('odds', odds);
      if (winProb) params.set('winProb', String(winProb));
      if (sport)   params.set('sport', sport);
      if (awayName) params.set('away', awayName);
      if (homeName) params.set('home', homeName);
      if (awayLogoUrl) params.set('awayLogo', awayLogoUrl);
      if (homeLogoUrl) params.set('homeLogo', homeLogoUrl);

      const res = await fetch(`/api/og/pick?${params}`);
      if (!res.ok) throw new Error('Image generation failed');
      const pngBlob = await res.blob();

      // Convert PNG → JPG using canvas for smaller file size
      const img = new Image();
      const pngUrl = URL.createObjectURL(pngBlob);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = pngUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 628;
      const ctx = canvas.getContext('2d');
      // Dark background fill (JPG has no transparency)
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, 1200, 628);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(pngUrl);

      canvas.toBlob(jpgBlob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(jpgBlob);
        const safePick = (pick || 'betos-pick').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
        a.download = `betos-${safePick}.jpg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }, 'image/jpeg', 0.93);
    } catch (e) {
      alert('Image export failed — try again in a moment.');
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  }

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0e0b00 0%, #0a0a0a 100%)',
      border: '1px solid rgba(255,184,0,0.2)',
      borderRadius: '16px', overflow: 'hidden',
      boxShadow: '0 4px 40px rgba(255,184,0,0.06)',
    }}>

      {/* ── HERO HEADER ── */}
      <div style={{
        padding: '1.1rem 1.4rem',
        background: 'linear-gradient(135deg, rgba(255,184,0,0.08) 0%, rgba(255,140,0,0.04) 50%, rgba(0,0,0,0) 100%)',
        borderBottom: '1px solid rgba(255,184,0,0.12)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow orb */}
        <div style={{
          position: 'absolute', top: '-30px', left: '-10px', width: '120px', height: '120px',
          background: 'radial-gradient(circle, rgba(255,184,0,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(255,184,0,0.2), rgba(255,120,0,0.1))',
              border: '1px solid rgba(255,184,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', flexShrink: 0,
              boxShadow: '0 0 14px rgba(255,184,0,0.2)',
            }}>🎯</div>
            <div>
              <div style={{
                fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase',
                fontSize: '0.78rem',
                background: 'linear-gradient(90deg, #FFD700, #FFB800, #FF9500)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                BetOS PICK REPORT
              </div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.62rem', marginTop: '1px', letterSpacing: '0.04em' }}>
                Live Intel · {ts}{runTime ? ` · ${runTime}s runtime` : ''}
                {sport && <span style={{ marginLeft: '6px', color: 'rgba(255,184,0,0.5)', fontWeight: 700 }}>· {sport}</span>}
              </div>
            </div>
          </div>
          {conf && (
            <span style={{
              padding: '5px 16px', borderRadius: '20px',
              border: `1px solid ${cs.border}`,
              background: cs.bg, color: cs.color,
              fontWeight: 900, fontSize: '0.7rem', letterSpacing: '0.14em',
              textShadow: `0 0 10px ${confColor}40`,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {conf} CONFIDENCE
            </span>
          )}
        </div>
      </div>

      {/* ── MATCHUP BUG — team logos + names ── */}
      {hasMatchup && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '0', padding: '1rem 1.4rem 0.75rem',
          background: 'rgba(0,0,0,0.25)',
          borderBottom: '1px solid rgba(255,184,0,0.07)',
        }}>
          {/* Away team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flex: 1 }}>
            {awayLogoUrl ? (
              <img src={awayLogoUrl} alt={awayName} width={48} height={48}
                style={{ objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(255,255,255,0.08))' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🏟️</div>
            )}
            <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: '#e0e0e0', fontSize: '0.78rem', textAlign: 'center' }}>
              {awayName?.split(' ').pop() || awayName}
            </div>
            <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Away</div>
          </div>

          {/* @ divider */}
          <div style={{ padding: '0 12px', textAlign: 'center' }}>
            <div style={{ color: '#2a2a2a', fontWeight: 900, fontSize: '1.1rem', lineHeight: 1 }}>@</div>
          </div>

          {/* Home team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flex: 1 }}>
            {homeLogoUrl ? (
              <img src={homeLogoUrl} alt={homeName} width={48} height={48}
                style={{ objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(255,255,255,0.08))' }}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🏟️</div>
            )}
            <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: '#e0e0e0', fontSize: '0.78rem', textAlign: 'center' }}>
              {homeName?.split(' ').pop() || homeName}
            </div>
            <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Home</div>
          </div>
        </div>
      )}

      {/* ── THE PICK HERO ── */}
      {pick && (
        <div style={{
          margin: '1.25rem 1.4rem',
          padding: '1.25rem 1.4rem',
          background: 'linear-gradient(135deg, rgba(255,184,0,0.1) 0%, rgba(255,149,0,0.04) 100%)',
          border: '1px solid rgba(255,184,0,0.3)',
          borderRadius: '12px',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Subtle diagonal stripe pattern */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,184,0,0.015) 20px, rgba(255,184,0,0.015) 21px)',
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{
              fontSize: '0.58rem', color: '#FFB800', fontWeight: 900,
              letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '8px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ width: '16px', height: '1px', background: '#FFB800', display: 'inline-block' }} />
              THE PICK
              <span style={{ width: '16px', height: '1px', background: '#FFB800', display: 'inline-block' }} />
            </div>
            <div style={{
              color: '#fff', fontWeight: 900, fontSize: '1.2rem', lineHeight: 1.35,
              letterSpacing: '-0.01em',
              textShadow: '0 0 20px rgba(255,184,0,0.15)',
            }}>
              {pick}
            </div>
            {odds && (
              <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Line</span>
                <span style={{
                  fontFamily: 'IBM Plex Mono', fontSize: '0.88rem', fontWeight: 800,
                  color: parseInt(odds) > 0 ? '#4ade80' : '#e0d0b0',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px', padding: '2px 10px',
                }}>{/^[+-]/.test(odds) ? odds : (parseInt(odds) > 0 ? `+${odds}` : odds)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── METRICS ROW ── */}
      {(conf || edge || winProb) && (
        <div style={{ display: 'flex', gap: '10px', padding: '0 1.4rem 1.25rem', flexWrap: 'wrap' }}>

          {/* Confidence Gauge */}
          {confScore && (
            <div style={{
              flex: '0 0 auto', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '12px', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Confidence</div>
              <ConfGauge pct={confScore} color={confColor} label="SCORE" />
            </div>
          )}

          {/* Edge Strength Bar */}
          <div style={{
            flex: 1, minWidth: '160px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '12px', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>Edge Strength</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1, height: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%', width: `${edgePct}%`,
                  background: `linear-gradient(90deg, ${confColor}80, ${confColor})`,
                  borderRadius: '5px', transition: 'width 1s ease',
                  boxShadow: `0 0 8px ${confColor}60`,
                }} />
              </div>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', fontWeight: 800, color: confColor, minWidth: '34px' }}>{edgePct}%</span>
            </div>
            {/* Win prob */}
            {winProb && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', minWidth: '60px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Mkt Implied</div>
                <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${winProb}%`, background: 'linear-gradient(90deg, #4ade8060, #4ade80)', borderRadius: '3px', transition: 'width 1s ease' }} />
                </div>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: '#4ade80', minWidth: '34px' }}>{winProb}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── KEY FACTORS ── */}
      {factors.length > 0 && (
        <div style={{ padding: '0 1.4rem 1.25rem' }}>
          <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '8px' }}>
            Key Factors
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {factors.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '0.6rem 0.85rem',
                background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '8px', borderLeft: '2px solid rgba(255,184,0,0.3)',
              }}>
                <span style={{ fontSize: '0.88rem', flexShrink: 0, marginTop: '1px' }}>{factorIcon(f)}</span>
                <span style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── FULL ANALYSIS (collapsible) ── */}
      <div style={{ padding: '0 1.4rem 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={() => setAnalysisOpen(v => !v)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.75rem 0', color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
          }}
        >
          <span>📄 Full Analysis</span>
          <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s', transform: analysisOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
        </button>

        {analysisOpen && (
          <div style={{ paddingBottom: '1.25rem' }}>
            {renderRichLines(result)}
          </div>
        )}
      </div>

      {/* ── ADD AS PICK INLINE PANEL ── */}
      {addOpen && pick && (
        <div style={{
          borderTop: '1px solid rgba(74,222,128,0.15)',
          padding: '1rem 1.4rem',
          background: 'linear-gradient(135deg, rgba(74,222,128,0.04), rgba(0,0,0,0))',
        }}>
          {addDone ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4ade80', fontWeight: 700, fontSize: '0.85rem' }}>
              ✅ Pick logged! Head to My Picks to track it.
            </div>
          ) : (
            <>
              {/* Pick preview */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '5px' }}>Logging pick</div>
                <div style={{ color: '#e0e0e0', fontWeight: 700, fontSize: '0.92rem' }}>{pick}</div>
                <div style={{ color: '#555', fontSize: '0.72rem', marginTop: '3px' }}>
                  {sport && <span style={{ marginRight: '8px' }}>{sport}</span>}
                  {odds && <span style={{ color: parseInt(odds) > 0 ? '#4ade80' : '#aaa', fontFamily: 'IBM Plex Mono', marginRight: '8px' }}>{/^[+-]/.test(odds) ? odds : (parseInt(odds) > 0 ? `+${odds}` : odds)}</span>}
                  <span style={{ color: '#444' }}>{detectBetType(pick)}</span>
                </div>
              </div>

              {/* Unit size selector */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '7px' }}>Unit size</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[0.5, 1, 2, 3, 5].map(u => (
                    <button
                      key={u}
                      onClick={() => setUnitSize(u)}
                      style={{
                        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
                        border: `1px solid ${unitSize === u ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
                        background: unitSize === u ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.03)',
                        color: unitSize === u ? '#4ade80' : '#888',
                        fontWeight: 700, fontSize: '0.82rem',
                        fontFamily: 'IBM Plex Mono, monospace',
                        transition: 'all 0.12s',
                      }}
                    >{u}u</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={async () => {
                    if (!user?.id || addSaving) return;
                    setAddSaving(true);
                    const { away: awayName, home: homeName } = extractMatchup(prompt);
                    const matchupStr = awayName && homeName ? `${awayName} @ ${homeName}` : '';
                    // Extract just the team/pick from the pick line (before the odds)
                    const teamName = pick.replace(/[+-]\d{3,4}.*$/, '').trim();
                    try {
                      await addPick({
                        user_id: user.id,
                        date: new Date().toISOString().split('T')[0],
                        sport: sport || 'Other',
                        team: teamName,
                        bet_type: detectBetType(pick),
                        matchup: matchupStr,
                        odds: odds ? parseInt(odds) : null,
                        book: 'BetOS',
                        result: 'PENDING',
                        profit: null,
                        notes: `${unitSize}u | BetOS AI Pick${conf ? ` — ${conf} confidence` : ''}${edge ? `, edge ${edge}/10` : ''}`,
                      });
                      setAddDone(true);
                    } catch { /* silent */ }
                    setAddSaving(false);
                  }}
                  disabled={addSaving || !user?.id}
                  style={{
                    padding: '8px 20px', borderRadius: '8px', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #4ade80, #22c55e)',
                    border: 'none', color: '#000', fontWeight: 800, fontSize: '0.82rem',
                    opacity: addSaving || !user?.id ? 0.5 : 1, transition: 'opacity 0.15s',
                  }}
                >
                  {addSaving ? 'Saving…' : `+ Log ${unitSize}u Pick`}
                </button>
                {!user?.id && (
                  <span style={{ color: '#666', fontSize: '0.72rem' }}>Sign in to log picks</span>
                )}
                <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: '0.72rem', marginLeft: 'auto' }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ODDS DISCLAIMER ── */}
      <div style={{
        margin: '0 1.4rem 0.75rem',
        padding: '6px 10px',
        borderRadius: '7px',
        background: 'rgba(255,184,0,0.04)',
        border: '1px solid rgba(255,184,0,0.15)',
        display: 'flex', alignItems: 'flex-start', gap: '6px',
      }}>
        <span style={{ fontSize: '0.72rem', flexShrink: 0, marginTop: '1px' }}>⚠️</span>
        <span style={{ fontSize: '0.62rem', color: 'rgba(255,200,80,0.75)', lineHeight: 1.5 }}>
          AI-generated odds may be stale or incorrect. Always verify lines on your sportsbook (DraftKings, FanDuel, etc.) before placing any bet. BetOS analysis is for informational purposes only.
        </span>
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        borderTop: '1px solid rgba(255,184,0,0.08)', padding: '0.65rem 1.4rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,184,0,0.02)', gap: '8px',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prompt}
        </span>

        {/* Add as Pick button — shown when AI found a specific pick */}
        {pick && !addDone && (
          <button
            onClick={() => { setAddOpen(v => !v); setAddDone(false); }}
            style={{
              background: addOpen ? 'rgba(74,222,128,0.15)' : 'rgba(74,222,128,0.08)',
              border: `1px solid ${addOpen ? 'rgba(74,222,128,0.4)' : 'rgba(74,222,128,0.2)'}`,
              borderRadius: '6px', color: '#4ade80', cursor: 'pointer',
              fontSize: '0.65rem', fontWeight: 700, padding: '3px 9px',
              display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
              transition: 'all 0.12s',
            }}
          >
            + Log Pick
          </button>
        )}
        {pick && addDone && (
          <span style={{ color: '#4ade80', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>✓ Logged</span>
        )}

        {/* Export dropdown */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setExportOpen(v => !v)}
            title="Export pick"
            style={{
              background: exportOpen ? 'rgba(255,184,0,0.15)' : 'rgba(255,184,0,0.08)',
              border: `1px solid ${exportOpen ? 'rgba(255,184,0,0.5)' : 'rgba(255,184,0,0.25)'}`,
              borderRadius: '6px', color: exportOpen ? '#FFB800' : 'rgba(255,184,0,0.7)',
              cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700, padding: '3px 9px',
              display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.12s',
            }}
          >
            ↗ Export {exportOpen ? '▲' : '▼'}
          </button>

          {exportOpen && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 6px)', right: 0,
              background: '#141414', border: '1px solid rgba(255,184,0,0.25)',
              borderRadius: '10px', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 100,
              minWidth: '160px',
            }}>
              {/* JPG option */}
              <button
                onClick={downloadPickImage}
                disabled={exporting}
                style={{
                  width: '100%', background: 'none', border: 'none', cursor: exporting ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', color: '#e0e0e0', fontSize: '0.72rem', fontWeight: 600,
                  textAlign: 'left', transition: 'background 0.1s',
                  opacity: exporting ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: '1rem' }}>📸</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span>{exporting ? 'Generating…' : 'Download Image'}</span>
                  <span style={{ fontSize: '0.58rem', color: '#555' }}>1200×628 JPG</span>
                </div>
              </button>

              {/* Divider */}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0 10px' }} />

              {/* PDF option */}
              <button
                onClick={() => { exportReportToPDF(parsed, result, prompt, runTime); setExportOpen(false); }}
                style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', color: '#e0e0e0', fontSize: '0.72rem', fontWeight: 600,
                  textAlign: 'left', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: '1rem' }}>📄</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span>Export PDF</span>
                  <span style={{ fontSize: '0.58rem', color: '#555' }}>Full analysis report</span>
                </div>
              </button>
            </div>
          )}
        </div>

        <span style={{
          fontSize: '0.62rem', fontWeight: 900, letterSpacing: '0.12em',
          background: 'linear-gradient(90deg, #FFD700, #FF9500)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          flexShrink: 0,
        }}>BetOS™</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 1. BetOS LIVE — command center
// ────────────────────────────────────────────────────────────────────────────

const SPORT_PRESETS = [
  { emoji: '⚾', label: 'MLB Today',     color: '#E31937', prompt: 'Find me the sharpest MLB pick for today. Give me the best edge on tonight\'s slate — line movement, CLV, key matchup factors, full analysis.' },
  { emoji: '🏀', label: 'NBA Tonight',   color: '#F58426', prompt: 'Analyze tonight\'s NBA slate. Find the single sharpest pick — rest spots, pace mismatches, line movement vs closing number.' },
  { emoji: '🏈', label: 'NFL This Week', color: '#013369', prompt: 'Give me the sharpest NFL pick this week. Edge metrics, CLV projection, public fading angle, full BetOS breakdown.' },
  { emoji: '🏒', label: 'NHL Slate',     color: '#00528C', prompt: 'Run a full BetOS scan on tonight\'s NHL slate. Find the best moneyline or puck line value.' },
  { emoji: '⛳', label: 'Golf Pick',     color: '#4ade80', prompt: 'Give me the sharpest golf betting angle — top-10 finish, outright winner, or head-to-head matchup. Consider form, course fit, and odds value.' },
  { emoji: '🔥', label: 'Best Bet Now',  color: '#FF6B35', prompt: 'Scan ALL sports right now — MLB, NBA, NFL, NHL — and find me the single best bet with the highest true edge anywhere on the board today. Don\'t limit to one sport.' },
];

const CTX_OPTIONS = [
  { id: 'today',      label: 'Today',       emoji: '📅', input: false },
  { id: 'tomorrow',   label: 'Tomorrow',    emoji: '🌅', input: false },
  { id: 'date',       label: 'Pick Date',   emoji: '🗓',  input: 'date',   placeholder: 'Target date...' },
  { id: 'tournament', label: 'Tournament',  emoji: '🏆', input: 'text',   placeholder: 'e.g. The Masters, NCAA Tournament...' },
  { id: 'futures',    label: 'Futures',     emoji: '🔮', input: 'text',   placeholder: 'e.g. Masters winner, NFL MVP 26/27...' },
];

function buildContextualPrompt(base, ctx, ctxInput) {
  const today    = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const prefixes = {
    today:      `[Today: ${today}]\n`,
    tomorrow:   `[Target date: TOMORROW, ${tomorrow}. Today is ${today}.]\n`,
    date:       ctxInput ? `[Target date: ${ctxInput}. Today is ${today}.]\n` : `[Today: ${today}]\n`,
    tournament: ctxInput ? `[TOURNAMENT/EVENT: "${ctxInput}". Factor in scheduling, form, bracket position, and tournament-specific edges. Today is ${today}.]\n` : `[Today: ${today}]\n`,
    futures:    ctxInput ? `[FUTURES MARKET: "${ctxInput}". Analyze long-term probability, odds value, and futures-specific factors. Today is ${today}.]\n` : `[Today: ${today}]\n`,
  };
  return (prefixes[ctx] || '') + base;
}

// ── Report persistence ─────────────────────────────────────────────────────────
const REPORTS_KEY = 'betos_reports';
function saveReport(report) {
  try {
    const prev = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    localStorage.setItem(REPORTS_KEY, JSON.stringify([report, ...prev].slice(0, 50)));
  } catch {}
}
function getReports() {
  try { return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]'); } catch { return []; }
}

const LOAD_STEPS = [
  'Connecting to live data feeds...',
  'Scanning sportsbooks for line movement...',
  'Identifying sharp money signals...',
  'Running edge model vs closing line...',
  'Generating BetOS pick report...',
];

const FEED_SYSTEM_PROMPT = `You are a sports betting intelligence feed. Search X/Twitter and sports news sources for the most recent (last 2 hours) relevant betting intel. Return exactly 6 items in this strict format:

ITEM: [brief punchy headline, no markdown, no URLs]
DETAIL: [1-2 sentences of context, no URLs]
ANGLE: [one-line betting takeaway]
---

Do not include any URLs, markdown formatting, asterisks, or source citations. Plain text only.`;

function BetOSLive({ injectedPrompt, onPromptConsumed, injectedReport, onReportConsumed, user, isDemo }) {
  const [prompt, setPrompt]             = useState('');
  const [result, setResult]             = useState('');
  const [model, setModel]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [loadStep, setLoadStep]         = useState(0);
  const [doneSteps, setDoneSteps]       = useState([]);
  const [ctx, setCtx]                   = useState('today');
  const [ctxInput, setCtxInput]         = useState('');
  const [elapsed, setElapsed]           = useState(0);
  const [runTime, setRunTime]           = useState(null);
  const [history, setHistory]           = useState([]);
  const [showHistory, setShowHistory]   = useState(true);
  const [resultCollapsed, setResultCollapsed] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  // Live feed
  const [feedItems, setFeedItems]       = useState([]);
  const [feedLoading, setFeedLoading]   = useState(false);
  const [feedTime, setFeedTime]         = useState(null);
  const [showFeed, setShowFeed]         = useState(false);
  // News chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatLoading, setChatLoading]   = useState(false);

  const hasRun       = useRef(false);
  const taRef        = useRef(null);
  const timerRefs    = useRef([]);
  const startTime    = useRef(null);
  const retryRef     = useRef(false);   // true if we're in an auto-retry
  const lastPromptRef = useRef('');     // tracks prompt for tab-return retry

  // Load history on mount
  useEffect(() => { setHistory(getReports()); }, []);

  // Inject pre-loaded report (from Featured tab)
  useEffect(() => {
    if (injectedReport) {
      setResult(injectedReport.result || '');
      setModel(injectedReport.model || 'BetOS AI');
      setPrompt(injectedReport.prompt || '');
      setRunTime(injectedReport.runTime || null);
      onReportConsumed?.();
    }
  }, [injectedReport]);

  // Inject prompt from Scoreboard / Featured / Odds
  useEffect(() => {
    if (injectedPrompt && injectedPrompt !== prompt) {
      setPrompt(injectedPrompt);
      hasRun.current = false;
    }
  }, [injectedPrompt]);

  useEffect(() => {
    if (injectedPrompt && prompt === injectedPrompt && !hasRun.current && !loading) {
      hasRun.current = true;
      onPromptConsumed?.();
      runBetOS(injectedPrompt);
    }
  }, [prompt, injectedPrompt]);

  // ETA timer
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    startTime.current = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [loading]);

  // Animate loading steps
  useEffect(() => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    setLoadStep(0);
    setDoneSteps([]);
    if (!loading) return;
    LOAD_STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        setLoadStep(i + 1);
        if (i > 0) setDoneSteps(prev => [...prev, i - 1]);
      }, i * 2600);
      timerRefs.current.push(t);
    });
    return () => timerRefs.current.forEach(clearTimeout);
  }, [loading]);

  async function runBetOS(overridePrompt) {
    const base = overridePrompt || prompt;
    if (!base.trim()) return;
    lastPromptRef.current = base; // track for tab-return retry
    const q = buildContextualPrompt(base, ctx, ctxInput);
    setLoading(true);
    setResult('');
    setError('');
    setModel('');
    const t0 = Date.now();
    try {
      const res = await fetch('/api/goatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      retryRef.current = false; // success — reset retry flag
      const rt = Math.floor((Date.now() - t0) / 1000);
      setResult(data.result);
      setModel(data.model || 'BetOS AI');
      setRunTime(rt);
      // Extract team names from prompt for cross-tab linkage (Featured, History)
      const teamMatch = base.match(/on\s+(.+?)\s+@\s+(.+?)(?:\s*[\-—–]|\s*\(|$)/i);
      const report = {
        id: Date.now().toString(),
        prompt: base,
        result: data.result,
        model: data.model || 'BetOS AI',
        timestamp: new Date().toISOString(),
        runTime: rt,
        awayTeam: teamMatch ? teamMatch[1].trim() : null,
        homeTeam: teamMatch ? teamMatch[2].trim() : null,
      };
      saveReport(report);
      setHistory(getReports());
      setResultCollapsed(false); // auto-expand new report
      setExpandedHistoryId(null);
    } catch (e) {
      // ── Auto-retry on browser-cancelled network errors ────────────────────
      // When a user switches browser tabs, some browsers kill long-running fetches.
      // "Load failed" / "Failed to fetch" = browser abort, not a real error.
      // Auto-retry once silently instead of showing a confusing error.
      const isNetworkAbort = e.message === 'Load failed'
        || e.message === 'Failed to fetch'
        || e.message === 'NetworkError when attempting to fetch resource.'
        || e.name === 'TypeError';
      if (isNetworkAbort && !retryRef.current) {
        retryRef.current = true;
        setError(''); // don't show error — silently retry
        setLoading(false);
        // Brief pause, then re-fire the same prompt
        setTimeout(() => runBetOS(base), 800);
        return;
      }
      retryRef.current = false;
      setError(e.message);
    }
    setLoading(false);
  }

  // ── Tab visibility: if user returns while loading was killed, re-fire ─────────
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && !loading && retryRef.current && lastPromptRef.current) {
        // Tab came back and we were in a retry state — fire again
        runBetOS(lastPromptRef.current);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function loadFeed() {
    setFeedLoading(true);
    setShowFeed(true);
    try {
      const res = await fetch('/api/goatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: FEED_SYSTEM_PROMPT }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      // Parse feed items
      const raw = (data.result || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/https?:\/\/\S+/g, '');
      const blocks = raw.split('---').map(b => b.trim()).filter(Boolean);
      const items = blocks.map(block => {
        const item    = (block.match(/^ITEM:\s*(.+)$/m) || [])[1]?.trim() || '';
        const detail  = (block.match(/^DETAIL:\s*(.+)$/ms) || [])[1]?.trim() || '';
        const angle   = (block.match(/^ANGLE:\s*(.+)$/m) || [])[1]?.trim() || '';
        return { item, detail, angle };
      }).filter(x => x.item);
      setFeedItems(items);
      setFeedTime(new Date());
    } catch {}
    setFeedLoading(false);
  }

  async function sendChat(e) {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    try {
      const context = feedItems.length
        ? `Recent sports intel:\n${feedItems.map(f => `- ${f.item}: ${f.detail}`).join('\n')}\n\n`
        : result ? `Current BetOS report context:\n${result.slice(0, 800)}\n\n` : '';
      const res = await fetch('/api/goatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `${context}User question: ${userMsg}\n\nAnswer concisely as a sharp sports betting analyst. No markdown, no URLs, no ** formatting.` }),
      });
      const data = await res.json();
      const answer = stripMarkdown(data.result || 'Could not get a response.');
      setChatMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error fetching response.' }]);
    }
    setChatLoading(false);
  }

  function loadHistoryReport(entry) {
    // Expand this entry inline in the history panel
    setExpandedHistoryId(prev => prev === entry.id ? null : entry.id);
    setShowHistory(true);
  }

  const canFire = !loading && !!prompt.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── COMMAND CENTER ─────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(160deg, #0f0b00 0%, #0a0a0f 60%)',
        border: '1px solid rgba(255,184,0,0.22)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 0 60px rgba(255,184,0,0.06), inset 0 1px 0 rgba(255,184,0,0.1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '1rem 1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,184,0,0.08)',
          background: 'rgba(255,184,0,0.025)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.9rem', lineHeight: 1 }}>🎯</span>
            <div>
              <div style={{ fontWeight: 900, color: '#FFB800', fontSize: '1.1rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
                BetOS
              </div>
              <div style={{ color: 'rgba(255,184,0,0.45)', fontSize: '0.6rem', letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: '3px' }}>
                Sharp Pick Intelligence
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Engine</div>
              <div style={{ color: 'rgba(255,184,0,0.7)', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', marginTop: '1px' }}>
                GROK-4 · LIVE SEARCH
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 11px',
              background: 'rgba(74,222,128,0.05)',
              border: '1px solid rgba(74,222,128,0.18)',
              borderRadius: '20px',
            }}>
              <span className="live-dot" style={{ width: '6px', height: '6px' }} />
              <span style={{ color: '#4ade80', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em' }}>ONLINE</span>
            </div>
          </div>
        </div>

        {/* Sport presets */}
        <div style={{ padding: '0.9rem 1.5rem 0' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.55rem' }}>
            ⚡ Quick Fire
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {SPORT_PRESETS.map(sp => (
              <button
                key={sp.label}
                onClick={() => { setPrompt(sp.prompt); setTimeout(() => taRef.current?.focus(), 50); }}
                style={{
                  padding: '5px 12px', borderRadius: '20px',
                  border: `1px solid ${sp.color}33`,
                  background: `${sp.color}0d`,
                  color: `${sp.color}cc`,
                  fontSize: '0.75rem', fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '4px',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = sp.color + '88';
                  e.currentTarget.style.color = sp.color;
                  e.currentTarget.style.background = sp.color + '22';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = sp.color + '33';
                  e.currentTarget.style.color = sp.color + 'cc';
                  e.currentTarget.style.background = sp.color + '0d';
                }}
              >
                <span style={{ fontSize: '0.85rem' }}>{sp.emoji}</span>
                <span>{sp.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTEXT PICKER ──────────────────────────────────────────── */}
        <div style={{ padding: '0.75rem 1.5rem 0' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            🗓 Pick Context
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {CTX_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => { setCtx(opt.id); setCtxInput(''); }}
                className={`ctx-chip${ctx === opt.id ? ' active' : ''}`}
              >
                {opt.emoji} {opt.label}
              </button>
            ))}
          </div>

          {/* Context input when needed */}
          {CTX_OPTIONS.find(o => o.id === ctx)?.input && (
            <div style={{ marginTop: '0.5rem' }}>
              <input
                type={CTX_OPTIONS.find(o => o.id === ctx)?.input === 'date' ? 'date' : 'text'}
                value={ctxInput}
                onChange={e => setCtxInput(e.target.value)}
                placeholder={CTX_OPTIONS.find(o => o.id === ctx)?.placeholder}
                style={{
                  background: 'rgba(255,184,0,0.04)',
                  border: '1px solid rgba(255,184,0,0.2)',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  color: '#FFB800',
                  fontSize: '0.82rem',
                  fontFamily: 'Inter, sans-serif',
                  outline: 'none',
                  width: '100%',
                  maxWidth: '380px',
                  colorScheme: 'dark',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(255,184,0,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,184,0,0.2)'}
              />
            </div>
          )}
        </div>

        {/* Terminal input */}
        <div style={{ padding: '0.75rem 1.5rem 1.25rem' }}>
          <div style={{
            background: '#060606',
            border: `1px solid ${canFire ? 'rgba(255,184,0,0.4)' : 'rgba(255,255,255,0.05)'}`,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'stretch',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            boxShadow: canFire ? '0 0 30px rgba(255,184,0,0.08)' : 'none',
          }}>
            {/* Prompt glyph */}
            <div style={{
              padding: '14px 6px 14px 16px',
              color: '#FFB800',
              fontFamily: '"IBM Plex Mono", "Courier New", monospace',
              fontSize: '0.85rem', fontWeight: 700,
              flexShrink: 0, alignSelf: 'flex-start',
              userSelect: 'none', letterSpacing: '-0.03em',
            }}>
              GOAT&nbsp;›
            </div>

            <textarea
              ref={taRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  runBetOS();
                }
              }}
              placeholder={`"Find the sharpest edge on tonight's MLB slate"  ·  "Analyze Dodgers vs Padres, I like the under"  ·  "Best dog on the board right now"`}
              rows={3}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none', outline: 'none',
                color: '#eee',
                fontSize: '0.9rem',
                fontFamily: 'Inter, sans-serif',
                resize: 'none',
                padding: '13px 8px 13px 0',
                lineHeight: 1.65,
                caretColor: '#FFB800',
              }}
            />

            {/* Fire button */}
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
              <VoiceButton value={prompt} onChange={setPrompt} size="md" />
              <button
                onClick={() => runBetOS()}
                disabled={!canFire}
                style={{
                  padding: '10px 22px',
                  borderRadius: '9px',
                  border: 'none',
                  background: canFire
                    ? 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)'
                    : '#141414',
                  color: canFire ? '#000' : '#2a2a2a',
                  fontWeight: 900,
                  fontSize: '0.78rem',
                  letterSpacing: '0.12em',
                  cursor: canFire ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  boxShadow: canFire ? '0 4px 20px rgba(255,149,0,0.4)' : 'none',
                }}
                onMouseEnter={e => { if (canFire) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(255,149,0,0.5)'; } }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = canFire ? '0 4px 20px rgba(255,149,0,0.4)' : 'none'; }}
              >
                {loading ? '· · ·' : '▶ FIRE'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.62rem', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace' }}>
            ⌘↵ to run
          </div>
        </div>
      </div>

      {/* ── LOADING — animated terminal steps + ETA ──────────────── */}
      {loading && (
        <div style={{
          background: '#050505',
          border: '1px solid rgba(255,184,0,0.1)',
          borderRadius: '12px',
          padding: '1.25rem 1.5rem',
          fontFamily: '"IBM Plex Mono", monospace',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{
              color: '#FFB800', fontSize: '0.68rem',
              letterSpacing: '0.15em', textTransform: 'uppercase',
            }}>
              ◈ BetOS ACTIVATING
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#FFB800', fontSize: '1.1rem', fontWeight: 800, lineHeight: 1 }}>
                  {elapsed}s
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem', marginTop: '1px' }}>
                  ~15–30s typical
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ width: '80px', height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #FFB800, #FF9500)',
                  borderRadius: '2px',
                  width: `${Math.min((elapsed / 28) * 100, 95)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {LOAD_STEPS.map((step, i) => {
              const done    = doneSteps.includes(i);
              const active  = loadStep === i + 1 && !done;
              const pending = loadStep <= i && !done;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  opacity: pending ? 0.18 : 1,
                  transition: 'opacity 0.4s',
                }}>
                  <span style={{
                    width: '14px', flexShrink: 0, textAlign: 'center',
                    color: done ? '#4ade80' : active ? '#FFB800' : '#333',
                    fontSize: done ? '0.8rem' : '0.7rem',
                  }}>
                    {done ? '✓' : active ? '▶' : '○'}
                  </span>
                  <span style={{
                    color: done ? '#4ade80' : active ? '#e0e0e0' : '#444',
                    fontSize: '0.8rem', letterSpacing: '0.01em',
                  }}>
                    {step}
                  </span>
                  {active && (
                    <span style={{
                      color: '#FFB800', fontSize: '0.65rem',
                      letterSpacing: '0.2em', marginLeft: '2px',
                    }}>
                      ●●●
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ERROR ──────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          background: 'rgba(248,113,113,0.04)',
          border: '1px solid rgba(248,113,113,0.18)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex', gap: '12px',
        }}>
          <span style={{ color: '#f87171', fontSize: '1rem', flexShrink: 0, marginTop: '1px' }}>✕</span>
          <div>
            <div style={{ color: '#f87171', fontWeight: 700, fontSize: '0.85rem', marginBottom: '4px' }}>Analysis Failed</div>
            <div style={{ color: 'rgba(248,113,113,0.85)', fontSize: '0.8rem' }}>{error}</div>
            <div style={{ color: 'rgba(248,113,113,0.55)', fontSize: '0.72rem', marginTop: '6px' }}>Ensure XAI_API_KEY is set in .env.local and restart the server.</div>
          </div>
        </div>
      )}

      {/* ── GET STARTED (empty state) ────────────────────────────── */}
      {!loading && !result && !error && history.length === 0 && (
        <div style={{
          background: 'linear-gradient(160deg, #0a0800 0%, #080810 100%)',
          border: '1px solid rgba(255,184,0,0.08)',
          borderRadius: '14px',
          padding: '2.5rem 2rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.8rem', marginBottom: '1rem', lineHeight: 1 }}>🎯</div>
          <div style={{ color: 'rgba(255,184,0,0.85)', fontWeight: 900, fontSize: '1rem', letterSpacing: '0.06em', marginBottom: '6px' }}>
            BetOS READY
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '1.5rem', maxWidth: '380px', margin: '0 auto 1.5rem', lineHeight: 1.65 }}>
            Ask BetOS for today's sharpest pick, or use a preset above to instantly scan any sport's slate.
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { emoji: '⚾', label: 'Best MLB tonight' },
              { emoji: '🏀', label: 'Sharp NBA angle' },
              { emoji: '🔥', label: 'Best bet right now' },
            ].map(tip => (
              <button
                key={tip.label}
                onClick={() => { /* prompt setter is in parent scope */ }}
                style={{
                  background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.18)',
                  borderRadius: '20px', padding: '5px 14px', color: 'rgba(255,184,0,0.7)',
                  fontSize: '0.72rem', fontWeight: 600, cursor: 'default', fontFamily: 'inherit',
                }}
              >
                {tip.emoji} {tip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── RESULT (collapsible) ───────────────────────────────────── */}
      {result && !loading && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,184,0,0.25)', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Collapse header */}
          <button
            onClick={() => setResultCollapsed(v => !v)}
            style={{ width: '100%', padding: '0.75rem 1.25rem', background: 'rgba(255,184,0,0.04)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '1rem' }}>🎯</span>
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div style={{ color: 'var(--gold)', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>BetOS Pick Report</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' }}>
                  {(() => {
                    const pick = result?.match(/(?:^|\n)THE PICK\s*:\s*([^\n]{5,100})/im)?.[1]?.trim();
                    return pick || cleanPromptDisplay(prompt, 80);
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {(() => {
                const conf = extractConf(result);
                const confColor = { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888' }[conf];
                return conf ? (
                  <span style={{
                    color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}40`,
                    borderRadius: '4px', padding: '2px 8px', fontSize: '0.65rem', fontWeight: 800,
                    letterSpacing: '0.06em',
                  }}>
                    {conf} CONFIDENCE
                  </span>
                ) : null;
              })()}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', transition: 'transform 0.2s', display: 'inline-block', transform: resultCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}>▼</span>
            </div>
          </button>
          {/* Full report content */}
          {!resultCollapsed && (
            <div style={{ borderTop: '1px solid rgba(255,184,0,0.15)' }}>
              <GoatPickCard result={result} model={model} prompt={prompt} runTime={runTime} user={user} isDemo={isDemo} />
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY PANEL — collapsible report cards ───────────────── */}
      {history.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Section header */}
          <button
            onClick={() => setShowHistory(v => !v)}
            style={{ width: '100%', padding: '0.75rem 1.25rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>🗂</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.82rem' }}>GOAT History</span>
              <span style={{ background: 'rgba(255,184,0,0.12)', color: 'var(--gold)', borderRadius: '10px', padding: '1px 8px', fontSize: '0.68rem', fontWeight: 800 }}>
                {history.length}
              </span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{showHistory ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showHistory && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {history.map((entry, idx) => {
                const conf = extractConf(entry.result);
                const confColor = { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888' }[conf] || '#888';
                // Robust pick extraction — reject date phrases like "for April 5, 2026"
                const rawPick = (entry.result || '').match(/(?:^|\n)THE PICK\s*:\s*([^\n]{5,100})/im)?.[1]?.trim()
                             || (entry.result || '').match(/(?:^|\n)(?:MY PICK|BEST PICK)\s*:\s*([^\n]{5,100})/im)?.[1]?.trim();
                const pickLine = (rawPick && !/^for\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)/i.test(rawPick))
                  ? stripMarkdown(rawPick).slice(0, 62) : null;
                const when = new Date(entry.timestamp);
                const timeLabel = when.toLocaleDateString() === new Date().toLocaleDateString()
                  ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isExpanded = expandedHistoryId === entry.id;

                return (
                  <div
                    key={entry.id}
                    style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                  >
                    {/* Row header — always visible */}
                    <button
                      onClick={() => setExpandedHistoryId(isExpanded ? null : entry.id)}
                      style={{
                        width: '100%', padding: '0.65rem 1.25rem', background: isExpanded ? 'rgba(255,184,0,0.03)' : 'none',
                        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'none'; }}
                    >
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0 }}>🎯</span>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pickLine ? `→ ${pickLine}` : `→ ${cleanPromptDisplay(entry.prompt, 68)}`}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.63rem', marginTop: '1px' }}>
                          {timeLabel}{entry.runTime ? ` · ${entry.runTime}s` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {conf && (
                          <span style={{
                            color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}40`,
                            borderRadius: '4px', padding: '1px 7px', fontSize: '0.63rem', fontWeight: 800,
                            letterSpacing: '0.05em',
                          }}>
                            {conf}
                          </span>
                        )}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>
                    </button>
                    {/* Expanded full report */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-base)' }}>
                        <GoatPickCard result={entry.result} model={entry.model} prompt={entry.prompt} runTime={entry.runTime} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── LIVE X FEED ────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '12px', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.9rem 1.25rem',
          borderBottom: showFeed ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1rem' }}>📡</span>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem' }}>Live Sports Intel</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '1px' }}>
                Fresh news, injuries, line movement via live search
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {feedTime && (
              <span style={{ color: '#555', fontSize: '0.65rem', fontFamily: 'IBM Plex Mono' }}>
                {feedTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={loadFeed}
              disabled={feedLoading}
              style={{
                padding: '6px 14px', borderRadius: '8px',
                border: '1px solid rgba(255,184,0,0.35)',
                background: 'rgba(255,184,0,0.06)',
                color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700,
                cursor: feedLoading ? 'not-allowed' : 'pointer',
                opacity: feedLoading ? 0.6 : 1, transition: 'all 0.12s',
              }}
            >
              {feedLoading ? '⟳ Loading...' : '⟳ Refresh Feed'}
            </button>
            {showFeed && (
              <button onClick={() => setShowFeed(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
            )}
          </div>
        </div>

        {showFeed && feedItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {feedItems.map((item, i) => (
              <div key={i} style={{
                padding: '0.85rem 1.25rem',
                borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ color: 'var(--gold)', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0, marginTop: '3px', fontFamily: 'IBM Plex Mono' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '3px' }}>{item.item}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.55, marginBottom: '4px' }}>{item.detail}</div>
                    {item.angle && (
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.15)',
                        borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', color: 'var(--gold)',
                      }}>
                        ⚡ {item.angle}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* News Chat */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem', background: 'rgba(255,184,0,0.02)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.65rem', fontWeight: 700 }}>
                💬 Ask about the news
              </div>
              {chatMessages.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} style={{
                      padding: '0.55rem 0.85rem',
                      borderRadius: '8px',
                      background: msg.role === 'user' ? 'rgba(255,184,0,0.08)' : 'var(--bg-elevated)',
                      border: msg.role === 'user' ? '1px solid rgba(255,184,0,0.2)' : '1px solid var(--border)',
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                    }}>
                      <div style={{ color: msg.role === 'user' ? 'var(--gold)' : 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.55 }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ padding: '0.5rem 0.85rem', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', alignSelf: 'flex-start' }}>
                      <span style={{ color: '#FFB800', fontFamily: 'IBM Plex Mono', fontSize: '0.75rem' }}>●●●</span>
                    </div>
                  )}
                </div>
              )}
              <form onSubmit={sendChat} style={{ display: 'flex', gap: '8px' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="e.g. Does this injury affect tonight's total?"
                  disabled={chatLoading}
                  style={{
                    flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)',
                    borderRadius: '8px', padding: '0.5rem 0.85rem',
                    color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(255,184,0,0.4)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatLoading}
                  style={{
                    padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                    background: chatInput.trim() && !chatLoading ? 'var(--gold)' : 'var(--border)',
                    color: chatInput.trim() && !chatLoading ? '#000' : '#555',
                    fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                    transition: 'all 0.12s', whiteSpace: 'nowrap',
                  }}
                >Ask</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. FILTER ANALYSIS
// ────────────────────────────────────────────────────────────────────────────

function FilterAnalysis({ picks }) {
  const settled = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH');

  const bySport = useMemo(() => {
    const map = {};
    settled.forEach(p => {
      if (!map[p.sport]) map[p.sport] = { sport: p.sport, wins: 0, losses: 0, units: 0, total: 0 };
      map[p.sport].total++;
      map[p.sport].units += parseFloat(p.profit) || 0;
      if (p.result === 'WIN') map[p.sport].wins++;
      if (p.result === 'LOSS') map[p.sport].losses++;
    });
    return Object.values(map).map(d => ({
      ...d,
      winPct: d.total ? ((d.wins / d.total) * 100).toFixed(1) : 0,
      units: parseFloat(d.units.toFixed(3)),
    }));
  }, [settled]);

  const byOddsRange = useMemo(() => {
    const ranges = [
      { label: 'Heavy Dog (+200+)', test: o => o >= 200 },
      { label: 'Dog (+101 to +199)', test: o => o >= 101 && o <= 199 },
      { label: 'Pick (+100 to -109)', test: o => o <= 100 && o >= -109 },
      { label: 'Small Fav (-110 to -149)', test: o => o <= -110 && o >= -149 },
      { label: 'Fav (-150 to -199)', test: o => o <= -150 && o >= -199 },
      { label: 'Heavy Fav (-200+)', test: o => o <= -200 },
    ];
    return ranges.map(r => {
      const grp = settled.filter(p => r.test(p.odds));
      const wins = grp.filter(p => p.result === 'WIN').length;
      const units = grp.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
      return {
        label: r.label,
        total: grp.length,
        wins,
        losses: grp.filter(p => p.result === 'LOSS').length,
        winPct: grp.length ? parseFloat(((wins / grp.length) * 100).toFixed(1)) : 0,
        units: parseFloat(units.toFixed(3)),
      };
    }).filter(r => r.total > 0);
  }, [settled]);

  const byBetType = useMemo(() => {
    const map = {};
    settled.forEach(p => {
      const t = p.bet_type || 'Unknown';
      if (!map[t]) map[t] = { type: t, wins: 0, losses: 0, units: 0, total: 0 };
      map[t].total++;
      map[t].units += parseFloat(p.profit) || 0;
      if (p.result === 'WIN') map[t].wins++;
    });
    return Object.values(map).map(d => ({
      ...d,
      units: parseFloat(d.units.toFixed(3)),
      winPct: d.total ? parseFloat(((d.wins / d.total) * 100).toFixed(1)) : 0,
    }));
  }, [settled]);

  if (settled.length === 0) {
    return <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No settled picks yet — results will appear here after you log wins and losses.</div>;
  }

  const barColor = (val) => val >= 0 ? '#4ade80' : '#f87171';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* By Sport */}
      <div className="card" style={{ padding: '1.3rem' }}>
        <h3 style={{ fontWeight: 700, color: '#f0f0f0', marginBottom: '1rem', fontSize: '0.95rem' }}>P/L by Sport</h3>
        {bySport.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No data.</p> : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={bySport} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="sport" tick={{ fill: '#888', fontSize: 11 }} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', fontSize: '0.8rem' }}
                  formatter={(v) => [`${v >= 0 ? '+' : ''}${v}u`, 'Units']}
                />
                <Bar dataKey="units" radius={[4, 4, 0, 0]}>
                  {bySport.map((d, i) => <Cell key={i} fill={barColor(d.units)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table style={{ width: '100%', marginTop: '0.8rem', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <thead><tr>{['Sport', 'W-L', 'Win%', 'Units'].map(h => (
                <th key={h} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
              ))}</tr></thead>
              <tbody>{bySport.map(d => (
                <tr key={d.sport}>
                  <td style={{ padding: '5px 8px', color: '#60a5fa', fontWeight: 600 }}>{d.sport}</td>
                  <td style={{ padding: '5px 8px', color: '#f0f0f0' }}>{d.wins}-{d.losses}</td>
                  <td style={{ padding: '5px 8px', color: '#f0f0f0' }}>{d.winPct}%</td>
                  <td style={{ padding: '5px 8px', color: d.units >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace', fontWeight: 700 }}>{d.units >= 0 ? '+' : ''}{d.units}u</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </div>

      {/* By Odds Range */}
      <div className="card" style={{ padding: '1.3rem' }}>
        <h3 style={{ fontWeight: 700, color: '#f0f0f0', marginBottom: '1rem', fontSize: '0.95rem' }}>P/L by Odds Range</h3>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead><tr>{['Range', 'Picks', 'W-L', 'Win%', 'Units'].map(h => (
            <th key={h} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
          ))}</tr></thead>
          <tbody>{byOddsRange.map(d => (
            <tr key={d.label} style={{ borderTop: '1px solid #1a1a1a' }}>
              <td style={{ padding: '6px 8px', color: '#f0f0f0' }}>{d.label}</td>
              <td style={{ padding: '6px 8px', color: '#888' }}>{d.total}</td>
              <td style={{ padding: '6px 8px', color: '#f0f0f0' }}>{d.wins}-{d.losses}</td>
              <td style={{ padding: '6px 8px', color: d.winPct > 50 ? '#4ade80' : '#f0f0f0' }}>{d.winPct}%</td>
              <td style={{ padding: '6px 8px', color: d.units >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace', fontWeight: 700 }}>{d.units >= 0 ? '+' : ''}{d.units}u</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {/* By Bet Type */}
      <div className="card" style={{ padding: '1.3rem' }}>
        <h3 style={{ fontWeight: 700, color: '#f0f0f0', marginBottom: '1rem', fontSize: '0.95rem' }}>P/L by Bet Type</h3>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead><tr>{['Type', 'Picks', 'W-L', 'Win%', 'Units'].map(h => (
            <th key={h} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
          ))}</tr></thead>
          <tbody>{byBetType.map(d => (
            <tr key={d.type} style={{ borderTop: '1px solid #1a1a1a' }}>
              <td style={{ padding: '6px 8px', color: '#f0f0f0' }}>{d.type}</td>
              <td style={{ padding: '6px 8px', color: '#888' }}>{d.total}</td>
              <td style={{ padding: '6px 8px', color: '#f0f0f0' }}>{d.wins}-{d.losses}</td>
              <td style={{ padding: '6px 8px', color: d.winPct > 50 ? '#4ade80' : '#f0f0f0' }}>{d.winPct}%</td>
              <td style={{ padding: '6px 8px', color: d.units >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace', fontWeight: 700 }}>{d.units >= 0 ? '+' : ''}{d.units}u</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. KELLY CALCULATOR
// ────────────────────────────────────────────────────────────────────────────

function KellyCalculator() {
  const [bankroll, setBankroll]   = useState(1000);
  const [odds, setOdds]           = useState(105);
  const [winPct, setWinPct]       = useState(54);
  const [fraction, setFraction]   = useState(0.25);

  const result = useMemo(() => {
    const p = winPct / 100;
    const q = 1 - p;
    const b = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
    const kelly = (b * p - q) / b;
    const fractional = kelly * fraction;
    const wager = fractional * bankroll;
    const ev = (p * b - q) * 100; // EV in cents per $1
    const impliedWinPct = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
    return {
      kelly: (kelly * 100).toFixed(2),
      fractional: (fractional * 100).toFixed(2),
      wager: wager.toFixed(2),
      ev: ev.toFixed(2),
      edge: ((p - impliedWinPct) * 100).toFixed(2),
      isPositive: kelly > 0,
    };
  }, [bankroll, odds, winPct, fraction]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.9rem' }}>
        {[
          { label: 'Bankroll ($)', value: bankroll, set: setBankroll, type: 'number', min: 1 },
          { label: 'Odds (American)', value: odds, set: setOdds, type: 'number', placeholder: '+105 or -118' },
          { label: 'Your Win % Estimate', value: winPct, set: setWinPct, type: 'number', min: 1, max: 99 },
          { label: `Kelly Fraction (${(fraction * 100).toFixed(0)}%)`, value: fraction, set: setFraction, type: 'range', min: 0.05, max: 1, step: 0.05 },
        ].map(({ label, value, set, type, min, max, step, placeholder }) => (
          <div key={label}>
            <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
              {label}
            </label>
            <input
              className={type === 'range' ? '' : 'input'}
              type={type}
              value={value}
              min={min}
              max={max}
              step={step}
              placeholder={placeholder}
              onChange={e => set(type === 'range' ? parseFloat(e.target.value) : e.target.value)}
              style={type === 'range' ? { width: '100%', accentColor: '#FFB800' } : {}}
            />
          </div>
        ))}
      </div>

      {/* Results */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.8rem' }}>
        {[
          { label: 'Edge', value: `${result.edge}%`, color: parseFloat(result.edge) > 0 ? '#4ade80' : '#f87171' },
          { label: 'Expected Value', value: `+${result.ev}¢ per $1`, color: parseFloat(result.ev) > 0 ? '#4ade80' : '#f87171' },
          { label: 'Full Kelly', value: `${result.kelly}%`, color: '#FFB800' },
          { label: `${(fraction * 100).toFixed(0)}% Kelly Wager`, value: `$${result.wager}`, color: result.isPositive ? '#FFB800' : '#f87171' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card-inner" style={{ padding: '1rem', textAlign: 'center' }}>
            <p style={{ color: '#888', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>{label}</p>
            <p style={{ color, fontWeight: 800, fontSize: '1.4rem', fontFamily: 'monospace' }}>{value}</p>
          </div>
        ))}
      </div>

      {!result.isPositive && (
        <div style={{ background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', padding: '0.8rem 1rem', color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ Negative Kelly — no edge at these odds with this win%. Pass this bet.
        </div>
      )}
      {result.isPositive && (
        <div style={{ background: '#0d2b0d', border: '1px solid #166534', borderRadius: '8px', padding: '0.8rem 1rem', color: '#4ade80', fontSize: '0.85rem' }}>
          ✅ Positive edge! Bet ${result.wager} on ${bankroll} bankroll ({result.fractional}% of roll).
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. HEAD-TO-HEAD SCORER
// ────────────────────────────────────────────────────────────────────────────

const FACTORS = [
  { key: 'record', label: 'Season Record / Form' },
  { key: 'rest', label: 'Rest Advantage' },
  { key: 'travel', label: 'Travel / Home Field' },
  { key: 'injuries', label: 'Injury Situation' },
  { key: 'pitching', label: 'Pitching / Starting QB' },
  { key: 'lineMove', label: 'Line Movement (Sharp)' },
  { key: 'weather', label: 'Weather / Conditions' },
  { key: 'motivation', label: 'Motivation / Spot' },
];

function HeadToHead() {
  const [teamA, setTeamA]   = useState('');
  const [teamB, setTeamB]   = useState('');
  const [scores, setScores] = useState(() => {
    const s = {};
    FACTORS.forEach(f => { s[f.key] = { a: 5, b: 5 }; });
    return s;
  });
  const [notes, setNotes]   = useState(() => {
    const n = {};
    FACTORS.forEach(f => { n[f.key] = ''; });
    return n;
  });

  function setScore(factor, side, val) {
    setScores(prev => ({ ...prev, [factor]: { ...prev[factor], [side]: parseInt(val) } }));
  }

  const totals = useMemo(() => {
    let a = 0, b = 0;
    FACTORS.forEach(f => { a += scores[f.key].a; b += scores[f.key].b; });
    const total = a + b;
    return { a, b, aPct: total ? ((a / total) * 100).toFixed(1) : 50, bPct: total ? ((b / total) * 100).toFixed(1) : 50 };
  }, [scores]);

  const winner = totals.a > totals.b ? teamA || 'Team A' : totals.b > totals.a ? teamB || 'Team B' : null;
  const confidence = Math.abs(totals.a - totals.b) / (FACTORS.length * 10) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Teams */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {[
          { label: 'Team A', value: teamA, set: setTeamA, color: '#60a5fa', placeholder: 'e.g. Pittsburgh Pirates' },
          { label: 'Team B', value: teamB, set: setTeamB, color: '#f472b6', placeholder: 'e.g. Baltimore Orioles' },
        ].map(({ label, value, set, color, placeholder }) => (
          <div key={label}>
            <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
              {label}
            </label>
            <input className="input" value={value} onChange={e => set(e.target.value)} placeholder={placeholder} style={{ borderColor: color + '44' }} />
          </div>
        ))}
      </div>

      {/* Factor Sliders */}
      <div className="card" style={{ padding: '1.3rem' }}>
        <p style={{ color: '#888', fontSize: '0.78rem', marginBottom: '1rem' }}>
          Score each factor 1–10 for each team. Higher = stronger edge.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {FACTORS.map(f => (
            <div key={f.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#f0f0f0', fontSize: '0.85rem', flex: '1 1 160px', minWidth: '120px' }}>{f.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                  <span style={{ color: '#60a5fa', fontSize: '0.75rem', minWidth: '16px' }}>{teamA?.split(' ').pop() || 'A'}</span>
                  <input type="range" min="1" max="10" value={scores[f.key].a} onChange={e => setScore(f.key, 'a', e.target.value)} style={{ accentColor: '#60a5fa', width: '100px' }} />
                  <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '0.9rem', minWidth: '18px', fontFamily: 'monospace' }}>{scores[f.key].a}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                  <span style={{ color: '#f472b6', fontSize: '0.75rem', minWidth: '16px' }}>{teamB?.split(' ').pop() || 'B'}</span>
                  <input type="range" min="1" max="10" value={scores[f.key].b} onChange={e => setScore(f.key, 'b', e.target.value)} style={{ accentColor: '#f472b6', width: '100px' }} />
                  <span style={{ color: '#f472b6', fontWeight: 700, fontSize: '0.9rem', minWidth: '18px', fontFamily: 'monospace' }}>{scores[f.key].b}</span>
                </div>
                <input
                  className="input"
                  value={notes[f.key]}
                  onChange={e => setNotes(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder="Notes..."
                  style={{ flex: '1 1 140px', fontSize: '0.78rem', padding: '4px 8px' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Result */}
      <div className="card" style={{ padding: '1.3rem' }}>
        <h3 style={{ fontWeight: 700, color: '#f0f0f0', marginBottom: '1rem', fontSize: '0.95rem' }}>Scorecard Result</h3>
        {/* Bar */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
            <span style={{ color: '#60a5fa', fontWeight: 700 }}>{teamA || 'Team A'}: {totals.a}pts ({totals.aPct}%)</span>
            <span style={{ color: '#f472b6', fontWeight: 700 }}>{teamB || 'Team B'}: {totals.b}pts ({totals.bPct}%)</span>
          </div>
          <div style={{ height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#1a1a1a', display: 'flex' }}>
            <div style={{ width: `${totals.aPct}%`, background: '#60a5fa', transition: 'width 0.3s ease' }} />
            <div style={{ width: `${totals.bPct}%`, background: '#f472b6', transition: 'width 0.3s ease' }} />
          </div>
        </div>

        {winner ? (
          <div style={{ background: '#0d2b0d', border: '1px solid #166534', borderRadius: '8px', padding: '0.9rem 1.1rem' }}>
            <p style={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
              🏆 Edge: <span style={{ color: totals.a > totals.b ? '#60a5fa' : '#f472b6' }}>{winner}</span>
            </p>
            <p style={{ color: '#888', fontSize: '0.82rem', marginTop: '4px' }}>
              Confidence: {confidence.toFixed(0)}% — {confidence < 15 ? 'Lean (flip or pass)' : confidence < 30 ? 'Moderate edge' : 'Strong edge'}
            </p>
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>It's a toss-up based on your scores.</p>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. AI INSIGHTS — BETTING COACH
// ────────────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR  = { high: '#FF4560', medium: '#FF8C42', low: '#FFB800' };
const STRENGTH_COLOR  = { strong: '#00D48B', moderate: '#4E9BF5', developing: '#9B6DFF' };

function BettingInsights({ picks }) {
  const [insights, setInsights]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [analyzed, setAnalyzed]   = useState(0);

  const settled = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH');

  async function runInsights() {
    setLoading(true);
    setInsights(null);
    setError('');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Analysis failed');
      setInsights(data.insights);
      setAnalyzed(data.picksAnalyzed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (settled.length < 3) {
    return (
      <div className="surface" style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🧠</div>
        <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.5rem' }}>Log more picks to unlock AI Insights</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Need at least 3 settled picks. You have {settled.length} so far.</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.4rem' }}>The more picks you have, the sharper and more specific the analysis gets.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Run button */}
      <div className="surface" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>AI Betting Coach</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {analyzed > 0
              ? `Last analysis ran on ${analyzed} picks — run again any time to refresh`
              : `${settled.length} settled picks ready to analyze`}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={runInsights}
          disabled={loading}
          style={{ padding: '0.65rem 1.5rem', fontSize: '0.9rem' }}
        >
          {loading ? '🧠 Analyzing...' : '🧠 Run Analysis'}
        </button>
      </div>

      {loading && (
        <div className="surface" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ color: 'var(--gold)', fontSize: '1.8rem', marginBottom: '0.75rem' }}>🧠</div>
          <p style={{ color: 'var(--text-secondary)' }}>Reviewing your {settled.length} picks for patterns, leaks, and edges...</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.4rem' }}>Analyzing patterns with BetOS AI...</p>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--red-subtle)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: '8px', padding: '1rem', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {insights && !loading && (
        <>
          {/* Score + Summary */}
          <div className="surface" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  border: `3px solid ${insights.score >= 60 ? 'var(--green)' : insights.score >= 40 ? 'var(--gold)' : 'var(--red)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column',
                }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '1.6rem', fontWeight: 700, color: insights.score >= 60 ? 'var(--green)' : insights.score >= 40 ? 'var(--gold)' : 'var(--red)', lineHeight: 1 }}>
                    {insights.score}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>/ 100</span>
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {insights.score >= 70 ? 'Sharp' : insights.score >= 50 ? 'Developing' : 'Square'}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Overall Assessment · {analyzed} picks analyzed
                </div>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: 1.6 }}>{insights.summary}</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {/* Leaks */}
            {insights.leaks?.length > 0 && (
              <div className="surface" style={{ padding: '1.25rem' }}>
                <h3 style={{ fontWeight: 700, color: 'var(--red)', fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🔴 Leaks to Fix
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {insights.leaks.map((leak, i) => (
                    <div key={i} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[leak.severity] || 'var(--red)'}`, paddingLeft: '0.9rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{leak.title}</span>
                        <span style={{ fontSize: '0.65rem', color: SEVERITY_COLOR[leak.severity], background: `${SEVERITY_COLOR[leak.severity]}18`, padding: '1px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 }}>
                          {leak.severity}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{leak.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Edges */}
            {insights.edges?.length > 0 && (
              <div className="surface" style={{ padding: '1.25rem' }}>
                <h3 style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🟢 Your Edges
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {insights.edges.map((edge, i) => (
                    <div key={i} style={{ borderLeft: `3px solid ${STRENGTH_COLOR[edge.strength] || 'var(--green)'}`, paddingLeft: '0.9rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{edge.title}</span>
                        <span style={{ fontSize: '0.65rem', color: STRENGTH_COLOR[edge.strength], background: `${STRENGTH_COLOR[edge.strength]}18`, padding: '1px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 }}>
                          {edge.strength}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{edge.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Patterns */}
          {insights.patterns?.length > 0 && (
            <div className="surface" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--blue)', fontSize: '0.9rem', marginBottom: '1rem' }}>📈 Patterns</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {insights.patterns.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>→</span>
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{p.title}:</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.83rem', marginLeft: '5px' }}>{p.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {insights.recommendations?.length > 0 && (
            <div className="surface" style={{ padding: '1.25rem', borderColor: 'rgba(255,184,0,0.2)' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--gold)', fontSize: '0.9rem', marginBottom: '1rem' }}>🎯 Recommendations</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {insights.recommendations.map((rec, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--gold)', fontFamily: 'IBM Plex Mono', fontSize: '0.8rem', flexShrink: 0, marginTop: '1px' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.55 }}>{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ANALYZER TAB
// ────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'betos',   label: '🎯 BetOS Live',        desc: 'Real-time AI pick analysis + live web search' },
  { id: 'filter',    label: '📊 Filter Analysis',        desc: 'ROI breakdown by sport, odds range, bet type' },
  { id: 'insights',  label: '🧠 AI Insights',           desc: 'Personalized coaching — leaks, edges, and habits from your pick history' },
];

export default function AnalyzerTab({ picks, user, isDemo, goatPrompt, onGoatPromptConsumed, goatReport, onGoatReportConsumed }) {
  const [active, setActive] = useState('betos');

  // Auto-switch to BetOS tab when a prompt or report is injected
  useEffect(() => {
    if (goatPrompt || goatReport) setActive('betos');
  }, [goatPrompt, goatReport]);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              padding: '0.6rem 1.1rem',
              borderRadius: '8px',
              border: `1px solid ${active === s.id ? '#FFB800' : '#2a2a2a'}`,
              background: active === s.id ? '#1a1200' : '#111',
              color: active === s.id ? '#FFB800' : '#888',
              fontWeight: active === s.id ? 700 : 400,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section description */}
      <p style={{ color: '#555', fontSize: '0.8rem' }}>
        {SECTIONS.find(s => s.id === active)?.desc}
      </p>

      {/* Section content — BetOSLive stays mounted to preserve results */}
      {active === 'insights'  && <BettingInsights picks={picks} />}
      <div style={{ display: active === 'betos' ? 'block' : 'none' }}>
        <BetOSLive
          injectedPrompt={goatPrompt}
          onPromptConsumed={onGoatPromptConsumed}
          injectedReport={goatReport}
          onReportConsumed={onGoatReportConsumed}
          user={user}
          isDemo={isDemo}
        />
      </div>
      {active === 'filter'   && <FilterAnalysis picks={picks} />}
    </div>
  );
}
