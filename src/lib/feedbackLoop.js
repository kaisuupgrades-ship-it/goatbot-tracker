/**
 * feedbackLoop.js — The BetOS AI self-improvement engine.
 *
 * Two main systems:
 *
 * 1. POST-MORTEM GENERATOR
 *    After analyses are graded, calls AI to review what happened:
 *    - Why did the pick win or lose?
 *    - What did the AI miss?
 *    - What pattern should be remembered?
 *    Stores structured lessons in `analysis_lessons`.
 *
 * 2. PERFORMANCE CONTEXT BUILDER
 *    Before generating new analyses, queries the lessons DB to build
 *    a rich context block that gets injected into the analysis prompt:
 *    - Overall record + recent trend
 *    - Win rate by sport, confidence, bet type
 *    - Recent losses with lessons learned
 *    - Patterns to avoid and seek
 *    - Confidence calibration data
 *
 * Together these form a feedback loop: analyze → grade → post-mortem → learn → analyze better.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const XAI_BASE = 'https://api.x.ai/v1';

// ═══════════════════════════════════════════════════════════════════════════════
// POST-MORTEM GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

const POSTMORTEM_SYSTEM = `You are BetOS's internal analysis reviewer. You review completed game analyses and their outcomes to extract actionable lessons for future predictions.

Given an analysis that was made BEFORE a game, and the actual result AFTER, produce a structured post-mortem.

Be brutally honest. If the analysis was wrong, identify exactly what was missed or misjudged. If it was right, identify what edge was correctly identified.

Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):
{
  "postmortem": "2-3 sentence narrative of what happened and why the pick won/lost",
  "lesson_type": "one of: betting_angle, injury_miss, line_value, matchup_read, weather, motivation, model_overconfident, sharp_edge, public_fade, situational, bullpen, pitching, scoring_pace, defensive, other",
  "bet_type": "one of: ml, spread, over, under",
  "key_factor": "single most important factor in 5-10 words",
  "lesson_summary": "1-2 sentence actionable lesson for future analyses",
  "avoid_pattern": "pattern to avoid in future (null if win), e.g. 'Avoid backing road favorites in divisional NBA games'",
  "seek_pattern": "pattern to seek in future (null if loss), e.g. 'Target home underdogs after 3+ game losing streaks'",
  "was_overconfident": true/false,
  "was_underconfident": true/false,
  "confidence_delta": 0
}

Rules for confidence_delta:
- 0 = confidence was appropriate for the outcome
- Positive = overconfident (said HIGH but lost → +1, said ELITE but lost → +2)
- Negative = underconfident (said LOW but won → -1, said MEDIUM but won decisively → -1)

For was_overconfident: true if confidence was HIGH/ELITE and result was LOSS
For was_underconfident: true if confidence was LOW/MEDIUM and result was WIN`;

/**
 * Generate post-mortems for recently graded analyses that don't have one yet.
 * Called by the grade-picks cron after the grading phase.
 *
 * @param {number} limit - Max post-mortems to generate per run (to stay within timeout)
 * @returns {{ generated: number, skipped: number, errors: number }}
 */
export async function generatePostMortems(limit = 15) {
  const stats = { generated: 0, skipped: 0, errors: 0 };

  // Find graded analyses that don't have a post-mortem yet
  const { data: graded, error } = await supabase
    .from('game_analyses')
    .select('id, sport, game_date, home_team, away_team, analysis, prediction_pick, prediction_conf, prediction_result, final_score, prompt_version, provider')
    .not('prediction_result', 'is', null)
    .order('prediction_graded_at', { ascending: false })
    .limit(limit * 2); // fetch extra since some may already have lessons

  if (error || !graded?.length) return stats;

  // Filter to those without existing lessons
  const ids = graded.map(g => g.id);
  const { data: existing } = await supabase
    .from('analysis_lessons')
    .select('analysis_id')
    .in('analysis_id', ids);

  const existingIds = new Set((existing || []).map(e => e.analysis_id));
  const needsPostMortem = graded.filter(g => !existingIds.has(g.id)).slice(0, limit);

  if (!needsPostMortem.length) return stats;

  const xaiKey = process.env.XAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  for (const analysis of needsPostMortem) {
    try {
      const userPrompt = buildPostMortemPrompt(analysis);
      const response = await callAIForPostMortem(userPrompt, xaiKey, claudeKey);

      if (!response) { stats.errors++; continue; }

      // Parse the JSON response
      let parsed;
      try {
        // Strip any markdown code block wrappers
        const cleaned = response.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn('[postmortem] Failed to parse AI response as JSON:', response.slice(0, 200));
        stats.errors++;
        continue;
      }

      // Find the audit log entry for this analysis
      const { data: auditLog } = await supabase
        .from('analysis_audit_logs')
        .select('id')
        .eq('analysis_id', analysis.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Insert the lesson
      const { error: insertErr } = await supabase.from('analysis_lessons').insert([{
        analysis_id:       analysis.id,
        audit_log_id:      auditLog?.id || null,
        sport:             analysis.sport,
        game_date:         analysis.game_date,
        home_team:         analysis.home_team,
        away_team:         analysis.away_team,
        predicted_pick:    analysis.prediction_pick,
        predicted_conf:    analysis.prediction_conf,
        predicted_edge:    null,
        result:            analysis.prediction_result,
        final_score:       analysis.final_score,
        postmortem:        parsed.postmortem || null,
        lesson_type:       parsed.lesson_type || 'other',
        bet_type:          parsed.bet_type || null,
        key_factor:        parsed.key_factor || null,
        lesson_summary:    parsed.lesson_summary || null,
        avoid_pattern:     parsed.avoid_pattern || null,
        seek_pattern:      parsed.seek_pattern || null,
        was_overconfident:  parsed.was_overconfident || false,
        was_underconfident: parsed.was_underconfident || false,
        confidence_delta:   parsed.confidence_delta || 0,
        prompt_version:    analysis.prompt_version,
        model_used:        analysis.provider,
        generated_by:      'auto',
      }]);

      if (insertErr) {
        console.warn('[postmortem] Insert error:', insertErr.message);
        stats.errors++;
      } else {
        stats.generated++;
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`[postmortem] Error for ${analysis.away_team}@${analysis.home_team}:`, e.message);
      stats.errors++;
    }
  }

  return stats;
}

function buildPostMortemPrompt(analysis) {
  return `Review this BetOS analysis and its outcome:

SPORT: ${(analysis.sport || '').toUpperCase()}
GAME: ${analysis.away_team} @ ${analysis.home_team} (${analysis.game_date})
FINAL SCORE: ${analysis.final_score || 'Unknown'}

AI'S PICK: ${analysis.prediction_pick || 'Unknown'}
AI'S CONFIDENCE: ${analysis.prediction_conf || 'Unknown'}
RESULT: ${analysis.prediction_result}

FULL ANALYSIS THAT WAS GIVEN PRE-GAME:
${(analysis.analysis || '').slice(0, 2000)}

Generate a structured post-mortem. What happened? Why did the pick ${analysis.prediction_result === 'WIN' ? 'win' : analysis.prediction_result === 'LOSS' ? 'lose' : 'push'}? What should the AI remember for future ${(analysis.sport || '').toUpperCase()} analyses?`;
}

async function callAIForPostMortem(prompt, xaiKey, claudeKey) {
  // Try Grok-3 first (lighter model, no web search needed for post-mortems)
  if (xaiKey) {
    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: 'grok-3',
          messages: [
            { role: 'system', content: POSTMORTEM_SYSTEM },
            { role: 'user', content: prompt },
          ],
          max_tokens: 800,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch (e) {
      console.warn('[postmortem] Grok-3 failed:', e.message);
    }
  }

  // Fallback to Claude
  if (claudeKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          system: POSTMORTEM_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || null;
      }
    } catch (e) {
      console.warn('[postmortem] Claude failed:', e.message);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a rich performance context block to inject into the analysis prompt.
 * This tells the AI its own track record + lessons learned so it can improve.
 *
 * @param {string} sport - The sport being analyzed (e.g., 'mlb')
 * @returns {string} - A multi-line text block to prepend to the analysis prompt
 */
export async function buildPerformanceContext(sport) {
  const sportUpper = (sport || '').toUpperCase();
  const sections = [];

  try {
    // 1. Overall record (last 30 days)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const { data: allGraded } = await supabase
      .from('game_analyses')
      .select('sport, prediction_result, prediction_conf')
      .not('prediction_result', 'is', null)
      .gte('game_date', cutoff);

    if (allGraded?.length) {
      const overall = calcRecord(allGraded);
      const sportOnly = calcRecord(allGraded.filter(r => r.sport === sport));
      const byConf = {};
      for (const r of allGraded) {
        const c = r.prediction_conf || 'UNKNOWN';
        if (!byConf[c]) byConf[c] = [];
        byConf[c].push(r);
      }

      let recordBlock = `YOUR RECENT TRACK RECORD (last 30 days):
Overall: ${overall.wins}W-${overall.losses}L (${overall.pct}% win rate) on ${overall.total} settled picks`;

      if (sportOnly.total > 0) {
        recordBlock += `\n${sportUpper} specifically: ${sportOnly.wins}W-${sportOnly.losses}L (${sportOnly.pct}%)`;
      }

      // Confidence calibration
      const confLines = [];
      for (const [conf, picks] of Object.entries(byConf).sort((a, b) => confOrder(a[0]) - confOrder(b[0]))) {
        const r = calcRecord(picks);
        if (r.total >= 2) confLines.push(`  ${conf}: ${r.wins}W-${r.losses}L (${r.pct}%)`);
      }
      if (confLines.length) recordBlock += `\nBy confidence level:\n${confLines.join('\n')}`;

      sections.push(recordBlock);
    }

    // 2. Recent lessons from losses (most actionable)
    const { data: recentLosses } = await supabase
      .from('analysis_lessons')
      .select('sport, lesson_summary, avoid_pattern, key_factor, bet_type, predicted_conf, game_date, away_team, home_team')
      .eq('result', 'LOSS')
      .gte('game_date', cutoff)
      .order('game_date', { ascending: false })
      .limit(30);

    if (recentLosses?.length) {
      // Sport-specific lessons
      const sportLosses = recentLosses.filter(l => l.sport === sport);
      const otherLosses = recentLosses.filter(l => l.sport !== sport);

      let lessonsBlock = 'LESSONS FROM RECENT LOSSES (learn from these):';

      if (sportLosses.length) {
        lessonsBlock += `\n\n${sportUpper} losses:`;
        for (const l of sportLosses.slice(0, 5)) {
          lessonsBlock += `\n- ${l.away_team}@${l.home_team} (${l.game_date}): ${l.lesson_summary || l.key_factor || 'No lesson extracted'}`;
        }
      }

      // Cross-sport patterns (may reveal systematic issues)
      if (otherLosses.length >= 3) {
        lessonsBlock += `\n\nCross-sport patterns:`;
        for (const l of otherLosses.slice(0, 3)) {
          if (l.lesson_summary) lessonsBlock += `\n- [${(l.sport || '').toUpperCase()}] ${l.lesson_summary}`;
        }
      }

      sections.push(lessonsBlock);
    }

    // 3. Patterns to avoid (aggregated from all losses)
    const { data: avoidPatterns } = await supabase
      .from('analysis_lessons')
      .select('avoid_pattern, sport, result')
      .not('avoid_pattern', 'is', null)
      .eq('result', 'LOSS')
      .gte('game_date', cutoff)
      .limit(20);

    if (avoidPatterns?.length) {
      const sportAvoids = avoidPatterns.filter(p => p.sport === sport).map(p => p.avoid_pattern);
      const generalAvoids = avoidPatterns.filter(p => p.sport !== sport).map(p => p.avoid_pattern);

      // Deduplicate similar patterns
      const uniqueAvoids = [...new Set([...sportAvoids, ...generalAvoids])];

      if (uniqueAvoids.length) {
        let avoidBlock = 'PATTERNS TO AVOID (from your past losses):';
        for (const p of uniqueAvoids.slice(0, 8)) {
          avoidBlock += `\n- ${p}`;
        }
        sections.push(avoidBlock);
      }
    }

    // 4. Patterns to seek (aggregated from wins)
    const { data: seekPatterns } = await supabase
      .from('analysis_lessons')
      .select('seek_pattern, sport')
      .not('seek_pattern', 'is', null)
      .eq('result', 'WIN')
      .eq('sport', sport)
      .gte('game_date', cutoff)
      .limit(10);

    if (seekPatterns?.length) {
      const uniqueSeeks = [...new Set(seekPatterns.map(p => p.seek_pattern))];
      if (uniqueSeeks.length) {
        let seekBlock = `WINNING PATTERNS FOR ${sportUpper} (edges you've correctly identified before):`;
        for (const p of uniqueSeeks.slice(0, 5)) {
          seekBlock += `\n- ${p}`;
        }
        sections.push(seekBlock);
      }
    }

    // 5. Confidence calibration warning
    const { data: overconfident } = await supabase
      .from('analysis_lessons')
      .select('predicted_conf, sport')
      .eq('was_overconfident', true)
      .gte('game_date', cutoff);

    if (overconfident?.length >= 3) {
      const sportOverconf = overconfident.filter(o => o.sport === sport).length;
      const totalOverconf = overconfident.length;
      let calBlock = `CONFIDENCE CALIBRATION WARNING:`;
      calBlock += `\nYou've been overconfident ${totalOverconf} times in the last 30 days (rated HIGH/ELITE but lost).`;
      if (sportOverconf > 0) calBlock += ` ${sportOverconf} of those were in ${sportUpper}.`;
      calBlock += `\nBe more conservative with HIGH/ELITE ratings unless you have multiple confirmed, concrete edges.`;
      sections.push(calBlock);
    }

    // 6. Bet type performance
    const { data: betTypeLessons } = await supabase
      .from('analysis_lessons')
      .select('bet_type, result, sport')
      .eq('sport', sport)
      .not('bet_type', 'is', null)
      .gte('game_date', cutoff);

    if (betTypeLessons?.length >= 3) {
      const byBet = {};
      for (const l of betTypeLessons) {
        if (!byBet[l.bet_type]) byBet[l.bet_type] = { wins: 0, losses: 0 };
        if (l.result === 'WIN') byBet[l.bet_type].wins++;
        if (l.result === 'LOSS') byBet[l.bet_type].losses++;
      }

      const betLines = [];
      for (const [bt, r] of Object.entries(byBet)) {
        const total = r.wins + r.losses;
        if (total >= 2) {
          const wp = Math.round((r.wins / total) * 100);
          const label = bt === 'ml' ? 'Moneyline' : bt === 'spread' ? 'Spread' : bt === 'over' ? 'Over' : bt === 'under' ? 'Under' : bt;
          betLines.push(`  ${label}: ${r.wins}W-${r.losses}L (${wp}%)`);
        }
      }

      if (betLines.length) {
        let betBlock = `YOUR ${sportUpper} PERFORMANCE BY BET TYPE:`;
        betBlock += `\n${betLines.join('\n')}`;

        // Call out weak spots
        for (const [bt, r] of Object.entries(byBet)) {
          const total = r.wins + r.losses;
          if (total >= 3 && r.wins / total < 0.4) {
            const label = bt === 'ml' ? 'moneyline' : bt;
            betBlock += `\n⚠ You're struggling with ${sportUpper} ${label} bets. Consider other bet types or be extra rigorous here.`;
          }
        }

        sections.push(betBlock);
      }
    }

  } catch (e) {
    console.warn('[feedbackLoop] Error building performance context:', e.message);
  }

  if (!sections.length) return '';

  return `
═══════════════════════════════════════════════════════════════
BETOS AI SELF-IMPROVEMENT CONTEXT (auto-generated from your graded history)
═══════════════════════════════════════════════════════════════

${sections.join('\n\n')}

═══════════════════════════════════════════════════════════════
USE THIS CONTEXT: Factor your track record and lessons into today's analysis.
- If you've been losing a specific bet type, be extra critical before recommending it again.
- If you've been overconfident, dial back unless the edge is rock-solid.
- Lean into patterns that have been winning.
- Be specific about WHY you're making this pick — show your work.
═══════════════════════════════════════════════════════════════
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcRecord(picks) {
  const wins = picks.filter(p => p.prediction_result === 'WIN').length;
  const losses = picks.filter(p => p.prediction_result === 'LOSS').length;
  const pushes = picks.filter(p => p.prediction_result === 'PUSH').length;
  const total = wins + losses;
  const pct = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  return { wins, losses, pushes, total, pct };
}

function confOrder(conf) {
  return { ELITE: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 }[conf] ?? 5;
}
