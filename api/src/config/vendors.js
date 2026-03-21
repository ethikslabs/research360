// Proof360 vendor catalog — used by discovery agent for staleness detection.

export const VENDORS = [
  {
    vendor: 'CrowdStrike',
    tags: ['crowdstrike'],
    security_page: 'https://www.crowdstrike.com/resources/reports/',
    gap_categories: ['security', 'identity'],
  },
  {
    vendor: 'Okta',
    tags: ['okta'],
    security_page: 'https://www.okta.com/security/',
    gap_categories: ['identity'],
  },
  {
    vendor: 'AWS',
    tags: ['aws', 'amazon'],
    security_page: 'https://aws.amazon.com/security/',
    gap_categories: ['cloud infrastructure', 'security'],
  },
  {
    vendor: 'Microsoft',
    tags: ['microsoft', 'azure', 'microsoft365'],
    security_page: 'https://www.microsoft.com/en-us/trust-center/security',
    gap_categories: ['cloud infrastructure', 'identity', 'governance'],
  },
  {
    vendor: 'Google Cloud',
    tags: ['google', 'gcp', 'google cloud'],
    security_page: 'https://cloud.google.com/security',
    gap_categories: ['cloud infrastructure', 'security'],
  },
  {
    vendor: 'Atlassian',
    tags: ['atlassian', 'jira', 'confluence'],
    security_page: 'https://www.atlassian.com/trust',
    gap_categories: ['governance', 'operational maturity'],
  },
  {
    vendor: 'Palo Alto Networks',
    tags: ['palo alto', 'paloalto'],
    security_page: 'https://www.paloaltonetworks.com/security',
    gap_categories: ['security'],
  },
  {
    vendor: 'Qualys',
    tags: ['qualys'],
    security_page: 'https://www.qualys.com/security/',
    gap_categories: ['security', 'compliance'],
  },
  {
    vendor: 'Vanta',
    tags: ['vanta'],
    security_page: 'https://www.vanta.com/resources',
    gap_categories: ['compliance', 'governance'],
  },
  {
    vendor: 'Drata',
    tags: ['drata'],
    security_page: 'https://drata.com/resources',
    gap_categories: ['compliance', 'governance'],
  },
]
