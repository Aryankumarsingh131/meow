export interface Profile { id: string; email: string; role: 'supervisor'; team_id: string; team_name: string; dataMode: 'synthetic' | 'live' }
export interface Source { id: string; team_id: string; name: string; locality: string; version: number; latitude?: number | null; longitude?: number | null; source_type?: string; village?: string | null; ward?: string | null; risk_level?: string | null; public_status?: string | null }
export interface Case { id: string; team_id: string; source_id: string; screening_id: string | null; origin: 'screening' | 'ivr'; status: 'under_review' | 'closed'; priority: 'normal' | 'urgent' | 'critical'; created_at: string; version: number; closed_at: string | null; closure_reason: string | null }
export interface Screening { capture_name: string | null; readings?: Array<{ parameter: string; label: string; unit: string; value: number; level: 'low' | 'medium' | 'high' | null }>; id: string; source_id: string; sample_code: string; machine_suggestion: string; human_observation: string; screening_flag: string; captured_at: string; created_by: string; photos?: string[] }
export interface LabReport { id: string; case_id: string; source_id: string; screening_id: string; report_number: string; lab_name: string; result: string; file_name: string; file_sha256: string; uploaded_at: string; uploaded_by: string; verification_status: 'uploaded' | 'verified'; verified_at: string | null; verified_by: string | null; verification_note: string | null }
export interface CaseAction { id: string; case_id: string; kind: 'referral' | 'corrective'; description: string; performed_by: string; performed_at: string; evidence_name: string | null; photo?: string | null }
export interface Retest { id: string; case_id: string; requested_at: string; due_at: string; instructions: string; linked_screening_id: string | null; status: 'requested' | 'completed'; completed_at: string | null }
export interface Communication { id: string; case_id: string; channel: string; message_summary: string; sent_at: string; delivery_status: string; delivery_reference: string }
export interface Complaint { id: string; source_id: string | null; case_id: string | null; summary: string; status: 'new' | 'linked'; received_at: string; version: number; photos?: string[] }
export interface Audit { id: string; entity_id: string; sequence: number; occurred_at: string; actor_id: string; event: string; event_hash: string; previous_hash: string; payload: Record<string,unknown> }
export interface Workspace { profile: Profile; water_sources: Source[]; cases: Case[]; screening_records: Screening[]; lab_reports: LabReport[]; case_actions: CaseAction[]; retests: Retest[]; resident_communications: Communication[]; ivr_complaints: Complaint[]; audit_log: Audit[] }
export interface Photo { kind: 'complaint' | 'screening' | 'field'; record_id: string; report_id: string | null; source_id: string | null; source_name: string; blob_id: string | null; position: number; at: string; title: string; detail: string | null; status: string | null }
export const photoKey = (p: Photo) => `${p.kind}:${p.record_id}:${p.position}`
export const photoUrl = (blobId: string) => `/api/supervisor/photo/${blobId}`
export class ApiError extends Error { status: number; constructor(status:number,message:string){super(message);this.status=status} }
export async function api<T>(path:string, body?:unknown, method='POST'):Promise<T> {
 const response=await fetch(`/api/supervisor/${path}`,body===undefined?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const result=await response.json()
 if(!response.ok) throw new ApiError(response.status,result.error || 'Unable to complete this request.')
 return result as T
}
export async function attachment(file:File){
 if(file.size>2*1024*1024 || !['application/pdf','image/jpeg','image/png'].includes(file.type)) throw new Error('Choose a PDF, JPEG or PNG up to 2 MB.')
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the file.'));reader.readAsDataURL(file)})
 return {file_name:file.name,file_type:file.type,file_base64:data}
}
export async function download(path:string,name:string){
 const response=await fetch(`/api/supervisor/${path}`)
 if(!response.ok){const result=await response.json();throw new Error(result.error || 'Download failed.')}
 const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export const date=(value:string|null)=>value?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not recorded'
export const shortId=(id:string)=>id.slice(0,8).toUpperCase()
