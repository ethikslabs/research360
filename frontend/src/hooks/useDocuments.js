import { useState, useEffect, useCallback, useRef } from 'react'
import { listDocuments, deleteDocument } from '../api/research360.js'
import { DEFAULTS } from '../config/index.js'

export default function useDocuments(sourceTypeFilter) {
  const [documents, setDocuments] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const intervalRef = useRef(null)

  const filters = {}
  if (sourceTypeFilter && sourceTypeFilter !== 'all') {
    filters.source_type = sourceTypeFilter
  }

  const fetch = useCallback(async () => {
    try {
      const data = await listDocuments(filters)
      setDocuments(data.documents)
      setTotal(data.total)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [sourceTypeFilter])

  useEffect(() => {
    setLoading(true)
    fetch()
    intervalRef.current = setInterval(fetch, DEFAULTS.pollInterval)
    return () => clearInterval(intervalRef.current)
  }, [fetch])

  async function remove(id) {
    await deleteDocument(id)
    setDocuments(prev => prev.filter(d => d.id !== id))
    setTotal(prev => prev - 1)
  }

  return { documents, total, loading, error, remove, refresh: fetch }
}
