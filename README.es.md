# Fightcord

[Sitio web](https://fightcord.pages.dev/es/) · [English](README.md) · [Português (Brasil)](README.pt-BR.md) · **Español**

**Fightcade, pero se ve y funciona como Discord**, más un montón de herramientas para jugadores
competitivos. Un instalador, ninguna otra descarga, todo funciona dentro de la app de Fightcade en
tu PC.

![Un canal de Fightcade con Fightcord: barra de canales, chat y lista de miembros estilo Discord](docs/screenshots/channel.png)

> Fightcord es un mod hecho por fans que funciona solo en tu computadora. **No** está hecho por
> Fightcade ni por Discord, ni está afiliado a ellos ni avalado por ellos.

> **🤖 Vibe-coded.** Todo aquí (el mod, el instalador, la web, este README) se hace describiéndole lo
> que debe hacer a un asistente de programación con IA (Claude Code), que escribe el código. Todo se
> revisa con pruebas automáticas y se usa en Fightcade antes de cada versión, y el código es abierto,
> así que puedes leer cada línea.

## Descarga

Descarga **`FightcordSetup.exe`** de la [última versión](https://github.com/JillTheStingray/fightcord/releases/latest),
cierra Fightcade, ejecútalo y haz clic en **Instalar**. Eso es todo: abre Fightcade y una pantalla
de bienvenida corta te guía con el resto.

<img src="docs/screenshots/welcome.png" alt="La pantalla de bienvenida: elige un tema y un color de acento" width="720">

- Windows 10 / 11, la app normal de Fightcade 2. No necesita permisos de administrador.
- El instalador encuentra Fightcade solo (Documentos, OneDrive, `C:\Fightcade`, o un Fightcade
  abierto); si no, haz clic en Buscar.
- **¿"Windows protegió su PC"?** El instalador no tiene firma digital (los certificados cuestan
  dinero), así que SmartScreen avisa la primera vez: **Más información → Ejecutar de todas formas**.
  Algunos antivirus también desconfían de los instaladores nuevos sin firma: Malwarebytes, por
  ejemplo, puede ponerlo en cuarentena como "MachineLearning/Anomalous", que es una suposición de
  IA y no una amenaza conocida. Si confías en él, restáuralo de la cuarentena, o compílalo tú
  mismo desde este repositorio (ver abajo).
- **Las actualizaciones** ocurren dentro de Fightcade: al abrirlo, Fightcord revisa las versiones de
  este repositorio e instala la nueva antes de cargar (verificada con checksum). Nunca necesitas volver
  aquí ni ejecutar el instalador otra vez. Si Fightcade queda abierto por días, un botón verde en la
  barra izquierda ofrece reiniciar cuando la actualización está lista, y Configuración →
  Actualizaciones muestra las novedades.
- **Desinstalar:** vuelve a ejecutar el instalador → Desinstalar. Tu configuración queda guardada en
  una carpeta de respaldo.

## Qué obtienes

**El look**
- **Nuevo en 3.0: un diseño como el Discord de hoy.** Una barra de título que muestra dónde estás, tu
  propio panel abajo a la izquierda (chat de voz, música, ajustes), un chat más amplio, tres densidades y
  animaciones más suaves (Completo / Sutil / Apagado). Configuración → Apariencia → Diseño recupera el
  Clásico.
- Un tema estilo Discord: Oscuro, Ash, Onyx, Gris clásico o FightCord Neón, cualquier color de acento,
  tu propio fondo de chat, o tus propios colores en el editor de tema.
- Barra de canales, lista de miembros (agrupada por rango, con ping, avisos de Wi-Fi/VPN y puesto en
  el ranking), tarjetas al pasar el mouse, panel de perfil y menú de clic derecho, todo estilo Discord.
- La pestaña de búsqueda como una página Descubrir hecha para ti: tus juegos con tu rango y ELO, amigos
  jugando ahora, rivales libres para jugar, partidas en vivo, los eventos de la semana, categorías,
  búsqueda instantánea y páginas de juego.
- Una nueva pantalla de inicio de sesión: arte de juegos detrás de una tarjeta elegante, la mascota de
  FightCord y una bienvenida con tu rango y tu última sesión.
- Tu estilo en el emulador: la barra con los nombres y el marcador de tus partidas en el color de tu tema,
  y doce fuentes para elegir (píxel, arcade, esports, ...), cada una con vista previa.
- Un visualizador de música detrás del chat: barras, una onda o un anillo pulsante que se mueven con tu
  música de fondo y golpean en cada bombo.
- Un lobby más tranquilo: la lista de miembros a la izquierda, una línea por jugador, un solo botón de
  Filtro, y el récord de la noche con tus metas en una franja en la barra de arriba.
- La clasificación del juego, repeticiones para ver, eventos y perfiles de jugadores dentro de Fightcade,
  y además una pantalla de VS con el arte del juego, personajes en tu estado de Discord y notas por personaje.
- Estilos en un clic: CRT de arcade, 3rd Strike y Neon Tokyo cambian juntos los colores, la fuente, el
  fondo y la fuente del emulador.
- Chat: menciones, horas, vistas previas de enlaces, ir al presente, atajos `:emoji:`, estilos de
  fuente y traducción automática de los mensajes que recibes.

| | |
|---|---|
| ![La página Descubrir: tus juegos y partidas en vivo para ver](docs/screenshots/discover.png) | ![Configuración: perfiles y todos los módulos en una pantalla](docs/screenshots/settings.png) |
| ![Descubrir hecho para ti: amigos jugando, rivales en línea, partidas en vivo](docs/screenshots/discover-foryou.png) | ![La pantalla de inicio: la mascota y una bienvenida](docs/screenshots/login.png) |

**Para jugadores competitivos**
- **Ficha del rival:** su rango, ELO, probabilidades de ganar y su cara a cara, apenas te desafía.
  El ELO es exacto para los patrocinadores de Fightcade en Patreon (Fightcade solo se lo envía a
  ellos) y estimado por rango y puesto en el ranking para todos los demás. También avisa cuando
  alguien suele abandonar sets ranked.
- **Filtros de desafío:** avisan o rechazan desafíos automáticamente por ping, Wi-Fi / VPN, país,
  formato del set, rango, jugadores con los que nunca jugaste, o una lista de bloqueo.
- **Buscar partida:** un botón muestra quién está libre ahora cerca de tu rango, con buen ping,
  nuevo para ti o parejo en el cara a cara, con tus probabilidades y un botón Desafiar.
- **Pantallas de partida, estilo arcade (3.1):** una pantalla de VS con los dos personajes, tus más usados y un cara a cara de rango, ELO, historial entre ustedes y tus probabilidades; ¡GANASTE! / ¡PERDISTE! con el set partida a partida y tu ELO y barra de rango moviéndose; el récord de la noche arriba del canal.
- **Estadísticas:** tu historial, cara a cara, rachas y una tarjeta para compartir.
- **Historial de rango y ELO:** un gráfico de tu rango en el tiempo para cada juego, con una
  celebración cuando subes.
- **Metas de entrenamiento:** "ganar 5 sets", "ganarle a 3 rangos A", "jugar una hora"… seguidas en
  vivo, con un resumen de la sesión.
- **Análisis de partidas:** porcentaje de victorias por rango del rival, ping, hora del día y formato
  del set, más un aviso de tilt.

| | |
|---|---|
| ![Un desafío recibido con la ficha del rival: ELO, probabilidades, cara a cara](docs/screenshots/scout.png) | ![Metas de entrenamiento junto al récord de la noche](docs/screenshots/goals.png) |
| ![Historial de rango y ELO](docs/screenshots/progress.png) | ![Análisis de partidas](docs/screenshots/analytics.png) |

**Lobbies privados** (nuevo en 2.14, mejorado en 3.0)
- Tu propio **lobby solo con invitación, como un servidor de Discord**: el **+** debajo de tus canales
  de juego crea uno o te une a uno con un código de invitación. Solo entra quien tenga el código y Fightcord.
- Un **chat que guarda el historial**, una **lista de miembros** (en línea, ausente, en una partida, en voz)
  con **Desafiar** (Fightcord los lleva a los dos al canal del juego del lobby) y una **sala de voz** para hasta 8.
- El dueño puede renombrar el lobby, cambiar el juego, crear un código de invitación nuevo o quitar a
  alguien (todos los demás reciben una clave nueva, así que esa persona no puede leer nada nuevo).
- **Nuevo en 3.0:**
  - **El aspecto de tu lobby:** una imagen o emoji, un banner y un color, una descripción y un mensaje de
    bienvenida que los nuevos miembros ven una vez.
  - **Moderadores** que pueden expulsar, silenciar y renombrar miembros, fijar mensajes y programar eventos.
  - **Reacciones, respuestas y mensajes fijados**: pasa el ratón por un mensaje para ver la barra.
  - **Eventos** con Voy / No puedo ir y un recordatorio antes de empezar.
  - **Una clasificación:** los sets entre miembros en el juego del lobby cuentan solos, y el primero es el
    Rey del lobby.

![Un lobby privado: canales y la sala de voz a la izquierda, el chat y la lista de miembros](docs/screenshots/lobby.png)

**Social**
- **Lista de amigos** con avisos de conexión / partida y un botón Ver, más **notas y etiquetas de
  jugadores**.
- **Feed del lobby:** entradas, partidas para ver, sorpresas y rachas de victorias en cada canal.
- **Recordatorios de eventos:** un aviso antes de que empiecen los torneos de Fightcade de tus juegos
  (o cualquier evento en el que toques la campanita), con un botón para abrir el canal.
- **Estado en Discord:** muestra tu juego, tu rival y el tiempo de partida en tu perfil de Discord.
- **Lobbies privados**, como un servidor de Discord: solo con invitación, con un chat que guarda el historial, lista de miembros con Desafiar, una sala de voz para hasta 8 y, desde 3.0, imagen y banner, moderadores, reacciones, respuestas, mensajes fijados, eventos y una clasificación.
- **Imágenes, GIFs, clips y audios en el chat** para quien usa Fightcord: pega, suelta o haz clic en +, marca GIFs como favoritos y vuelve a enviarlos con el botón GIF.
- **Mensajes con varias líneas:** Shift+Enter abre un cuadro de mensaje más alto, enviado como un solo mensaje que todos ven.
- **Bienvenida a nuevos jugadores con Fightcord:** una línea en tu chat cuando alguien en tu canal acaba de instalarlo.

> **¿En Fightcord 2.18 o anterior?** Las actualizaciones automáticas dejaron de funcionar a finales de octubre de 2026 (un cambio del lado de GitHub). Descarga y ejecuta [FightcordSetup.exe](https://github.com/JillTheStingray/fightcord/releases/latest/download/FightcordSetup.exe) una vez; desde la 2.19 las actualizaciones vuelven a llegar solas.
- **Perfiles** para quien usa Fightcord (estado, Sobre mí, banner, insignias) en tarjetas de perfil al estilo de Discord (3.2: banner con el arte del juego, estado en una burbuja, cuadro Mensaje a @nombre), una lista de miembros con el estado de cada jugador debajo del nombre, búsqueda, grupos plegables y desafío con un clic, y códigos para compartir tu configuración.
- **Música** en el lobby (trae tu propia pista; no viene ninguna incluida).

**Para streamers**
- **Modo streamer:** Ctrl+Shift+H difumina los nombres, avatares y el chat de los demás jugadores
  en pantalla, pone los desafíos en fila (uno a la vez, ninguno durante la partida) y silencia los
  avisos con nombres.
- **Overlay de OBS:** un marcador (tú vs tu rival, rangos, el marcador y el récord de la noche)
  para agregar en OBS como fuente de Navegador.

| | |
|---|---|
| ![Buscar partida: jugadores libres cerca de tu rango, con probabilidades y un botón Desafiar](docs/screenshots/findmatch.png) | ![Modo streamer: otros jugadores difuminados, desafíos en cola](docs/screenshots/streamer.png) |

<img src="docs/screenshots/feed.png" alt="El feed del lobby: sorpresas, rachas y partidas para ver" width="720">

<sub>Las capturas usan jugadores y conversaciones inventados (y muestran la versión en inglés).</sub>

Fightcord (y su instalador) habla **inglés, portugués de Brasil y español**. Sigue el idioma de
Windows, o elige uno en Configuración → Mi Fightcord → Idioma.

Todo se puede activar o desactivar: **Ctrl+,** abre la ventana de configuración (en 3.3, una ventana flotante sobre Fightcade; o escribe `/fightcord`, y
`/help` muestra todos los comandos del chat). Los perfiles **Ligero / Completo / Competitivo**
cambian grupos enteros de una vez.

## Privacidad

Fightcord no tiene servidor ni recolecta datos. Solo se comunica con:

| Qué | Dónde | Cuándo |
|---|---|---|
| Datos de jugadores, resultados, rankings | La propia API de Fightcade (`web.fightcade.com`) | fichas, estadísticas, el feed, historial de rango; los mismos pedidos que hace Fightcade |
| Traducción del chat | Google Translate (`translate.googleapis.com`) | mensajes recibidos que no están en tu idioma, mientras el traductor está activado (Configuración → Chat) |
| Vistas previas de enlaces | YouTube / X / Streamable / Twitch | cuando aparece un enlace suyo en el chat |
| Avatares, una fuente | Gravatar, Google Fonts | como lo hace Fightcade |
| Actualizaciones | este repositorio de GitHub | una vez al día |
| Estado en Discord | la app de Discord en tu PC | mientras el estado en Discord está activado |
| Overlay de OBS | una página en `127.0.0.1` que solo esta PC puede abrir | mientras el overlay está activado (Configuración → Modo streamer) |
| "Quién tiene Fightcord" | relays Nostr públicos y gratuitos (`relay.damus.io`, `nos.lol`, `relay.primal.net`) | mientras Fightcade está abierto, salvo que desactives "Mostrar que uso Fightcord": tu nombre de Fightcade, con hash, y si el chat de voz está activado, cada pocos minutos; los relays lo reenvían en vivo y no lo guardan; con "Compartir mi perfil" activado (por defecto), también tu estado, Sobre mí, juego del banner e insignias cuando otro jugador con Fightcord los pida; en tu primera semana después de instalarlo, también que eres nuevo en Fightcord ("Decirles a los jugadores con Fightcord que soy nuevo" lo desactiva) |
| Chat de voz | los mismos relays para el apretón de manos cifrado, luego directo a la PC de tu rival (STUN: Google / Cloudflare para encontrar la ruta) | solo durante un set, solo cuando ambos se unieron |
| Lobbies privados | relays Nostr públicos y gratuitos (`nos.lol`, `relay.primal.net`, `nostr.mom`, `offchain.pub`, `relay.damus.io`) | para los lobbies en los que estás, mientras Fightcade está abierto: mensajes, entradas, señales de "en línea", las imágenes y ajustes del lobby y los resultados de sets entre miembros (para la clasificación), todo cifrado con una clave que solo existe en el código de invitación. Los relays guardan los mensajes cifrados para que veas lo que te perdiste, pero no pueden leerlos. La sala de voz va directo entre las PC de los jugadores, como el chat de voz |
| Imágenes en el chat | envío: `catbox.moe`, o `uguu.se` cuando catbox está caído (allí los archivos se borran después de 3 horas); visualización: catbox, uguu, imgur, KLIPY, Tenor, Giphy, Discord; búsqueda de GIFs: `api.klipy.com` (`tenor.com` si KLIPY no responde) | lo que escribes en la búsqueda del botón GIF va a KLIPY (o Tenor) cuando dejas de escribir, con un id aleatorio de esta instalación que KLIPY pide; una imagen solo se sube cuando haces clic en Subir (pública para cualquiera con el enlace); las imágenes de esos sitios cargan cuando aparecen en el chat (o cuando haces clic en ellas, con "Desenfocar hasta hacer clic") |

La configuración, las notas, los amigos y el historial de partidas quedan en la carpeta de Fightcord
en tu PC (`<Fightcade>\fc2-electron\resources\app\inject\fightcord\`). Configuración → Copia de
seguridad lo guarda todo en un archivo.

## Juego limpio

Fightcord solo cambia lo que ves y donde haces clic en la app de Fightcade. Nunca toca el emulador,
la memoria del juego, los controles ni el netcode, y nunca juega partidas ni envía, acepta o rechaza
desafíos por su cuenta: los filtros de desafío solo rechazan los desafíos que tú les indicaste.

## Preguntas frecuentes

**Algo se ve roto después de una actualización de Fightcade.** Mantén **Shift** mientras Fightcade
inicia para abrirlo sin Fightcord (modo seguro), luego revisa Configuración → Diagnóstico, o abre un
issue con el texto de "Copiar información de depuración".

**¿Puedo usar solo una parte?** Sí: Configuración → Mi Fightcord activa y desactiva módulos uno por
uno, o elige el perfil Ligero.

**Encontré un error de traducción.** Las traducciones son nuevas — abre un issue o un pull request en
`src/i18n-es.js` (la app) o `installer/i18n.json` (el instalador).

## Compilarlo tú mismo

Mira la sección [Building it yourself](README.md#building-it-yourself) del README en inglés: Windows,
Node.js 18+ y PowerShell, y luego `powershell -ExecutionPolicy Bypass -File build.ps1`.

## Licencia

[MIT](LICENSE). Fightcade, Discord y los juegos que aparecen en Fightcade pertenecen a sus dueños.
