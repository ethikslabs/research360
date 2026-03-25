import { config } from '../config/env.js'

const SEED_FEEDS = [
  // ── Australian ecosystem ────────────────────────────────────────────────
  {
    name: 'StartupAus Research',
    url: 'https://startupaus.org/research/',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  {
    name: 'RBA Statement on Monetary Policy',
    url: 'https://www.rba.gov.au/publications/smp/',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  // ── AI & tech ───────────────────────────────────────────────────────────
  {
    name: 'ARK Invest Research',
    url: 'https://ark-invest.com/research/',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'Gartner Newsroom',
    url: 'https://www.gartner.com/en/newsroom',
    type: 'url',
    tier: 1,
    jurisdiction: 'GLOBAL',
  },
  {
    name: 'Stanford HAI News',
    url: 'https://hai.stanford.edu/news',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
  // ── VC & founder ────────────────────────────────────────────────────────
  {
    name: 'a16z Future',
    url: 'https://a16z.com/latest/',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'First Round Review',
    url: 'https://review.firstround.com/',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'YC Blog',
    url: 'https://www.ycombinator.com/blog',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
  // ── Market intelligence ─────────────────────────────────────────────────
  {
    name: 'CB Insights Research',
    url: 'https://www.cbinsights.com/research/',
    type: 'url',
    tier: 1,
    jurisdiction: 'GLOBAL',
  },
  {
    name: 'Sequoia Articles',
    url: 'https://www.sequoiacap.com/article/',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
]

/**
 * Poll all seed feeds + vendor security pages.
 * Never throws — partial failure is valid.
 * Feed polling failures do not fail the whole run.
 *
 * @param {Array} vendors - array from config/vendors.js VENDORS
 * @returns {Promise<{ items: FeedItem[], polled: number, failures: number }>}
 */
export async function pollFeeds(vendors) {
  const allFeeds = [
    ...SEED_FEEDS,
    ...vendors.map(v => ({
      name: `${v.vendor} Security`,
      url: v.security_page,
      type: 'url',
      tier: 2,
      jurisdiction: 'GLOBAL',
    })),
  ]

  const items = []
  let polled = 0
  let failures = 0

  await Promise.allSettled(
    allFeeds.map(async (feed) => {
      polled++
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        const res = await fetch(feed.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Research360-DiscoveryAgent/1.0' },
        })
        clearTimeout(timeout)

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const contentType = res.headers.get('content-type') || ''
        let content = ''

        if (contentType.includes('json')) {
          const json = await res.json()
          // Handle CISA KEV shape
          if (Array.isArray(json?.vulnerabilities)) {
            content = json.vulnerabilities.slice(0, 10).map(v =>
              `${v.cveID || v.cve?.id}: ${v.vulnerabilityName || v.cve?.descriptions?.[0]?.value || ''}`
            ).join('\n')
          } else {
            content = JSON.stringify(json).slice(0, 2000)
          }
        } else {
          content = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
        }

        items.push({
          feed_name:    feed.name,
          feed_url:     feed.url,
          source_type:  feed.type,
          source_tier:  feed.tier,
          jurisdiction: feed.jurisdiction,
          content,
          fetched_at:   new Date().toISOString(),
        })
      } catch (err) {
        failures++
        console.log(JSON.stringify({ stage: 'feed_poller', feed: feed.name, error: err.message }))
      }
    })
  )

  return { items, polled, failures }
}
