import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from '../config/env.js'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

export const pool = new Pool({ connectionString: config.DATABASE_URL })

export async function initialize() {
  const sql = readFileSync(join(__dirname, 'migrations', '001_initial.sql'), 'utf8')
  await pool.query(sql)
}

export async function healthCheck() {
  const res = await pool.query('SELECT 1')
  return res.rows.length === 1
}
