import { useEffect, useState } from 'react';
import { AlertTriangle, ChartNoAxesColumnIncreasing, Check, ChevronLeft, ChevronRight, ExternalLink, FileText, FlaskConical, MapPin, RotateCcw, UploadCloud } from 'lucide-react';
import { pump } from '../brandAssets';
import { date, photoUrl, shortId, type Workspace } from '../supervisor';

type Section = string;
export default function LabPortalView({ data, section, onOpenCase, onMutate }: { data: Workspace; section: Section; onOpenCase: (id: string) => void; onMutate: (path: string, body: unknown, method?: string) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(data.screening_records[0]?.id || '');
  const [filter, setFilter] = useState('all');
  const [note, setNote] = useState('');
  const [auditFilter, setAuditFilter] = useState('all');
  const [noteError, setNoteError] = useState('');
  const [page, setPage] = useState(0);
  const selected = data.screening_records.find(record => record.id === selectedId) || data.screening_records[0];
  const selectedCase = data.cases.find(record => record.screening_id === selected?.id);
  const source = data.water_sources.find(record => record.id === selected?.source_id);
  const reports = data.lab_reports.filter(record => record.screening_id === selected?.id);
  const status = (id: string) => {
    const related = data.lab_reports.filter(report => report.screening_id === id);
    return related.some(report => report.verification_status === 'verified') ? 'Verified' : related.length ? 'In Testing' : 'Pending';
  };
  const queue = data.screening_records.filter(record => filter === 'all' || status(record.id) === filter);
  const visible = queue.slice(page * 9, page * 9 + 9);
  const index = data.screening_records.findIndex(record => record.id === selected?.id);
  const kind = (event: string) => event.endsWith('.note') ? 'notes' : event.startsWith('lab_referrals.') ? 'lab' : 'case';
  const audit = selectedCase ? data.audit_log.filter(record => record.entity_id === selectedCase.id && (auditFilter === 'all' || kind(record.event) === auditFilter)).sort((a, b) => a.sequence - b.sequence) : [];
  const verified = reports.some(report => report.verification_status === 'verified');
  const BAND: Record<string, string> = { low: 'Within band', medium: 'Watch band', high: 'Outside band' };
  useEffect(() => {
    if (section === 'labs') return;
    const selector = section === 'samples' ? '.reference-sample-details' : section === 'results' ? '.reference-lab-results' : section === 'audit' ? '.reference-lab-audit' : '';
    if (selector) requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ block: 'start' }));
  }, [section]);
  function move(amount: number) {
    const next = data.screening_records[(index + amount + data.screening_records.length) % data.screening_records.length];
    if (next) setSelectedId(next.id);
  }
  async function postNote() {
    const text = note.trim();
    if (!text || !selectedCase) return;
    setNoteError('');
    try { await onMutate('notes', { case_id: selectedCase.id, text }); setNote(''); }
    catch (reason) { setNoteError(reason instanceof Error ? reason.message : 'The note was not saved.'); }
  }
  return <div className="reference-lab" data-section={section}>
    <div className="reference-page-heading reference-lab-heading"><div><h1>Lab Portal</h1><p>Validate field samples, confirm results and ensure water safety through trusted testing.</p></div><p className="reference-quote">“Accurate testing today. Safer communities tomorrow.”</p></div>
    <div className="reference-lab-grid">
      <section className="reference-lab-queue">
        <header><h2>Sample Queue <span>({queue.length})</span></h2><select aria-label="Filter sample status" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All Status</option><option>Pending</option><option>In Testing</option><option>Verified</option></select></header>
        <div className="reference-lab-queue__list">{visible.map(record => {
          const itemSource = data.water_sources.find(item => item.id === record.source_id);
          const related = data.cases.find(item => item.screening_id === record.id);
          return <button key={record.id} className={selected?.id === record.id ? 'selected' : ''} onClick={() => setSelectedId(record.id)}>
            <span className="reference-lab-queue__check">{selected?.id === record.id && <Check size={16} />}</span><span className={`reference-lab-dot ${related?.priority || 'normal'}`} />
            <span className="reference-lab-queue__name"><strong>{record.sample_code || shortId(record.id)}</strong><small>{itemSource?.locality || itemSource?.name || 'Unknown source'}</small><time>{date(record.captured_at)}</time></span>
            <span className="reference-lab-queue__badges"><em className={related?.priority || 'normal'}>{related?.priority === 'critical' ? 'High' : related?.priority === 'urgent' ? 'Medium' : 'Low'}</em><small>{status(record.id)}</small></span>
          </button>;
        })}{!visible.length && <p className="empty-state">No samples match this status.</p>}</div>
        <footer><span>{queue.length ? `${page * 9 + 1}–${Math.min(page * 9 + 9, queue.length)}` : '0'} of {queue.length} samples</span><div><button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous queue page"><ChevronLeft size={17} /></button><span>{page + 1}</span><button onClick={() => setPage(page + 1)} disabled={(page + 1) * 9 >= queue.length} aria-label="Next queue page"><ChevronRight size={17} /></button></div></footer>
      </section>
      <div className="reference-lab-center">
        <section className="reference-sample-details">
          <header><h2>Sample Details</h2><div><button onClick={() => move(-1)} disabled={!selected}><ChevronLeft size={17} /> Previous</button><button onClick={() => move(1)} disabled={!selected}>Next <ChevronRight size={17} /></button></div></header>
          {selected ? <><div className="reference-sample-title"><h3>{selected.sample_code || shortId(selected.id)}</h3><span className={`reference-risk ${selectedCase?.priority || 'normal'}`}>{selectedCase?.priority || 'Normal'} priority</span><span className="reference-sample-status">{status(selected.id)}</span><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}>View Field Form <ExternalLink size={15} /></button></div><p className="reference-sample-meta">Collected {date(selected.captured_at)} · Field worker {shortId(selected.created_by)}</p>
          <div className="reference-sample-cards">
            <article><h4><MapPin size={21} />Source Information</h4><dl><div><dt>Source ID</dt><dd>{shortId(selected.source_id)}</dd></div><div><dt>Source Type</dt><dd>{source?.name || '—'}</dd></div><div><dt>Village</dt><dd>{source?.locality || '—'}</dd></div><div><dt>District</dt><dd>{data.profile.team_name}</dd></div></dl><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}><MapPin size={15} /> View source case</button></article>
            <article className="reference-sample-illustration"><h4><FileText size={21} />Source Illustration</h4>{selected.photos?.[0] ? <img src={photoUrl(selected.photos[0])} alt="Field capture of the test strip" /> : <img src={pump} alt="Illustration of a community hand pump" />}<small>Field capture: {selected.capture_name || 'No photo attached'}</small></article>
            <article><h4><FlaskConical size={21} />Field Screening (Indicative)</h4><div className="reference-screening-note"><AlertTriangle size={20} /><span><strong>Awaiting lab confirmation</strong><small>Field results are indicative and must be confirmed by laboratory analysis.</small></span></div><dl><div><dt>Screening flag</dt><dd>{selected.screening_flag}</dd></div><div><dt>Field observation</dt><dd>{selected.human_observation || '—'}</dd></div></dl></article>
          </div></> : <p className="empty-state">No field samples have been submitted.</p>}
        </section>
        <section className="reference-lab-results"><header><h2>Lab Test Results</h2><span>{reports.some(report => report.verification_status === 'verified') ? 'Verified' : reports.length ? 'Report uploaded' : 'Awaiting report'}</span><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}>Enter Results</button></header><div className="reference-table-wrap"><table><thead><tr><th>Parameter</th><th>Field Result</th><th>Lab Result</th><th>Status</th></tr></thead><tbody>{(selected?.readings?.length ? selected.readings : []).map(r => <tr key={r.parameter}><th>{r.label}</th><td>{r.value}{r.unit ? ` ${r.unit}` : ''}</td><td>{verified ? 'See verified report' : reports.length ? 'Report uploaded' : '—'}</td><td><span className={r.level === 'low' ? 'reference-result-ok' : 'reference-result-pending'}>{r.level ? BAND[r.level] : 'Not assessed'}</span></td></tr>)}{!selected?.readings?.length && <tr><th colSpan={4}>This screening has no numeric readings (a colour-band or model reading).</th></tr>}</tbody></table></div>{reports.length > 0 && <p className="reference-lab-report-summary"><strong>Uploaded report:</strong> {reports[0].report_number} · {reports[0].result}</p>}</section>
        <section className="reference-lab-comparison"><header><h2><ChartNoAxesColumnIncreasing size={20} /> Field vs Lab Comparison</h2><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}>View Trend</button></header><p>Parameter comparison appears once structured lab results are available.</p></section>
        <div className="reference-lab-actions"><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase || !verified || selectedCase.status === 'closed'} title={verified ? 'Review and close the case with its evidence' : 'Verified evidence is required'}><Check size={18} /> Approve &amp; finalize</button><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}><RotateCcw size={18} /> Request retest</button><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}><AlertTriangle size={18} /> Flag discrepancy</button><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}><UploadCloud size={18} /> Upload report</button><button onClick={() => selectedCase && onOpenCase(selectedCase.id)} disabled={!selectedCase}>Close case</button></div>
      </div>
      <aside className="reference-lab-audit"><header><h2>Audit Trail &amp; Notes</h2><select aria-label="Filter audit events" value={auditFilter} onChange={event => setAuditFilter(event.target.value)}><option value="all">All Events</option><option value="case">Case changes</option><option value="lab">Lab events</option><option value="notes">Notes</option></select></header><div className="reference-lab-audit__events">{audit.map((entry, entryIndex) => <article key={entry.id}><span className={`reference-audit-icon icon-${entryIndex % 4}`}>{entryIndex % 2 ? <FlaskConical size={18} /> : <MapPin size={18} />}</span><time>{date(entry.occurred_at)}</time><strong>{entry.event.endsWith('.note') ? 'Note added' : entry.event.replaceAll('_', ' ').replace('.', ' · ')}</strong><p>{entry.event.endsWith('.note') && typeof entry.payload.text === 'string' ? entry.payload.text : `by ${entry.actor_id ? shortId(entry.actor_id) : 'System'}`}</p></article>)}{!audit.length && <p className="empty-state">{selectedCase ? 'No events of this kind for this sample’s case.' : 'This sample has no case, so there is no history to show.'}</p>}</div><form onSubmit={event => { event.preventDefault(); postNote(); }}><label className="sr-only" htmlFor="lab-note">Session note</label><input id="lab-note" placeholder="Add a session note..." value={note} onChange={event => setNote(event.target.value)} /><button type="submit" disabled={!note.trim() || !selectedCase}>Post</button></form><small className="reference-lab-audit__disclaimer">{noteError || 'Notes are saved to the case history and visible to your team.'}</small></aside>
    </div>
  </div>;
}
