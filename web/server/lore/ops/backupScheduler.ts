import { registerBuiltInJobs } from '../jobs/jobDefinitions';
import { initJobScheduler } from '../jobs/registry';

export function initBackupScheduler(): void {
  registerBuiltInJobs();
  initJobScheduler();
}
