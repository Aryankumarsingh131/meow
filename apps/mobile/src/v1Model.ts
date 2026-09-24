/** Version 1 demo data. Ratings are chosen by the tester, not calculated from a kit. */
export const PARAMETERS = [
  { key: 'ph', label: 'pH', unit: '' },
  { key: 'chlorine', label: 'Chlorine', unit: 'mg/L' },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU' },
  { key: 'nitrate', label: 'Nitrate', unit: 'mg/L' },
  { key: 'iron', label: 'Iron', unit: 'mg/L' },
  { key: 'fluoride', label: 'Fluoride', unit: 'mg/L' },
] as const;

export type ParameterKey = (typeof PARAMETERS)[number]['key'];
export type Rating = 'safe' | 'warning' | 'unsafe';
export type Reading = { key: ParameterKey; value: string; rating: Rating };
export type CaseStatus = 'Open' | 'Sent for Lab Testing' | 'Action Required' | 'Retest Scheduled' | 'Resolved';
export type FollowUpCase = {
  id: string;
  parameter: ParameterKey;
  priority: 'High' | 'Medium';
  assignedPerson: string;
  dueDate: string;
  status: CaseStatus;
};
export type TestRecord = {
  id: string;
  sourceId: string;
  sourceName: string;
  location: string;
  sourceType: string;
  date: string;
  testerName: string;
  readings: Reading[];
  createdAt: string;
  demo: boolean;
  followUp?: FollowUpCase;
};

export function overallOf(readings: Reading[]): 'not_tested' | 'safe' | 'warning' | 'unsafe' {
  if (!readings.length) return 'not_tested';
  if (readings.some((reading) => reading.rating === 'unsafe')) return 'unsafe';
  if (readings.some((reading) => reading.rating === 'warning')) return 'warning';
  return 'safe';
}

export function statusOf(record: TestRecord): string {
  if (record.followUp?.status === 'Resolved') return 'Resolved';
  return overallOf(record.readings) === 'unsafe' ? 'Follow-Up Required'
    : overallOf(record.readings) === 'warning' ? 'Review Suggested' : 'Safe (demo)';
}
