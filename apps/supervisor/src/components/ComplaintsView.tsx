import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { date, photoKey, type Photo } from '../supervisor';

const KINDS = [['all', 'All photos'], ['complaint', 'Resident complaints'], ['screening', 'Screenings'], ['field', 'Field action']] as const;
const KIND_LABEL: Record<Photo['kind'], string> = { complaint: 'Resident complaint', screening: 'Screening', field: 'Field action' };

export default function ComplaintsView({ photos, fresh, error, refreshing, updatedAt, onRefresh, onOpenCase, onOpenAlerts }: {
  photos: Photo[] | null; fresh: Set<string>; error: string; refreshing: boolean; updatedAt: Date | null
  onRefresh: () => void; onOpenCase: (id: string) => void; onOpenAlerts: () => void
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('all');
  const shown = (photos ?? []).filter(p => kind === 'all' || p.kind === kind);
  return <>
    <div className="reference-subheading photo-feed__head">
      <div><h1>Complaints &amp; Photos</h1><p>Newest photos from phones, checked every second. {updatedAt ? `Last checked ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` : ''}</p></div>
      <button className="photo-feed__refresh" onClick={onRefresh} disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    <div className="photo-feed__filters" role="group" aria-label="Photo type">
      {KINDS.map(([id, label]) => <button key={id} aria-pressed={kind === id} className={kind === id ? 'selected' : ''} onClick={() => setKind(id)}>{label} <small>{id === 'all' ? photos?.length ?? 0 : photos?.filter(p => p.kind === id).length ?? 0}</small></button>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!photos && !error && <p className="workspace-loading" role="status">Loading recent photos…</p>}
    {photos && !shown.length && <p className="empty-state">No photos have been reported yet. New uploads from the app appear here within a couple of seconds.</p>}
    <div className="photo-feed">
      {shown.map(p => <article key={photoKey(p)} className={`photo-card ${fresh.has(photoKey(p)) ? 'is-new' : ''}`}>
        {p.blob_id
          ? <a href={`/api/supervisor/photo/${p.blob_id}`} target="_blank" rel="noreferrer" aria-label={`Open full photo: ${p.title}`}><img src={`/api/supervisor/photo/${p.blob_id}`} alt={`${KIND_LABEL[p.kind]} photo, ${p.source_name}`} loading="lazy" /></a>
          : <div className="photo-card__missing">Photo not stored on this server</div>}
        <div className="photo-card__body">
          <p className="photo-card__tags"><span className={`photo-card__kind is-${p.kind}`}>{KIND_LABEL[p.kind]}</span>{fresh.has(photoKey(p)) && <span className="photo-card__fresh">New</span>}{p.position > 1 && <span>Photo {p.position}</span>}</p>
          <strong>{p.title}</strong>
          <small>{p.source_name} · {date(p.at)}</small>
          {p.detail && <small className="photo-card__detail">{p.detail}</small>}
          {p.report_id
            ? <button onClick={() => onOpenCase(p.report_id!)}>Open case</button>
            : p.kind === 'complaint' ? <button onClick={onOpenAlerts}>Review complaint</button> : null}
        </div>
      </article>)}
    </div>
  </>;
}
