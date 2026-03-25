// Research360 gap category catalog — cross-domain knowledge corpus for EthiksLabs.
// Used by discovery agent gap_detection mode.

export const GAP_CATEGORIES = [
  {
    category: 'venture capital & fundraising',
    description: 'VC market dynamics, investor behaviour, cap table structures, fundraising mechanics, term sheets',
    authoritative_sources: [
      { name: 'ADIA Annual Report', url: 'https://www.adia.com.au/', jurisdiction: 'AU' },
      { name: 'StartupAus Crossroads', url: 'https://startupaus.org/research/', jurisdiction: 'AU' },
      { name: 'Cut Through Venture State of Australian Startups', url: 'https://www.cutthroughventure.com/reports', jurisdiction: 'AU' },
      { name: 'AVCAL Research', url: 'https://www.avcal.com.au/research', jurisdiction: 'AU' },
      { name: 'CB Insights State of Venture', url: 'https://www.cbinsights.com/research/report/venture-trends/', jurisdiction: 'GLOBAL' },
      { name: 'Carta State of Private Markets', url: 'https://carta.com/blog/state-of-private-markets/', jurisdiction: 'US' },
      { name: 'Pitchbook-NVCA Venture Monitor', url: 'https://pitchbook.com/news/reports/q4-2025-pitchbook-nvca-venture-monitor', jurisdiction: 'US' },
    ],
  },
  {
    category: 'AI strategy & emerging technology',
    description: 'AI capabilities, agentic AI, platform convergence, model developments, enterprise AI adoption',
    authoritative_sources: [
      { name: 'ARK Invest Big Ideas', url: 'https://ark-invest.com/big-ideas/', jurisdiction: 'US' },
      { name: 'Gartner Top Strategic Technology Trends', url: 'https://www.gartner.com/en/articles/gartner-top-10-strategic-technology-trends', jurisdiction: 'GLOBAL' },
      { name: 'McKinsey State of AI', url: 'https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai', jurisdiction: 'GLOBAL' },
      { name: 'Stanford AI Index', url: 'https://aiindex.stanford.edu/report/', jurisdiction: 'GLOBAL' },
      { name: 'CSIRO AI Roadmap', url: 'https://www.csiro.au/en/research/technology-space/ai', jurisdiction: 'AU' },
      { name: 'Anthropic Research', url: 'https://www.anthropic.com/research', jurisdiction: 'US' },
      { name: 'a16z AI Canon', url: 'https://a16z.com/ai/', jurisdiction: 'US' },
    ],
  },
  {
    category: 'Australian startup ecosystem',
    description: 'Local VC landscape, ESIC, government programs, founder community, market sizing',
    authoritative_sources: [
      { name: 'StartupAus', url: 'https://startupaus.org/', jurisdiction: 'AU' },
      { name: 'Austrade Landing Pads', url: 'https://www.austrade.gov.au/en/news-and-analysis/landing-pads', jurisdiction: 'AU' },
      { name: 'ATO ESIC Guidelines', url: 'https://www.ato.gov.au/individuals-and-families/investments-and-assets/early-stage-innovation-company-esic', jurisdiction: 'AU' },
      { name: 'Innovation and Science Australia', url: 'https://www.industry.gov.au/science-technology-and-innovation', jurisdiction: 'AU' },
      { name: 'Blackbird Giants', url: 'https://blackbird.vc/blog', jurisdiction: 'AU' },
      { name: 'Square Peg Capital', url: 'https://www.squarepegcap.com/blog', jurisdiction: 'AU' },
    ],
  },
  {
    category: 'go-to-market & revenue',
    description: 'B2B sales strategy, founder-led growth, pricing, positioning, PLG, category creation',
    authoritative_sources: [
      { name: 'OpenView PLG Benchmarks', url: 'https://openviewpartners.com/blog/', jurisdiction: 'US' },
      { name: 'Lenny Rachitsky Newsletter', url: 'https://www.lennysnewsletter.com/', jurisdiction: 'US' },
      { name: 'SaaStr Annual Report', url: 'https://www.saastr.com/category/annual/', jurisdiction: 'US' },
      { name: 'First Round Review', url: 'https://review.firstround.com/', jurisdiction: 'US' },
      { name: 'Kyle Poyar Growth Unhinged', url: 'https://www.growthunhinged.com/', jurisdiction: 'US' },
    ],
  },
  {
    category: 'product & design',
    description: 'Product strategy, founder product thinking, B2B SaaS patterns, UX research, design systems',
    authoritative_sources: [
      { name: 'Reforge Insights', url: 'https://www.reforge.com/blog', jurisdiction: 'US' },
      { name: 'Intercom Product Blog', url: 'https://www.intercom.com/blog/product/', jurisdiction: 'GLOBAL' },
      { name: 'Julie Zhuo The Looking Glass', url: 'https://joulee.medium.com/', jurisdiction: 'US' },
      { name: 'Shape Up (Basecamp)', url: 'https://basecamp.com/shapeup', jurisdiction: 'US' },
    ],
  },
  {
    category: 'trust, governance & AI ethics',
    description: 'AI governance frameworks, responsible AI, digital trust, data provenance, audit infrastructure',
    authoritative_sources: [
      { name: 'OECD AI Principles', url: 'https://oecd.ai/en/ai-principles', jurisdiction: 'GLOBAL' },
      { name: 'NIST AI RMF', url: 'https://www.nist.gov/artificial-intelligence/ai-risk-management-framework', jurisdiction: 'US' },
      { name: 'Australia AI Ethics Framework', url: 'https://www.industry.gov.au/publications/australias-artificial-intelligence-ethics-framework', jurisdiction: 'AU' },
      { name: 'EU AI Act Overview', url: 'https://artificialintelligenceact.eu/', jurisdiction: 'EU' },
      { name: 'Partnership on AI', url: 'https://partnershiponai.org/research/', jurisdiction: 'GLOBAL' },
    ],
  },
  {
    category: 'competitive intelligence',
    description: 'Adjacent tools in trust, audit, knowledge management, AI reasoning, risk intelligence markets',
    authoritative_sources: [
      { name: 'G2 AI Categories', url: 'https://www.g2.com/categories/artificial-intelligence', jurisdiction: 'GLOBAL' },
      { name: 'Product Hunt AI Tools', url: 'https://www.producthunt.com/topics/artificial-intelligence', jurisdiction: 'GLOBAL' },
      { name: 'Tomasz Tunguz Blog', url: 'https://tomtunguz.com/', jurisdiction: 'US' },
      { name: 'Bessemer Cloud Index', url: 'https://cloudindex.bvp.com/', jurisdiction: 'US' },
    ],
  },
  {
    category: 'macro & capital markets',
    description: 'Interest rates, LP sentiment, global investment flows, public market signals, recession indicators',
    authoritative_sources: [
      { name: 'RBA Economic Outlook', url: 'https://www.rba.gov.au/publications/smp/', jurisdiction: 'AU' },
      { name: 'Goldman Sachs Outlook', url: 'https://www.goldmansachs.com/insights/outlook/', jurisdiction: 'GLOBAL' },
      { name: 'Sequoia Arc', url: 'https://www.sequoiacap.com/article/', jurisdiction: 'US' },
      { name: 'Howard Marks Memos', url: 'https://www.oaktreecapital.com/insights/memos', jurisdiction: 'US' },
      { name: 'Fred Wilson AVC', url: 'https://avc.com/', jurisdiction: 'US' },
    ],
  },
  {
    category: 'founder operations',
    description: 'Company building, hiring, culture, board management, equity, legal structure',
    authoritative_sources: [
      { name: 'YC Startup Library', url: 'https://www.ycombinator.com/library', jurisdiction: 'US' },
      { name: 'Stripe Atlas Guides', url: 'https://stripe.com/atlas/guides', jurisdiction: 'GLOBAL' },
      { name: 'Holloway Guides', url: 'https://www.holloway.com/g/equity-compensation', jurisdiction: 'US' },
      { name: 'a16z Talent Blog', url: 'https://a16z.com/talent/', jurisdiction: 'US' },
    ],
  },
]
