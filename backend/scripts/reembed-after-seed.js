const { initVectorDb, regenerateEmbeddings } = require('../src/utils/vectorDb');

async function main() {
  try {
    console.log('[SEED-REEMBED] Initializing vector DB...');
    await initVectorDb();

    console.log('[SEED-REEMBED] Re-embedding documents from documents table...');
    const summary = await regenerateEmbeddings();

    if (summary && summary.failed > 0) {
      console.error(`[SEED-REEMBED] Completed with failures. embedded=${summary.embedded}, failed=${summary.failed}, skippedEmpty=${summary.skippedEmpty}`);
      for (const failure of summary.failures.slice(0, 5)) {
        console.error(`[SEED-REEMBED] Failed document ${failure.documentId}: ${failure.message}`);
      }
      process.exit(1);
      return;
    }

    console.log('[SEED-REEMBED] Done. Seeded documents are now available for vector search.');
    process.exit(0);
  } catch (error) {
    console.error('[SEED-REEMBED] Failed:', error?.message || error);
    process.exit(1);
  }
}

main();
