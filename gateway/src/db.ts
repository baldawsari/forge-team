import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://forgeteam:forgeteam_secret@localhost:5432/forgeteam';

const pool = new Pool({ connectionString: DATABASE_URL });

export async function query(text: string, params?: any[]): Promise<any> {
  return pool.query(text, params);
}

export function getPool(): Pool {
  return pool;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
