"""
Gera os dados do dashboard a partir da planilha e das exportações do notebook.

Uso (de qualquer pasta):
    python scripts/gerar_json.py [planilha.xlsx] [acerto_uf.csv] [acerto_municipios.csv.gz]

Padrões (pasta fonte/ do dashboard):
    acerto_descritores_5EF_2023.xlsx   -> abas Descritores, Brasil e Metodologia
    acerto_uf_5EF_2023.csv             -> UF × rede × descritor
    acerto_municipios_5EF_2023.csv.gz  -> município × rede × descritor (todas as UFs)

Saída (pasta data/ do dashboard):
    data/dados.json      -> descritores, Brasil, todas as UFs e metodologia (carregado na abertura)
    data/uf/<ID_UF>.json -> municípios de uma UF (carregado quando o estado é escolhido)

Requer: pandas, openpyxl  (pip install pandas openpyxl)
"""
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent      # pasta dashboard_saeb/
FONTE = RAIZ / "fonte"
DADOS = RAIZ / "data"

ENTRADA = Path(sys.argv[1]) if len(sys.argv) > 1 else FONTE / "acerto_descritores_5EF_2023.xlsx"
ARQ_UF = Path(sys.argv[2]) if len(sys.argv) > 2 else FONTE / "acerto_uf_5EF_2023.csv"
ARQ_MUN = Path(sys.argv[3]) if len(sys.argv) > 3 else FONTE / "acerto_municipios_5EF_2023.csv.gz"
SAIDA = DADOS / "dados.json"
DIR_UF = DADOS / "uf"

UFS = {
    11: ("RO", "Rondônia"), 12: ("AC", "Acre"), 13: ("AM", "Amazonas"), 14: ("RR", "Roraima"),
    15: ("PA", "Pará"), 16: ("AP", "Amapá"), 17: ("TO", "Tocantins"), 21: ("MA", "Maranhão"),
    22: ("PI", "Piauí"), 23: ("CE", "Ceará"), 24: ("RN", "Rio Grande do Norte"), 25: ("PB", "Paraíba"),
    26: ("PE", "Pernambuco"), 27: ("AL", "Alagoas"), 28: ("SE", "Sergipe"), 29: ("BA", "Bahia"),
    31: ("MG", "Minas Gerais"), 32: ("ES", "Espírito Santo"), 33: ("RJ", "Rio de Janeiro"),
    35: ("SP", "São Paulo"), 41: ("PR", "Paraná"), 42: ("SC", "Santa Catarina"),
    43: ("RS", "Rio Grande do Sul"), 50: ("MS", "Mato Grosso do Sul"), 51: ("MT", "Mato Grosso"),
    52: ("GO", "Goiás"), 53: ("DF", "Distrito Federal"),
}

abas = pd.read_excel(ENTRADA, sheet_name=["Descritores", "Brasil", "Metodologia"])
uf = pd.read_csv(ARQ_UF)
mun = pd.read_csv(ARQ_MUN)


def r4(v):
    """Arredonda proporções para 4 casas (0,6547 = 65,47%) e trata vazios."""
    return None if pd.isna(v) else round(float(v), 4)


# ---------- Descritores ----------
descritores = []
for _, d in abas["Descritores"].iterrows():
    fonte = str(d["fonte_descricao"])
    descritores.append({
        "disc": d["disciplina"],
        "cod": d["descritor"],
        "matriz": "BNCC" if "BNCC" in fonte else "2001",
        "topico": d["topico"],
        "descricao": None if "não disponível" in str(d["descricao"]) else d["descricao"],
        "n_itens": int(d["n_itens"]),
        "itens": str(d["itens"]),
    })

# ---------- Linhas de resultado (formato colunar, para os arquivos ficarem leves) ----------
COLS = ["rede", "disc", "cod", "n_alunos", "n_resp", "n_acertos",
        "pct", "pct_pond", "pct_branco", "pct_nulo"]
# no município o % ponderado não é usado (pesos não foram desenhados para esse nível)
COLS_MUN = ["id", "rede", "disc", "cod", "n_alunos", "n_resp", "n_acertos", "pct", "pct_branco", "pct_nulo"]


def linhas(df):
    return [[r.rede, r.disciplina, r.descritor, int(r.n_alunos), int(r.n_respostas),
             int(r.n_acertos), r4(r.pct_acerto), r4(r.pct_acerto_ponderado),
             r4(r.pct_branco), r4(r.pct_nulo)] for r in df.itertuples(index=False)]


def linhas_mun(df):
    return [[int(r.ID_MUNICIPIO), r.rede, r.disciplina, r.descritor, int(r.n_alunos), int(r.n_respostas),
             int(r.n_acertos), r4(r.pct_acerto), r4(r.pct_branco), r4(r.pct_nulo)]
            for r in df.itertuples(index=False)]


ufs = []
for id_uf, g in mun.groupby("ID_UF"):
    sigla, nome = UFS[int(id_uf)]
    ufs.append({"id": int(id_uf), "sigla": sigla, "nome": nome, "n_municipios": int(g.ID_MUNICIPIO.nunique())})

dados = {
    "meta": {
        "edicao": "Saeb 2023",
        "etapa": "5º ano do Ensino Fundamental",
        "fonte": "Microdados do Saeb 2023 (Inep) – TS_ALUNO_5EF e TS_ITEM",
        "planilha_origem": ENTRADA.name,   # a página oferece o download em fonte/<nome>
        "gerado_em": date.today().isoformat(),
        "limite_baixa_confiabilidade": 30,
        "uf_padrao": 33,
    },
    "ufs": ufs,
    "descritores": descritores,
    "referencias": {
        "colunas": COLS,
        "BR": linhas(abas["Brasil"]),
        "UF": {str(int(k)): linhas(g) for k, g in uf.groupby("ID_UF")},
    },
    "metodologia": [
        {"regra": r["regra"], "descricao": r["descricao"]}
        for _, r in abas["Metodologia"].iterrows()
    ],
}
with open(SAIDA, "w", encoding="utf-8") as f:
    json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))

DIR_UF.mkdir(parents=True, exist_ok=True)
for id_uf, g in mun.groupby("ID_UF"):
    with open(DIR_UF / f"{int(id_uf)}.json", "w", encoding="utf-8") as f:
        json.dump({"colunas": COLS_MUN, "linhas": linhas_mun(g)}, f, ensure_ascii=False, separators=(",", ":"))

print(f"{SAIDA}: {len(descritores)} descritores, {len(ufs)} UFs")
print(f"{DIR_UF}/: {len(ufs)} arquivos, {mun.ID_MUNICIPIO.nunique():,} municípios, {len(mun):,} linhas")
