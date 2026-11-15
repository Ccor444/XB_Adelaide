# Relatório — evolução gráfica e de jogo (v3_44 → v3_47)

## Auditoria do motor (antes)
Já existiam: instancing, LOD, frustum culling, anisotropia, reflexo do céu nos carros, deformação de amassados, sombra em mancha, partículas, 5 níveis de qualidade com governador automático, minimapa, diagrama de dano, toque/teclado/gamepad, áudio por amostras.
Não existiam: framebuffer de pós-processamento, SSAO, bloom, tone mapping, sombras por mapa de profundidade, faróis funcionais, câmera com resposta, som 3D dos rivais.

## O que foi feito
| Versão | Mudança | Onde |
|---|---|---|
| 3_44 | Pós-processamento HDR (RGBA16F se a GPU deixa) + MSAA 4x, bloom controlado, tone mapping de ombro suave, vinheta, grão; SSAO só no Ultra; botão Ultra | js/game.js seção 9b, index.html |
| 3_45 | Sombra dos carros por shadow map (2048², PCF) na pista e nos carros; cone de faróis no asfalto à noite; brilho de faróis e lanternas; luz de freio | seção 9c, shaders trkP/carP |
| 3_46 | Vibração de câmera por velocidade, tranco em batidas, FOV; motores 3D dos rivais com Doppler; vento e ambiente | camFX, rivalAudio |
| 3_47 | Opções Sombras e Câmera viva no menu | index.html, game.js |

Níveis: Ultra = MSAA+bloom+SSAO+sombras; Alto = MSAA+bloom+sombras; Médio/Baixo = caminho antigo sem custo extra; celular não usa pós nem sombras.

## Verificação
Playwright + swiftshader: console sem erros de shader/GL nos 4 níveis, dia e noite; comparação antes/depois em ANTES_DEPOIS.png (v3_43 em cima, v3_47 Ultra embaixo, mesma cena).

## Limitações (não declarar como feito)
- Desempenho real em GPU/celular NÃO medido (swiftshader não representa).
- Som e sensação da câmera não foram ouvidos/sentidos; volumes/amplitudes são ajustáveis (rivalAudio, camFX).
- Sombra por mapa só de carros, num raio de ~20 m do jogador; casas, árvores e grama não projetam nem recebem.
- Não feito: oclusão por occlusion culling, resolução dinâmica contínua, interior 3D de cockpit, sombras PCF de cenário, GI aproximado, trânsito de carros, reflexos em tempo real (os carros seguem com reflexo do céu).
