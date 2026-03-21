import { config } from '../config/env.js'

const SEED_FEEDS = [
  {
    name: 'CISA KEV',
    url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'NVD CVE',
    url: 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'ACSC Alerts',
    url: 'https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  {
    name: 'OAIC Breach Register',
    url: 'https://www.oaic.gov.au/privacy/notifiable-data-breaches/notifiable-data-breaches-register',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  {
    name: 'NIST Cybersecurity News',
    url: 'https://www.nist.gov/news-events/cybersecurity',
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
