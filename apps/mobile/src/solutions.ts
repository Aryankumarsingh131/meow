/**
 * "Suggested solutions" after a screening (tests/solutions.test.ts).
 *
 * For the FIELD WORKER and the water team only: what is the likely cause, what
 * to do at the source, who does it, and how to confirm. Every suggestion starts
 * from a screening, so each one says to confirm with the lab first where the
 * reading is the basis. Never shown to residents or on public pages: those
 * surfaces carry no treatment instructions and no verdict on the water.
 */

import type { Judgement, KitParameter } from './pluccyModel.ts';

export type Priority = 'today' | 'this_week' | 'routine';

export interface Suggestion {
  key: string;
  title: string;
  why: string;
  steps: string[];
  who: string;
  priority: Priority;
}

export interface Finding {
  parameter: string;
  value: number;
  level: 'low' | 'medium' | 'high';
}

const LAB = 'Send a sample to the district lab to confirm before any change at the source.';

type Side = 'low' | 'high';
type Entry = Omit<Suggestion, 'key' | 'priority'>;

/** Per parameter and side of the band. */
const BY_PARAMETER: Record<string, Partial<Record<Side, Entry>>> = {
  ph: {
    low: { title: 'Acidic pH reading', why: 'Low pH can corrode pipes and pump parts and carry metals into the water.',
           steps: [LAB, 'Check the pump rods, pipes and fittings for rust or corrosion.',
                   'If the lab confirms, the water department can plan pH correction at the source or supply.'], who: 'Water department with the supervisor' },
    high: { title: 'Alkaline pH reading', why: 'A high pH often points to soap, detergent or waste water reaching the source.',
            steps: [LAB, 'Look for washing, bathing or drain water within 10 m of the source and ask for it to stop.',
                    'Screen again after the surroundings are dealt with.'], who: 'Field worker and panchayat' },
  },
  chlorine: {
    low: { title: 'Residual chlorine below band', why: 'Too little chlorine leaves no protection against germs in the supply.',
           steps: ['Tell the supply operator the dosing may be low or interrupted today.', 'Ask for the line to be flushed after dosing is corrected.',
                   'Screen chlorine again 24 hours after the fix.'], who: 'Supply operator via the supervisor' },
    high: { title: 'Residual chlorine above band', why: 'Over-dosing makes the water taste strong and people may switch to other sources.',
            steps: ['Tell the supply operator to check the dose at the tank or doser.', 'Screen chlorine again 24 hours later.'],
            who: 'Supply operator via the supervisor' },
  },
  iron: {
    high: { title: 'High iron reading', why: 'Iron usually comes from the aquifer or from rusting pipes and casing.',
            steps: [LAB, 'Check for rusty rising mains or a corroded hand-pump cylinder; replace rusted parts.',
                    'If the aquifer is the cause, the water department can install an iron-removal unit at the source.'],
            who: 'Hand-pump mechanic and water department' },
  },
  tds: {
    high: { title: 'High dissolved solids', why: 'Salty or mineral-rich water; sometimes waste water seeping in.',
            steps: [LAB + ' Ask for the individual salts to be measured.', 'Check the source for seepage from drains or industry nearby.',
                    'The water department decides on treatment or an alternative source.'], who: 'Water department' },
  },
  coliform: {
    high: { title: 'Coliform bacteria present', why: 'Faecal bacteria mean sewage or animal waste is reaching the water.',
            steps: ['Call your supervisor today.', 'Take a sealed sample to the lab within 24 hours.',
                    'Walk the surroundings for latrines, soak pits, animal waste and broken drainage (see the sanitary items).',
                    'After the cause is fixed, a trained team disinfects the source and it is retested before the case is closed.'],
            who: 'Supervisor, lab and the water department' },
  },
  hardness: {
    high: { title: 'High hardness', why: 'Calcium and magnesium from the rock; it causes scale in pots and pipes.',
            steps: [LAB, 'Log it for the water department; softening or blending with another source is their decision.'], who: 'Water department' },
  },
  nitrate: {
    high: { title: 'High nitrate', why: 'Nitrate usually comes from fertiliser run-off or sewage near the source.',
            steps: [LAB, 'Note fields, cattle sheds or soak pits uphill of the source.',
                    'The water department decides on protection of the source or an alternative source; tell the health worker for infants in the area.'],
            who: 'Water department and health worker' },
  },
  fluoride: {
    high: { title: 'High fluoride', why: 'Fluoride comes from the rock; long exposure affects teeth and bones.',
            steps: [LAB, 'The water department decides on a defluoridation unit or an alternative source.',
                    'Inform the health department so they can plan checks in the area.'], who: 'Water department and health department' },
  },
  turbidity: {
    high: { title: 'Cloudy water (turbidity)', why: 'Silt or soil entering through a damaged casing, platform or after rain.',
            steps: ['Flush the source and screen turbidity again.', 'Check the well lining, casing and platform for cracks that let surface water in.',
                    'If it stays high, ask the water department to check the filter or treatment step.'], who: 'Field worker and water department' },
  },
};

/** Sanitary and observation answers (009 inspection_criteria keys). */
const BY_CRITERION: Record<string, Entry> = {
  latrine_nearby: { title: 'Latrine or soak pit too close', why: 'Waste from within 10 m can seep into the water.',
                    steps: ['Report it to the panchayat to seal, line or relocate the pit.', 'Mark it on the source record with a photo.'], who: 'Panchayat' },
  animal_waste: { title: 'Animal waste near the source', why: 'Dung near the source is a common route for bacteria.',
                  steps: ['Ask the community to keep cattle away; request a fence around the apron.', 'Clear the waste and check again next visit.'],
                  who: 'Panchayat and the community' },
  standing_water: { title: 'Water pooling at the source', why: 'Pools let dirty water seep back down the pipe or well.',
                    steps: ['Ask for the drain channel to be cleared or extended so water runs away.'], who: 'Panchayat maintenance' },
  damaged_platform: { title: 'Cracked or broken platform', why: 'Cracks let surface water run straight into the source.',
                      steps: ['Request an apron repair; photograph the damage for the case.'], who: 'Panchayat maintenance' },
  drainage_broken: { title: 'Broken or blocked drain', why: 'Spilled water should run away, not collect beside the source.',
                     steps: ['Request the drain channel to be repaired or cleared.'], who: 'Panchayat maintenance' },
  open_or_loose: { title: 'Open well or loose pump', why: 'Dirt, animals and hands can reach the water.',
                   steps: ['Ask for a well cover, or for the mechanic to fix the pump to its base.'], who: 'Hand-pump mechanic' },
  garbage_nearby: { title: 'Garbage dumped nearby', why: 'Rotting waste drains into the ground around the source.',
                    steps: ['Ask the panchayat to clear it and put up a no-dumping notice.'], who: 'Panchayat' },
  recent_flooding: { title: 'Source flooded recently', why: 'Flood water carries surface dirt into wells and pumps.',
                     steps: ['Ask for the source to be disinfected by a trained team, then screen again before it is used for drinking.'],
                     who: 'Water department' },
  colour_change: { title: 'Water looks coloured', why: 'Colour often means iron, silt or organic matter.',
                   steps: ['Run the iron and turbidity kits if you did not today.', LAB], who: 'Field worker' },
  odour: { title: 'Unusual smell', why: 'A smell can mean waste water, algae or gas in the source.',
           steps: ['Look for drains, dead animals or algae near or in the source.', LAB], who: 'Field worker and supervisor' },
  visible_particles: { title: 'Particles or cloudiness', why: 'Silt or debris is getting in.', steps: ['Run the turbidity kit and check the casing and cover.'],
                       who: 'Field worker' },
  taste_reports: { title: 'Residents report an odd taste', why: 'Taste changes often come before a measurable change.',
                   steps: ['Screen again next week and note the date the taste changed.'], who: 'Field worker' },
  illness_reports: { title: 'Residents report illness', why: 'Illness after drinking needs a health check, not only a water check.',
                     steps: ['Call your supervisor and the ASHA or health worker today.', 'Take a sealed sample to the lab within 24 hours.'],
                     who: 'Supervisor and health department' },
};

const URGENT = new Set(['coliform', 'illness_reports', 'recent_flooding']);

function side(p: KitParameter | undefined, value: number): Side {
  if (!p || p.ok_max === null) return 'low';
  return value > p.ok_max ? 'high' : 'low';
}

/** Suggestions for everything a screening flagged, most urgent first. */
export function solutionsFor(findings: Finding[], parameters: KitParameter[], judgement: Judgement | null): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (f.level === 'low') continue;
    const s = side(parameters.find((p) => p.key === f.parameter), f.value);
    const entry = BY_PARAMETER[f.parameter]?.[s] ?? BY_PARAMETER[f.parameter]?.high;
    const key = `${f.parameter}:${s}`;
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ...entry, priority: URGENT.has(f.parameter) || f.level === 'high' ? 'today' : 'this_week' });
  }
  for (const k of judgement?.flagged ?? []) {
    const entry = BY_CRITERION[k];
    if (entry && !seen.has(k)) {
      seen.add(k);
      out.push({ key: k, ...entry, priority: URGENT.has(k) ? 'today' : judgement!.sanitary_level === 'high' ? 'this_week' : 'routine' });
    }
  }
  const rank: Record<Priority, number> = { today: 0, this_week: 1, routine: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export const PRIORITY_TEXT: Record<Priority, string> = { today: 'Do today', this_week: 'This week', routine: 'Next routine visit' };
