import { AsrEngine, type AsrEngineOptions, type Session } from '@jeffpeng3/nemotron-asr-core';
import { AwaitQueue, AwaitQueueRemovedTaskError, AwaitQueueStoppedError } from 'awaitqueue';

export type NemotronAsrProfile = 'TURBO' | 'FAST' | 'BALANCED' | 'NORMAL' | 'HIGH';

export type NemotronAsrWorkerInMessage =
  | { type: 'load'; profile: NemotronAsrProfile; beamWidth: number }
  | { type: 'startSession'; langId: number }
  | { type: 'feed'; samples: Float32Array }
  | { type: 'endSession' }
  | { type: 'dispose' };

export type NemotronAsrWorkerOutMessage =
  | { type: 'progress'; label: string; progress: number }
  | { type: 'status'; detail: string }
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'session-ended' }
  | { type: 'error'; error: string }
  | { type: 'disposed' };

let engine: AsrEngine | null = null;
let session: Session | null = null;
let stopRequested = false;
let asyncQueue = new AwaitQueue();

function post(message: NemotronAsrWorkerOutMessage) {
  self.postMessage(message);
}

function isQueueCancel(error: unknown): boolean {
  return (
    error instanceof AwaitQueueStoppedError ||
    error instanceof AwaitQueueRemovedTaskError ||
    stopRequested
  );
}

async function disposeEngine() {
  stopRequested = true;
  asyncQueue.stop();
  asyncQueue = new AwaitQueue();
  const active = session;
  session = null;
  if (active) {
    try {
      await active.end();
    } catch {
      // ignore teardown errors
    }
  }
  engine = null;
}

self.onmessage = async (event: MessageEvent<NemotronAsrWorkerInMessage>) => {
  const data = event.data;

  try {
    switch (data.type) {
      case 'load': {
        await disposeEngine();
        stopRequested = false;

        const engineOptions: AsrEngineOptions = {
          profile: data.profile,
          beamWidth: data.beamWidth,
        };

        engine = new AsrEngine(
          {
            progress: (label, loaded, total, cached) => {
              if (cached) {
                return;
              }
              const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
              post({ type: 'progress', label, progress });
            },
            status: detail => {
              post({ type: 'status', detail });
            },
          },
          engineOptions,
        );

        await engine.init();
        if (stopRequested) {
          return;
        }
        post({ type: 'ready' });
        break;
      }

      case 'startSession': {
        if (!engine || session || stopRequested) {
          return;
        }
        session = engine.session(data.langId, false);
        break;
      }

      case 'feed': {
        if (!data.samples.length || !session || stopRequested) {
          return;
        }
        const chunk = data.samples;
        void asyncQueue
          .push(async () => {
            if (!session || stopRequested) {
              return;
            }
            const partials = await session.feed(chunk);
            if (!partials?.length || stopRequested) {
              return;
            }
            for (const partial of partials) {
              const text = partial.text.trim();
              if (text) {
                post({ type: 'partial', text });
              }
            }
          }, 'nemotron-feed')
          .catch(error => {
            if (isQueueCancel(error)) {
              return;
            }
            post({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        break;
      }

      case 'endSession': {
        void asyncQueue
          .push(async () => {
            const active = session;
            if (!active || stopRequested) {
              post({ type: 'session-ended' });
              return;
            }
            session = null;
            const result = await active.end();
            if (stopRequested) {
              post({ type: 'session-ended' });
              return;
            }
            const text = result?.text.trim() ?? '';
            if (text) {
              post({ type: 'final', text });
            } else {
              post({ type: 'session-ended' });
            }
          }, 'nemotron-flush')
          .catch(error => {
            session = null;
            if (isQueueCancel(error)) {
              post({ type: 'session-ended' });
              return;
            }
            post({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        break;
      }

      case 'dispose': {
        await disposeEngine();
        post({ type: 'disposed' });
        break;
      }
    }
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
