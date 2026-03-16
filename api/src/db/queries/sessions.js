import { pool } from '../client.js'

export async function insert(tenantId) {
  const res = await pool.query(
    `INSERT INTO sessions (tenant_id) VALUES ($1) RETURNING id, history, created_at`,
    [tenantId]
  )
  return res.rows[0]
}

export async function findById(id, tenantId) {
  const res = await pool.query(
    'SELECT * FROM sessions WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  )
  return res.rows[0] || null
}

export async function appendHistory(id, turn) {
  const res = await pool.query(
    `UPDATE sessions
     SET history = history || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING history`,
    [JSON.stringify([turn]), id]
  )
  return res.rows[0]
}
