#!/usr/bin/env node
/**
 * backfill-pick-lines.js — one-time script to populate the `line` column
 * for existing PENDING spread/total picks that were created before the
 * column was formally added.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-pick-lines.js
 *
 * Or with a .env.local file (requires dotenv):
 *   node -r dotenv/config scripts/backfill-pick-lines.js dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SPREAD_TOTAL_TYPES = ['Spread', 'Run Line', 'Puck Line', 'Over', 'Under', 'Total'];

// ── Line extraction helpers (mirrors gradeEngine.js logic) ──────────────────

function parseLineFromTeam(team) {
  if (!team) return null;
  // Trailing signed number: "Tigers -1.5", "Cowboys +3", "Under 8.5"
  const m = team.match(/[+-]\d+(?:\.\d+)?(?:\s*)$/);
  if (m) return parseFloat(m[0]);
  // "Over 8.5" / "Under 6" / "O 7.5"
  const m2 = team.match(/(?:over|under|o|u)\s*(\d+(?:\.\d+)?)/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

function parseLineFromNotes(notes) {
  if (!notes) return null;
  // "spread -1.5" / "over 7.5" / "line -2"
  const m1 = notes.match(/(?:over|under|total|spread|line|o\/u|ou)\s*([+-]?\d+(?:\.\d+)?)/i);
  if (m1) return parseFloat(m1[1]);
  // "-1.5 total points" / "+3 runs"
  const m2 = notes.match(/([+-]?\d+\.\d+)\s*(?:total|points|runs|goals)/i);
  if (m2) return parseFloat(m2[1]);
  // "Auburn -1.5 live spread"
  const m3 = notes.match(/([+-]?\d+(?:\.\d+)?)\s+(?:\w+\s+)*(?:spread|run line|puck line|line)/i);
  if (m3) return parseFloat(m3[1]);
  return null;
}

function parseLineFromAiAnalysis(text) {
  if (!text) return null;
  // Look for explicit line mentions like "line: -3.5" or "spread of +1.5"
  const m1 = text.match(/(?:line|spread|total|o\/u)\s*[=:]\s*([+-]?\d+(?:\.\d+)?)/i);
  if (m1) return parseFloat(m1[1]);
  // "over/under 8.5" or "o/u 8.5"
  const m2 = text.match(/(?:over\/under|o\/u|total)\s+([+-]?\d+(?:\.\d+)?)/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching PENDING spread/total picks with null line…');

  const { data: picks, error: fetchErr } = await supabase
    .from('picks')
    .select('id, team, notes, ai_analysis, bet_type, result')
    .in('bet_type', SPREAD_TOTAL_TYPES)
    .is('line', null)
    .eq('result', 'PENDING');

  if (fetchErr) {
    console.error('Failed to fetch picks:', fetchErr.message);
    process.exit(1);
  }

  const found      = picks?.length ?? 0;
  let   backfilled = 0;
  let   missing    = 0;

  console.log(`Found ${found} picks to backfill.`);
  if (found === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (const pick of picks) {
    const fromTeam     = parseLineFromTeam(pick.team);
    const fromNotes    = parseLineFromNotes(pick.notes);
    const fromAnalysis = parseLineFromAiAnalysis(pick.ai_analysis);

    const resolved = fromTeam ?? fromNotes ?? fromAnalysis;

    if (resolved !== null && !isNaN(resolved)) {
      const source = fromTeam !== null ? 'team' : fromNotes !== null ? 'notes' : 'ai_analysis';
      const { error: updateErr } = await supabase
        .from('picks')
        .update({ line: resolved })
        .eq('id', pick.id);

      if (updateErr) {
        console.warn(`  [WARN] Failed to update pick ${pick.id}: ${updateErr.message}`);
      } else {
        console.log(`  [OK] pick ${pick.id} — line=${resolved} (from ${source}) — team="${pick.team}"`);
        backfilled++;
      }
    } else {
      console.log(`  [SKIP] pick ${pick.id} — could not resolve line — team="${pick.team}" notes="${pick.notes?.slice(0, 60) ?? ''}"`);
      missing++;
    }
  }

  console.log('\n── Summary ─────────────────────────────────────');
  console.log(`  Picks found:        ${found}`);
  console.log(`  Successfully updated: ${backfilled}`);
  console.log(`  Still missing line: ${missing}`);
  console.log('────────────────────────────────────────────────');

  if (missing > 0) {
    console.log('\nPicks still missing a line cannot be auto-graded.');
    console.log('Review them in Supabase: SELECT id, team, notes FROM picks WHERE line IS NULL AND result = \'PENDING\';');
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
