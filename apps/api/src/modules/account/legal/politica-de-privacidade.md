# Política de privacidade

Versão: 0.2
Vigência: 03/11/2026

> RASCUNHO para revisão do autor e do orientador. Este texto ainda não foi revisado por quem entende de direito e não vale como texto final.

Esta política explica, conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018, art. 9), que dados pessoais a Alvesting trata, para quê, por quanto tempo e quais são os seus direitos. Ela descreve só o que existe hoje: a conta, o login, os e-mails de verificação e a carteira de ações. O chat consultivo ainda não existe; quando existir, esta política ganha uma versão nova e você será chamado a aceitá-la.

## 1. Quem é o controlador e como falar com ele

O controlador dos dados pessoais, com o nome e o canal de contato (que também atende como encarregado, art. 5º, VIII), é o indicado no topo desta página. Esses dados vêm da configuração do serviço e não ficam escritos neste texto.

## 2. Que dados tratamos (só os mínimos)

- **Nome e e-mail**, que você informa ao criar a conta (ou que o Google informa, se você entrar com ele).
- **Senha**: guardamos apenas um resumo criptográfico dela (scrypt), nunca a senha em texto.
- **Login com Google** (só para quem escolher): o identificador da conta Google, o nome e o e-mail que o Google informar. Não guardamos a foto de perfil nem as chaves de acesso que o Google entrega.
- **Sessão**: um identificador secreto no cookie e as datas de criação e de validade. Não guardamos o endereço IP nem o navegador na sessão.
- **Aceite**: o documento, a versão, o resumo criptográfico (SHA-256) do texto e a data e hora de cada aceite destes termos e desta política.
- **Carteira** (só para quem a usar): os lançamentos de compra que você digita, cada um com o código da ação (ticker), a quantidade, o custo total pago em reais e, se você quiser, a data da compra, mais a data e a hora em que o lançamento foi criado ou alterado. É só o que você digita: não pedimos nem guardamos corretora, conta de investimento, CPF nem nota de corretagem. O preço usado para estimar o valor da carteira vem de dados públicos de mercado, e não de você.
- **Segurança**: o filtro de segurança da borda (Azure Front Door) registra o endereço IP e a URL completa, com os parâmetros, das requisições que ele bloqueia ou limita. O registro da aplicação não guarda e-mail, nome, endereço IP, cookie nem token, nem o conteúdo da sua carteira: quando precisa identificar alguém, usa só um código aleatório (ULID) da conta.

Não usamos seus dados para publicidade, perfilamento ou venda, e não usamos cookies de rastreamento. O único cookie é o da sessão (necessário para você continuar conectado: HttpOnly, SameSite=Lax e Secure), mais cookies temporários do fluxo de login com o Google.

## 3. Para quê (finalidade) e base legal

- **Criar e manter a conta, autenticar você e manter a sessão.** Base legal: execução de contrato ou de procedimentos preliminares a pedido do titular (art. 7º, V).
- **Enviar o e-mail de confirmação do endereço e o de redefinição de senha.** Base legal: execução de contrato (art. 7º, V).
- **Guardar a sua carteira e mostrar o preço médio, o valor estimado e o ganho ou a perda dos seus lançamentos.** Base legal: execução de contrato (art. 7º, V), porque a carteira é um recurso que você escolhe usar.
- **Guardar a prova do seu aceite destes textos.** Base legal: exercício regular de direitos (art. 7º, VI) e consentimento (art. 7º, I e art. 8º, § 2º).
- **Proteger o serviço contra abuso e invasão** (limites de tentativas, registros de segurança). Base legal: legítimo interesse (art. 7º, IX).
- **Transferência internacional dos dados** (item 6). Base legal: consentimento específico e em destaque (art. 33, VIII) e garantias contratuais dos operadores (art. 33, II).

## 4. Operadores e compartilhamento

- **Microsoft Azure** (Microsoft Corporation) hospeda o site, a API, o banco de dados PostgreSQL, o cofre de segredos e os registros de segurança, e envia os e-mails (Azure Communication Services).
- **Google** (Google LLC) só participa para quem escolhe entrar com a conta Google, para confirmar a identidade.

Não compartilhamos seus dados com mais ninguém, exceto por obrigação legal ou ordem de autoridade.

## 5. Por quanto tempo guardamos (retenção)

- **Conta e aceites**: enquanto a conta existir. Quando você exclui a conta, apagamos do banco, no mesmo ato, o cadastro, as contas vinculadas, as sessões, os pedidos pendentes de verificação, o histórico de aceites e a carteira com os lançamentos. Ficam apenas o registro de auditoria da exclusão, com o código aleatório da conta e sem nome nem e-mail, e as cópias de segurança abaixo.
- **Carteira**: até você apagar o lançamento ou excluir a conta. Você pode corrigir ou apagar cada lançamento a qualquer momento, e apagar a conta apaga a carteira inteira. Não guardamos o histórico das alterações; só o ponto de restauração abaixo guarda estados antigos, por até 7 dias.
- **Sessão**: até 7 dias, renovada quando você usa o site; sair encerra na hora. Uma limpeza semanal apaga as sessões vencidas, então o registro de uma sessão que você deixou de usar pode ficar até 14 dias.
- **Cadastro não confirmado**: se você criar a conta e nunca confirmar o e-mail, o nome e o e-mail ficam guardados por até 14 dias: uma limpeza semanal apaga o cadastro não confirmado que tem mais de 7 dias.
- **Links por e-mail**: o de confirmação vale 60 minutos e o de redefinição de senha, 30 minutos. Os pedidos vencidos também são apagados pela limpeza semanal.
- **Cópia de segurança do banco**: o serviço de banco mantém um ponto de restauração contínuo por 7 dias, e só ele guarda dado pessoal, a carteira inclusive. Depois disso, o que você excluiu deixa de existir também nas cópias. Há ainda uma cópia mensal do banco, guardada por até 12 meses para provar que o banco se restaura: ela leva a estrutura do banco e os dados públicos da arena, e **não leva nenhum dado das tabelas da conta nem da carteira** (cadastro, contas vinculadas, sessões, pedidos de verificação, aceites, a carteira e os lançamentos). Se um dia guardarmos dado pessoal por mais tempo, esta política muda.
- **Registro de segurança da borda** (endereço IP e URL): 90 dias.

## 6. Transferência internacional de dados (LGPD, art. 33)

Os dados ficam em servidores da Microsoft nos Estados Unidos, na região East US 2 do Azure. Isso vale para os dados descritos no item 2, inclusive a carteira. Quem entra com o Google também tem dados tratados pelo Google, que opera nos Estados Unidos e em outros países. Isso é uma transferência internacional de dados pessoais.

Ao aceitar esta política, você dá o consentimento específico e em destaque para essa transferência (art. 33, VIII), depois de ser informado aqui de que ela é internacional. Os operadores também oferecem garantias contratuais de proteção (art. 33, II). Se não concordar, não crie conta: a arena pública pode ser lida sem conta.

## 7. Seus direitos (LGPD, art. 18)

Você pode pedir, a qualquer momento e sem custo: confirmação de que tratamos seus dados; acesso; correção de dados incompletos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade; portabilidade; eliminação dos dados tratados com o seu consentimento; informação sobre com quem compartilhamos; informação sobre a possibilidade de não consentir e suas consequências; e a revogação do consentimento.

Dois deles já estão no site, em "Minha conta": **exportar meus dados** (um arquivo JSON com o seu cadastro, as contas vinculadas, as sessões, os aceites e a carteira com os lançamentos, sem senha nem chaves; ficam de fora os registros de auditoria, que guardam só o código aleatório da conta, e os pedidos pendentes de uso único, que carregam credenciais) e **excluir minha conta**. A correção e a eliminação dos lançamentos da carteira você faz na própria tela da carteira; se os textos mudaram e você ainda não aceitou a versão nova, a tela pede o aceite primeiro (item 9), e até lá exportar os dados e excluir a conta, que apaga a carteira inteira, seguem disponíveis. Para os demais, fale com o contato do topo desta página. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

## 8. Segurança

Usamos conexão criptografada (HTTPS), guardamos a senha só como resumo criptográfico, protegemos o cookie de sessão contra leitura por scripts e limitamos as tentativas de login. Nenhum sistema é infalível; se houver um incidente que possa causar dano relevante, avisaremos você e a ANPD, como a LGPD manda.

## 9. Mudanças

Quando esta política mudar, a versão sobe e pedimos novo aceite antes de você continuar usando os recursos da conta, a carteira inclusive. Exportar os dados e excluir a conta continuam disponíveis sem o aceite novo.
