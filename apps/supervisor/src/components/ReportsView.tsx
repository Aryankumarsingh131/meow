import { useEffect, useState } from 'react';
import { Download, ShieldCheck, Users, Trophy, PackageCheck, Gift } from 'lucide-react';
import { api, download, type Workspace } from '../supervisor';

interface TeamMetrics {
  tests_done: number;
  cases_open: number;
  cases_closed: number;
  avg_closure_time_hours: number;
  cases_by_priority: { normal: number; urgent: number; critical: number };
}

interface LeaderboardData {
  disclaimer: string;
  field_workers: Array<{ rank: number; id: string; name: string; tests_completed: number; cases_flagged: number; points: number }>;
  locations: Array<{ rank: number; locality: string; sources_monitored: number; test_frequency_per_month: number; within_band_percent: number | null }>;
}

interface TestKit {
  id: string;
  name: string;
  code: string;
  parameter: string;
  unit: string;
  expiry_days: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  tests?: number;
  points?: number;
}


export default function ReportsView({ data }: { data: Workspace }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<TeamMetrics | null>(null);
  const [leaderboards, setLeaderboards] = useState<LeaderboardData | null>(null);
  const [testKits, setTestKits] = useState<TestKit[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    async function loadExtra() {
      try {
        const [m, lb, tk, tm] = await Promise.all([
          api<TeamMetrics>('metrics'),
          api<LeaderboardData>('leaderboards/field-workers'),
          api<{ test_kits: TestKit[] }>('test-kits'),
          api<{ members: TeamMember[] }>('team'),
        ]);
        setMetrics(m);
        setLeaderboards(lb);
        setTestKits(tk.test_kits || []);
        setTeamMembers(tm.members || []);
      } catch {
        // Fallback to local computation if offline
      }
    }
    void loadExtra();
  }, []);

  const [busyFull, setBusyFull] = useState(false);
  async function exportCsv(path: string, name: string, setWorking: (value: boolean) => void) {
    setWorking(true);
    setError('');
    try { await download(path, name); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed. Try again.'); }
    finally { setWorking(false); }
  }

  return (
    <div className="reports-layout" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '2rem' }}>
      {/* 1. Team Metrics Header */}
      <section className="reports-summary">
        <h2>Team Analytics &amp; Metrics</h2>
        <p>Real-time metrics for {data.profile.team_name}.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ background: 'var(--surface-color, #f8fafc)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <small style={{ color: '#64748b', fontSize: '0.85rem' }}>Total Tests Done</small>
            <h3 style={{ fontSize: 'clamp(1.25rem, 5vw, 1.8rem)', whiteSpace: 'nowrap', margin: '0.25rem 0 0', color: '#0f172a' }}>{metrics ? metrics.tests_done : data.screening_records.length}</h3>
          </div>
          <div style={{ background: 'var(--surface-color, #f8fafc)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <small style={{ color: '#64748b', fontSize: '0.85rem' }}>Open Cases</small>
            <h3 style={{ fontSize: 'clamp(1.25rem, 5vw, 1.8rem)', whiteSpace: 'nowrap', margin: '0.25rem 0 0', color: '#d97706' }}>{metrics ? metrics.cases_open : data.cases.filter(c => c.status === 'under_review').length}</h3>
          </div>
          <div style={{ background: 'var(--surface-color, #f8fafc)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <small style={{ color: '#64748b', fontSize: '0.85rem' }}>Cases Closed</small>
            <h3 style={{ fontSize: 'clamp(1.25rem, 5vw, 1.8rem)', whiteSpace: 'nowrap', margin: '0.25rem 0 0', color: '#16a34a' }}>{metrics ? metrics.cases_closed : data.cases.filter(c => c.status === 'closed').length}</h3>
          </div>
          <div style={{ background: 'var(--surface-color, #f8fafc)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <small style={{ color: '#64748b', fontSize: '0.85rem' }}>Avg Closure Time</small>
            <h3 style={{ fontSize: 'clamp(1.25rem, 5vw, 1.8rem)', whiteSpace: 'nowrap', margin: '0.25rem 0 0', color: '#2563eb' }}>{!metrics ? '—' : metrics.cases_closed ? `${metrics.avg_closure_time_hours} hrs` : 'No closed cases'}</h3>
          </div>
        </div>
      </section>

      {/* 2. Leaderboards Section */}
      <section className="reports-summary" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><Trophy size={20} color="#d97706" /> Team &amp; Location Leaderboards</h2>
          <span style={{ fontSize: '0.8rem', background: '#fef3c7', color: '#92400e', padding: '0.25rem 0.75rem', borderRadius: '999px', fontWeight: 600 }}>
            {leaderboards?.disclaimer || 'Points reward on-time field screening; they are not a water-quality signal.'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '1.5rem' }}>
          <div>
            <h4 style={{ margin: '0 0 0.75rem', color: '#334155' }}>Top Field Workers</h4>
            <div className="reports-table-scroll"><table style={{ width: '100%', fontSize: '0.9rem' }}>
              <thead><tr><th>Rank</th><th>Name</th><th>Tests</th><th>Points</th></tr></thead>
              <tbody>
                {(leaderboards?.field_workers || []).map(fw => (
                  <tr key={fw.rank}>
                    <td>#{fw.rank}</td>
                    <td><strong>{fw.name}</strong></td>
                    <td>{fw.tests_completed}</td>
                    <td><span style={{ color: '#d97706', fontWeight: 600 }}>{fw.points} pts</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {leaderboards && !leaderboards.field_workers.length && <p className="empty-state">No field workers in this team yet.</p>}
          </div>

          <div>
            <h4 style={{ margin: '0 0 0.75rem', color: '#334155' }}>Monitored Location Activity</h4>
            <div className="reports-table-scroll"><table style={{ width: '100%', fontSize: '0.9rem' }}>
              <thead><tr><th>Locality</th><th>Sources</th><th>Screenings (30 days)</th><th>Within bands</th></tr></thead>
              <tbody>
                {(leaderboards?.locations || []).map(loc => (
                  <tr key={loc.locality}>
                    <td><strong>{loc.locality}</strong></td>
                    <td>{loc.sources_monitored}</td>
                    <td>{loc.test_frequency_per_month}</td>
                    <td><span style={{ color: '#0f172a', fontWeight: 600 }}>{loc.within_band_percent === null ? 'No screenings' : `${loc.within_band_percent}% of screenings`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      </section>

      {/* 3. Team Roster, Test Kits & Rewards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '1.5rem' }}>
        <section className="reports-summary" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}><Users size={18} /> Team Members Roster</h2>
          <div className="reports-table-scroll"><table style={{ width: '100%', fontSize: '0.9rem', marginTop: '0.75rem' }}>
            <thead><tr><th>Name</th><th>Role</th><th>Tests</th><th>Status</th></tr></thead>
            <tbody>
              {teamMembers.map(m => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong><br /><small style={{ color: '#64748b' }}>{m.email}</small></td>
                  <td><span className="state-badge">{m.role.replace('_', ' ')}</span></td>
                  <td>{m.tests ?? '—'}</td>
                  <td><span style={{ color: '#16a34a', fontWeight: 600 }}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="reports-summary" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}><PackageCheck size={18} /> Field Test Kits Catalog</h2>
          <div className="reports-table-scroll"><table style={{ width: '100%', fontSize: '0.9rem', marginTop: '0.75rem' }}>
            <thead><tr><th>Kit Name</th><th>Code</th><th>Parameter</th></tr></thead>
            <tbody>
              {testKits.map(kit => (
                <tr key={kit.id}>
                  <td><strong>{kit.name}</strong></td>
                  <td><code>{kit.code}</code></td>
                  <td>{kit.parameter}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="reports-summary" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}><Gift size={18} /> Points</h2>
          <p style={{ color: '#475569', fontSize: '0.9rem', marginTop: '0.75rem' }}>Field workers earn 10 points for each screening with every reading, a photo, and the strip read inside the kit's time window. There is no rewards catalogue; points are shown in the leaderboard above.</p>
        </section>
      </div>

      {/* 4. Export & Data Summary Footer */}
      <aside className="export-panel" style={{ marginTop: '1rem' }}>
        <div className="export-panel__content">
          <p className="eyebrow">DATA EXPORT / CSV</p>
          <h2>Download your team’s data.</h2>
          <p><strong>Full data</strong> is every record on this board in one CSV: sources, cases, screenings and readings, lab reports, actions, re-reports, resident messages, resident complaints and case history. A <code>record_type</code> column tells them apart; photos are counted, not included.</p>
          <div className="export-panel__actions">
            <button className="primary-button" disabled={busyFull} onClick={() => void exportCsv('export/full', 'jalsakshi-full-export.csv', setBusyFull)}><Download size={17} />{busyFull ? 'Preparing…' : 'Download full data (CSV)'}</button>
            <button className="secondary-button" disabled={busy} onClick={() => void exportCsv('export', 'jalsakshi-safe-summary.csv', setBusy)}><Download size={17} />{busy ? 'Preparing…' : 'Aggregate counts only'}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="export-panel__privacy"><ShieldCheck size={17} />The full file holds case details, complaint text and message logs: keep it inside the team. Share the aggregate file for outside reporting.</p>
        </div>
      </aside>
    </div>
  );
}

