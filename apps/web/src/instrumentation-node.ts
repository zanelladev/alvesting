// Contrato da trava de origem (docs/INFRA.md, 3.3): o Bicep injeta ORIGIN_LOCK=front-door em texto puro nos apps
// atrás do Front Door, e o FRONT_DOOR_ID vem do Key Vault. Com ORIGIN_LOCK ligado e o ID vazio, o app RECUSA
// SUBIR: um ID perdido por erro de configuração pareceria "sem trava" (como no perfil econômico) e a desligaria em
// silêncio. Um ID que não é GUID trancaria todo mundo para fora com o /health ainda verde. Nos dois casos o
// processo sai com código 1, o contêiner nunca fica saudável e o deploy reprova a revisão.
// Só o Next sai do ar sozinho aqui: se register() apenas lançasse o erro, o servidor ficaria de pé respondendo 500.
// A API faz o mesmo em apps/api/src/config/env.ts.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkOriginLockEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { ORIGIN_LOCK, FRONT_DOOR_ID } = env;
  const problem =
    ORIGIN_LOCK && ORIGIN_LOCK !== 'front-door'
      ? 'ORIGIN_LOCK inválido: o único valor aceito é front-door'
      : ORIGIN_LOCK === 'front-door' && !FRONT_DOOR_ID
        ? 'ORIGIN_LOCK=front-door exige FRONT_DOOR_ID (docs/INFRA.md, 3.3)'
        : FRONT_DOOR_ID && !GUID.test(FRONT_DOOR_ID)
          ? 'FRONT_DOOR_ID inválido: precisa ser o GUID do perfil do Front Door'
          : undefined;
  if (problem) {
    console.error(`trava de origem: ${problem}`);
    process.exit(1);
  }
}
