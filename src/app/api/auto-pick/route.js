import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR  = join(process.cwd(), 'data');
const DATA_FILE = join(DATA_DIR, 'auto-pick.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export async function GET() {
  if (!existsSync(DATA_FILE)) {
    return NextResponse.json({ pick: null });
  }
  try {
    const raw  = readFileSync(DATA_FILE, 'utf-8');
    const pick = JSON.parse(raw);
    return NextResponse.json({ pick });
  } catch {
    return NextResponse.json({ pick: null });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    // Write a new pick (from scheduled task via API call)
    if (body.action === 'write') {
      ensureDir();
      const pick = { ...body.pick, imported: false, generated_at: new Date().toISOString() };
      writeFileSync(DATA_FILE, JSON.stringify(pick, null, 2));
      return NextResponse.json({ ok: true });
    }
    // Mark existing pick as imported
    if (body.action === 'import') {
      if (!existsSync(DATA_FILE)) return NextResponse.json({ ok: false, error: 'No pick file found' });
      const raw  = readFileSync(DATA_FILE, 'utf-8');
      const pick = JSON.parse(raw);
      pick.imported = true;
      writeFileSync(DATA_FILE, JSON.stringify(pick, null, 2));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
