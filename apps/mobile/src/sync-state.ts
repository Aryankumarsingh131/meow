export type SyncState = 'PENDING' | 'SYNCED' | 'ERROR';
export type PhotoState = 'PENDING' | 'AVAILABLE' | 'ERROR';

export function nextSyncStep(metadata: SyncState, photo: PhotoState) {
  if (metadata !== 'SYNCED') return 'METADATA';
  if (photo !== 'AVAILABLE') return 'PHOTO';
  return 'DONE';
}
