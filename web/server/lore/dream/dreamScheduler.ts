import { registerBuiltInJobs } from '../jobs/jobDefinitions';
import { initJobScheduler } from '../jobs/registry';

export function initDreamScheduler(): void {
  registerBuiltInJobs();
  initJobScheduler();
}
