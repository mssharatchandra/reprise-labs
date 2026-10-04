import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/store.ts';
import { config } from '../server/env.ts';
import { providerRequest } from '../server/bolna.ts';
const store = new Store(config.database);
try {
  const session = store
    .allSessions()
    .find(
      (s) => s.mode === 'live' && s.executionId && s.status === 'completed' && s.transcript.length,
    );
  if (!session?.executionId) throw Error('No completed answered call found.');
  const execution = await providerRequest(`/executions/${session.executionId}`);
  let url = (execution.telephony_data as { recording_url?: string })?.recording_url;
  if (!url || new URL(url).protocol !== 'https:')
    throw Error('Provider did not expose a recording.');
  let response = await fetch(url, {
    headers:
      new URL(url).hostname === 'api.bolna.ai' ? { Authorization: `Bearer ${config.apiKey}` } : {},
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  if (response.status >= 300 && response.status < 400) {
    url = new URL(response.headers.get('location')!, url).href;
    response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  }
  if (response.ok && (response.headers.get('content-type') || '').includes('json')) {
    const data = (await response.json()) as Record<string, unknown>;
    const next = data.recording_url || data.url || data.download_url;
    if (typeof next !== 'string' || !next.startsWith('https://'))
      throw Error('Recording response did not include a downloadable URL.');
    response = await fetch(next, { signal: AbortSignal.timeout(30000) });
  }
  if (!response.ok) throw Error(`Recording download returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 30 * 1024 * 1024)
    throw Error('Recording size was outside the expected range.');
  const magic = bytes.subarray(0, 12).toString('ascii'),
    extension = magic.startsWith('RIFF')
      ? 'wav'
      : magic.startsWith('OggS')
        ? 'ogg'
        : magic.includes('ftyp')
          ? 'm4a'
          : 'mp3';
  mkdirSync('artifacts', { recursive: true });
  const file = `artifacts/live-call.${extension}`;
  writeFileSync(file, bytes);
  writeFileSync(
    'artifacts/call-recording.json',
    JSON.stringify(
      {
        file,
        source: 'Original Bolna recording of the permitted fictional test call.',
        durationSeconds: execution.conversation_duration,
        downloadedAt: new Date().toISOString(),
        notes:
          'Recorded before the current channel-delivery wording. No audio was generated or re-recorded.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      file,
      bytes: bytes.length,
      durationSeconds: execution.conversation_duration,
      contentType: response.headers.get('content-type'),
    }),
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
