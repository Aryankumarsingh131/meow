import { openDatabaseAsync } from 'expo-sqlite';

import type { TestRecord } from './v1Model';

const database = openDatabaseAsync('jalsakshi-v1.db').then(async (db) => {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS v1_tests (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  return db;
});

function sampleRecords(): TestRecord[] {
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.toISOString().slice(0, 10);
  };
  return [
    {
      id: 'demo-hand-pump', sourceId: 'HP-104', sourceName: 'Patel Nagar hand pump',
      location: 'Patel Nagar', sourceType: 'Hand Pump', date: day(1), testerName: 'Demo field worker',
      readings: [
        { key: 'ph', value: '7.2', rating: 'safe' },
        { key: 'turbidity', value: '12', rating: 'unsafe' },
        { key: 'iron', value: '0.6', rating: 'warning' },
      ],
      createdAt: `${day(1)}T10:00:00.000Z`, demo: true,
      followUp: {
        id: 'CASE-104', parameter: 'turbidity', priority: 'High', assignedPerson: 'Demo field team',
        dueDate: day(-4), status: 'Open',
      },
    },
    {
      id: 'demo-tap', sourceId: 'TP-207', sourceName: 'Market square tap',
      location: 'Riverside village', sourceType: 'Tap', date: day(3), testerName: 'Demo field worker',
      readings: [{ key: 'ph', value: '7.1', rating: 'safe' }, { key: 'chlorine', value: '0.4', rating: 'safe' }],
      createdAt: `${day(3)}T09:00:00.000Z`, demo: true,
    },
  ];
}

export async function listTests(): Promise<TestRecord[]> {
  const db = await database;
  for (const record of sampleRecords()) {
    await db.runAsync('INSERT OR IGNORE INTO v1_tests (id, created_at, payload) VALUES (?, ?, ?)',
      record.id, record.createdAt, JSON.stringify(record));
  }
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM v1_tests ORDER BY created_at DESC');
  return rows.map((row) => JSON.parse(row.payload) as TestRecord);
}

export async function saveTest(record: TestRecord): Promise<void> {
  const db = await database;
  await db.runAsync(
    'INSERT INTO v1_tests (id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
    record.id, record.createdAt, JSON.stringify(record),
  );
}
