XB ADELAIDE — versão em pasta
=============================
Rodar: duplo clique em iniciar.bat (Windows) ou ./iniciar.sh (Linux/Mac). Abre o EDITOR em http://localhost:8080/editor/ — o jogo fica em http://localhost:8080/
(precisa de Python 3; alternativa: npx serve . ou qualquer servidor estático).
Não abre por duplo clique no index.html: o navegador bloqueia fetch/WebGL de arquivos locais (file://).

Estrutura
  index.html        marcação das telas (menu, HUD, resultado, pausa)
  css/style.css     visual
  js/loader.js      carrega data/*.json + assets/* e monta os objetos para o motor
  js/game.js        motor: WebGL2, física, IA, áudio, câmera, troféus
  data/*.json       metadados (grupos da pista, curvas de som, IA...) — campos {"$file"} apontam para assets/
  cars/             um carro por pasta (veja "Carros" abaixo)
  assets/track      malha da pista, 183 texturas .webp, céu, física, público, jumbotron
  assets/sounds     21 .wav (motor V8, pneus, impactos)
  assets/ui         HUD original (mostrador, ponteiro, dano...)
  assets/trophy     malhas e madeira dos troféus
  assets/fx         fumaça
  assets/peds       torcida: <tipo>.vb.bin/.ib.bin (malha reduzida), .anim.bin (animações assadas), <tipo>.webp (atlas), people.bin (espectadores)
  assets/trees      árvores 3D: oak.vb.bin/.ib.bin (casca + folhas), bark.jpg, leaf.webp, inst.bin (posição/escala de cada árvore)
  tools/build_trees.py  refaz a troca das árvores (precisa de Leaf_Oak.fbx + texturas); originais em _orig_trees/
  tools/build_peds.py   refaz a torcida a partir dos .dff/.txd + ped.ifp: python3 tools/build_peds.py <pasta> .   (usa tools/rwped.py e meshdecimate.py)

Árvores 3D (data/trees.json)
  As árvores-sprite da pista (413, pares de planos cruzados) foram removidas da malha e trocadas pelo carvalho Leaf_Oak, instanciado
  nos mesmos lugares (altura de cada uma segue a antiga). Folhas com recorte por alpha e balanço leve de vento.
  Ajustes: "far" (distância máxima de desenho, m), "sway":0 (sem balanço); escala/posição individuais em assets/trees/inst.bin.
  Os mapas normais (…nor.png/jpg) não são usados: o motor da pista não tem iluminação por pixel.

Torcida com IA (data/peds.json)
  Os sprites e a torcida 3D antiga foram removidos. Os espectadores (1858, posições gravadas em assets/peds/people.bin) agora são pedestres do GTA SA:
  andre, army, ballas1-3, bb, bbthin, bfori, bfost (DFF com pele + TXD), malha reduzida a ~2200 triângulos e animações do ped.ifp
  assadas a 12 quadros/s (assets/peds/*.anim.bin). Pele na GPU, mistura suave entre animações.
  Comportamento (a cada ~9 s cada um decide de novo, sempre igual para a mesma pessoa/horário):
    - sentados (os que estão sobre o assento astnd.dds, 654): SEAT_idle; às vezes conversando (SEAT_idle + IDLE_chat);
    - em pé: olhando a corrida (IDLE_stance / idlestance_old / IDLE_HBHB / IDLE_tired / woman_idlestance), conversando com o par mais
      próximo (olham um para o outro), ao telefone (phone_talk), coçando (XPRESSscratch);
    - o corpo gira para o carro mais próximo; quando um carro passa a menos de ~18 m eles torcem (handsup); os sentados levantam,
      torcem e sentam de novo (SEAT_up + handsup + SEAT_down).
  Só os mais próximos e visíveis são desenhados: "near" (m, padrão 75; 0 desliga), "cap" (máx. por quadro, padrão 140), "scale".
  Mais pedestres/animações: ponha os .dff/.txd na pasta e rode tools/build_peds.py (lista TYPES e CLIPS no começo do script).

Grama (data/grass.json)
  Modelos do GTA SA (grass*_*.dff + plant1.dff, texturas do plant1.txd, camadas do plants.dat) espalhados SÓ sobre o chão da pista que usa a textura gras.dds
  (816 triângulos, ~600 mil m²; paredes/taludes íngremes ficam de fora). Perto de asfalto/muros há uma margem sem grama ("edge", m) e as plantas encolhem ao chegar nela.
  As plantas não ficam gravadas em arquivo: são geradas por célula de 16 m, sempre nos mesmos lugares, só até "far" metros da câmera (alpha-test, balanço de vento, névoa e brilho iguais ao resto da pista).
  Camadas = linhas de plants.dat (GRASS_SHORT_LUSH, GRASS_MEDIUM_LUSH, GRASS_LONG_LUSH) + 3 extras esparsos (grass0_2, grass0_3, plant1). Cada camada: modelo, textura, cor RGB, intensidade, escala XY/Z (+variação), vento, densidade.
  Ajustes em data/grass.json: "far" (padrão 42 m; 0 desliga), "densMul" (densidade geral), "cap" (máx. plantas por camada), "scale", "edge", "sway":0 (sem vento), "adaptive":0 (desliga a qualidade automática, que baixa a quantidade se o FPS cair).
  Regenerar a partir dos arquivos originais: python3 tools/build_grass.py <pasta com .dff/.txd/plants.dat> .
  grass2_*/grass3_* e outras superfícies do plants.dat (areia, mato seco…) vêm embutidos em data/grass.json ("plantsDat") mas não são usados: nenhuma linha de grama da pista os referencia.

Céu (assets/skies/)
  Skybox do GTA (skybox.dff + skyboxes.txd) convertido para equirretangular 2048x1024: extrasunny_1 (padrão, azul limpo), sunny_1, cloudy_1, rainy_1, stars_1 (noite).
  O céu é também o reflexo de carros e troféus. Para trocar: em data/ext.json mude "sky" para {"$file":"assets/skies/<nome>.jpg"}.
  Refazer: python3 tools/build_skybox.py skybox.dff skyboxes.txd . [nome_padrão]   (o sky.jpg original continua em assets/track/)

Carros (pasta cars/)
  cars/cars.json    lista de carros e o carro inicial: {"default":"xb","cars":["xb","a9x"]}
  cars/xb/          Ford Falcon XB GT
  cars/a9x/         Holden Torana A9X (convertido do mod SLRR; originais em cars/a9x/_slrr/, não são usados pelo jogo)
  cars/<id>/car.json  tudo do carro: nome, física ("phys"), curva de torque ("torque"), pinturas ("skins"),
                    peças da malha ("objs") e arquivos (car.vb.bin / car.ib.bin / car.dd.bin, wheel.jpg, blur.png, skin_*.jpg, glass_*.png)
  cars/willard/     Willard Eudora (GTA SA, convertido do .dff/.txd/handling.cfg com tools/gta_car.py)
                    Refazer/ajustar: python3 tools/gta_car.py willard "Willard Eudora" Willard_Eudora.dff Willard_Eudora.txd Handling_cfg.txt [escala]
                    Malha em 6 peças (carroceria/pintura, para-choques, detalhes, cromados, faróis, vidros) + rodas e discos de borrão; só as peças "_ok" (sem dano)
                    4 pinturas (skin_*.jpg, atlas 2048²); rodas de wheel.jpg (N4SPEED_SA_Tyre); física vem do handling.cfg (massa, giro, vmax, nº de marchas,
                    entre-eixos) — curva de torque, marchas e relação final são ESTIMADAS: ajuste em cars/willard/car.json → "phys" / "torque"
  Para adicionar outro carro: crie cars/<id>/ com um car.json no mesmo formato e acrescente o <id> em cars/cars.json.
  O menu do jogo mostra o seletor "Carro" automaticamente; o editor (aba Modelos 3D) também lista cada carro.
  Nomes das peças: rodas MSH-FL/FR/BL/BR + Alloy|Tyre|Disc|Hub e <roda>_BAlloy (disco de borrão); o resto é carroceria.
  Peça com "tex":"gls" ou "gtx" é vidro (desenhada com transparência).
  Observação: os rivais usam o mesmo modelo do jogador; a IA segue o traçado de data/ext.json, independente do carro.
  A9X: malha, texturas e curva de torque vêm do mod; massa, marchas e relações são ESTIMADAS (o car.txt.enc do mod é
  criptografado). Ajuste em cars/a9x/car.json → "phys" e "torque.peakNm" (ou na aba Código / Dados do editor).

Como alterar sem mexer na estrutura
  - Trocar pintura/textura/som/ícone: substitua o arquivo em assets/ (ou cars/<id>/ para o carro) mantendo o nome.
  - Mexer em regras/física/IA/câmera: js/game.js.
  - Mexer em layout/cores: css/style.css e index.html.
  - Ajustar curvas de áudio, nomes de partes etc.: data/*.json.

EDITOR (pasta editor/) — v2
  Três formas de abrir (todas com as mesmas abas):
    1) iniciar.bat / iniciar.sh → http://localhost:8080/editor/ (serve.py; grava direto no disco, com backup em _backup/)
    2) Duplo clique em editor/index.html (file://) → "Abrir pasta do jogo…" (Chrome/Edge: lê e grava direto na pasta, sem servidor)
    3) Qualquer navegador, file:// ou localhost → "Abrir .zip" ou "Abrir pasta pelo navegador": edita na memória; use "Exportar .zip"
       (ou "Exportar só alterados" na aba Arquivos) e extraia por cima da pasta do jogo.
  Arquivos     explorador de TUDO do projeto: prévia (imagem/DDS/áudio/texto/hex), enviar, substituir, renomear, duplicar, excluir, versões,
               importar/exportar .zip e "Verificar projeto" (referências quebradas, índices fora do limite, tamanhos de textura, colisão).
  Texturas     pincel macio, borracha, balde, linha/retângulo/elipse, carimbo, pintura em mosaico, ajustes de cor, inverter/cinza/suavizar/nitidez,
               deslocar, cor→transparente, redimensionar, ver só alfa, desfazer/refazer, DDS (leitura → salvar como PNG), salva no formato original.
  Modelos 3D   carros, pista, troféus: mover/girar/escalar, espelhar, inverter faces, excluir, duplicar, renomear, material do carro, primitivas
               (caixa/plano/cilindro/rampa), importar/exportar OBJ, malha (wireframe), "Tornar sólida" (copia a peça para a colisão).
  Colisão      NOVO: edita assets/track/phy.*. Vê chão por superfície + paredes sobre a pista visual; seleciona (triângulo, pincel, conectados);
               troca superfície (asfalto/grama/cascalho/zebra), exclui, move, nivela, suaviza, adiciona chão/caixa/parede/rampa, importa/exporta OBJ,
               regenera a partir da pista visual.
  Traçado      linha da IA: pontos, larguras, velocidade máxima por ponto, suavizar, largura global, camada de colisão no mapa.
  Sons         onda, cortar, ganho, normalizar, fades, inverter, mono, cortar silêncio, loop contínuo (crossfade), velocidade, 22/44 kHz,
               importar som novo (registra em snd.json), desfazer, versões.
  Configurações NOVO: carros (física, marchas, curva de torque arrastável, pinturas, novo carro/excluir/ordem/padrão), som (curvas de volume/tom
               de cada camada), regras do jogo (voltas, rivais, IA, aderência, gravidade, downforce, dano… editados dentro de js/game.js),
               troféus (cores) e pista/ambiente.
  Código       números de linha, localizar/trocar, busca e troca em todos os arquivos, verificação de sintaxe JSON/JS, versões.
  Jogo         prévia do jogo dentro do editor, lendo os arquivos do projeto (funciona também em file:// e no modo memória).
  Atalhos      Ctrl+S salva a aba atual · Ctrl+Z/Ctrl+Shift+Z desfaz/refaz (texturas, colisão) · [ ] muda o tamanho do pincel.
  Limites      cada malha aceita até 65535 vértices; Modelos 3D não altera a colisão (use a aba Colisão ou "Tornar sólida").


== CASAS DO GTA SA (substituem os prédios da pista) ==
Os prédios antigos (texturas bldng*, bckgnd*, roof*) foram removidos da malha da pista e trocados por 306 casas
instanciadas (5 modelos DFF + texturas dos TXD), colocadas nas mesmas pegadas e viradas para a rua mais próxima.
 - Gerar de novo:  python3 tools/build_houses.py <pasta com .dff e .txd> .   (opção --debug mapa.png)
   Idempotente: parte dos originais guardados em _orig_buildings/ (pista, árvores, torcida).
   Para trocar as casas, basta apontar outra pasta de DFF/TXD. Texturas ausentes nos TXD usam reboco (tex_1559_0).
 - Ajustes em data/houses.json: "far" (distância máxima de desenho, m) e "light" (brilho).
 - Árvores (15) e pedestres (4) que ficariam dentro de casas foram removidos/deslocados.
 - Mantidos: arquibancadas, boxes, tendas e janelas (cwin) — são infraestrutura da corrida, não prédios.
 - Atenção: tools/build_trees.py parte de _orig_trees (que ainda tem os prédios); rode build_houses.py depois dele.
 - A colisão (.phy) não mudou: as paredes invisíveis continuam onde estavam os prédios.

== CORREÇÕES GRÁFICAS (v3.1) ==
 - Sombras: o grupo tshado1 tinha 338 triângulos inclinados e 115 gigantes (faixas de sombra esticadas no céu) e um grupo
   mal categorizado como opaco (triângulo preto sólido). Foram removidos, junto com as sombras no chão dos prédios que sumiram
   (build_houses.py faz isso a partir dos originais em _orig_buildings/). Cada casa ganhou uma sombra de contato (shado1).
 - logotiss.dds e logo02.dds estavam pretas (painéis pretos no pórtico/passarelas dos boxes): tools/fix_logotiss.py gera painéis "ADELAIDE".

ARQUIBANCADAS E BOXES (v3.2)
 - As arquibancadas antigas (astnd/stand/grnstnd + degraus) e o prédio branco sem textura dos boxes da largada
   (inwall/cwin/pitfrnt/gantry/tents...) foram removidos da malha da pista. Espectadores que estavam sentados nelas também.
 - No lugar das arquibancadas foi colocado o modelo des_ruin3_ (+ cxref_desert.txd), 34 instâncias, via data/houses.json.
 - Gerar de novo (depois de build_houses.py):  python3 tools/build_stands.py des_ruin3_.dff cxref_desert.txd .
   (originais do estado "pós-casas" ficam em _orig_stands/). A textura 00000000 do modelo não existe no TXD e usa reboco liso.
 - Os modelos de pessoas/objetos enviados (bella1, DIEGO, DRSAL, ESTEBAN, JOSE, beachball, FLOWERA, Golfclub) ainda NÃO foram usados.

AUDITORIA DE RESTOS E TEXTURAS (v3.3)
 - Removidos também: cercas laranja/marrons das arquibancadas (bar01/02/03), tendas/bases coladas nelas, coberturas de lona (canvs*) e
   marcas/pontes soltas que ficavam sobre os boxes, sombras "baked" órfãs (arquibancadas e prédio dos boxes),
   espectadores e árvores que caíam dentro das ruínas novas.
 - Modelo des_ruin3_: as duas texturas só de sombra (a2280388, acaeb1b8: preto + alfa) estavam virando ~1700 triângulos pretos; foram descartadas.
   As ruínas agora assentam na altura real do chão (não mais na da arquibancada).
 - tools/fix_textures.py recria texturas que vieram pretas/transparentes/estouradas: conht (concreto), ptmarsh e roadi (tinta branca), tents (lona).
 - Ordem para refazer tudo: build_trees.py -> build_houses.py -> build_stands.py -> build_lod.py -> fix_textures.py

PEDESTRES LIVRES + MENOS RUÍNAS (v3.4)
 - Ruínas des_ruin3_: agora 12 (uma a cada ~60 m onde havia arquibancada), antes 34.
 - Torcida: ninguém mais fica sentado/no ar. Quem estava nas arquibancadas foi tirado (os que caíam sem chão embaixo) ou posto de pé
   na altura exata do chão (mapa de triângulos caminháveis). Pares de conversa foram reindexados (antes quebravam).
 - Andar livre: ~470 pedestres sem par vagueiam por trajetos de 4 pontos (assets/peds/walk.bin) só sobre relva/piso livre:
   nunca entram na pista (corredor da linha de corrida + 6 m), em cercas/muros, casas/ruínas ou árvores. A posição é função do tempo (sem custo
   extra) e eles se afastam de carros a menos de 7 m. Caminhada = balanço de pernas e braços feito no shader sobre a pose parada.
 - Ordem: build_trees.py -> build_houses.py -> build_stands.py -> build_lod.py -> fix_textures.py

DESEMPENHO — 60 FPS (v3.5)
 - Gargalo medido: geometria (~829 mil triângulos e ~346 draws por quadro). Agora ~330 mil (casas 389k -> 37k, pedestres 130k -> 25k, árvores 113k -> 70k).
 - LOD de casas e pedestres (tools/build_lod.py, roda DEPOIS de build_stands.py): 3 níveis por clustering de vértices, sem vértices novos.
   Casas: LOD0 < 150 m, LOD1 (28%) < 420 m, LOD2 (8%) além. Pedestres: 22 m / 50 m (30% / 9%). Dados em houses.json (models[].lod) e peds.json (lib/nli).
 - Frustum culling (esferas) em casas, árvores e pedestres: nada fora do campo de visão é enviado à GPU.
 - Governador automático de qualidade: mede o tempo de quadro a cada 1 s. Se passar de ~19,5 ms por 2 s seguidas, desce um nível; se ficar
   estável (<17,9 ms) por ~12 s, sobe. Níveis 0 (máx.) a 4: escala de resolução 1,0 -> 0,6, pedestres 140 -> 30, casas 1100 -> 450 m, árvores 520 -> 200 m, grama.
   Celular (toque) começa no nível 2, sem MSAA, anisotropia 4x e DPR máx. 1,5. O nível fica salvo no navegador (xbadl:q).
 - Menu: "Gráficos" Auto / Alto / Médio / Baixo (Auto = governador). F3 ou ?fps na URL mostra FPS, nível, resolução e contagens.
 - Buffers de instância agora são fixos (bufferSubData, sem realocar por quadro).
 - Ordem: build_trees.py -> build_houses.py -> build_stands.py -> build_lod.py -> fix_textures.py

AUDITORIA DE LAYOUT (v3.6)
 - Verificado contra a malha real: casas, ruínas, pedestres e árvores. Achados: 158 casas em cima de asfalto/concreto (pátio do paddock), 10 atravessando
   mureta/cerca, 24 coladas em outra, 5 em terreno íngreme, 3 perto da linha de corrida; ruínas sobre a pista; 16+4 pedestres na pista; terreno com buracos
   (miolo do circuito e bordas dos bairros) -> casas "penduradas" no vazio.
 - tools/build_terrain.py: gera um terreno de grama (visual) que preenche os buracos e vai até além do horizonte, sempre abaixo da malha existente.
   Fica num grupo 'fill' de trk.json e é ignorado pela física/colisão.
 - tools/build_layout.py: remove o que não tem lugar na malha e baixa a base das casas ao chão real. Casas 318 -> 118, árvores 397 -> 330, pedestres 1417 -> 1388
   (e no máx. 12 por célula de 8x8 m; PEDCAP=n muda isso). Regras: sem asfalto/concreto/água sob a casa, sem mureta/cerca, >=11 m da linha de corrida (ruína 16 m),
   desnível < 1,8 m, 1,5 m de vão entre casas. Reexecutar não muda mais nada.
 - Carros conferidos: bitola, distância entre eixos e altura das rodas batem com a física dos 3 carros.
 - Ordem final: build_trees.py -> build_houses.py -> build_stands.py -> build_lod.py -> fix_textures.py -> build_terrain.py -> build_layout.py

PEDESTRES (v3.7)
 - População: 1388 -> 840 (620 parados + 220 andando). Máx. 6 por célula de 8x8 m; pares de conversa saem juntos.
   Ajustável em tools/build_layout.py por variáveis de ambiente: PEDCAP (por célula), PEDMAX (parados), WALKMAX (andando).
 - Comportamento: quem anda PARA quando um carro passa perto (<18 m), vira o corpo para o carro, torce e depois retoma a rota do ponto onde parou
   (o relógio da caminhada é congelado). Quem anda se afasta de carros num raio de 7 m (até 12 m em alta velocidade). Quem está parado dá um passo
   para trás se o carro chega a menos de 5 m. Todos olham o carro mais próximo; sentados limitam o giro.


Clima / névoa (data/timecyc.json + data/fog.json)
  A névoa vem do timecyc.dat do GTA SA (tools/timecyc/timecycp.dat; o timecyc.dat original também está lá). Para cada clima e 8 horários
  (0h 5h 6h 7h 12h 19h 20h 22h) o jogo lê: cor do horizonte/névoa (SkyBot), FogSt (onde a névoa começa; negativo = já no carro, gravado
  no .dat como 16 bits sem sinal: 65514 = -22) e FarClp (onde chega a 100%). Entre horários os valores são interpolados.
  Todos os shaders (pista, carros, torcida, árvores, casas, grama, mar, troféus) usam o mesmo bloco de uniformes "Fog"; o céu mistura com a cor da névoa perto do horizonte.
  Menu do jogo: botões Clima e Hora (salvos no navegador). URL: ?clima=FOGGY_SF&hora=12  ·  ?clima=classic volta à névoa fixa antiga.
  Padrão (CLOUDY_LA às 12h), botões e densidade: editor → Configurações → Clima / névoa (data/fog.json). Valores por horário: mesma tela (data/timecyc.json).
  python3 tools/build_timecyc.py regenera data/timecyc.json a partir do .dat (apaga edições feitas no editor).
  Limite: só a névoa e o horizonte mudam com o horário; céu (imagem) e iluminação continuam os do dia, então horas da noite ficam estranhas.


Torcida: mistura de pedestres (data/torcida.json, data/pedgrp.json)
  data/torcida.json → "mix": peso de cada um dos 9 tipos de espectador (0 = não aparece; todos 1 = distribuição uniforme). O sorteio é fixo por espectador.
  Editor → Configurações → Torcida: sliders de peso, atalhos de mistura, distância/limite/escala (data/peds.json) e consulta aos grupos do pedgrp.dat.
  data/pedgrp.json = grupos do GTA SA (tools/pedgrp/pedgrp.dat, regenerado por python3 tools/build_pedgrp.py). Só bfori e bfost existem como modelo;
  para usar outros grupos, converta os modelos (.dff/.txd) com tools/build_peds.py e acrescente os nomes em TYPES.


=== CAMINHÕES (Linerunner do GTA SA) ===
Os 18 cavalos mecânicos da área dos boxes agora são o Linerunner (linerun.dff/.txd), desenhados pelo mesmo sistema instanciado das casas
(3 níveis de detalhe; ~9 mil triângulos de perto). Os reboques antigos (tral*) continuam.
 - Arquivos: assets/trucks/*, data/trucks.json ("far" distância máxima, "light" brilho, "l1"/"l2" distâncias dos LODs), posições em assets/trucks/inst.bin.
 - Refazer: python3 tools/build_trucks.py linerun.dff linerun.txd . [--scale 1.15]   (parte sempre de _orig_trucks/, não perde a pista original).
 - Se rodar tools/build_houses.py de novo, rode build_trucks.py depois (build_houses traz de volta os caminhões antigos).
 - Para voltar aos caminhões antigos: apague data/trucks.json e copie _orig_trucks/* para data/ e assets/track/.


=== APP NO NAVEGADOR / TELA CHEIA ===
O jogo agora é um PWA (funciona como app nativo):
 - Botão ⛶ no canto superior direito ou tecla F: tela cheia (no celular o primeiro toque já entra em tela cheia e trava em paisagem).
 - Instalar: Chrome/Edge/Android mostram o botão "⤓ Instalar" (ou menu ⋮ → Instalar app). O app instalado abre em tela cheia, sem barra do navegador, com ícone próprio.
 - iPhone/iPad (Safari não tem tela cheia por botão): Compartilhar → "Adicionar à Tela de Início"; abre em tela cheia.
 - Offline: depois da 1ª visita o jogo abre sem internet (sw.js, rede primeiro: sempre usa a versão nova quando online).
 - A instalação e o modo offline exigem https:// ou http://localhost (iniciar.bat/.sh servem em localhost). Para publicar: qualquer hospedagem https (GitHub Pages, Netlify…).
 - Arquivos: manifest.webmanifest, sw.js, js/pwa.js, assets/pwa/*. A tela fica ligada durante o jogo (Wake Lock).


=== VISUAL "PREMIUM" (v3_25) ===
 - css/premium.css: camada de acabamento por cima de css/style.css (vidro fosco, realce laranja, velocímetro com aro, botões de toque novos com ícones, vibração curta ao tocar).
 - Controles de toque: volante (‹ ›) à esquerda, freio e acelerador à direita; o velocímetro fica ao lado dos pedais; o botão ⛶ sai de cima do minimapa durante a corrida.
 - Para voltar ao visual antigo: apague a linha <link> de premium.css em index.html.


=== CORREÇÕES DE TEXTURA (v3_27) ===
 - Pedestres: no gráfico Baixo/Médio apareciam como "bolhas marrons" (LOD muito grosseiro e trocado cedo demais). LODs refeitos (50% e 20% dos triângulos) e a troca de LOD agora nunca acontece abaixo de 16 m / 37 m (tools/build_lod.py).
 - Caminhões: sombreado assado (topo claro, laterais mais escuras, sem o branco estourado) e vidros azul-grafite em vez de preto chapado (tools/build_trucks.py).
 - Chão de grama (gras.dds): menos contraste, para não parecer "camuflagem" ao lado do gramado 3D.
 - Celular: a resolução interna nunca fica abaixo de 75% (antes 60% no Baixo, o que deixava cercas e placas serrilhadas).


=== PLACAS FLUTUANDO (v3_28) ===
 - As placas ADELAIDE/Jumbo tinham perdido os pés e armações numa etapa antiga e ficavam no ar. tools/fix_billboards.py devolve os pés (signbase/bar04 de _orig_sea) e põe dois pilares nos telões altos que nunca tiveram suporte.
 - Ordem se for refazer: build_houses.py → fix_billboards.py → build_trucks.py.

== v3_29: lajes de pista flutuando ==
tools/clean_floating.py remove 304 triangulos de pista (roada/road1/roadf/roadc) soltos no campo, sem ligacao com o circuito
(pedacos de ate 6 triangulos a mais de 8 m da linha da IA). Roda sobre _orig_trucks/, depois build_trucks.py.
Ordem: fix_billboards.py -> clean_floating.py -> build_trucks.py ../lr/linerun.dff ../lr/linerun.txd .

== v3_30: itens na pista (Nitro e Chave) ==
8 itens espalhados pela volta (5 nitro azul, 3 chave verde), em faixas diferentes. Passar por cima pega:
- NITRO: ~3,5 s de aceleração extra (empilha até 7 s), chamas azuis no escape, barra "NITRO" no topo.
- CHAVE: conserta o carro (zera dano, amassados, fumaça/fogo e o risco de explosão).
O item some e volta após 22 s. Aparecem também no minimapa (azul = nitro, verde = chave).
Ajustes: js/game.js, seção "12b. Itens na pista" (PICK_DEF = fração da volta, tipo, lado; boost em stepCar; tempo de volta em k.re).

== v3_31: correções dos itens ==
- drawPickups deixava o BLEND desligado e o CULL_FACE desligado: fumaça/partículas saíam sem transparência (quadrados). Agora o estado é preservado.
- Barra de nitro mexia no elemento errado (texto "NITRO" sobreposto). Corrigido.

== v3_32: pedestres andando de verdade (exemplo motor3d) ==
Antes: quem andava usava a pose parada com pernas/braços balançando por fórmula no shader (rígido).
Agora: tools/bake_walk.py assa os ciclos reais do ped.ifp (WALK_civi homens, WOMAN_walknorm mulheres) nas animações (clipes walkM/walkF).
O motor3d só tinha o André; os outros 8 tipos recebem o ciclo por retarget (erro medido 1-5 cm; "bb" ≈ 15 cm, o mais aproximado).
Fase do passo = distância percorrida / passada (sem patinar no chão); ao partir/parar mistura com a pose parada.
Para melhorar o retarget (bb) basta ter os .dff/.txd dos outros tipos: rode build_peds.py de novo com eles.
Uso: python3 tools/bake_walk.py <pasta com andre.dff + ped.ifp> .

== v3_33: modo "Observar a pé" ==
Menu → Modo "Observar a pé" → escolha o pedestre (André, Soldado, Ballas 1-3, Robusto, Magro, Mulher 1-2) → Largar.
Você vira um pedestre andando pelo mapa (nasce no box, perto da largada) enquanto os carros correm sozinhos (o carro do "jogador" também vira piloto automático).
- WASD/setas: andar e girar · Shift: correr (no toque, corre sozinho depois de ~1,4 s andando) · C: câmera (atrás do pedestre / 1ª pessoa / acompanhar o carro) · R: volta ao ponto inicial.
- Caminhada e corrida usam os ciclos reais do ped.ifp (tools/bake_walk.py agora também assa run_civi / woman_run).
- Colisão: não atravessa muros, não entra na água nem sobe degraus altos. Carro em velocidade que acertar você = volta ao ponto de partida.
- O som dos carros vem de longe: o volume depende da distância ao carro mais próximo. Itens de nitro/chave e troféus ficam desligados nesse modo.
- Código: js/game.js, seção "12c. Modo Observar a pé".

== v3_34: modo a pé — corrida normal, todos os carros em IA ==
- O carro que seria do jogador agora é uma IA de verdade (mesma lógica dos rivais: faixa, ultrapassagem, erros ocasionais), não mais um piloto automático de teste que batia e explodia.
- A corrida roda normal até TODOS os carros terminarem; aí aparece "Corrida encerrada" e o resultado (sem troféu). Você continua andando durante a corrida.
- O pedestre alcança praticamente o mapa todo (teste de alcance por busca em área: ~630 mil m² a partir do box, inclusive a pista pelas aberturas dos muros; só mar e água ficam de fora).

== v3_35 ==
- Menu: o campo "Pedestre" aparecia vazio (rótulo solto) fora do modo a pé; agora some de verdade.
- Botões de toque dizem "Andar / Ré" no modo a pé.

== v3_36: pedestre a pé — correções ==
- Caminhada real só nos tipos em que o retarget ficou bom (André, Soldado, Ballas 1-3). bb, bbthin, bfori e bfost deformavam (cabeça solta do corpo, braço esticado):
  voltam ao balanço antigo, tanto para você quanto para os pedestres da torcida, até termos os .dff deles (WALKOK em js/game.js).
- Colisão com cenário: troncos de árvores (2.916), casas e caminhões (136 caixas giradas) agora bloqueiam o pedestre (data/colliders.json, gerado por tools/build_colliders.py a partir da geometria real dos modelos).
  Postes de luz, placas e cercas ainda não têm colisão própria (a cerca e os muros já bloqueavam).

== v3_37 ==
- Cercas, grades e folhas de árvore/palmeira (texturas com transparência) deixavam de virar grade e viravam "pontinhos brancos"
  à distância (o mipmap apagava o alfa). Agora o recorte de alfa preserva a cobertura por nível de mipmap (função acov)
  nos shaders da pista, árvores 3D, árvores billboard e vegetação. Cercas ficam inteiras e árvores mais cheias.
- Varredura de 24 pontos da pista (modo corrida) e passeio em modo pedestre: sem erros de console / HTTP.

== v3_38 — só a vwfyst1 ==
- Todos os pedestres antigos (andre, army, ballas1-3, bb, bbthin, bfori, bfost) foram removidos. Só existe a vwfyst1
  (vwfyst1.dff + .txd + ped.ifp enviados): torcida inteira (840 espectadores, 220 caminhantes) e pedestre controlável.
- Esqueleto nativo (32 ossos): anda (WOMAN_walknorm), corre (woman_run) e todos os clipes (parada, conversa, telefone, torcida, coçar)
  direto do ped.ifp, sem retarget. Escala 0.92 (peds.json 'scale'). Modo "Observar a pé" não mostra mais seletor de pedestre.
- Reconstruir: PED_TYPES=vwfyst1 python3 tools/build_peds.py <pasta com vwfyst1.dff/.txd/ped.ifp> . ; depois python3 tools/build_lod.py .
  (restaure 'walk' em data/peds.json se o build_peds sobrescrever). tools/bake_walk.py (retarget do André) ficou obsoleto.

== v3_39 — Eudora (Willard) com o handling.cfg original do GTA SA ==
- cars/willard/car.json "phys": massa 2500 -> 1800 kg, giro (Iz) 4750 -> 4350, 5 -> 4 marchas, relação final 4.17 -> 4.69 (vmax 160 km/h),
  conforme a linha WILLARD do handling.cfg do data.zip. Medido no jogo, acelerador a fundo: 0-100 km/h 20,6 s -> 4,7 s.
- Para voltar ao anterior, use "m":2500,"Iz":4750,"gear":[0,3,2.5,2,1.5,1],"fin":4.17.
- O vehicles.col enviado só contém o "airtrain" (nenhum carro jogável): a caixa de colisão da Eudora segue a estimada (hw/hl em car.json).

== v3_40 — pinturas oficiais da Eudora (carcols.dat) ==
- cars/willard: +8 pinturas do GTA SA, as da linha "willard" do carcols.dat (índices 37, 42, 53, 62, 7, 10, 11, 15):
  Verde escuro, Granada, Azul surf, Vinho, Azul vivo, Azul saxony, Azul concord, Prata pedra (skin_sa*.jpg, gerados da skin Prata
  com a cor da tabela "col" do carcols.dat). Total 12 pinturas. Para outra cor: copie um skin_sa*.jpg trocando a cor e acrescente em car.json "skins".

== v3_41 — sistema do GTA SA na física, na hora do dia e no dano ==
- Handling (cars/<id>/car.json → "sa", lido em stepCar/settle/addDmg): tm tractionMultiplier (grip; Eudora .70 = referência, os outros em proporção),
  tl tractionLoss (patinando perde aderência lateral), tb tractionBias (grip dianteiro/traseiro), bd brakeDecel e bb brakeBias (freio),
  abs (sem ABS, frente travada perde aderência lateral), lock steeringLock (graus), drag dragMult, comZ altura do centro de massa (transferência
  de peso), inert engineInertia (resposta do giro), susF/susD/anti suspensão (rolagem/arfagem), cdm collisionDamageMultiplier (dano das batidas).
  Eudora = linha WILLARD do handling.cfg. Falcon XB e Torana A9X NÃO existem no SA: usei BUCCANEE e SABRE como estimativa ("src" no json) — edite à vontade.
  Massa, marchas e torque desses dois continuam os do mod (não foram trocados). Medido: 0-100 km/h Falcon 4,8 s, Torana 4,3 s, Eudora 4,7 s;
  100 → 15 km/h: 35 m, 35 m e 49 m.
- Hora do dia: a luz acompanha o horário (noite 30 %, amanhecer/entardecer baixos, dia 100 %), botão "Noite" (22 h) e "Ciclo" (a hora avança
  sozinha, 1 h a cada 40 s). Cor do céu/névoa continua vindo do timecyc.dat. URL: ?clima=EXTRASUNNY_LA&hora=22.
- Pedestres: a torcida já reage como no SA (desvia de carros, olha, torce, conversa em dupla); nada a mudar. Não há tráfego de carros: a pista é um
  circuito fechado de corrida e os nós (paths/NODES*.DAT) são do mapa do SA, não da Adelaide.
- peds.col não foi usado (a leitura das esferas de colisão não bateu com o formato esperado).

== v3_42 — personalidades da IA ==
Cada rival tem a sua (tabela PERS em js/game.js, pelo nome; edite os números à vontade):
  Marlow    Esperto             ritmo 1.00, quase não erra, olha longe, aproveita o vácuo, ultrapassa limpo
  Kowalski  Malandro            fecha a porta de quem vem atrás, empurra quem está ao lado, dá freada de fiscal (a cada ≥6 s); aparece "Kowalski (Malandro) te fechou!"
  Tran      Medroso             o mais lento (0.935), freia cedo nas curvas, sai da frente de quem vem atrás, perde mais ritmo após batida
  Okafor    Rapidinho           o mais rápido (1.045), freia tarde, olha pouco à frente (encosta na traseira), erra mais e maior
  Reyes     Quer dar de esperto tenta ultrapassagens arriscadas por dentro (às vezes passa do ponto e sai largo) e faz zigue-zague de exibido nas retas
  Lindqvist Regular             ritmo médio, cede um pouco
A tela de resultado mostra a personalidade de cada rival. O nível (Fácil/Normal/Difícil) continua escalando o ritmo base.
Medido numa corrida só de IAs (1 volta): Marlow 1º com 2 erros; Okafor 2º com 9 erros e 10 ultrapassagens arriscadas; Tran por último.

== v3_43 — a pedestre entra e sai do carro ==
- Modo Piloto: a corrida começa com a pedestre (vwfyst1, única) a pé ao lado do carro. Vá até a porta (botão laranja "Entrar no carro" / tecla E; no celular, toque no botão)
  e ela entra; só então a contagem regressiva começa. Os rivais esperam no grid.
- Durante a corrida, com o carro quase parado (< 25 km/h), E / botão "Sair do carro" faz ela descer. O carro fica parado com o freio de mão (os rivais passam por ele)
  e ela anda/corre pela pista (WASD, Shift). Perto da porta, E volta a entrar. R leva ela de volta à porta do carro.
- Atropelamento: um carro em movimento (> 11 km/h) que a atingir mata: sangue, corpo caído de bruços e a tela "Você morreu" (Tentar de novo / Voltar ao menu).
  O carro dela parado NÃO a mata. Se todos os rivais terminarem e ela estiver a pé, a corrida encerra e mostra o resultado.
- "Observar a pé" continua igual (todos os carros em IA, atropelada volta ao ponto inicial).
- Para testes/automação: adicione ?semembarque à URL para pular o embarque.
- Novo no shader de pedestres: a_i3.z > 0 deita o corpo (usado na morte).

== v3_44 · Fase 1 do pacote "AAA": pós-processamento ==
- Novo pipeline (js/game.js, seção 9b): cena em framebuffer HDR (RGBA16F quando a GPU permite) com MSAA 4x, resolvido para textura.
- Bloom controlado (só realces acima de ~0,8), tone mapping de ombro suave, vinheta leve, grão anti-banding.
- SSAO (só Ultra): por profundidade, em meia resolução, com desfoque que respeita bordas.
- Níveis: Ultra = tier 0 (MSAA+bloom+SSAO), Alto = tier 1 (MSAA+bloom), Médio/Baixo = caminho antigo, sem custo extra. Celular (COARSE) não usa pós.
- Botão "Ultra" adicionado em Qualidade; Alto passou a ser o tier 1. O modo Auto continua a governar o FPS e desce de nível se cair.
- NÃO feito ainda: sombras PCF por shadow map, faróis/lanternas funcionais, câmera/áudio novos, minimapa/UI nova.
- Testado só em swiftshader (sem erros de shader/console); desempenho real em GPU não medido.

== v3_45 · Sombras reais dos carros + faróis funcionais ==
- Sombra por mapa de profundidade do sol (2048², PCF 3x3 + filtro de hardware), centrada no jogador e presa aos texels (não treme). Projeta carros na pista e nos outros carros (auto-sombra). Só em Ultra/Alto, fora do celular. Não cobre casas/árvores/grama ainda.
- Faróis: à noite (hora<~19:30 / modo Noite/Ciclo) cada um dos 4 carros mais próximos ilumina o asfalto com um cone; lentes dos faróis brilham.
- Lanternas: brilho fraco sempre, mais forte à noite e luz de freio forte ao frear.
- Console limpo nos testes (swiftshader). Desempenho real em GPU não medido.

== v3_46 · Câmera e áudio espacial ==
- Câmera: vibração leve que cresce com a velocidade (acima de ~110 km/h), tranco curto em batidas fortes e abertura suave de FOV (batida; nitro se existir). Não atua no menu, troféu, a pé, espectador ou pausa.
- Áudio: cada rival tem motor 3D (posição, atenuação por distância, pan estéreo conforme a câmera, Doppler simulado pela velocidade relativa). Vento que sobe com a velocidade e fundo urbano discreto. O motor do jogador, pneus, batidas e trocas de marcha seguem pelas amostras já existentes.
- Testado: sem erros de console, nós de áudio criados (5 rivais + vento). NÃO foi possível ouvir o resultado nem sentir a câmera aqui: ajuste os volumes (rivalAudio) e a amplitude (camFX) a gosto.

== v3_47 · Opções de efeitos no menu ==
- Nova linha "Efeitos": Sombras (liga/desliga a sombra por mapa de profundidade) e Câmera viva/Parada (liga/desliga vibração, tranco e abertura de FOV). Salvo em localStorage (xbadl:o:shadow / xbadl:o:shake).
- Já existiam e foram mantidos: minimapa, diagrama de dano por peça, HUD com conta-giros, controles de toque, teclado e gamepad, seletor de carro e de gráficos (Auto/Ultra/Alto/Médio/Baixo).

== v3_49 · Pedestre desativado + modo "Câmera livre" ==
- Pedestre jogável DESATIVADO (const PED_ON=false em js/game.js): sem embarque antes da corrida, sem descer do carro, sem andar. A corrida começa direto no carro. A torcida 3D da pista continua. Para reativar: PED_ON=true (e recolocar o botão "Observar a pé" em index.html).
- Menu "Modo": Piloto | Câmera livre. Na câmera livre todos os 6 carros correm sozinhos (IA) e você voa pela pista:
  W/A/S/D move · Q/E desce/sobe · setas ou arrastar o mouse = olhar · Shift = rápido · roda do mouse = velocidade · R volta à posição inicial · C alterna livre / 1ª pessoa / espectador · P pausa. Gamepad: analógicos + gatilhos para subir/descer.
- No modo livre, o som é todo espacial (inclusive o carro da vaga do jogador) e sem vibração de câmera.
- Toque (celular): arrastar com o dedo olha; o movimento por toque NÃO foi implementado (use teclado/gamepad).

== v3_50 · Todos os pedestres desativados ==
- const CROWD_ON=false em js/game.js: a torcida 3D não é mais atualizada nem desenhada. Junto com PED_ON=false (v3_49) não há nenhum pedestre no jogo. Para reativar a torcida: CROWD_ON=true.
