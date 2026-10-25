# Dashboard – Acerto por descritor (Saeb 2023, 5º ano)

Página estática que mostra o percentual de acerto por descritor
da Matriz de Referência do Saeb, em Língua Portuguesa e Matemática, para os
municípios de todo o Brasil, comparando cada um com o seu estado e com o país.

A página tem duas telas:

* **Painel** (`index.html#painel`): resumo do município, pontos de atenção,
  acerto por tópico, acerto por descritor com painel de detalhe e tabela completa;
* **Metodologia** (`index.html#metodologia`): como ler o painel, regras de cálculo e downloads.

Downloads (gerados no navegador, CSV com `;` que abre direto no Excel):
matriz de descritores (botão no cabeçalho), tabela do município selecionado e a planilha de origem.

## Estrutura

```
dashboard_saeb/
├── index.html              # estrutura da página (só HTML)
├── assets/
│   ├── css/style.css       # aparência: cores (claro/escuro), layout, componentes
│   └── js/app.js           # lógica: carga dos dados, filtros, gráficos, tabela, downloads
├── data/                   # dados lidos pela página (gerados; não editar à mão)
│   ├── dados.json          # descritores, Brasil, todas as UFs, metodologia (lido na abertura)
│   ├── municipios.json     # opcional: nomes dos municípios, {"6325345": "Nome"}; começa vazio {}
│   └── uf/<ID_UF>.json     # municípios de cada UF, lido só quando o estado é escolhido (33 = RJ)
├── fonte/                  # arquivos de origem dos dados
│   ├── acerto_descritores_5EF_2023.xlsx   # planilha (descritores, Brasil, metodologia); também oferecida para download
│   ├── acerto_uf_5EF_2023.csv             # UF × rede × descritor (notebook, seção 8)
│   └── acerto_municipios_5EF_2023.csv.gz  # município × rede × descritor, todas as UFs (notebook, seção 8)
└── scripts/
    └── gerar_json.py       # lê fonte/ e gera data/
```

Fluxo dos dados: notebook `seab/acerto_descritores_5EF.ipynb` → `fonte/` → `scripts/gerar_json.py` → `data/` → página.

Onde mexer:

* textos e ordem das seções → `index.html`;
* cores, espaçamentos e responsividade → `assets/css/style.css`;
* cálculos exibidos, filtros, gráficos e downloads → `assets/js/app.js`
  (os caminhos das pastas estão nas constantes `DIR_DADOS` e `DIR_FONTE`, no topo).

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta para a raiz dele.
2. No repositório, abra **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
4. Em um ou dois minutos a página fica disponível em `https://<seu-usuario>.github.io/<repositorio>/`.

Atenção: o repositório público deixa a planilha e o JSON acessíveis a qualquer pessoa.
A página só precisa de `index.html`, `assets/`, `data/` e da planilha em `fonte/` (para o download);
os dois CSV de `fonte/` (12 MB) podem ficar fora do repositório publicado.
São dados agregados de microdados públicos, mas, se depois você colocar dados vindos do
Sedap, confira as regras de divulgação do Inep antes de publicar.

## Testar no computador

A página não funciona com duplo clique (o navegador bloqueia a leitura do JSON).
Dentro da pasta, rode:

```
python -m http.server
```

e abra `http://localhost:8000`.

## Atualizar os dados

```
pip install pandas openpyxl
python scripts/gerar_json.py
```

O script usa por padrão os arquivos de `fonte/` e grava em `data/`; funciona de qualquer pasta.
Para usar outros arquivos: `python scripts/gerar_json.py planilha.xlsx acerto_uf.csv acerto_municipios.csv.gz`.

Os dois CSV e a planilha são gerados pelo notebook `seab/acerto_descritores_5EF.ipynb`
(gravados em `data/seab/` do projeto; copie-os para `fonte/`).

A planilha precisa manter as abas Descritores, Brasil e Metodologia. A página não precisa ser alterada.

## Dar nome aos municípios

Os códigos dos microdados públicos são máscaras do Inep. Quando tiver a
correspondência com o código real, preencha `data/municipios.json`:

```json
{ "6325345": "Nome do município", "6325412": "Outro município" }
```

## Links diretos

A página guarda os filtros no endereço, então dá para compartilhar uma visão específica:

```
index.html?disc=MT&uf=33&mun=6325412&rede=Pública&ref=UF&desc=D9
```

O link pode terminar em `#metodologia` para abrir direto a tela de metodologia.

Parâmetros: `disc` (LP ou MT), `uf` (código IBGE da UF, padrão 33), `mun` (código), `rede` (Pública ou Total),
`ref` (UF ou BR; links antigos com `ref=RJ` continuam valendo), `desc` (descritor em destaque), `bncc=1` (incluir itens BNCC).
