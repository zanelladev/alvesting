// Apoio dos testes que trocam o `fetch` por um falso. Só os testes importam este arquivo (fica fora do build, ver
// tsconfig.build.json).

// O endereço de um pedido do fetch, seja texto, URL ou Request.
export const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
