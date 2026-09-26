import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowRight, Crosshair } from 'lucide-react';
import type { Case, Source } from '../supervisor';

type Filter = 'all' | 'open' | 'critical';
type Tone = 'critical' | 'open' | 'clear' | 'untested';

// OpenStreetMap street tiles (no key; attribution required). Needs internet; without
// it the pins still show on a plain background and a notice says why.
// ponytail: the public OSM tile server is for light use; point TILES at a hosted
// or self-hosted tile service before production traffic.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Team water sources on a street map, at their recorded GPS pins. */
export default function SourceMap({ sources, cases, filter, onOpenCase, onOpenSources }: {
  sources: Source[]; cases: Case[]; filter: Filter; onOpenCase: (id: string) => void; onOpenSources: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [tilesDown, setTilesDown] = useState(false);

  const placed = sources.filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number');
  const toneOf = (s: Source): Tone => {
    const open = cases.filter(c => c.source_id === s.id && c.status === 'under_review');
    if (open.some(c => c.priority === 'critical')) return 'critical';
    if (open.length) return 'open';
    return s.risk_level && s.risk_level !== 'unknown' ? 'clear' : 'untested';
  };
  const shown = placed.filter(s => filter === 'all' || (filter === 'open' ? ['critical', 'open'].includes(toneOf(s)) : toneOf(s) === 'critical'));
  const recenter = () => {
    if (!map.current || !placed.length) return;
    map.current.fitBounds(L.latLngBounds(placed.map(s => [s.latitude!, s.longitude!] as [number, number])), { padding: [48, 48], maxZoom: 15 });
  };

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, scrollWheelZoom: true });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: 'source-map__tiles' })
      .on('tileerror', () => setTilesDown(true)).on('tileload', () => setTilesDown(false)).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.setView([22.72, 75.86], 11);   // replaced by the team's pins as soon as they are drawn
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; layer.current = null; fitted.current = false; };
  }, []);

  // Draw the (filtered) pins whenever the data, filter or selection changes.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const s of shown) {
      L.marker([s.latitude!, s.longitude!], {
        icon: L.divIcon({ className: '', html: `<span class="lf-pin ${toneOf(s)}${picked === s.id ? ' picked' : ''}"></span>`, iconSize: [28, 36], iconAnchor: [14, 34] }),
        title: s.name, keyboard: true, riseOnHover: true,
      }).bindTooltip(s.name, { direction: 'top', offset: [0, -32] }).on('click', () => setPicked(s.id)).addTo(group);
    }
    if (!fitted.current && placed.length) { recenter(); fitted.current = true; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, cases, filter, picked]);

  const current = shown.find(s => s.id === picked);
  const openCase = current && cases.find(c => c.source_id === current.id && c.status === 'under_review');

  return <div className="source-map">
    <div ref={box} className="source-map__leaflet" role="application" aria-label={`Map of ${shown.length} water sources`} />
    {!placed.length && <p className="source-map__notice">No water source has a recorded location yet.</p>}
    {tilesDown && <p className="source-map__notice">Street map unavailable (no internet). Pins are still shown.</p>}
    <button className="source-map__recenter" onClick={recenter} aria-label="Show all sources"><Crosshair size={18} /></button>
    <ul className="source-map__legend"><li className="critical">Critical case</li><li className="open">Open case</li><li className="clear">Screened, no open case</li><li className="untested">Not screened</li></ul>
    {current && <div className="source-map__popup" role="dialog" aria-label={current.name}>
      <strong>{current.name}</strong><small>{current.locality}</small>
      <small>{openCase ? `Open case · ${openCase.priority}` : 'No open case'}</small>
      <div>{openCase && <button onClick={() => onOpenCase(openCase.id)}>Open case</button>}<button onClick={onOpenSources}>Source list</button><button onClick={() => setPicked(null)} aria-label="Close">×</button></div>
    </div>}
    <button className="source-map__hint" onClick={onOpenSources}>Open source list <ArrowRight size={15} /></button>
  </div>;
}
