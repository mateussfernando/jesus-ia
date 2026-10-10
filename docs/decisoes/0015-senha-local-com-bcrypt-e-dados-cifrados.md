# 0015 — Senha local com bcrypt e dados cifrados com AES-256-GCM

- Status: aceita
- Data: 10/10/2026

## Contexto

O dono do projeto pediu "encriptação de dados com bcrypt, para ser usada no login e onde for necessária", e escolheu que o Jesus peça uma **senha própria para abrir**, guardada como hash bcrypt.

O bcrypt é uma função de *hash* de senha: só vai num sentido. Serve para conferir uma senha (o código calcula o hash do que você digitou e compara), mas **não serve para cifrar dados que o Jesus precisa ler depois** (tokens OAuth, chaves de API, memórias sensíveis). Um dado "cifrado com bcrypt" não volta. Para esses dados, a seção 5.4 já previa cifragem reversível com AES-256-GCM e chave no cofre do Windows.

Outros pontos conferidos em 10/10/2026:

- `bcryptjs` 3.0.3 é JavaScript puro, sem script de instalação nem binário nativo (o pacote `bcrypt` precisaria de compilação ou de binário baixado). Custo 12 levou ~350 ms num servidor comum.
- O bcrypt só usa os **primeiros 72 bytes** da senha e ignora o resto sem avisar. Duas senhas que começam iguais e passam de 72 bytes dariam o mesmo hash.
- A senha do Jesus é diferente das senhas das contas: o login no Google e no GitHub continua sempre seu, na página oficial (seção 3.4.9, item 2); o Jesus nunca pede, guarda ou digita essas senhas.

## Decisão

**Senha local (login do Jesus):**

- Na primeira vez, você cria a senha do Jesus. Depois, ele pede a senha ao abrir, ao voltar de um bloqueio do Windows ou da suspensão do PC, e depois de 15 min sem uso (ajustável na interface, de 1 a 120 min).
- Guardada **só como hash bcrypt** (`bcryptjs`, custo 12), na tabela `app_credentials`. Nunca em texto puro, nunca no contexto do modelo, nunca em log.
- Regras da senha: no mínimo 12 caracteres (15 ou mais recomendados, como uma frase de 4 palavras); no máximo **72 bytes** em UTF-8 (cerca de 72 letras sem acento, ou menos com acentos), recusando com uma mensagem clara em vez de cortar; texto normalizado em NFC antes do hash (o mesmo "é" digitado de jeitos diferentes vale igual); colar é permitido (gerenciador de senhas); recusa senhas de uma lista curta de senhas comuns e repetições óbvias. Sem regra de "maiúscula + número + símbolo".
- **Tentativas erradas:** as 5 primeiras são livres; depois, cada erro dobra a espera (30 s, 1 min, 2 min… até 15 min). A contagem fica no banco: fechar e abrir o app não zera. Nunca há bloqueio permanente.
- **Código de recuperação:** ao criar a senha, o Jesus mostra uma vez um código de recuperação (100 bits aleatórios, em grupos fáceis de anotar). Ele também é guardado só como hash bcrypt e é a única forma de trocar a senha esquecida. Usado, ele é trocado por um novo.
- Com o Jesus bloqueado: a interface mostra só a tela de senha; pedidos novos (voz ou texto) não são aceitos; cartões de confirmação pendentes e fluxos de conexão de contas são cancelados (o código do device flow sai da tela); "Jesus, pare" continua funcionando, porque parar é sempre seguro (seção 3.11). Rotinas agendadas seguem como já estavam previstas: sem humano, nada de risco médio ou alto.
- A conferência da senha acontece no processo principal (Node). A interface manda a senha pela ponte de IPC uma vez e recebe só "ok", "errada" ou "espere N segundos"; nunca recebe o hash.
- A senha do Jesus pode servir, no futuro, como mais um canal de confirmação de nível alto (ao lado do clique e do Windows Hello, seção 3.4.7). Ela nunca vale para os provedores.

**Dados cifrados (onde a cifragem precisa ter volta):**

- **AES-256-GCM**, do `node:crypto`, com um *nonce* aleatório de 12 bytes por valor e o contexto do campo como dado autenticado (tabela, coluna e id da linha), para que um valor cifrado não possa ser copiado para outra linha ou coluna.
- Formato versionado (versão, id da chave, *nonce*, texto cifrado, *tag*), para permitir trocar a chave depois.
- A **chave de dados** (32 bytes aleatórios) fica protegida pelo cofre do Windows (`safeStorage`/DPAPI, seção 3.5), e só o lado confiável (Executor e o worker de memória) a usa.
- Vale para: campos sensíveis do banco (seção 5.4 e rascunho de memória), backups e qualquer segredo que precise ser lido de volta. Tokens OAuth e chaves de API continuam no cofre (seção 3.5).

**Onde fica o código:** `packages/crypto` (`@jesus/crypto`: bcrypt, AES-256-GCM, códigos aleatórios) e `packages/auth` (`@jesus/auth`: regras da senha, tentativas, bloqueio e serviço de login, com portas injetadas). A tabela fica no `packages/db` (Prisma, decisão 0014).

## Consequências

- Quem chegar ao PC desbloqueado não usa o Jesus sem a senha.
- A senha **não** cifra os dados: um programa rodando como você ainda consegue pedir ao DPAPI a chave de dados (limite já registrado na seção 3.5). Fechar essa porta exige derivar a chave de dados também da senha (com uma função lenta própria para isso, como scrypt; o bcrypt não serve para derivar chave). O custo: nada cifrado pode ser lido com o Jesus bloqueado (inclusive por rotinas), e perder a senha e o código de recuperação significa perder os dados. Fica como pergunta em aberto para o dono, para depois das rotinas (fase 9).
- O limite de 72 bytes do bcrypt é mostrado na tela de criação de senha (contador), em vez de cortar a senha sem avisar.
- O `bcryptjs` é mais lento que o `bcrypt` nativo; com custo 12, a espera de ~0,3 a 0,5 s ao desbloquear é aceitável. O custo fica num lugar só e, quando subir, o hash é refeito no próximo desbloqueio certo.

## Detalhes

[03-seguranca.md](../03-seguranca.md) (seções 3.5, 3.9, 3.11, 3.12 e nova 3.20) · [05-dados-postgresql.md](../05-dados-postgresql.md) (seção 5.4) · `packages/crypto` · `packages/auth`
