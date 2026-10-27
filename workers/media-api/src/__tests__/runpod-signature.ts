/**
 * Sign a body the way the RunPod handler does: hex HMAC-SHA256 over
 * `${timestamp}.${payload}` (or the bare payload without a timestamp).
 *
 * Not `@codex/security` generateWorkerSignature: that signs `ts:payload` and
 * encodes base64, the worker-to-worker scheme.
 */
export async function signRunpodPayload(
  payload: string,
  secret: string,
  timestamp?: number
): Promise<string> {
  const encoder = new TextEncoder();
  const message = timestamp ? `${timestamp}.${payload}` : payload;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
