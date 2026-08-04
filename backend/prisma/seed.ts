export async function main(): Promise<void> {
  // P9.1 seeds only explicit test fixtures through the acceptance harness.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
