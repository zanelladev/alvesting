// O gancho da telemetria: `node --import ./dist/telemetry/preload.js dist/main.js`. A imagem da api o põe no NODE_OPTIONS (apps/api/Dockerfile),
// então vale para os quatro papéis sem mexer no comando de nenhum (infra/modules/containerapps.bicep) e roda ANTES do ponto de entrada
// carregar uma biblioteca instrumentada (pg, http, o SDK da Azure). Ver telemetry.ts, que diz por que tem de ser assim na api, que é ESM.
//
// Sem APPLICATIONINSIGHTS_CONNECTION_STRING não carrega nada além deste arquivo (dev, teste, e2e e o job de migrations da imagem). A
// telemetria é secundária: se não subir, a api sobe do mesmo jeito, e o motivo vai para o stderr (o Log Analytics o recebe).
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()) {
  try {
    const { startTelemetry } = await import('./telemetry.js');
    await startTelemetry();
  } catch (error) {
    console.error(
      `telemetria não iniciou; seguindo sem ela (${error instanceof Error ? error.name : 'erro'})`,
    );
  }
}

export {};
