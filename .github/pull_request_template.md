## O que muda

<!-- Uma ou duas frases: o que muda e por quê. -->

## Checklist

- [ ] `pnpm check` verde (lint, tipos, testes e `docs:check`).
- [ ] `docs/DEPENDENCIAS.md` atualizado: todo pacote, imagem, action, binário, fonte ou serviço novo tem linha completa, com versão exata, licença e link. (Ou nada externo novo neste PR.)
- [ ] E2E mobile verde: `pnpm test:e2e` nos projetos `pixel-7`, `iphone-15` e `desktop`. Mobile é gate de merge.
- [ ] Nenhum prompt no diff (arena ou chat): nem o texto, nem canário, nem trecho dele.
- [ ] Migration segura: gerada com `prisma migrate diff`, revisada e sem perda de dado. Nenhum `migrate dev`, `migrate reset` ou `db push`.
- [ ] Testes: unidade no caso de uso e integração no endpoint. Nenhum teste chama LLM, B3, CVM, BCB ou brapi.
- [ ] Decisão deliberada nova tem ADR em `docs/adr/`.
- [ ] Mexeu em workflow, Dockerfile ou `scripts/deploy.mjs`: `actionlint` limpo e as duas imagens constroem (`docker build -f apps/<app>/Dockerfile .`). (Ou nada disso muda neste PR.)
