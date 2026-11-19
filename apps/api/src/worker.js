import {
  claimNextJob,
  completeConversion,
  failConversion,
  finishJob,
  markConverting,
  requeueInterruptedJobs,
} from './models/modelQueries.js';
import { withTransaction } from './db/transaction.js';

const SERVER_PROBLEM =
  'Conversion failed because of a server problem. Try again; if it keeps failing, check that the converter is running.';

// Pulls conversion jobs from Postgres one at a time and hands them to the converter.
// Uploads call wake() so a new job starts immediately instead of on the next poll.
export function createConversionWorker({ db, converter, storage, log = console, idlePollMs = 2000 }) {
  let running = false;
  let loopDone = null;
  let wakeSleeper = null;
  let lastLoopError = null;

  async function processNext() {
    const job = await claimNextJob(db);
    if (!job) return false;

    const outputPath = storage.glbPath(job.model_id);
    const model = await markConverting(db, job.model_id);
    if (!model) {
      await finishJob(db, job.id, 'failed', 'Model was deleted before conversion started');
      return true;
    }

    try {
      const result = await converter.convert({
        inputPath: model.source_path,
        outputPath,
        quality: job.quality,
      });
      const saved = await withTransaction(db, (tx) =>
        completeConversion(tx, { jobId: job.id, modelId: job.model_id, glbPath: outputPath, result }),
      );
      if (!saved) {
        // Deleted while converting: drop the orphaned GLB and close the job.
        await storage.remove(outputPath);
        await finishJob(db, job.id, 'failed', 'Model was deleted during conversion');
      }
    } catch (error) {
      if (!error.userFacing) log.error(`Conversion job ${job.id} failed:`, error);
      await failConversion(db, {
        jobId: job.id,
        modelId: job.model_id,
        userMessage: error.userFacing ? error.message : SERVER_PROBLEM,
        detail: error.message,
      });
    }
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeSleeper = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wakeSleeper = null;
    });
  }

  async function loop() {
    while (running) {
      let didWork = false;
      try {
        didWork = await processNext();
        lastLoopError = null;
      } catch (error) {
        // Usually the database is down; say so once, not every poll.
        if (error.message !== lastLoopError) log.error('Conversion worker error:', error.message);
        lastLoopError = error.message;
      }
      if (!didWork && running) await sleep(idlePollMs);
    }
  }

  return {
    processNext,

    async start() {
      if (running) return;
      running = true;
      try {
        const requeued = await requeueInterruptedJobs(db);
        if (requeued) log.info?.(`Re-queued ${requeued} conversion job(s) interrupted by a restart`);
      } catch (error) {
        log.error('Could not re-queue interrupted jobs:', error.message);
      }
      loopDone = loop();
    },

    async stop() {
      running = false;
      wakeSleeper?.();
      await loopDone;
    },

    wake() {
      wakeSleeper?.();
    },
  };
}
