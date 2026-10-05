# Fightcord

[Site](https://jillthestingray.github.io/fightcord/pt/) · [English](README.md) · **Português (Brasil)** · [Español](README.es.md)

**O Fightcade com a cara e o jeito do Discord**, mais um monte de ferramentas para quem joga
competitivo. Um instalador, nenhum outro download, tudo rodando dentro do app do Fightcade no seu PC.

![Um canal do Fightcade com o Fightcord: barra de canais, chat e lista de membros estilo Discord](docs/screenshots/channel.png)

> O Fightcord é um mod feito por fãs, que roda só no seu computador. Ele **não** é feito pelo
> Fightcade nem pelo Discord, nem tem ligação ou aval deles.

## Download

Baixe o **`FightcordSetup.exe`** na [versão mais recente](https://github.com/JillTheStingray/fightcord/releases/latest),
feche o Fightcade, rode o instalador e clique em **Instalar**. Pronto: abra o Fightcade e uma tela
de boas-vindas curta te guia pelo resto.

<img src="docs/screenshots/welcome.png" alt="A tela de boas-vindas: escolha um tema e uma cor de destaque" width="720">

- Windows 10 / 11, o app normal do Fightcade 2. Não precisa de administrador.
- O instalador encontra o Fightcade sozinho (Documentos, OneDrive, `C:\Fightcade`, ou um Fightcade
  aberto); se não, clique em Procurar.
- **"O Windows protegeu o computador"?** O instalador não tem assinatura digital (certificados
  custam caro), então o SmartScreen avisa na primeira vez: **Mais informações → Executar assim mesmo**.
  Alguns antivírus também desconfiam de instaladores novos sem assinatura: o Malwarebytes, por
  exemplo, pode colocá-lo em quarentena como "MachineLearning/Anomalous", que é um palpite de IA e
  não uma ameaça conhecida. Se confiar, restaure-o da quarentena, ou compile você mesmo a partir
  deste repositório (veja abaixo).
- **As atualizações** acontecem dentro do Fightcade: quando você abre, o Fightcord confere as versões
  deste repositório e instala a nova antes de carregar (conferida por checksum). Você nunca precisa
  voltar aqui nem rodar o instalador de novo. Se o Fightcade fica aberto por dias, um botão verde na
  barra da esquerda oferece reiniciar quando a atualização está pronta, e Configurações → Atualizações
  mostra as novidades.
- **Desinstalar:** rode o instalador de novo → Desinstalar. Suas configurações ficam guardadas numa
  pasta de backup e, se você usava o Cerberus antes, ele pode voltar.

## O que você ganha

**O visual**
- Um tema estilo Discord: Escuro, AMOLED, Cinza clássico ou FightCord Neon, qualquer cor de destaque,
  seu próprio fundo no chat, ou suas próprias cores no editor de tema.
- Barra de canais, lista de membros (agrupada por rank, com ping, avisos de Wi-Fi/VPN e posição no
  ranking), cartões ao passar o mouse, painel de perfil e menu do botão direito, tudo estilo Discord.
- A aba de busca vira uma página Descobrir: categorias, "Seus jogos", Ao vivo agora, busca
  instantânea e páginas de jogo.
- Chat: menções, horários, prévias de links, ir para o presente, atalhos `:emoji:`, estilos de fonte
  e tradução automática das mensagens recebidas.

| | |
|---|---|
| ![A página Descobrir: seus jogos e partidas ao vivo para assistir](docs/screenshots/discover.png) | ![Configurações: perfis e todos os módulos numa tela](docs/screenshots/settings.png) |

**Para quem joga competitivo**
- **Ficha do oponente:** rank, ELO, chances de vitória e o confronto direto de vocês, assim que ele
  te desafia. O ELO é exato para apoiadores do Fightcade no Patreon (o Fightcade só manda para eles)
  e estimado pelo rank e pela posição no ranking para todo o resto. Ela também avisa quando alguém
  costuma abandonar sets ranked.
- **Filtros de desafio:** avisam ou recusam desafios automaticamente por ping, Wi-Fi / VPN, país,
  formato do set, rank, jogadores que você nunca enfrentou, ou uma lista de bloqueio.
- **Achar partida:** um botão mostra quem está livre agora perto do seu rank, com ping bom, novo
  para você ou equilibrado no confronto direto, com suas chances e um botão Desafiar.
- **Telas de partida:** VS / VOCÊ VENCEU! / VOCÊ PERDEU!, e o placar da noite no topo do canal.
- **Estatísticas:** seu histórico, confrontos diretos, sequências e um cartão para compartilhar.
- **Histórico de rank e ELO:** um gráfico do seu rank ao longo do tempo em cada jogo, com
  comemoração quando você sobe.
- **Metas de treino:** "vencer 5 sets", "derrotar 3 rank A", "jogar uma hora"… acompanhadas ao vivo,
  com resumo da sessão.
- **Análise de partidas:** taxa de vitória por rank do oponente, ping, hora do dia e formato do set,
  mais um alerta de tilt.

| | |
|---|---|
| ![Um desafio recebido com a ficha do oponente: ELO, chances, confronto direto](docs/screenshots/scout.png) | ![Metas de treino ao lado do placar da noite](docs/screenshots/goals.png) |
| ![Histórico de rank e ELO](docs/screenshots/progress.png) | ![Análise de partidas](docs/screenshots/analytics.png) |

**Social**
- **Lista de amigos** com avisos de online / partida e botão Assistir, mais **notas e etiquetas de
  jogadores**.
- **Feed do lobby:** entradas, partidas para assistir, zebras e sequências de vitórias em cada canal.
- **Lembretes de eventos:** um aviso antes dos torneios do Fightcade dos seus jogos começarem (ou de
  qualquer evento em que você tocar o sininho), com um botão para abrir o canal.
- **Status no Discord:** mostra seu jogo, oponente e o tempo de partida no seu perfil do Discord.
- **Música** no lobby (traga sua própria faixa; nenhuma vem incluída).

**Para streamers**
- **Modo streamer:** Ctrl+Shift+H borra nomes, avatares e o chat dos outros jogadores na tela,
  coloca os desafios numa fila (um por vez, nenhum durante a partida) e silencia avisos com nomes.
- **Overlay do OBS:** um placar (você vs seu oponente, ranks, o placar e o saldo da noite) para
  adicionar no OBS como fonte de Navegador.

| | |
|---|---|
| ![Achar partida: jogadores livres perto do seu rank, com chances e um botão Desafiar](docs/screenshots/findmatch.png) | ![Modo streamer: outros jogadores borrados, desafios numa fila](docs/screenshots/streamer.png) |

<img src="docs/screenshots/feed.png" alt="O feed do lobby: zebras, sequências e partidas para assistir" width="720">

<sub>As capturas usam jogadores e conversas inventados (e mostram a versão em inglês).</sub>

O Fightcord (e o instalador) fala **inglês, português do Brasil e espanhol**. Ele segue o idioma do
Windows, ou escolha um em Configurações → Meu Fightcord → Idioma.

Tudo pode ser ligado ou desligado: **Ctrl+,** abre as configurações (ou digite `/fightcord`, e
`/help` lista todos os comandos do chat). Os perfis **Leve / Completo / Competitivo** trocam grupos
inteiros de uma vez.

## Privacidade

O Fightcord não tem servidor nem coleta de dados. Ele só conversa com:

| O quê | Onde | Quando |
|---|---|---|
| Dados de jogadores, resultados, rankings | A própria API do Fightcade (`web.fightcade.com`) | fichas, estatísticas, o feed, histórico de rank; os mesmos pedidos que o Fightcade faz |
| Tradução do chat | Google Tradutor (`translate.googleapis.com`) | mensagens recebidas que não estão no seu idioma, enquanto o tradutor está ligado (Configurações → Chat) |
| Prévias de links | YouTube / X / Streamable / Twitch | quando um link deles aparece no chat |
| Avatares, uma fonte | Gravatar, Google Fonts | como o Fightcade faz |
| Atualizações | este repositório no GitHub | uma vez por dia |
| Status no Discord | o app do Discord no seu PC | enquanto o status no Discord está ligado |
| Overlay do OBS | uma página em `127.0.0.1` que só este PC abre | enquanto o overlay está ligado (Configurações → Modo streamer) |

Configurações, notas, amigos e histórico de partidas ficam na pasta do Fightcord no seu PC
(`<Fightcade>\fc2-electron\resources\app\inject\fightcord\`). Configurações → Backup e restauração
salva tudo num arquivo.

## Jogo limpo

O Fightcord só muda o que você vê e clica no app do Fightcade. Ele nunca mexe no emulador, na
memória do jogo, nos comandos ou no netcode, e nunca joga partidas nem envia, aceita ou recusa
desafios sozinho: os filtros de desafio só recusam os desafios que você mandou recusar.

## Perguntas frequentes

**Algo quebrou depois de uma atualização do Fightcade.** Segure **Shift** enquanto o Fightcade abre
para iniciá-lo sem o Fightcord (modo seguro), depois veja Configurações → Diagnóstico, ou abra uma
issue com o texto de "Copiar informações de depuração".

**Posso usar só uma parte?** Sim: Configurações → Meu Fightcord liga e desliga módulos individuais,
ou escolha o perfil Leve.

**Funciona com o Cerberus?** O Fightcord substitui o Cerberus. O instalador move o Cerberus para uma
pasta de backup e traz suas configurações, histórico de partidas e sons junto.

**Achei um erro de tradução.** As traduções são novas — abra uma issue ou um pull request em
`src/i18n-pt.js` (o app) ou `installer/i18n.json` (o instalador).

## Compilar você mesmo

Veja a seção [Building it yourself](README.md#building-it-yourself) no README em inglês: Windows,
Node.js 18+ e PowerShell, depois `powershell -ExecutionPolicy Bypass -File build.ps1`.

## Licença

[MIT](LICENSE). Fightcade, Discord e os jogos mostrados no Fightcade pertencem aos seus donos.
