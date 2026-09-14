import { cleanupExpiredRequestRecords } from './idempotency';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly — matches the 24h TTL, no need to run more often

let intervalHandle: NodeJS.Timeout | null = null;

export function startScheduledCleanup() {
  if (intervalHandle) {
    return; // already running — avoid double-scheduling on hot reload
  }

  intervalHandle = setInterval(async () => {
    try {
      const deletedCount = await cleanupExpiredRequestRecords();
      if (deletedCount > 0) {
        console.log(`Cleanup: removed ${deletedCount} expired voice request record(s)`);
      }
    } catch (err) {
      // A failed cleanup run should never crash the server — just log and
      // let the next scheduled run try again.
      console.error('Cleanup job failed:', err);
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't let this timer keep the process alive on its own during shutdown.
  intervalHandle.unref();
}

export function stopScheduledCleanup() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}