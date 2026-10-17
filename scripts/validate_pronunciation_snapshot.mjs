import { createServer } from 'vite';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
});
try {
  const { validateOverlayDocumentSet } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/contracts.ts',
  );
  const { validateIdentityRegistry, listEntries, listLexemes } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/identity.ts',
  );
  const { createPronunciationQuery } = await server.ssrLoadModule(
    '/src/pronunciation-overlay/query.ts',
  );
  const asset = JSON.parse(input);
  if (process.argv.includes('--legacy-batch')) {
    const { legacyProtection } = await server.ssrLoadModule('/src/pronunciation-overlay/legacy.ts');
    console.log(
      JSON.stringify(
        Object.fromEntries(
          asset.map((row) => [
            row.word,
            legacyProtection(
              row.word,
              row.legacyState,
              row.scopeResolutions,
              row.proposed?.identity === undefined
                ? undefined
                : Object.values(row.proposed.identity.byId)
                    .filter((entry) => entry.kind === 'entry' && entry.status === 'active')
                    .map((entry) => entry.id),
              row.proposed?.documents?.rules ?? [],
            ),
          ]),
        ),
      ),
    );
  } else {
    for (const result of [
      validateIdentityRegistry(asset.identity),
      validateOverlayDocumentSet(asset.documents),
    ]) {
      if (!result.valid) throw new Error(JSON.stringify(result.issues));
    }
    const sameIds = (left, right) =>
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    if (
      !sameIds(
        listEntries(asset.identity).map((entry) => entry.id),
        asset.documents.identityEntryIds,
      ) ||
      !sameIds(
        listLexemes(asset.identity).map((entry) => entry.id),
        asset.documents.identityLexemeIds ?? [],
      )
    )
      throw new Error('Identity registry differs from documents');
    createPronunciationQuery(asset, {
      legacy: { status: 'ready', user: {}, system: {} },
      resolutions: [],
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
