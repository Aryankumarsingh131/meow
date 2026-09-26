import { useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Clock3, Download, Droplets, FlaskConical, RotateCcw, ShieldCheck } from 'lucide-react';
import SourceMap from './SourceMap';
import { date, shortId, type Workspace } from '../supervisor';

type Destination = 'sources' | 'cases' | 'alerts' | 'reports';

export default function OverviewView({ data, onNavigate, onOpenCase }: { data: Workspace; onNavigate: (screen: Destination) => void; onOpenCase: (id: string) => void }) {
  const [mapFilter, setMapFilter] = useState('all');
  const [period, setPeriod] = useState('6 months');
  const open = data.cases.filter(record => record.status === 'under_review');
  const highRisk = open.filter(record => record.priority !== 'normal');
  const pendingRetests = data.retests.filter(record => record.status === 'requested');
  const today = new Date().toDateString();
  const testsToday = data.screening_records.filter(record => new Date(record.captured_at).toDateString() === today).length;
  const sorted = [...open].sort((a, b) => ({ critical: 0, urgent: 1, normal: 2 })[a.priority] - ({ critical: 0, urgent: 1, normal: 2 })[b.priority]);
  const alerts = [
    ...highRisk.map(record => ({ id: record.id, title: record.priority === 'critical' ? 'Critical case needs review' : 'Urgent case needs review', subtitle: `${shortId(record.id)} — ${data.water_sources.find(source => source.id === record.source_id)?.name || 'Water source'}`, detail: record.origin === 'ivr' ? 'Resident report escalation' : 'Field screening flagged', kind: record.priority, time: date(record.created_at) })),
    ...data.ivr_complaints.filter(record => record.status === 'new').map(record => ({ id: record.id, title: 'Resident report awaiting linkage', subtitle: record.summary, detail: `Complaint ${shortId(record.id)}`, kind: 'urgent', time: date(record.received_at) })),
  ].slice(0, 5);
  // Month buckets of screenings by band ('·' marks a month with no screenings).
  const months = period === '3 months' ? 3 : 6;
  const trend = Array.from({ length: months }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (months - 1 - i));
    const key = d.toISOString().slice(0, 7);
    const inMonth = data.screening_records.filter(record => record.captured_at.slice(0, 7) === key);
    return { label: d.toLocaleString('en-IN', { month: 'short' }), total: inMonth.length,
      low: inMonth.filter(r => r.screening_flag === 'low').length, medium: inMonth.filter(r => r.screening_flag === 'medium').length,
      high: inMonth.filter(r => r.screening_flag === 'high').length };
  });
  const recent = [...data.cases].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const mapCount = mapFilter === 'all' ? data.water_sources.length : mapFilter === 'open' ? new Set(open.map(record => record.source_id)).size : new Set(open.filter(record => record.priority === 'critical').map(record => record.source_id)).size;

  return <div className="reference-overview">
    <div className="reference-page-heading"><div><h1>Good morning, {data.profile.email.split('@')[0].split(/[._-]/)[0].replace(/^./, letter => letter.toUpperCase()) || 'Supervisor'}.</h1><p>Here’s what’s happening with water quality in {data.profile.team_name}.</p></div><p className="reference-quote">“Every test counts. Healthier communities begin with transparency.”</p></div>
    <section className="reference-kpis" aria-label="Team activity">
      <button onClick={() => onNavigate('sources')} className="reference-kpi"><span className="reference-kpi__icon blue"><Droplets size={31} fill="currentColor" /></span><span><small>Total Sources</small><strong>{data.water_sources.length}</strong><em>Team water sources</em></span><svg viewBox="0 0 76 35" aria-hidden="true"><path d="M1 30 9 28 15 22 22 24 29 17 36 20 43 15 50 24 59 6 67 12 75 2" /></svg></button>
      <button onClick={() => onNavigate('cases')} className="reference-kpi"><span className="reference-kpi__icon mint"><FlaskConical size={31} /></span><span><small>Tests Today</small><strong>{testsToday}</strong><em>{data.screening_records.length} team screenings</em></span><svg viewBox="0 0 76 35" aria-hidden="true"><path d="M1 30 10 25 18 28 27 20 34 22 42 14 49 19 58 5 66 13 75 2" /></svg></button>
      <button onClick={() => onNavigate('alerts')} className="reference-kpi"><span className="reference-kpi__icon coral"><Bell size={31} fill="currentColor" /></span><span><small>High-Risk Alerts</small><strong>{highRisk.length}</strong><em>Needs attention</em></span><svg viewBox="0 0 76 35" aria-hidden="true"><path d="M1 30 10 24 18 25 27 6 36 28 44 21 53 20 62 9 68 22 75 3" /></svg></button>
      <button onClick={() => onNavigate('cases')} className="reference-kpi"><span className="reference-kpi__icon amber"><RotateCcw size={31} /></span><span><small>Pending Retests</small><strong>{pendingRetests.length}</strong><em>Follow-up requested</em></span><svg viewBox="0 0 76 35" aria-hidden="true"><path d="M1 30 10 24 18 28 27 14 34 27 44 24 53 29 62 10 69 17 75 2" /></svg></button>
    </section>

    <div className="reference-overview__grid">
      <div className="reference-overview__left">
        <section className="reference-map-panel"><header><div><h2>Water Sources – {data.profile.team_name}</h2><p>Recorded GPS locations · select a pin for its case</p></div><label className="reference-filter">View Filters <select value={mapFilter} onChange={event => setMapFilter(event.target.value)} aria-label="Filter water sources"><option value="all">All sources</option><option value="open">Open cases</option><option value="critical">Critical cases</option></select></label></header>{mapFilter !== 'all' && <span className="reference-map__filter-count">{mapCount} {mapFilter === 'critical' ? 'critical' : 'open'} sources</span>}<SourceMap sources={data.water_sources} cases={data.cases} filter={mapFilter as 'all' | 'open' | 'critical'} onOpenCase={onOpenCase} onOpenSources={() => onNavigate('sources')} /></section>
        <section className="reference-trend"><header><div><h2>Contamination Trend</h2><p>Share of field screenings in each screening band, by month</p></div><label>Last <select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Trend period"><option>6 months</option><option>3 months</option></select></label></header><div className="reference-chart"><div className="reference-chart__axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><svg viewBox="0 0 720 110" preserveAspectRatio="none" role="img" aria-label="Share of screenings within, watch and outside the screening bands per month"><path className="grid" d="M0 8H720M0 33H720M0 58H720M0 83H720M0 108H720" />{(['low', 'medium', 'high'] as const).map(level => { const cls = { low: 'safe', medium: 'watch', high: 'critical' }[level]; const pts = trend.map((m, i) => ({ m, x: trend.length > 1 ? (i * 720) / (trend.length - 1) : 360 })).filter(p => p.m.total).map(p => ({ x: p.x, y: 108 - (p.m[level] / p.m.total) * 100 })); return <g key={level}><path className={cls} d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} />{pts.map(p => <circle key={p.x} className={`dot ${cls}`} cx={p.x} cy={p.y} r={4} />)}</g>; })}</svg><div className="reference-chart__months">{trend.map(m => <span key={m.label} title={m.total ? `${m.total} screenings` : 'No screenings'}>{m.label}{m.total ? '' : ' –'}</span>)}</div></div><div className="reference-chart__legend"><span className="safe">Within bands</span><span className="watch">Watch band</span><span className="critical">Outside bands</span></div></section>
        <section className="reference-recent"><header><h2>Recent Cases</h2><button onClick={() => onNavigate('cases')}>View All <ArrowRight size={15} /></button></header><div className="reference-table-wrap"><table><thead><tr><th>Source ID</th><th>Location</th><th>Issue / Parameter</th><th>Risk</th><th>Due Date</th><th>Status</th></tr></thead><tbody>{recent.map(record => <tr key={record.id} onClick={() => onOpenCase(record.id)}><td>{shortId(record.id)}</td><td>{data.water_sources.find(source => source.id === record.source_id)?.locality || '—'}</td><td>{record.origin === 'ivr' ? 'Resident report' : 'Field screening'}</td><td><span className={`reference-risk ${record.priority}`}>{record.priority}</span></td><td>{date(record.created_at)}</td><td>{record.status === 'closed' ? 'Closed' : 'Open'}</td></tr>)}</tbody></table></div>{!recent.length && <p className="empty-state">No cases recorded for this team.</p>}</section>
      </div>
      <div className="reference-overview__right">
        <section className="reference-alerts"><header><h2>Live Alerts &amp; Updates</h2><span>{alerts.length} new</span><button onClick={() => onNavigate('alerts')}>View All</button></header><div>{alerts.map(alert => <button key={alert.id} className="reference-alert" onClick={() => data.cases.some(record => record.id === alert.id) ? onOpenCase(alert.id) : onNavigate('cases')}><span className={`reference-alert__icon ${alert.kind}`}>{alert.kind === 'critical' ? <AlertTriangle size={24} fill="currentColor" /> : <Clock3 size={24} />}</span><span><strong>{alert.title}</strong><small>{alert.subtitle}</small><em>{alert.detail}</em></span><time>{alert.time}</time></button>)}{!alerts.length && <p className="empty-state">No urgent case or resident alerts right now.</p>}</div></section>
        <section className="reference-tasks"><header><h2>Open Tasks &amp; Assignments</h2><button onClick={() => onNavigate('cases')}>View All</button></header><div>{sorted.slice(0, 4).map((record, index) => <button key={record.id} onClick={() => onOpenCase(record.id)}><span className={`reference-task__icon task-${index % 4}`}>{index % 2 ? <FlaskConical size={19} /> : <ShieldCheck size={19} />}</span><span><strong>{record.origin === 'ivr' ? 'Review resident report' : 'Review field screening'} — {shortId(record.id)}</strong><small>{data.water_sources.find(source => source.id === record.source_id)?.name || 'Water source'}</small></span><em className={record.priority}>{record.priority === 'critical' ? 'Priority' : record.priority === 'urgent' ? 'Soon' : 'Open'}</em></button>)}{!sorted.length && <p className="empty-state">No open case assignments.</p>}</div></section>
        <button className="reference-download" onClick={() => onNavigate('reports')}><Download size={18} /> Export team summary <ArrowRight size={16} /></button>
      </div>
    </div>
  </div>;
}
