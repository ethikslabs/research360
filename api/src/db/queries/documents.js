import { pool } from '../client.js'

export async function insert({ tenantId, title, sourceType, sourceUrl, fileName, fileType, s3Key, fileHash }) {
  const res = await pool.query(
    `INSERT INTO documents (tenant_id, title, source_type, source_url, file_name, file_type, s3_key, file_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')
     RETURNING id, status, source_type, created_at`,
    [tenantId, title || null, sourceType, sourceUrl || null, fileName || null, fileType || null, s3Key || null, fileHash || null]
  )
  return res.rows[0]
}

export async function findByFileHash(fileHash, tenantId) {
  const res = await pool.query(
    `SELECT id, title, status, created_at FROM documents WHERE file_hash = $1 AND tenant_id = $2 LIMIT 1`,
    [fileHash, tenantId]
  )
  return res.rows[0] || null
}

export async function findById(id, tenantId) {
  const res = await pool.query(
    `SELECT d.*, COUNT(c.id)::int AS chunk_count
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     WHERE d.id = $1 AND d.tenant_id = $2
     GROUP BY d.id`,
    [id, tenantId]
  )
  return res.rows[0] || null
}

export async function findAll({ tenantId, status, sourceType, limit = 50, offset = 0 }) {
  const conditions = ['d.tenant_id = $1']
  const params = [tenantId]
  let i = 2

  if (status) { conditions.push(`d.status = $${i++}`); params.push(status) }
  if (sourceType) { conditions.push(`d.source_type = $${i++}`); params.push(sourceType) }

  const where = conditions.join(' AND ')

  const [rows, countRes] = await Promise.all([
    pool.query(
      `SELECT d.id, d.title, d.source_type, d.status, d.file_name, d.source_url, d.created_at
       FROM documents d
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM documents d WHERE ${where}`, params),
  ])

  return { documents: rows.rows, total: countRes.rows[0].total }
}

export async function remove(id, tenantId) {
  const res = await pool.query(
    'DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING id',
    [id, tenantId]
  )
  return res.rows[0] || null
}

export async function updateTitle(id, title) {
  await pool.query(
    'UPDATE documents SET title = $1, updated_at = NOW() WHERE id = $2 AND title IS NULL',
    [title, id]
  )
}

export async function updateStatus(id, status) {
  await pool.query(
    'UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  )
}

export async function updateMetadata(id, metadata) {
  await pool.query(
    'UPDATE documents SET metadata = metadata || $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(metadata), id]
  )
}
