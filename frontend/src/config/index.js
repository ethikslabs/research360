// Empty string = relative URLs (production behind nginx proxy)
// Set VITE_API_URL=http://localhost:3000 for local dev
export const API_URL = import.meta.env.VITE_API_URL ?? ''

export const DEFAULTS = {
  persona: 'strategist',
  complexity: 'detailed',
  tenantId: 'ethikslabs',
  pollInterval: 5000,
}
