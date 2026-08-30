/**
 * The curated slice of Indian law this demo ships with.
 *
 * Chosen for the person this product is for: a tenant, an employee, a borrower,
 * a consumer, someone who was in an accident or is dealing with the police -
 * not for a litigator. Everything here comes from India Code (Government of
 * India) via the section-wise dataset named in README.md.
 */
export const CURATED_ACTS = [
  // Everyday money and agreements
  'Indian Contract Act 1872',
  'Consumer Protection Act 2019',
  'Negotiable Instruments Act 1881',
  'Specific Relief Act 1963',
  'Indian Partnership Act 1932',
  'Arbitration and Conciliation Act 1996',
  'Limitation Act 1963',

  // Home, rent and property
  'Transfer of Property Act 1882',
  'Delhi Rent Control Act 1958',
  'Real Estate Regulation and Development Act 2016',
  'Registration Act 1908',
  'Indian Stamp Act 1899',
  'Indian Succession Act 1925',

  // Work and wages
  'Code on Wages Act 2019',
  'Minimum Wages Act 1948',
  'Payment of Wages Act 1936',
  'Payment of Gratuity Act 1972',
  'Industrial Disputes Act 1947',
  'Maternity Benefit Act 1961',
  "Employees' Provident Funds and Miscellaneous Provisions Act 1952",
  'Equal Remuneration Act 1976',
  'Unorganised Sector Workers Social Security Act 2008',
  'Bonded Labour System Abolition Act 1976',

  // Safety, family and personal rights
  'Protection of Women from Domestic Violence Act 2005',
  'Sexual Harassment of Women at Workplace Act 2013',
  'Dowry Prohibition Act 1961',
  'Hindu Marriage Act 1955',
  'Special Marriage Act 1954',
  'Muslim Women Protection of Rights on Marriage Act 2019',
  'Muslim Women Protection of Rights on Divorce Act 1986',
  'Maintenance and Welfare of Parents and Senior Citizens Act 2007',
  'Protection of Children from Sexual Offences Act 2012',
  'Right of Children to Free and Compulsory Education Act 2009',
  'Rights of Persons with Disabilities Act 2016',

  // Citizen vs the system
  'Right to Information Act 2005',
  'Legal Services Authorities Act 1987',
  'Information Technology Act 2000',
  'Aadhaar Act 2016',
  'Motor Vehicles Act 1988',
  'Bharatiya Nyaya Sanhita 2023',
];

/** Short, human-readable blurbs used in the UI's corpus browser. */
export const ACT_TOPICS = {
  'Indian Contract Act 1872': 'agreements, breach, compensation',
  'Consumer Protection Act 2019': 'defective goods, bad service, refunds, complaints',
  'Negotiable Instruments Act 1881': 'cheque bounce, promissory notes',
  'Transfer of Property Act 1882': 'sale, lease, mortgage, gift of property',
  'Delhi Rent Control Act 1958': 'rent, eviction, landlord and tenant',
  'Real Estate Regulation and Development Act 2016': 'flat booking, builder delays, RERA',
  'Code on Wages Act 2019': 'salary, minimum wage, deductions',
  'Payment of Gratuity Act 1972': 'gratuity after 5 years of service',
  'Industrial Disputes Act 1947': 'layoff, retrenchment, unfair dismissal',
  'Protection of Women from Domestic Violence Act 2005': 'protection orders, residence, maintenance',
  'Sexual Harassment of Women at Workplace Act 2013': 'POSH complaints, internal committee',
  'Right to Information Act 2005': 'RTI applications, appeals, exemptions',
  'Motor Vehicles Act 1988': 'accidents, compensation, licences, challans',
  'Information Technology Act 2000': 'online fraud, data, cybercrime',
  'Bharatiya Nyaya Sanhita 2023': 'criminal offences and punishments',
  'Legal Services Authorities Act 1987': 'free legal aid, Lok Adalat',
};
