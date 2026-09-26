/** Pure parts of the public map (publicMap.tsx): type colours and the Leaflet page. */

import type { MapSource } from './v2.ts';

export const SOURCE_TYPE_COLORS: Record<string, string> = {
  hand_pump: '#2563EB', tap: '#0891B2', well: '#7C3AED', tank: '#EA580C', pond: '#16A34A', river: '#DB2777', other: '#64748B',
};
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  hand_pump: 'Hand pump', tap: 'Tap', well: 'Well', tank: 'Tank', pond: 'Pond', river: 'River / canal', other: 'Other',
};

/** The Leaflet page for these sources (tests/public-map.test.ts). */
export function mapHtml(sources: MapSource[]): string {
  const points = sources.filter((s) => s.latitude !== null && s.longitude !== null).map((s) => ({
    lat: s.latitude, lon: s.longitude, name: s.name, type: SOURCE_TYPE_LABELS[s.source_type] ?? s.source_type,
    color: SOURCE_TYPE_COLORS[s.source_type] ?? SOURCE_TYPE_COLORS.other, status: s.status_label,
    area: [s.village, s.ward].filter(Boolean).join(', '), precision: s.location_precision, issues: s.open_issues,
  }));
  // JSON inside <script>: "<" is escaped so no value can close the tag.
  const data = JSON.stringify(points).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;height:100%;font-family:sans-serif}.p b{font-size:14px}.p div{font-size:12px;color:#334;margin-top:2px}
#e{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:20px;color:#456;font-size:14px}</style>
</head><body><div id="m"></div><div id="e">The map needs an internet connection. The list under Sources works offline.</div><script>
var pts=${data};
function esc(t){var d=document.createElement('div');d.textContent=t==null?'':String(t);return d.innerHTML}
if(!window.L){document.getElementById('e').style.display='flex'}else{
var map=L.map('m',{zoomControl:true});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
var b=[];pts.forEach(function(p){b.push([p.lat,p.lon]);
L.circleMarker([p.lat,p.lon],{radius:9,color:'#fff',weight:2,fillColor:p.color,fillOpacity:.95}).addTo(map)
.bindPopup('<div class="p"><b>'+esc(p.name)+'</b><div>'+esc(p.type)+(p.area?' · '+esc(p.area):'')+'</div><div>Status: '+esc(p.status)+'</div>'
+(p.issues?'<div>Open issues: '+esc(p.issues)+'</div>':'')+'<div>Location: '+esc(p.precision)+'</div></div>')});
if(b.length){map.fitBounds(b,{padding:[24,24],maxZoom:14})}else{map.setView([22.7,75.9],7)}}
</script></body></html>`;
}
