// Research360 gap category catalog — authoritative sources per category + jurisdiction.
// Used by discovery agent gap_detection mode.

export const GAP_CATEGORIES = [
  {
    category: 'security',
    description: 'Cybersecurity frameworks, threat intelligence, vulnerability management',
    authoritative_sources: [
      { name: 'ACSC Essential Eight', url: 'https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight', jurisdiction: 'AU' },
      { name: 'NIST CSF 2.0', url: 'https://www.nist.gov/cyberframework', jurisdiction: 'US' },
      { name: 'ISO 27001 Overview', url: 'https://www.iso.org/isoiec-27001-information-security.html', jurisdiction: 'GLOBAL' },
    ],
  },
  {
    category: 'compliance',
    description: 'Regulatory compliance, data protection, privacy law',
    authoritative_sources: [
      { name: 'OAIC Privacy Act', url: 'https://www.oaic.gov.au/privacy/australian-privacy-principles', jurisdiction: 'AU' },
      { name: 'APRA CPS 234', url: 'https://www.apra.gov.au/cps-234-information-security', jurisdiction: 'AU' },
      { name: 'GDPR Overview', url: 'https://gdpr.eu/', jurisdiction: 'EU' },
    ],
  },
  {
    category: 'governance',
    description: 'IT governance, risk management, board-level oversight',
    authoritative_sources: [
      { name: 'COBIT 2019', url: 'https://www.isaca.org/resources/cobit', jurisdiction: 'GLOBAL' },
      { name: 'ASX Corporate Governance', url: 'https://www.asx.com.au/regulation/corporate-governance-council.htm', jurisdiction: 'AU' },
    ],
  },
  {
    category: 'identity',
    description: 'Identity and access management, zero trust, MFA',
    authoritative_sources: [
      { name: 'ACSC Identity Hardening', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/system-hardening-and-administration/identity', jurisdiction: 'AU' },
      { name: 'NIST Zero Trust', url: 'https://csrc.nist.gov/publications/detail/sp/800-207/final', jurisdiction: 'US' },
    ],
  },
  {
    category: 'cloud infrastructure',
    description: 'Cloud security posture, shared responsibility, infrastructure hardening',
    authoritative_sources: [
      { name: 'ACSC Cloud Security', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/cloud-security', jurisdiction: 'AU' },
      { name: 'CSA CCM', url: 'https://cloudsecurityalliance.org/research/cloud-controls-matrix/', jurisdiction: 'GLOBAL' },
    ],
  },
  {
    category: 'operational maturity',
    description: 'Incident response, business continuity, change management',
    authoritative_sources: [
      { name: 'ACSC Incident Response', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/incident-response', jurisdiction: 'AU' },
      { name: 'NIST SP 800-61 Rev 3', url: 'https://csrc.nist.gov/publications/detail/sp/800-61/rev-3/final', jurisdiction: 'US' },
    ],
  },
]
