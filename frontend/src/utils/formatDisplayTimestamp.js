const formatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function formatDisplayTimestamp(isoString) {
  if (!isoString) return null
  return formatter.format(new Date(isoString))
}
