export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./server/lore/ops/migrations');
    await runMigrations();
    const { registerBuiltInJobs } = await import('./server/lore/jobs/jobDefinitions');
    const { initJobScheduler } = await import('./server/lore/jobs/registry');
    registerBuiltInJobs();
    initJobScheduler();
  }
}
