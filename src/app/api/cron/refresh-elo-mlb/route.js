/**
 * /api/cron/refresh-elo-mlb
 *
 * Rebuilds MLB Elo ratings from ESPN game history and writes them to the
 * mlb_elo_ratings Supabase table. Scheduled daily at 07:00 UTC via vercel.json.
 *
 * Why a separate cron: /api/sports has a 15s Vercel serverless timeout. The
 * cold rebuild (60 ESPN team-schedule requests) takes 5-15s on its own, so it
 * cannot run inline in the hot path. This cron runs ahead of game time and
 * keeps the table warm so /api/sports + /api/quant-pick always get a cache hit.
 *
 * GET /api/cron/refresh-elo-mlb
 *   → { ok: true, source, gameCount, lastDate, teams, durationMs }
 *
 * force=1 query param bypasses the 24h TTL — useful for manual seeding.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentMLBRatings } from '@/lib/eloRatings';

export const maxDuration = 60; // allow full ESPN crawl (15s budget on /api/sports is why we split this out)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export async function GET(req) {
  const start = Date.now();
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === '1';

  // Verify Vercel cron secret (skip check if secret not configured — dev mode)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await getCurrentMLBRatings({ supabase, force: force || true });
    const teams = Object.keys(result.ratings || {}).length;

    console.log(`[refresh-elo-mlb] source=${result.source} teams=${teams} gameCount=${result.gameCount} lastDate=${result.lastDate} duration=${Date.now() - start}ms`);

    return NextResponse.json({
      ok: true,
      source: result.source,
      gameCount: result.gameCount,
      lastDate: result.lastDate,
      teams,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    console.error('[refresh-elo-mlb] error:', err.message);
    return NextResponse.json(
      { ok: false, error: err.message, durationMs: Date.now() - start },
      { status: 500 },
    );
  }
}
