// Research360 source catalog — authoritative publishers and research houses.
// Used by discovery agent for feed polling and staleness detection.
// "vendor" here means a trusted publishing source, not a software vendor.

export const VENDORS = [
  // ── Australian ecosystem ──────────────────────────────────────────────────
  {
    vendor: 'StartupAus',
    tags: ['startupaus', 'australian startup', 'australia tech'],
    security_page: 'https://startupaus.org/research/',
    gap_categories: ['Australian startup ecosystem', 'venture capital & fundraising'],
  },
  {
    vendor: 'Blackbird VC',
    tags: ['blackbird', 'blackbird ventures'],
    security_page: 'https://blackbird.vc/blog',
    gap_categories: ['Australian startup ecosystem', 'venture capital & fundraising'],
  },
  {
    vendor: 'Cut Through Venture',
    tags: ['cut through venture', 'australian vc', 'cutthroughventure'],
    security_page: 'https://www.cutthroughventure.com/reports',
    gap_categories: ['Australian startup ecosystem', 'venture capital & fundraising'],
  },

  // ── AI & tech research ────────────────────────────────────────────────────
  {
    vendor: 'ARK Invest',
    tags: ['ark invest', 'ark', 'cathie wood'],
    security_page: 'https://ark-invest.com/big-ideas/',
    gap_categories: ['AI strategy & emerging technology', 'macro & capital markets'],
  },
  {
    vendor: 'Gartner',
    tags: ['gartner', 'magic quadrant', 'hype cycle'],
    security_page: 'https://www.gartner.com/en/articles/gartner-top-10-strategic-technology-trends',
    gap_categories: ['AI strategy & emerging technology', 'competitive intelligence'],
  },
  {
    vendor: 'a16z',
    tags: ['a16z', 'andreessen horowitz', 'andreessen'],
    security_page: 'https://a16z.com/ai/',
    gap_categories: ['AI strategy & emerging technology', 'venture capital & fundraising', 'founder operations'],
  },
  {
    vendor: 'Sequoia Capital',
    tags: ['sequoia', 'sequoia capital'],
    security_page: 'https://www.sequoiacap.com/article/',
    gap_categories: ['venture capital & fundraising', 'founder operations', 'macro & capital markets'],
  },

  // ── Founder & GTM ─────────────────────────────────────────────────────────
  {
    vendor: 'Y Combinator',
    tags: ['ycombinator', 'yc', 'y combinator'],
    security_page: 'https://www.ycombinator.com/library',
    gap_categories: ['founder operations', 'go-to-market & revenue'],
  },
  {
    vendor: 'First Round Capital',
    tags: ['first round', 'firstround'],
    security_page: 'https://review.firstround.com/',
    gap_categories: ['founder operations', 'go-to-market & revenue', 'product & design'],
  },
  {
    vendor: 'OpenView Partners',
    tags: ['openview', 'plg', 'product led growth'],
    security_page: 'https://openviewpartners.com/blog/',
    gap_categories: ['go-to-market & revenue'],
  },

  // ── Market intelligence ───────────────────────────────────────────────────
  {
    vendor: 'CB Insights',
    tags: ['cb insights', 'cbinsights'],
    security_page: 'https://www.cbinsights.com/research/',
    gap_categories: ['venture capital & fundraising', 'competitive intelligence', 'AI strategy & emerging technology'],
  },
  {
    vendor: 'McKinsey',
    tags: ['mckinsey', 'mckinsey global institute'],
    security_page: 'https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai',
    gap_categories: ['AI strategy & emerging technology', 'macro & capital markets'],
  },

  // ── Trust & governance ────────────────────────────────────────────────────
  {
    vendor: 'OECD AI Policy',
    tags: ['oecd', 'oecd ai'],
    security_page: 'https://oecd.ai/en/dashboards',
    gap_categories: ['trust, governance & AI ethics'],
  },
  {
    vendor: 'NIST AI',
    tags: ['nist ai', 'ai rmf'],
    security_page: 'https://www.nist.gov/artificial-intelligence',
    gap_categories: ['trust, governance & AI ethics'],
  },
]
