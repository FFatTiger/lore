export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./server/lore/ops/migrations');
    await runMigrations();
  }
}
