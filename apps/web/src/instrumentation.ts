// O Next chama register() uma vez, quando o servidor sobe. O código que só roda no Node fica em outro arquivo,
// importado aqui só no runtime Node (padrão da documentação do Next): o process.exit não vai para o bundle do Edge.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkApiProxyEnv, checkOriginLockEnv } = await import('./instrumentation-node');
    checkOriginLockEnv();
    checkApiProxyEnv();
  }
}
