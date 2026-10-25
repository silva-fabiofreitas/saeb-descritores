# Descritores — painel Saeb 2023

Painel público com o percentual de acerto por descritor do Saeb 2023 (5º ano), para municípios, estados e Brasil. Público: secretarias de educação, coordenações pedagógicas e professores.

## Design system

Fonte de verdade para cores, fontes, espaçamentos e gráficos:
**Descritores (v2 · azul petróleo)** — https://claude.ai/artifact/8qtdQuy5DWQH4Vnu17E6RP

- Antes de mexer em cores, tipografia, componentes ou gráficos, leia o `project/README.md` e o `project/tokens.json` desse design system.
- Se o código e o design system divergirem, siga o design system e avise.
- Não invente cores novas. Use as variáveis CSS de `assets/css/style.css`. Se faltar um token, proponha a inclusão no design system em vez de usar um hex solto.

## Onde ficam as coisas

- `assets/css/style.css` — variáveis CSS (tokens) e estilos.
- `assets/js/app.js` — lógica do painel; escalas `seq-*` e `div-*` em `paletas()`.
- `assets/brand/` — arquivos da logo (SVG).

## Regras visuais essenciais

- **Cor da marca:** azul petróleo `--s-mun` (#0e5a73). Usada só em filtros ativos, no cartão do município, na série Município, em valores positivos e em links.
- **Cabeçalho:** fundo `--header` (#0b3340), texto branco; logo sempre na versão negativa.
- **Séries (ordem fixa, cor e forma):** Município = círculo petróleo 16 px; Estado = losango laranja `--s-rj` 10 px; Brasil = círculo cinza `--s-br` 12 px. Bolha vazada = menos de 30 respostas.
- **Acima/abaixo:** ▲ em petróleo, ▼ em ferrugem `--bad`. Nunca verde/vermelho, nunca só a cor sem o símbolo.
- **Fonte:** Inter (400–800) na interface, com `font-variant-numeric: tabular-nums`. Poppins só na logo.
- **Acessibilidade:** texto com contraste mínimo de 4,5:1; alvos de clique com 44 px; gráficos com `aria-label` e tabela equivalente.

## Texto

- Português simples, frases curtas, voz ativa.
- Vírgula decimal e sinal de menos tipográfico: "−2,3 pp", "57,7%". "%" para acerto, "pp" para diferença.
- Sempre dizer o recorte: disciplina, rede e referência (estado ou Brasil).

## Pendências

- Os SVGs da logo no design system (asset store do artifact) ainda estão no azul antigo; os de `assets/brand/` já foram atualizados.
