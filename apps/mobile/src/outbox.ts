export type PendingOutboxEvent = {
  eventId: string;
  sampleId: string;
  payloadJson: string;
  payloadHash: string;
  state: 'pending';
  attempt: 0;
  nextAttemptAt: null;
};

export async function createPendingOutboxEvent(
  eventId: string,
  sampleId: string,
  payload: object,
  hashText: (value: string) => Promise<string>,
): Promise<PendingOutboxEvent> {
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(payload);
  } catch {
    throw new Error('Sample payload must be JSON serializable');
  }
  if (!payloadJson) throw new Error('Sample payload must be JSON serializable');

  const payloadHash = (await hashText(payloadJson)).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) throw new Error('Payload SHA-256 is invalid');

  return {
    eventId,
    sampleId,
    payloadJson,
    payloadHash,
    state: 'pending',
    attempt: 0,
    nextAttemptAt: null,
  };
}
