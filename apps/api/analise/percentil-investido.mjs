// A linha de comando da análise do percentil com carteiras que continuam investidas (percentil-investido.ts). Só lê o banco.
//   pnpm --filter @alvesting/contracts build
//   node apps/api/analise/percentil-investido.mjs postgresql://alvesting:alvesting@localhost:25432/alvesting_temporada
// O código é TypeScript e importa o domínio da liquidação direto do src, sem build e sem entrar no dist: o Node 26 tira os tipos,
// e este gancho resolve o `.js` dos imports para o `.ts` ao lado, como o tsc e o Vitest fazem.
import { registerHooks } from 'node:module';
import process from 'node:process';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.endsWith('.js')) throw error;
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});

const { main } = await import('./percentil-investido.ts');
process.exitCode = await main(process.argv.slice(2));
