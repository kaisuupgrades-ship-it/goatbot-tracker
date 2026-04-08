import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callAI } from '@/lib/ai';

export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Calculate implied probability from American odds
 */
function calculateImpliedProb(odds) {
  const o = parseInt(odds);
  if (o > 0) {
    // Plus odds: prob = 100 / (odds + 100)
    return (100 / (o + 100)) * 100;
  } else {
    // Minus odds: prob = Math.abs(odds) / (Math.abs(odds) + 100)
    return (Math.abs(o) / (Math.abs(o) + 100)) * 100;
  }
}

/**
 * Generate a smart fallback analysis based on odds alone
 */
function generateFallbackAnalysis(odds, team, betType) {
  const impliedProb = calculateImpliedProb(odds);
  const o = parseInt(odds);

  let confidence = 'MEDIUM';
  let comment = '';

  if (o > 0) {
    // Plus money
    if (impliedProb < 35) {
      confidence = 'LOW';
      comment = `Heavy underdog at ${o}. Implied win prob ~${impliedProb.toFixed(1)}%. Only take if you see a real edge over that.`;
    } else if (impliedProb < 50) {
      comment = `Underdog value at ${o}. Implied prob ~${impliedProb.toFixed(1)}%. Good spot if fundamentals align.`;
    } else {
      confidence = 'MEDIUM';
      comment = `Plus money on favored side at ${o}. Implied prob ~${impliedProb.toFixed(1)}%. Fair value scenario.`;
    }
  } else {
    // Minus money
    if (impliedProb > 70) {
      confidence = 'MEDIUM';
      comment = `Heavy favorite at ${o}. Implied prob ~${impliedProb.toFixed(1)}%. Check for sharp action before locking in.`;
    } else if (impliedProb > 55) {
      comment = `Slight favorite at ${o}. Implied prob ~${impliedProb.toFixed(1)}%. Solid chalk if the matchup fits.`;
    } else {
      confidence = 'LOW';
      comment = `Close to even-money favorite at ${o}. Implied prob ~${impliedProb.toFixed(1)}%. Needs a strong angle.`;
    }
  }

  return `${team} ${betType} at ${odds} — Implied probability: ${impliedProb.toFixed(1)}%. ${comment} Confidence: ${confidence}.`;
}

/**
 * Build concise BetOS prompt
 */
function buildAnalysisPrompt(team, betType, odds, date, sport, notes) {
  let prompt = `Quick analysis: ${team} ${betType} at ${odds} on ${date}. Sport: ${sport}.`;
  if (notes?.trim()) {
    prompt += ` ${notes}`;
  }
  prompt += ` Give a 2-3 sentence sharp take — is this a good bet? Key angle and confidence level (LOW/MEDIUM/HIGH).`;
  return prompt;
}

/**
 * Call AI (xAI grok-3 first, Claude fallback) for quick analysis
 */
async function callXAI(prompt) {
  const result = await callAI({
    system: 'You are a sharp sports bettor giving quick, decisive analysis. Be concise and direct.',
    user: prompt,
    maxTokens: 300,
    temperature: 0.7,
  });
  return result.text;
}

/**
 * Retrieve cached analysis from Supabase
 */
async function getCachedAnalysis(pickId) {
  const { data, error } = await supabase
    .from('pick_analyses')
    .select('*')
    .eq('pick_id', pickId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found, which is fine
    console.error('Error fetching cached analysis:', error);
  }

  return data;
}

/**
 * Save analysis to Supabase
 */
async function saveAnalysis(pickId, analysis, model) {
  const { error } = await supabase
    .from('pick_analyses')
    .upsert(
      {
        pick_id: pickId,
        analysis,
        model,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'pick_id' }
    );

  if (error) {
    console.error('Error saving analysis:', error);
    throw error;
  }
}

/**
 * POST /api/auto-analyze
 * Accepts: { pickId, sport, team, bet_type, odds, units, date, notes }
 * OR: { action: 'batch-all' } to analyze all unanalyzed picks (admin)
 */
export async function POST(req) {
  try {
    const body = await req.json();

    // Admin batch-all action
    if (body.action === 'batch-all') {
      const result = await runBatchAll();
      return NextResponse.json({ ok: true, ...result });
    }

    const { pickId, sport, team, bet_type, odds, units, date, notes } = body;

    if (!pickId || !sport || !team || !bet_type || odds === undefined || !date) {
      return NextResponse.json(
        { error: 'Missing required fields: pickId, sport, team, bet_type, odds, date' },
        { status: 400 }
      );
    }

    // Check for cached analysis
    const cached = await getCachedAnalysis(pickId);
    if (cached) {
      return NextResponse.json({
        analysis: cached.analysis,
        model: cached.model,
        cached: true,
      });
    }

    let analysis, model;

    if (!XAI_API_KEY) {
      // Fallback: generate analysis based on odds
      analysis = generateFallbackAnalysis(odds, team, bet_type);
      model = 'fallback (odds-based)';
    } else {
      // Call xAI with grok-3
      const prompt = buildAnalysisPrompt(team, bet_type, odds, date, sport, notes);
      try {
        analysis = await callXAI(prompt);
        model = 'grok-3';
      } catch (err) {
        console.error('xAI API error:', err.message);
        // Fallback to odds-based if xAI fails
        analysis = generateFallbackAnalysis(odds, team, bet_type);
        model = 'fallback (xAI error)';
      }
    }

    // Save to Supabase
    try {
      await saveAnalysis(pickId, analysis, model);
    } catch (err) {
      // Log but don't fail the response if save fails
      console.error('Failed to save analysis to Supabase:', err.message);
    }

    return NextResponse.json({
      analysis,
      model,
      cached: false,
    });
  } catch (err) {
    console.error('Auto-analyze POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/auto-analyze?action=batch-all
 * Fetches all picks without a cached analysis and processes them (admin-triggered)
 */
async function runBatchAll() {
  // Fetch all picks
  const { data: allPicks, error: picksErr } = await supabase
    .from('picks')
    .select('id, sport, team, bet_type, odds, units, date, notes')
    .order('created_at', { ascending: false });

  if (picksErr) throw new Error(picksErr.message);
  if (!allPicks?.length) return { processed: 0, skipped: 0, total: 0 };

  // Fetch already-analyzed pick IDs
  const { data: existing } = await supabase
    .from('pick_analyses')
    .select('pick_id');
  const existingIds = new Set((existing || []).map(r => r.pick_id));

  const unanalyzed = allPicks.filter(p => !existingIds.has(p.id));
  let processed = 0;
  let failed = 0;

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < unanalyzed.length; i += 5) {
    const batch = unanalyzed.slice(i, i + 5);
    await Promise.allSettled(batch.map(async (pick) => {
      try {
        const prompt = buildAnalysisPrompt(pick.team, pick.bet_type, pick.odds, pick.date, pick.sport, pick.notes);
        let analysis, model;
        if (!XAI_API_KEY) {
          analysis = generateFallbackAnalysis(pick.odds, pick.team, pick.bet_type);
          model = 'fallback';
        } else {
          analysis = await callXAI(prompt);
          model = 'grok-3';
        }
        await saveAnalysis(pick.id, analysis, model);
        processed++;
      } catch { failed++; }
    }));
    // Small delay between batches
    if (i + 5 < unanalyzed.length) await new Promise(r => setTimeout(r, 500));
  }

  return { processed, failed, skipped: existingIds.size, total: allPicks.length };
}

/**
 * GET /api/auto-analyze?pickId=xxx or ?pickId=xxx,yyy,zzz (comma-separated for batch)
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const pickIdParam = searchParams.get('pickId');

    if (!pickIdParam) {
      return NextResponse.json({ error: 'pickId query parameter is required' }, { status: 400 });
    }

    const pickIds = pickIdParam.split(',').map(id => id.trim()).filter(Boolean);

    if (pickIds.length === 0) {
      return NextResponse.json({ error: 'No valid pick IDs provided' }, { status: 400 });
    }

    if (pickIds.length === 1) {
      // Single pick
      const cached = await getCachedAnalysis(pickIds[0]);
      if (!cached) {
        return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
      }
      return NextResponse.json({
        analysis: cached.analysis,
        model: cached.model,
        pickId: pickIds[0],
      });
    }

    // Batch: return all analyses keyed by pickId
    const { data, error } = await supabase
      .from('pick_analyses')
      .select('*')
      .in('pick_id', pickIds);

    if (error) {
      console.error('Error fetching batch analyses:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const analyses = {};
    (data || []).forEach(row => {
      analyses[row.pick_id] = row.analysis;
    });

    return NextResponse.json({
      analyses,
      count: Object.keys(analyses).length,
    });
  } catch (err) {
    console.error('Auto-analyze GET error:', err.message);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
