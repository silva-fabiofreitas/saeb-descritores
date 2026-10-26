"use strict";
const DIR_DADOS = "data/";   // dados.json, municipios.json e uf/<ID_UF>.json
const DIR_FONTE = "fonte/";  // planilha de origem (download)
const LIMITE = 30;          // respostas mínimas para confiabilidade
const LIMIAR_PP = 5;        // diferença destacada (pontos percentuais)
const S = { mun: "var(--s-mun)", UF: "var(--s-rj)", BR: "var(--s-br)" };
const MK = { mun: "", UF: "losango", BR: "menor" };   // forma do marcador em legendas e tooltips (design system: cor e forma)
const NOME = { mun: "Município", get UF() { return `Estado (${ufAtual().sigla})`; }, BR: "Brasil" };
const DISC_NOME = { LP: "Língua Portuguesa", MT: "Matemática" };
const REGIAO = { 1: "Norte", 2: "Nordeste", 3: "Sudeste", 4: "Sul", 5: "Centro-Oeste" };
const ECHARTS_URL = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.6.0/echarts.min.js";

const st = { disc: "LP", uf: null, mun: null, rede: "Pública", ref: "UF", bncc: false, desc: null, sort: { key: "ordem", dir: 1 },
             ind: "geral", modo: "pct", ufSel: null, sortUF: { key: "ordem", dir: 1 } };
let D, IDX = {}, NOMES = {}, MUN_INFO = [];
const UF_CACHE = {};        // municípios já carregados, por UF

const fmtPct = v => v == null ? "–" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const fmtPP  = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " pp";
const fmtInt = v => v == null ? "–" : v.toLocaleString("pt-BR");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nomeMun = id => NOMES[id] ? `${NOMES[id]}` : `Município cód. ${id}`;
const ufAtual = () => D.ufs.find(u => u.id === st.uf) || { id: st.uf, sigla: "?", nome: "?" };
const refNome = () => st.ref === "UF" ? `estado (${ufAtual().sigla})` : "Brasil";
const refCurto = () => st.ref === "UF" ? ufAtual().sigla : "Brasil";
const $ = id => document.getElementById(id);
const ic = nome => `<svg class="ic" aria-hidden="true"><use href="#i-${nome}"/></svg>`;   // ícones do sprite em index.html
function mostrarErro(html) {
  const el = $("erro");
  el.style.display = "flex";
  el.innerHTML = `${ic("alerta")}<div>${html}</div>`;
}

function ordemDesc(cod) {           // D1..D28 em ordem numérica; BNCC depois
  const m = /^D(\d+)$/.exec(cod);
  return m ? +m[1] : 1000 + cod.charCodeAt(0);
}

/* ---------- carga ---------- */
async function carregar() {
  try {
    const r = await fetch(DIR_DADOS + "dados.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    D = await r.json();
  } catch (e) {
    mostrarErro(`<b>Não foi possível ler <code>${DIR_DADOS}dados.json</code>.</b> ${esc(e.message)}<br>
      Se você abriu o arquivo com duplo clique, o navegador bloqueia a leitura. Publique a pasta no GitHub Pages
      ou rode <code>python -m http.server</code> dentro dela e acesse <code>http://localhost:8000</code>.`);
    return;
  }
  try {   // nomes opcionais: {"6325345": "Nome do município"}
    const r = await fetch(DIR_DADOS + "municipios.json", { cache: "no-cache" });
    if (r.ok) NOMES = await r.json();
  } catch (_) {}
  indexar();
  lerURL();
  if (!D.ufs.some(u => u.id === st.uf)) st.uf = D.meta.uf_padrao ?? D.ufs[0].id;
  montarFiltros();
  ligarDownloads();
  await carregarUF(st.uf);
  rota();
}

// Municípios de uma UF: carregados sob demanda (uf/<ID_UF>.json) e guardados em cache
async function carregarUF(id) {
  const sel = $("f-mun");
  if (!UF_CACHE[id]) {
    sel.disabled = true;
    sel.innerHTML = "<option>Carregando municípios…</option>";
    try {
      const r = await fetch(`${DIR_DADOS}uf/${id}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const J = await r.json();
      const info = {};
      for (const a of J.linhas) {
        const o = Object.fromEntries(J.colunas.map((k, i) => [k, a[i]]));
        IDX[`M${o.id}|${o.rede}|${o.disc}|${o.cod}`] = o;
        if (o.rede === "Total") {
          const k = info[o.id] ||= { id: o.id, alunos: 0 };
          k.alunos = Math.max(k.alunos, o.n_alunos);   // aproximação: maior nº de alunos num descritor
        }
      }
      UF_CACHE[id] = Object.values(info).sort((a, b) => b.alunos - a.alunos);
    } catch (e) {
      mostrarErro(`<b>Não foi possível ler <code>${DIR_DADOS}uf/${id}.json</code>.</b> ${esc(e.message)}`);
      UF_CACHE[id] = null;
    } finally {
      sel.disabled = false;
    }
  }
  MUN_INFO = UF_CACHE[id] || [];
  montarMunicipios();
}

function indexar() {
  const c = D.referencias.colunas;
  const toObj = (arr, cols) => Object.fromEntries(cols.map((k, i) => [k, arr[i]]));
  for (const a of D.referencias.BR) {
    const o = toObj(a, c);
    IDX[`BR|${o.rede}|${o.disc}|${o.cod}`] = o;
  }
  for (const [uf, linhas] of Object.entries(D.referencias.UF)) {
    for (const a of linhas) {
      const o = toObj(a, c);
      IDX[`U${uf}|${o.rede}|${o.disc}|${o.cod}`] = o;
    }
  }
  D.descritores.forEach(d => { d.ordem = ordemDesc(d.cod); });
}

/* ---------- telas ---------- */
function rota() {
  const h = location.hash;
  // tela inicial: Estados. Links antigos sem "#" mas com município (?mun=…) continuam abrindo na aba Município
  const legado = !h && new URLSearchParams(location.search).has("mun");
  const view = h === "#painel" || legado ? "painel" : h.startsWith("#m") ? "metodologia" : "estados";
  const sec = view === "metodologia" && h !== "#metodologia" ? h : null;   // âncora interna da metodologia
  for (const v of ["painel", "estados", "metodologia"]) $("v-" + v).hidden = v !== view;
  document.querySelectorAll(".tabs a").forEach(a =>
    a.setAttribute("aria-current", a.dataset.view === view ? "page" : "false"));
  if (D) { view === "metodologia" ? renderMetodologia() : render(); }
  if (sec) document.querySelector(sec)?.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}
addEventListener("hashchange", rota);

/* ---------- valores ---------- */
// Retorna {pct, n_resp, n_acertos, n_alunos, pct_branco, baixa} para um nível
// nivel: "mun" | "UF" | "BR"; prefixo: "M<id>" | "U<id>" | "BR"
const prefixo = nivel => nivel === "mun" ? `M${st.mun}` : nivel === "UF" ? `U${st.uf}` : "BR";
function val(nivel, cod) { return valPre(prefixo(nivel), cod); }
function valPre(pre, cod) {
  const o = IDX[`${pre}|${st.rede}|${st.disc}|${cod}`];
  if (!o) return null;
  const pond = pre[0] !== "M" && st.rede === "Total";
  return {
    pct: pond ? o.pct_pond : o.pct, n_resp: o.n_resp, n_acertos: o.n_acertos,
    n_alunos: o.n_alunos, pct_branco: o.pct_branco, pct_nulo: o.pct_nulo,
    baixa: o.n_resp < LIMITE,
  };
}
// Agregado de vários descritores: Σ acertos / Σ respostas (ou média ponderada por respostas do % ponderado)
function agreg(nivel, cods) { return agregPre(prefixo(nivel), cods); }
function agregPre(pre, cods) {
  let num = 0, den = 0, resp = 0;
  for (const c of cods) {
    const v = valPre(pre, c); if (!v || v.pct == null) continue;
    num += v.pct * v.n_resp; den += v.n_resp; resp += v.n_resp;
  }
  return den ? { pct: num / den, n_resp: resp, baixa: resp < LIMITE } : null;
}
function descritoresAtivos() {
  return D.descritores
    .filter(d => d.disc === st.disc && (st.bncc || d.matriz === "2001"))
    .sort((a, b) => a.ordem - b.ordem);
}
function topicosAtivos(ds) {
  const t = new Map();
  for (const d of ds) { if (!t.has(d.topico)) t.set(d.topico, []); t.get(d.topico).push(d); }
  const ROM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  const num = nome => ROM[(/^([IVX]+)\./.exec(nome) || [])[1]] ?? 99;
  return [...t.entries()].sort((a, b) => {
    const bA = a[0].includes("BNCC"), bB = b[0].includes("BNCC");
    if (bA !== bB) return bA - bB;
    return num(a[0]) - num(b[0]) || a[0].localeCompare(b[0], "pt-BR");
  });
}
// diferença município − referência (pp) por descritor
function difs(ds) {
  return ds.map(d => {
    const m = val("mun", d.cod), r = val(st.ref, d.cod);
    return { d, m, r, dif: m && r && m.pct != null && r.pct != null ? (m.pct - r.pct) * 100 : null };
  });
}

/* ---------- filtros ---------- */
function seg(id, key) {
  const el = $(id);
  el.querySelectorAll("button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.v === st[key]));
    b.onclick = () => { st[key] = b.dataset.v; if (key === "disc") st.desc = null; render(); };
  });
}
function montarFiltros() {
  const su = $("f-uf");
  su.innerHTML = [...D.ufs].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(u =>
    `<option value="${u.id}">${esc(u.nome)} (${u.sigla})</option>`).join("");
  su.value = st.uf;
  su.onchange = async () => {
    st.uf = +su.value; st.mun = null;
    await carregarUF(st.uf);
    render();
  };
  const sel = $("f-mun");
  sel.onchange = () => { st.mun = +sel.value; render(); };
  for (const id of ["f-bncc", "e-bncc"]) $(id).onchange = e => { st.bncc = e.target.checked; render(); };
  $("e-ind").onchange = e => { st.ind = e.target.value; render(); };
  $("e-btn-tabela").onclick = e => { e.preventDefault(); e.stopPropagation(); baixarTabelaEstados(); };
  $("e-btn-desc").onclick = e => { e.preventDefault(); e.stopPropagation(); baixarTabelaDescUF(); };
}
function montarMunicipios() {
  const sel = $("f-mun");
  sel.innerHTML = MUN_INFO.map(m =>
    `<option value="${m.id}">${esc(nomeMun(m.id))} · ~${fmtInt(m.alunos)} alunos</option>`).join("");
  if (!st.mun || !MUN_INFO.some(m => m.id === st.mun)) st.mun = MUN_INFO[0]?.id ?? null;
  sel.value = st.mun;
}
function lerURL() {
  const p = new URLSearchParams(location.search);
  if (["LP", "MT"].includes(p.get("disc"))) st.disc = p.get("disc");
  if (p.get("mun")) st.mun = +p.get("mun");
  if (["Pública", "Total"].includes(p.get("rede"))) st.rede = p.get("rede");
  if (["UF", "RJ"].includes(p.get("ref"))) st.ref = "UF";     // "RJ" = links antigos
  if (p.get("ref") === "BR") st.ref = "BR";
  if (p.get("uf")) st.uf = +p.get("uf");
  if (p.get("bncc") === "1") st.bncc = true;
  if (p.get("desc")) st.desc = p.get("desc");
  if (p.get("ind")) st.ind = p.get("ind");
  if (p.get("modo") === "dif") st.modo = "dif";
  if (p.get("ufsel")) st.ufSel = +p.get("ufsel");
}
function gravarURL() {
  const p = new URLSearchParams({ disc: st.disc, uf: st.uf, mun: st.mun, rede: st.rede, ref: st.ref });
  if (st.bncc) p.set("bncc", "1");
  if (st.desc) p.set("desc", st.desc);
  if (st.ind !== "geral") p.set("ind", st.ind);
  if (st.modo === "dif") p.set("modo", "dif");
  if (st.ufSel && st.ufSel !== st.uf) p.set("ufsel", st.ufSel);
  history.replaceState(null, "", "?" + p.toString() + location.hash);
}
function selecionar(cod) {
  st.desc = cod; render();
  if (innerWidth <= 1000) $("detalhe").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- downloads (CSV com ; e BOM, para abrir no Excel em português) ---------- */
function baixarCSV(nome, cab, linhas) {
  const cel = v => {
    if (v == null) return "";
    const s = typeof v === "number" ? v.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 4 }) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = "﻿" + [cab, ...linhas].map(l => l.map(cel).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function baixarMatriz() {
  const ds = [...D.descritores].sort((a, b) => a.disc.localeCompare(b.disc) || a.ordem - b.ordem);
  baixarCSV("matriz_descritores_saeb2023_5EF.csv",
    ["Disciplina", "Código", "Matriz", "Tópico", "Descrição", "Nº de itens", "Itens (ID_ITEM)"],
    ds.map(d => [DISC_NOME[d.disc], d.cod, d.matriz === "BNCC" ? "BNCC" : "Matriz de Referência 2001",
                 d.topico, d.descricao || "(descrição não disponível na Matriz de 2001)", d.n_itens, d.itens]));
}
function baixarTabela() {
  const refN = st.ref === "UF" ? `Estado (${ufAtual().sigla})` : "Brasil";
  const linhas = difs(descritoresAtivos()).map(({ d, m }) => {
    const rj = val("UF", d.cod), br = val("BR", d.cod), r = st.ref === "UF" ? rj : br;
    return [d.cod, d.descricao || "", d.topico, d.n_itens, m?.n_resp ?? null,
      m ? +(m.pct * 100).toFixed(1) : null, rj ? +(rj.pct * 100).toFixed(1) : null, br ? +(br.pct * 100).toFixed(1) : null,
      m && r ? +((m.pct - r.pct) * 100).toFixed(1) : null,
      m ? +(((m.pct_branco ?? 0) + (m.pct_nulo ?? 0)) * 100).toFixed(1) : null,
      m?.baixa ? "SIM" : "NÃO"];
  });
  baixarCSV(`resultado_${ufAtual().sigla}_${st.mun}_${st.disc}_${st.rede === "Pública" ? "publica" : "total"}.csv`,
    ["Descritor", "Descrição", "Tópico", "Itens", "Respostas (município)", "% Município", `% Estado (${ufAtual().sigla})`, "% Brasil",
     `Dif. × ${refN} (pp)`, "% Branco/nulo (município)", "Baixa confiabilidade (< 30 resp.)"], linhas);
}
function ligarDownloads() {
  $("btn-matriz").onclick = baixarMatriz;
  $("btn-tabela").onclick = e => { e.preventDefault(); e.stopPropagation(); baixarTabela(); };
  document.querySelectorAll("[data-dl]").forEach(b =>
    b.onclick = () => (b.dataset.dl === "matriz" ? baixarMatriz() : baixarTabela()));
}

/* ---------- tooltip ---------- */
const tip = $("tip");
function showTip(e, html) {
  tip.innerHTML = html; tip.style.display = "block";
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { tip.style.display = "none"; };
function tipLinhas(vals) {
  return ["mun", "UF", "BR"].map(n => {
    const v = vals[n];
    return `<div class="tr"><span><i class="${MK[n]}" style="background:${S[n]}"></i>${NOME[n]}</span><b>${v ? fmtPct(v.pct) : "–"}</b></div>`;
  }).join("") + (vals.mun ? `<div class="tr muted"><span>Respostas no município</span><span>${fmtInt(vals.mun.n_resp)}</span></div>` : "");
}

/* ---------- gráfico de pontos (tópicos e descritores) ---------- */
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
let CTX_MEDIDA;
function medirTexto(txt, fonte) {
  CTX_MEDIDA ||= document.createElement("canvas").getContext("2d");
  CTX_MEDIDA.font = fonte;
  return CTX_MEDIDA.measureText(txt).width;
}
// Quebra um texto em linhas que cabem em `larg` px (nunca corta com reticências)
function quebrar(txt, larg, fonte) {
  const linhas = [];
  let atual = "";
  for (const p of String(txt).split(/\s+/)) {
    const tent = atual ? `${atual} ${p}` : p;
    if (atual && medirTexto(tent, fonte) > larg) { linhas.push(atual); atual = p; } else atual = tent;
  }
  if (atual) linhas.push(atual);
  return linhas;
}
function dotPlot(container, rows, opts) {
  // rows: [{tipo:"cab", label} | {tipo:"lin", id, code?, label, warn, vals:{mun,UF,BR}, tip}]
  // opts.valores: rotula o valor do município e mostra a coluna "vs referência" à direita
  container.innerHTML = "";
  const W = Math.max(300, container.clientWidth);
  const narrow = W < 560;
  const stack = narrow;                                   // celular: nome acima dos pontos
  const fam = getComputedStyle(document.body).fontFamily;
  const F_NOME = `400 14px ${fam}`, F_COD = `700 13px ${fam}`, F_CAB = `700 14px ${fam}`, LH = 18;
  const colRef = opts.valores ? (narrow ? 64 : 92) : 0;
  const labW = stack ? 0 : Math.min(opts.lab || 300, Math.round(W * (opts.labFrac || 0.42)));
  const right = 16, top = 30;
  // coluna dos nomes: alinhada depois do código mais largo (+ alerta)
  const codW = Math.max(0, ...rows.filter(r => r.code).map(r => medirTexto(r.code, F_COD) + (r.warn ? 16 : 0)));
  const xNome = rows.some(r => r.code) ? 4 + codW + 10 : 4;
  const largNome = (stack ? W - right : labW - 8) - xNome;
  // altura de cada linha conforme o número de linhas do nome
  for (const r of rows) {
    if (r.tipo === "cab") { r._l = quebrar(r.label, W - right, F_CAB); r._h = r._l.length * LH + 14; continue; }
    r._l = quebrar(r.label, largNome, F_NOME);
    r._h = stack ? r._l.length * LH + (opts.valores ? 44 : 30) : Math.max(opts.rowH || 30, r._l.length * LH + 12);   // + espaço para o valor acima da bolha
  }
  const H = top + rows.reduce((t, r) => t + r._h, 0) + 8;
  // escala ajustada aos dados (de 10 em 10 pontos), para separar os pontos
  const todos = rows.flatMap(r => r.tipo === "lin" ? ["mun", "UF", "BR"].map(n => r.vals[n]?.pct).filter(v => v != null) : []);
  const lo = Math.max(0, Math.floor((Math.min(...todos) - 0.03) * 10) / 10);
  const hi = Math.min(1, Math.ceil((Math.max(...todos) + 0.03) * 10) / 10);
  const x0 = labW + (stack ? 8 : 12), x1 = W - right - colRef - (opts.valores ? (stack ? 52 : 12) : 0);   // no celular, reserva lugar para o rótulo
  const X = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.aria });

  // grade e eixo
  const g = el("g", { class: "grid" }, svg);
  const passo = narrow && (hi - lo) > 0.4 ? 0.2 : 0.1;
  for (let t = lo; t <= hi + 1e-9; t += passo) {
    el("line", { x1: X(t), x2: X(t), y1: top - 6, y2: H - 4 }, g);
    const tk = el("g", { class: "tick" }, svg);
    const ancora = X(t) < 16 ? "start" : X(t) > W - 16 ? "end" : "middle";
    const tx = el("text", { x: X(t), y: top - 14, "text-anchor": ancora }, tk);
    tx.textContent = Math.round(t * 100) + "%";
  }
  if (opts.valores) {
    const tx = el("text", { x: W - right, y: top - 14, "text-anchor": "end", class: "col-ref" }, svg);
    tx.textContent = `vs ${refCurto()}`;
  }

  let y = top;
  for (const r of rows) {
    if (r.tipo === "cab") {
      const t = el("text", { x: 0, y: y + 22, class: "topic-label" }, svg);
      r._l.forEach((l, k) => { const s = el("tspan", { x: 0, dy: k ? LH : 0 }, t); s.textContent = l; });
      y += r._h; continue;
    }
    const cy = stack ? y + r._h - 12 : y + r._h / 2;
    const hit = el("rect", { x: 0, y, width: W, height: r._h, rx: 6, class: "row-hit" + (opts.selected === r.id ? " sel" : "") }, svg);
    // rótulo: código (+ alerta) e nome em várias linhas
    const y1 = stack ? y + 18 : cy + 5 - (r._l.length - 1) * LH / 2;
    if (r.code) {
      const c = el("text", { x: 4, y: y1, class: "code" }, svg); c.textContent = r.code;
      if (r.warn) el("use", { href: "#i-alerta", x: 4 + medirTexto(r.code, F_COD) + 4, y: y1 - 10, width: 11, height: 11, class: "warn-ic" }, svg);
    }
    const nome = el("text", { x: xNome, y: y1, class: "nome" }, svg);
    r._l.forEach((l, k) => { const s = el("tspan", { x: xNome, dy: k ? LH : 0 }, nome); s.textContent = l; });
    // faixa entre min e max
    const vs = ["mun", "UF", "BR"].map(n => r.vals[n]?.pct).filter(v => v != null);
    if (vs.length > 1) el("line", { x1: X(Math.min(...vs)), x2: X(Math.max(...vs)), y1: cy, y2: cy, class: "rng" }, svg);
    // marcadores (design system): Brasil = círculo cinza 12 px, estado = losango 10 px, município = círculo 16 px por cima
    for (const n of ["BR", "UF", "mun"]) {
      const v = r.vals[n]; if (!v || v.pct == null) continue;
      const x = X(v.pct);
      if (n === "UF") {
        el("path", { d: `M${x} ${cy - 5.5}L${x + 5.5} ${cy}L${x} ${cy + 5.5}L${x - 5.5} ${cy}Z`, class: "dot", fill: S.UF }, svg);
      } else if (n === "BR") {
        el("circle", { cx: x, cy, r: 6, class: "dot", fill: S.BR }, svg);
      } else {
        const hollow = v.baixa;
        el("circle", {
          cx: x, cy, r: hollow ? 7 : 8, class: "dot",
          fill: hollow ? "var(--surface)" : S.mun,
          ...(hollow ? { stroke: S.mun, "stroke-width": 2.5 } : {}),
        }, svg);
      }
    }
    if (opts.valores && r.vals.mun?.pct != null) {
      // valor do município do lado livre da bolha (fora da faixa estado–Brasil; no meio, acima)
      const m = r.vals.mun.pct, outros = ["UF", "BR"].map(n => r.vals[n]?.pct).filter(v => v != null);
      let lado = !outros.length || m >= Math.max(...outros) ? 1 : m <= Math.min(...outros) ? -1 : 0;
      const wTxt = medirTexto(fmtPct(m), F_COD) + 13;
      if (lado > 0 && X(m) + wTxt > x1 + 8) lado = X(m) - wTxt > x0 - 8 && m <= Math.min(...outros, m) ? -1 : 0;   // sem espaço à direita
      if (lado < 0 && X(m) - wTxt < x0 - 8) lado = 0;                                                            // sem espaço à esquerda
      const t = el("text", { x: X(m) + lado * 13, y: lado ? cy + 4.5 : cy - 12, "text-anchor": lado > 0 ? "start" : lado < 0 ? "end" : "middle", class: "val-mun" }, svg);
      t.textContent = fmtPct(m);
      // coluna "vs referência"
      const ref = r.vals[st.ref]?.pct;
      if (ref != null) {
        const d = (m - ref) * 100, forte = Math.abs(d) >= LIMIAR_PP;
        const tv = el("text", { x: W - right, y: cy + 4.5, "text-anchor": "end", class: "dif" + (forte ? (d < 0 ? " neg" : " pos") : "") }, svg);
        tv.textContent = fmtPP(d);
        if (forte) el("use", { href: `#i-${d < 0 ? "desce" : "sobe"}`, x: W - right - medirTexto(fmtPP(d), F_COD) - 15, y: cy - 6, width: 12, height: 12, class: "dif-ic" + (d < 0 ? " neg" : " pos") }, svg);
      }
    }
    hit.addEventListener("mousemove", e => showTip(e, r.tip));
    hit.addEventListener("mouseleave", hideTip);
    if (opts.onClick) hit.addEventListener("click", () => { hideTip(); opts.onClick(r.id); });
    // trazer hit para frente sem cobrir pontos visualmente (transparente)
    svg.appendChild(hit);
    y += r._h;
  }
  container.appendChild(svg);
  // o eixo dá zoom na faixa dos dados: dizer isso
  const nota = document.createElement("p");
  nota.className = "note eixo-nota";
  nota.textContent = `O eixo vai de ${Math.round(lo * 100)}% a ${Math.round(hi * 100)}%, a faixa dos dados, e não de 0% a 100%.`;
  container.appendChild(nota);
}

/* ---------- 1. resumo ---------- */
function renderResumo(ds) {
  const cods = ds.map(d => d.cod);
  const a = { mun: agreg("mun", cods), UF: agreg("UF", cods), BR: agreg("BR", cods) };
  const disc = DISC_NOME[st.disc];
  const rede = st.rede === "Pública" ? "na rede pública" : "em todas as redes";

  // frase-resumo (vai dentro do cartão do município)
  const lista = difs(ds).filter(x => x.dif != null && !x.m.baixa);
  const abaixo = lista.filter(x => x.dif <= -LIMIAR_PP).length;
  const acima = lista.filter(x => x.dif >= LIMIAR_PP).length;
  const difUF = a.mun && a.UF ? (a.mun.pct - a.UF.pct) * 100 : null;
  const difBR = a.mun && a.BR ? (a.mun.pct - a.BR.pct) * 100 : null;
  const rel = d => d == null ? null : Math.abs(d) < 0.5 ? "igual" : d > 0 ? "mais" : "menos";
  const rU = rel(difUF), rB = rel(difBR);
  const comp = rU === rB
    ? (rU === "igual" ? "acerta praticamente o mesmo que o estado e o país" : `acerta ${rU} que o estado e o país`)
    : [rU && (rU === "igual" ? "praticamente o mesmo que o estado" : `${rU} que o estado`),
       rB && (rB === "igual" ? "praticamente o mesmo que o país" : `${rB} que o país`)].filter(Boolean).join(" e ").replace(/^/, "acerta ");
  // a primeira contagem leva o substantivo ("1 descritor fica"); a segunda, não ("1 fica")
  const qtd = (n, txt, subst) => n === 0 ? `${subst ? "nenhum descritor" : "nenhum"} fica ${txt}`
    : n === 1 ? `1${subst ? " descritor" : ""} fica ${txt}` : `${n}${subst ? " descritores" : ""} ficam ${txt}`;
  const frase = a.mun
    ? `Em ${disc}, ${rede}, o município ${comp}.` + (lista.length
      ? ` ${(s => s[0].toUpperCase() + s.slice(1))(qtd(abaixo, `${LIMIAR_PP} pp ou mais abaixo do ${refCurto()}`, true))}; ` +
        `${qtd(acima, `${LIMIAR_PP} pp ou mais acima`, false)}.` : "")
    : `Sem dados de ${disc} ${rede} para ${esc(nomeMun(st.mun))}.`;
  const pilula = (d, nome, chip) => d == null ? "" :
    `<span class="pill${chip ? " chip" : ""}${!chip && d <= -LIMIAR_PP ? " neg" : ""}">${Math.abs(d) >= 0.05 ? ic(d < 0 ? "desce" : "sobe") : ""}${fmtPP(d)} vs ${nome}</span>`;
  const outra = st.ref === "UF" ? "BR" : "UF";
  const nomeRef = n => n === "UF" ? ufAtual().sigla : "Brasil";
  const difDe = n => n === "UF" ? difUF : difBR;

  $("tiles").innerHTML = `
    <div class="tile main destaque"><div class="lab"><i style="background:var(--s-mun)"></i>Município · acerto geral</div>
      <div class="val">${fmtPct(a.mun?.pct)}<span class="pills">${pilula(difDe(st.ref), nomeRef(st.ref), false)}${pilula(difDe(outra), nomeRef(outra), true)}</span></div>
      <p class="frase">${frase}</p>
      <div class="foot">${fmtInt(a.mun?.n_resp)} respostas</div></div>
    <div class="tile serie-uf"><div class="lab"><i class="losango" style="background:var(--s-rj)"></i>${esc(ufAtual().nome)}</div>
      <div class="val">${fmtPct(a.UF?.pct)}</div><div class="foot">${fmtInt(a.UF?.n_resp)} respostas</div></div>
    <div class="tile serie-br"><div class="lab"><i class="menor" style="background:var(--s-br)"></i>Brasil</div>
      <div class="val">${fmtPct(a.BR?.pct)}</div><div class="foot">${fmtInt(a.BR?.n_resp)} respostas</div></div>
    <div class="tile conta"><div class="lab">Descritores × ${st.ref === "UF" ? "estado" : "Brasil"}</div>
      <div class="val contagem">${lista.length
        ? `<span class="delta-pos">${ic("sobe")}${acima}</span><span class="delta-neg">${ic("desce")}${abaixo}</span>` : "–"}</div>
      <div class="blocos" aria-hidden="true">${[...lista].sort((x, y) => x.d.ordem - y.d.ordem).map(x =>
        `<i class="${x.dif >= LIMIAR_PP ? "pos" : x.dif <= -LIMIAR_PP ? "neg" : ""}" title="${esc(x.d.cod)}: ${fmtPP(x.dif)}"></i>`).join("")}</div>
      <div class="foot">acima e abaixo, ${LIMIAR_PP} pp ou mais, de ${lista.length} descritores</div></div>`;
}

/* ---------- 2. pontos de atenção ---------- */
// Gráfico divergente único: diferença município − referência por descritor, em torno da linha da referência
function renderAtencao(ds) {
  const lista = difs(ds).filter(x => x.dif != null && !x.m.baixa).sort((a, b) => a.dif - b.dif);
  $("att-note").textContent = `Diferença em relação ao ${refNome()}, em pp, só com resultados de ${LIMITE} respostas ou mais. Clique num descritor para ver o detalhe.`;
  $("att-ref").textContent = st.ref === "UF" ? `Estado (${ufAtual().sigla})` : "Brasil";
  document.querySelector("#v-painel .ref-cor").style.color = S[st.ref];
  const box = $("att");
  if (!lista.length) { box.innerHTML = `<p class="empty">Nenhum descritor com ${LIMITE} respostas ou mais no município.</p>`; return; }
  const lim = Math.max(10, Math.ceil(Math.max(...lista.map(x => Math.abs(x.dif))) / 5) * 5);   // escala simétrica, de 5 em 5 pp
  const pos = v => 50 + (v / lim) * 50;                                                          // pp → % da largura da trilha
  const faixa = `left:${pos(-LIMIAR_PP)}%;width:${pos(LIMIAR_PP) - pos(-LIMIAR_PP)}%`;
  box.style.setProperty("--ref", S[st.ref]);
  box.innerHTML = `<div class="dv-eixo" aria-hidden="true"><span></span><span></span>
      <div class="dv-trilha"><b style="left:0">−${lim} pp</b><b style="left:${pos(-LIMIAR_PP)}%">−${LIMIAR_PP}</b><b style="left:50%">0</b>
        <b style="left:${pos(LIMIAR_PP)}%">+${LIMIAR_PP}</b><b style="left:100%">+${lim} pp</b></div><span></span></div>` +
    lista.map(x => {
      const forte = Math.abs(x.dif) >= LIMIAR_PP;
      const barra = x.dif < 0 ? `left:${pos(x.dif)}%;width:${50 - pos(x.dif)}%` : `left:50%;width:${pos(x.dif) - 50}%`;
      const desc = x.d.descricao || "(descrição não disponível)";
      return `<button type="button" class="dv-linha${st.desc === x.d.cod ? " sel" : ""}" role="listitem" data-cod="${esc(x.d.cod)}"
          aria-label="${esc(x.d.cod)}: ${esc(desc)}. ${fmtPP(x.dif)} em relação ao ${refNome()}.">
        <span class="c">${esc(x.d.cod)}${x.d.n_itens === 1 ? `<span class="alerta" title="Descritor avaliado por um único item">${ic("alerta")}</span>` : ""}</span>
        <span class="t">${esc(desc)}</span>
        <span class="dv-trilha"><i class="dv-faixa" style="${faixa}"></i><i class="dv-barra${forte ? " forte" : ""} ${x.dif < 0 ? "neg" : "pos"}" style="${barra}"></i></span>
        <span class="v ${forte ? (x.dif < 0 ? "delta-neg" : "delta-pos") : ""}">${forte ? ic(x.dif < 0 ? "desce" : "sobe") : ""}${fmtPP(x.dif)}</span>
      </button>`;
    }).join("");
  box.querySelectorAll(".dv-linha").forEach(b => b.onclick = () => selecionar(b.dataset.cod));
}

/* ---------- 3. tópicos ---------- */
function renderTopicos(ds) {
  const rows = [];
  for (const [topico, lista] of topicosAtivos(ds)) {
    const cods = lista.map(d => d.cod);
    const vals = { mun: agreg("mun", cods), UF: agreg("UF", cods), BR: agreg("BR", cods) };
    const nItens = lista.reduce((s, d) => s + d.n_itens, 0);
    rows.push({
      tipo: "lin", id: topico, label: topico, vals,
      tip: `<b>${esc(topico)}</b><div class="d">${lista.length} descritores · ${nItens} itens</div>${tipLinhas(vals)}`,
    });
  }
  dotPlot($("ch-topicos"), rows, { lab: 420, rowH: 36, valores: true, aria: "Acerto por tópico: município, estado e Brasil" });
}

/* ---------- 4. descritores ---------- */
function renderDescritores(ds) {
  const rows = [];
  for (const [topico, lista] of topicosAtivos(ds)) {
    rows.push({ tipo: "cab", label: topico });
    for (const d of lista) {
      const vals = { mun: val("mun", d.cod), UF: val("UF", d.cod), BR: val("BR", d.cod) };
      const desc = d.descricao || "(descrição não disponível na Matriz de 2001)";
      rows.push({
        tipo: "lin", id: d.cod, code: d.cod, label: desc, warn: d.n_itens === 1, vals,
        tip: `<b>${esc(d.cod)}</b> · ${d.n_itens} ${d.n_itens === 1 ? "item" : "itens"}<div class="d">${esc(desc)}</div>${tipLinhas(vals)}` +
             (vals.mun?.baixa ? `<div class="d" style="color:var(--warning-ink);margin:6px 0 0">Menos de ${LIMITE} respostas no município.</div>` : ""),
      });
    }
  }
  dotPlot($("ch-desc"), rows, {
    lab: 460, labFrac: 0.52, rowH: 30, selected: st.desc,
    aria: "Acerto por descritor: município, estado e Brasil",
    onClick: selecionar,
  });
}

function renderDetalhe(ds) {
  if (!st.desc || !ds.some(d => d.cod === st.desc)) {
    // padrão: o descritor com maior defasagem
    const pior = difs(ds).filter(x => x.dif != null && !x.m.baixa).sort((a, b) => a.dif - b.dif)[0];
    st.desc = pior?.d.cod ?? ds[0]?.cod;
  }
  const d = ds.find(x => x.cod === st.desc);
  if (!d) return;
  const v = { mun: val("mun", d.cod), UF: val("UF", d.cod), BR: val("BR", d.cod) };
  const ref = v[st.ref];
  const dif = v.mun && ref ? (v.mun.pct - ref.pct) * 100 : null;
  const badges = (d.n_itens === 1 ? `<span class="badge warn" title="Descritor avaliado por um único item: o resultado reflete aquela questão">${ic("alerta")}1 item</span>` : `<span class="badge">${d.n_itens} itens</span>`) +
                 (d.matriz === "BNCC" ? ` <span class="badge">BNCC</span>` : "") +
                 (v.mun?.baixa ? ` <span class="badge warn" title="Menos de ${LIMITE} respostas: ler com muita cautela">${ic("alerta")}&lt; ${LIMITE} resp.</span>` : "");
  $("dt-cod").innerHTML = `${esc(d.cod)} ${badges}`;
  $("dt-desc").textContent = d.descricao || "(descrição não disponível na Matriz de 2001)";
  $("dt-top").textContent = d.topico;
  $("dt-bars").innerHTML = ["mun", "UF", "BR"].map(n => `
    <div class="bar-row"><span class="bl"><i class="${MK[n]}" style="background:${S[n]}"></i>${n === "mun" ? "Município" : n === "UF" ? `Estado (${ufAtual().sigla})` : "Brasil"}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${v[n] ? (v[n].pct * 100).toFixed(1) : 0}%;background:${S[n]}${n === "mun" && v.mun?.baixa ? ";opacity:.45" : ""}"></div></div>
      <span class="bv">${fmtPct(v[n]?.pct)}</span></div>`).join("");
  $("dt-kv").innerHTML = `
    <span>Diferença × ${refNome()}</span>
    <span class="${dif == null ? "" : dif <= -LIMIAR_PP ? "delta-neg" : dif >= LIMIAR_PP ? "delta-pos" : ""}">${fmtPP(dif)}</span>
    <span>Respostas no município</span><span>${fmtInt(v.mun?.n_resp)}</span>
    <span>Alunos no município</span><span>${fmtInt(v.mun?.n_alunos)}</span>
    <span>Branco ou nulo no município</span><span>${v.mun ? fmtPct((v.mun.pct_branco ?? 0) + (v.mun.pct_nulo ?? 0)) : "–"}</span>`;
  renderPosicao(d);
}

function renderPosicao(d) {
  const box = $("ch-pos");
  const pts = [];
  for (const m of MUN_INFO) {
    const o = IDX[`M${m.id}|${st.rede}|${st.disc}|${d.cod}`];
    if (o && o.pct != null) pts.push({ id: m.id, pct: o.pct, n: o.n_resp, baixa: o.n_resp < LIMITE });
  }
  pts.sort((a, b) => b.pct - a.pct);
  const pos = pts.findIndex(p => p.id === st.mun) + 1;
  $("pos-title").textContent = `Posição entre os municípios do estado (${ufAtual().sigla})`;
  $("pos-sub").innerHTML = pos
    ? `<b>${pos}ª posição</b> entre ${pts.length} ${pts.length === 1 ? "município" : "municípios"} (rede ${st.rede === "Pública" ? "pública" : "total"}). Clique num ponto para trocar de município.`
    : "Sem dado para o município selecionado.";
  box.innerHTML = "";
  if (!pts.length) return;
  const W = Math.max(280, box.clientWidth), H = 104, l = 8, r = 8, base = 52;
  const lo = Math.max(0, Math.floor((Math.min(...pts.map(p => p.pct)) - 0.05) * 10) / 10);
  const hi = Math.min(1, Math.ceil((Math.max(...pts.map(p => p.pct)) + 0.05) * 10) / 10);
  const X = v => l + (W - l - r) * (v - lo) / (hi - lo);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Distribuição do acerto no ${d.cod} entre os municípios do estado (${ufAtual().sigla})` });
  const g = el("g", { class: "grid" }, svg);
  const passoP = W < 560 && (hi - lo) > 0.4 ? 0.2 : 0.1;
  for (let t = lo; t <= hi + 1e-9; t += passoP) {
    el("line", { x1: X(t), x2: X(t), y1: 14, y2: base + 22 }, g);
    const anc = X(t) < 16 ? "start" : X(t) > W - 16 ? "end" : "middle";
    const tx = el("text", { x: X(t), y: H - 6, "text-anchor": anc }, el("g", { class: "tick" }, svg));
    tx.textContent = Math.round(t * 100) + "%";
  }
  // referências estado e Brasil
  for (const n of ["UF", "BR"]) {
    const v = val(n, d.cod); if (!v) continue;
    el("line", { x1: X(v.pct), x2: X(v.pct), y1: 14, y2: base + 22, stroke: S[n], "stroke-width": 2, "stroke-dasharray": "4 3" }, svg);
  }
  // pontos (leve deslocamento vertical determinístico para separar sobreposições)
  pts.forEach((p, i) => {
    if (p.id === st.mun) return;
    const cy = base + ((i % 5) - 2) * 6;
    const c = el("circle", { cx: X(p.pct), cy, r: 5, class: "dot",
      fill: p.baixa ? "var(--surface)" : "var(--muted)", "fill-opacity": p.baixa ? 1 : 0.55,
      ...(p.baixa ? { stroke: "var(--muted)", "stroke-width": 1.5 } : {}) }, svg);
    c.addEventListener("mousemove", e => showTip(e, `<b>${esc(nomeMun(p.id))}</b><div class="tr"><span>Acerto</span><b>${fmtPct(p.pct)}</b></div><div class="tr muted"><span>Posição</span><span>${i + 1}ª de ${pts.length}</span></div><div class="tr muted"><span>Respostas</span><span>${fmtInt(p.n)}</span></div>`));
    c.addEventListener("mouseleave", hideTip);
    c.style.cursor = "pointer";
    c.addEventListener("click", () => { hideTip(); st.mun = p.id; $("f-mun").value = p.id; render(); });
  });
  const me = pts.find(p => p.id === st.mun);
  if (me) {
    el("circle", { cx: X(me.pct), cy: base, r: 8, class: "dot", fill: me.baixa ? "var(--surface)" : S.mun, ...(me.baixa ? { stroke: S.mun, "stroke-width": 3 } : {}) }, svg);
    const t = el("text", { x: X(me.pct), y: base - 22, "text-anchor": "middle", style: "fill:var(--ink);font-weight:650;paint-order:stroke;stroke:var(--surface);stroke-width:4px" }, svg);
    t.textContent = fmtPct(me.pct);
  }
  box.appendChild(svg);
}

/* ---------- 5. tabela ---------- */
function renderTabela(ds) {
  const linhas = ds.map(d => {
    const m = val("mun", d.cod), rj = val("UF", d.cod), br = val("BR", d.cod);
    const ref = st.ref === "UF" ? rj : br;
    return {
      d, ordem: d.ordem, cod: d.cod, topico: d.topico, n_itens: d.n_itens,
      n_resp: m?.n_resp ?? null, mun: m?.pct ?? null, rj: rj?.pct ?? null, br: br?.pct ?? null,
      branco: m ? (m.pct_branco ?? 0) + (m.pct_nulo ?? 0) : null,
      dif: m && ref ? (m.pct - ref.pct) * 100 : null, baixa: m?.baixa,
    };
  });
  const { key, dir } = st.sort;
  linhas.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "pt-BR") : x - y) * dir;
  });
  const refN = refCurto();
  const cols = [
    ["ordem", "Descritor"], [null, "Descrição"], ["n_itens", "Itens", "num"], ["n_resp", "Respostas<br>(município)", "num"],
    ["mun", "Município", "num"], ["rj", `Estado (${ufAtual().sigla})`, "num"], ["br", "Brasil", "num"],
    ["dif", `Dif. × ${refN}`, "num"], ["branco", "Branco/nulo<br>(município)", "num"],
  ];
  const th = cols.map(([k, t, c]) => {
    const s = k ? `sortable${st.sort.key === k ? (st.sort.dir > 0 ? " asc" : " desc") : ""}` : "";
    return `<th class="${s} ${c || ""}" ${k ? `data-k="${k}" tabindex="0"` : ""}>${t}</th>`;
  }).join("");
  const tb = linhas.map(r => {
    const st_ = r.dif == null ? "" : r.dif <= -LIMIAR_PP
      ? `<span class="status delta-neg">${ic("desce")}${fmtPP(r.dif)}</span>`
      : r.dif >= LIMIAR_PP ? `<span class="status delta-pos">${ic("sobe")}${fmtPP(r.dif)}</span>` : fmtPP(r.dif);
    const badges = (r.n_itens === 1 ? ` <span class="badge warn" title="Descritor avaliado por um único item: o resultado reflete aquela questão">${ic("alerta")}1 item</span>` : "") +
                   (r.d.matriz === "BNCC" ? ` <span class="badge">BNCC</span>` : "") +
                   (r.baixa ? ` <span class="badge warn" title="Menos de ${LIMITE} respostas: ler com muita cautela">${ic("alerta")}&lt; ${LIMITE} resp.</span>` : "");
    return `<tr data-cod="${esc(r.cod)}" class="${st.desc === r.cod ? "sel" : ""}">
      <td><b>${esc(r.cod)}</b>${badges}</td>
      <td class="desc">${esc(r.d.descricao || "(não disponível)")}<div class="muted" style="font-size:12px">${esc(r.topico)}</div></td>
      <td class="num">${r.n_itens}</td><td class="num">${fmtInt(r.n_resp)}</td>
      <td class="num"><b>${fmtPct(r.mun)}</b></td><td class="num">${fmtPct(r.rj)}</td><td class="num">${fmtPct(r.br)}</td>
      <td class="num">${st_}</td><td class="num">${fmtPct(r.branco)}</td></tr>`;
  }).join("");
  const t = $("tabela");
  t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
  t.querySelectorAll("th[data-k]").forEach(h => {
    const go = () => {
      const k = h.dataset.k;
      st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : (k === "ordem" ? 1 : -1) };
      renderTabela(ds);
    };
    h.onclick = go; h.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  t.querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => selecionar(tr.dataset.cod));
}

/* ---------- tela: estados (ECharts, carregado só quando a aba abre) ---------- */
const EC = {};               // instâncias ECharts por id do contêiner
let EC_PRONTO = null;
const regiao = id => REGIAO[Math.floor(id / 10)];
const nomeUF = id => D.ufs.find(u => u.id === id);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const escuro = () => document.documentElement.dataset.theme === "dark" ||
  (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

function prepararEstados() {
  return EC_PRONTO ||= (async () => {
    if (!window.echarts) await new Promise((ok, falha) => {
      const s = Object.assign(document.createElement("script"), { src: ECHARTS_URL, onload: ok });
      s.onerror = () => falha(new Error("não foi possível carregar a biblioteca ECharts."));
      document.head.appendChild(s);
    });
    const r = await fetch(DIR_DADOS + "br_uf.geojson");
    if (!r.ok) throw new Error(`não foi possível ler ${DIR_DADOS}br_uf.geojson (HTTP ${r.status}).`);
    const G = await r.json();
    for (const f of G.features) f.properties.name = nomeUF(f.properties.id)?.sigla;
    echarts.registerMap("BR", G);
  })().catch(e => {
    EC_PRONTO = null;
    mostrarErro(`<b>O mapa não pôde ser montado:</b> ${esc(e.message)}`);
    throw e;
  });
}
function grafico(id) {
  const box = $(id);
  if (EC[id] && EC[id].getDom() === box) return EC[id];
  return (EC[id] = echarts.init(box, null, { renderer: "svg" }));
}

// Paletas do design system (seq-1..5, div-1..7): sequencial em petróleo e divergente ferrugem ↔ petróleo, cinza no meio
function paletas() {
  return escuro()
    ? { seq: ["#12404e", "#1d6378", "#3a8ba3", "#7dc0d2", "#bfe3ec"],
        div: ["#f4a57e", "#c9692e", "#6e3a1f", "#33353b", "#1e5566", "#3e97b0", "#a6dce9"] }
    : { seq: ["#a9d3de", "#6fb0c2", "#3a8ba3", "#0e5a73", "#08394a"],
        div: ["#8a3410", "#c2571e", "#edb48f", "#d8dbdf", "#9ccad6", "#2f849e", "#0b4558"] };
}
// texto legível sobre a cor de fundo
function tinta(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#0f1e33" : "#ffffff";
}
const fmtNum = (v, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

// Faixas do mapa (mapa de gradação): classes de mesma largura em % ou limites fixos em pp
const LIM_DIF = [-10, -5, -2, 2, 5, 10];
function faixas(valores) {
  const P = paletas();
  if (st.modo === "dif") {
    const lab = ["< −10 pp", "−10 a −5", "−5 a −2", "−2 a +2", "+2 a +5", "+5 a +10", "> +10 pp"];
    return { cores: P.div, labels: lab, classe: v => {
      const i = LIM_DIF.findIndex((l, k) => k < 3 ? v < l : v <= l);
      return i < 0 ? 6 : i;
    } };
  }
  const lo = Math.floor(Math.min(...valores)), hi = Math.ceil(Math.max(...valores));
  const passo = Math.max(1, Math.ceil((hi - lo) / 5));
  const lab = P.seq.map((_, i) => `${lo + i * passo}–${lo + (i + 1) * passo}%`);
  return { cores: P.seq, labels: lab, classe: v => Math.min(4, Math.max(0, Math.floor((v - lo) / passo))) };
}
function faixasDif() { const m = st.modo; st.modo = "dif"; const f = faixas([]); st.modo = m; return f; }

// Indicador escolhido: acerto geral, um tópico ("T|nome") ou um descritor
function indicador(ds) {
  if (st.ind.startsWith("T|")) {
    const t = st.ind.slice(2), cods = ds.filter(d => d.topico === t).map(d => d.cod);
    if (cods.length) return { cods, nome: t, curto: t.replace(/^[IVX]+\.\s*/, ""), tipo: "tópico" };
  } else if (st.ind !== "geral") {
    const d = ds.find(x => x.cod === st.ind);
    if (d) return { cods: [d.cod], nome: `${d.cod} – ${d.descricao || "(descrição não disponível)"}`, curto: d.cod, tipo: "descritor", d };
  }
  st.ind = "geral";
  return { cods: ds.map(d => d.cod), nome: `Acerto geral em ${DISC_NOME[st.disc]}`, curto: "acerto geral", tipo: "geral" };
}
function montarIndicador(ds) {
  const curto = s => s.length > 80 ? s.slice(0, 78) + "…" : s;
  $("e-ind").innerHTML =
    `<option value="geral">Acerto geral da disciplina</option>` +
    `<optgroup label="Tópicos">${topicosAtivos(ds).map(([t]) => `<option value="T|${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>` +
    `<optgroup label="Descritores">${ds.map(d => `<option value="${esc(d.cod)}">${esc(curto(`${d.cod} · ${d.descricao || "(descrição não disponível)"}`))}</option>`).join("")}</optgroup>`;
  $("e-ind").value = st.ind;
}

function linhasEstados(cods) {
  const br = agregPre("BR", cods);
  const L = D.ufs.map(u => {
    const v = agregPre(`U${u.id}`, cods);
    return v && { u, pct: v.pct, n: v.n_resp, dif: br ? (v.pct - br.pct) * 100 : null };
  }).filter(Boolean).sort((a, b) => b.pct - a.pct);
  L.forEach((r, i) => { r.pos = i + 1; r.v = st.modo === "dif" ? r.dif : r.pct * 100; });
  return { L, br };
}

async function renderEstados() {
  seg("e-disc", "disc"); seg("e-rede", "rede"); seg("e-modo", "modo");
  const ds = descritoresAtivos();
  montarIndicador(ds);
  const ind = indicador(ds);
  $("e-ind").value = st.ind;
  gravarURL(); renderRodape();
  if (!window.echarts || !EC_PRONTO) {
    for (const id of ["e-mapa", "e-rank", "e-heat"]) {
      $(id).classList.add("ec-loading");
      $(id).innerHTML = `<span class="gabarito" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span role="status">Carregando o mapa…</span>`;
    }
    try { await prepararEstados(); } catch (_) {
      for (const id of ["e-mapa", "e-rank", "e-heat"]) $(id).textContent = "Gráfico indisponível (veja o aviso acima).";
      return;
    }
    for (const id of ["e-mapa", "e-rank", "e-heat"]) { $(id).classList.remove("ec-loading"); $(id).textContent = ""; }
    if ($("v-estados").hidden) return;
  }
  await EC_PRONTO;
  const { L, br } = linhasEstados(ind.cods);
  if (!L.length) return;
  if (!L.some(r => r.u.id === st.ufSel)) st.ufSel = L.some(r => r.u.id === st.uf) ? st.uf : L[0].u.id;
  const F = faixas(L.map(r => r.v));
  L.forEach(r => { r.k = F.classe(r.v); r.cor = F.cores[r.k]; });
  const T = {
    ink: cssv("--ink"), ink2: cssv("--ink-2"), muted: cssv("--muted"), grid: cssv("--grid"),
    surface: cssv("--surface"), br: cssv("--s-br"), font: getComputedStyle(document.body).fontFamily,
  };
  renderResumoEstados(L, br, ind);
  renderMapa(L, br, ind, F, T);
  renderRanking(L, br, ind, T);
  renderDetalheUF(L, br, ind, ds);
  renderTabelaDescUF(ds);
  renderHeatmap(L, ds, T);
  renderTabelaEstados(L, ind);
}

function tipUF(r, br) {
  const cls = r.dif == null ? "" : r.dif <= -LIMIAR_PP ? "delta-neg" : r.dif >= LIMIAR_PP ? "delta-pos" : "";
  return `<b>${esc(r.u.nome)} (${r.u.sigla})</b><div class="d">${regiao(r.u.id)} · ${r.pos}ª de ${D.ufs.length}</div>
    <div class="tr"><span>Acerto</span><b>${fmtPct(r.pct)}</b></div>
    <div class="tr"><span><i class="menor" style="background:var(--s-br)"></i>Brasil</span><span>${fmtPct(br?.pct)}</span></div>
    <div class="tr"><span>Diferença</span><b class="${cls}">${fmtPP(r.dif)}</b></div>
    <div class="tr muted"><span>Respostas</span><span>${fmtInt(r.n)}</span></div>`;
}
// liga o tooltip da página e o destaque cruzado (mapa ↔ ranking)
function ligarEventos(ch, L, br, outros) {
  ch.off("mousemove"); ch.off("mouseout"); ch.off("click"); ch.off("globalout");
  const achar = p => L.find(r => r.u.sigla === p.name);
  const realce = (tipo, r) => outros().forEach(o => o.dispatchAction({ type: tipo, seriesIndex: 0, dataIndex: L.indexOf(r) }));
  let atual = null;
  ch.on("mousemove", p => {
    const r = achar(p); if (!r) return;
    showTip(p.event.event, tipUF(r, br) + `<div class="d" style="margin:6px 0 0">Clique para selecionar</div>`);
    if (atual !== r) { if (atual) realce("downplay", atual); realce("highlight", r); atual = r; }
  });
  const sair = () => { hideTip(); if (atual) realce("downplay", atual); atual = null; };
  ch.on("mouseout", sair); ch.on("globalout", sair);
  ch.on("click", p => { const r = achar(p); if (r) { hideTip(); st.ufSel = r.u.id; render(); } });
}

function renderResumoEstados(L, br, ind) {
  const max = L[0], min = L[L.length - 1];
  const abaixo = L.filter(r => r.dif <= -LIMIAR_PP).length, acima = L.filter(r => r.dif >= LIMIAR_PP).length;
  const rede = st.rede === "Pública" ? "na rede pública" : "em todas as redes";
  const oque = ind.tipo === "geral" ? `o acerto geral em ${DISC_NOME[st.disc]}`
    : ind.tipo === "tópico" ? `o acerto no tópico ${esc(ind.curto)} (${DISC_NOME[st.disc]})`
    : `o acerto no descritor ${esc(ind.d.cod)} (${DISC_NOME[st.disc]})`;
  const estados = (n, txt, subst) => n === 0 ? `${subst ? "nenhum estado" : "nenhum"} fica ${txt}`
    : n === 1 ? `1${subst ? " estado" : ""} fica ${txt}` : `${n}${subst ? " estados" : ""} ficam ${txt}`;
  const frase = `${oque[0].toUpperCase() + oque.slice(1)}, ${rede}, vai de ${fmtPct(min.pct)} (${esc(min.u.nome)}) a ` +
    `${fmtPct(max.pct)} (${esc(max.u.nome)}). ${(s => s[0].toUpperCase() + s.slice(1))(estados(abaixo, `${LIMIAR_PP} pp ou mais abaixo do Brasil`, true))}; ` +
    `${estados(acima, `${LIMIAR_PP} pp ou mais acima`, false)}.`;
  $("e-tiles").innerHTML = `
    <div class="tile destaque serie-br"><div class="lab"><i class="menor" style="background:var(--s-br)"></i>Brasil · ${ind.tipo === "geral" ? "acerto geral" : esc(ind.curto)}</div>
      <div class="val">${fmtPct(br?.pct)}<span class="pills">
        <span class="pill${abaixo ? " neg" : ""}">${ic("desce")}${abaixo} ${abaixo === 1 ? "estado" : "estados"} abaixo</span>
        <span class="pill${acima ? " pos" : ""}">${ic("sobe")}${acima} acima</span></span></div>
      <p class="frase">${frase}</p>
      <div class="foot">${fmtInt(br?.n_resp)} respostas</div></div>
    <div class="tile"><div class="lab">Maior acerto</div>
      <div class="val">${fmtPct(max.pct)}</div><div class="foot">${esc(max.u.nome)} · ${fmtPP(max.dif)} × Brasil</div></div>
    <div class="tile"><div class="lab">Menor acerto</div>
      <div class="val">${fmtPct(min.pct)}</div><div class="foot">${esc(min.u.nome)} · ${fmtPP(min.dif)} × Brasil</div></div>
    <div class="tile conta"><div class="lab">Distância entre o maior e o menor</div>
      <div class="val">${fmtNum((max.pct - min.pct) * 100, 1)}<span class="muted" style="font-size:16px;font-weight:500"> pp</span></div>
      <div class="foot">pontos percentuais, de ${esc(min.u.nome)} a ${esc(max.u.nome)}</div></div>`;
}

function renderMapa(L, br, ind, F, T) {
  const ch = grafico("e-mapa");
  $("e-map-title").textContent = ind.nome;
  $("e-map-sub").textContent = st.modo === "dif"
    ? `Diferença de cada estado para o Brasil (${fmtPct(br?.pct)}), em pontos percentuais. Vermelho: abaixo; azul: acima.`
    : `Percentual de acerto, em ${F.cores.length} faixas de mesma largura. Mais escuro = maior acerto.`;
  $("e-mapa").setAttribute("aria-label", `Mapa do Brasil por estado: ${ind.nome}`);
  ch.setOption({
    animationDurationUpdate: 300,
    textStyle: { fontFamily: T.font },
    series: [{
      type: "map", map: "BR", roam: false, selectedMode: false, aspectScale: 0.95,
      left: 4, right: 4, top: 4, bottom: 4,
      label: { show: true, fontSize: 10, fontWeight: 600 },
      itemStyle: { borderColor: T.surface, borderWidth: 0.8 },
      data: L.map(r => {
        const sel = r.u.id === st.ufSel, lc = tinta(r.cor);
        return {
          name: r.u.sigla, value: r.v,
          itemStyle: { areaColor: r.cor, borderColor: sel ? T.ink : T.surface, borderWidth: sel ? 2.5 : 0.8 },
          label: { color: lc },
          emphasis: { itemStyle: { areaColor: r.cor, borderColor: T.ink, borderWidth: 2 }, label: { color: lc } },
        };
      }),
    }],
  }, true);
  ligarEventos(ch, L, br, () => [EC["e-rank"]].filter(Boolean));

  // legenda: faixas com nº de estados; passar o mouse destaca os estados da faixa
  const leg = $("e-leg");
  leg.innerHTML = F.cores.map((c, i) => {
    const n = L.filter(r => r.k === i).length;
    return `<button type="button" class="cls" data-k="${i}" title="${n} ${n === 1 ? "estado" : "estados"}"><i style="background:${c}"></i>${F.labels[i]} <b>${n}</b></button>`;
  }).join("") + (st.modo === "pct" && br ? `<span class="cls"><i style="background:none;border-top:2px dashed var(--s-br);height:0;border-radius:0"></i>Brasil ${fmtPct(br.pct)}</span>` : "");
  leg.querySelectorAll("button").forEach(b => {
    const idx = L.map((r, i) => r.k === +b.dataset.k ? i : -1).filter(i => i >= 0);
    const acao = tipo => () => idx.length && [ch, EC["e-rank"]].forEach(c => c?.dispatchAction({ type: tipo, seriesIndex: 0, dataIndex: idx }));
    b.onmouseenter = b.onfocus = acao("highlight");
    b.onmouseleave = b.onblur = acao("downplay");
  });
}

function renderRanking(L, br, ind, T) {
  const deitado = $("e-rank").clientWidth < 620;   // celular: barras horizontais, uma linha por estado
  $("e-rank").style.height = deitado ? `${L.length * 20 + 50}px` : "";
  const ch = grafico("e-rank");
  ch.resize();
  const dif = st.modo === "dif";
  const ref = dif ? 0 : (br?.pct ?? 0) * 100;
  const fmtV = v => dif ? fmtPP(v) : fmtNum(v, 1) + "%";
  $("e-rank").setAttribute("aria-label", `Ranking dos estados: ${ind.nome}`);
  ch.setOption({
    animationDurationUpdate: 300,
    textStyle: { fontFamily: T.font },
    grid: deitado ? { left: 34, right: 48, top: 24, bottom: 8 } : { left: 44, right: 12, top: 24, bottom: 28 },
    [deitado ? "yAxis" : "xAxis"]: {
      type: "category", data: L.map(r => r.u.sigla), inverse: deitado,
      axisTick: { show: false }, axisLine: { lineStyle: { color: T.grid } },
      axisLabel: {
        interval: 0, fontSize: 11, color: T.ink2,
        formatter: s => s === nomeUF(st.ufSel)?.sigla ? `{sel|${s}}` : s,
        rich: { sel: { color: T.ink, fontWeight: 700, fontSize: 11 } },
      },
    },
    [deitado ? "xAxis" : "yAxis"]: {
      type: "value", position: deitado ? "top" : undefined, ...(dif ? {} : { min: 0, max: v => Math.min(100, Math.ceil(v.max / 10) * 10) }),
      splitLine: { lineStyle: { color: T.grid } }, axisLabel: { color: T.muted, fontSize: 11, formatter: v => dif ? `${v > 0 ? "+" : ""}${v}` : `${v}%` },
    },
    series: [{
      type: "bar", barCategoryGap: "28%",
      data: L.map(r => {
        const sel = r.u.id === st.ufSel;
        return {
          value: r.v,
          itemStyle: { color: r.cor, borderColor: sel ? T.ink : "transparent", borderWidth: sel ? 1.5 : 0,
            borderRadius: deitado ? (r.v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4]) : (r.v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]) },
          label: { show: sel, position: deitado ? (r.v >= 0 ? "right" : "left") : (r.v >= 0 ? "top" : "bottom"), formatter: () => fmtV(r.v), color: T.ink, fontWeight: 650, fontSize: 11 },
        };
      }),
      emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1.5 } },
      markLine: {
        silent: true, symbol: "none", animation: false,
        lineStyle: { color: T.br, type: [5, 4], width: 2 },
        label: { formatter: dif ? "Brasil" : `Brasil ${fmtNum(ref, 1)}%`, position: deitado ? "end" : "insideEndTop", color: T.ink2, fontSize: 11 },
        data: [{ [deitado ? "xAxis" : "yAxis"]: ref }],
      },
    }],
  }, true);
  ligarEventos(ch, L, br, () => [EC["e-mapa"]].filter(Boolean));
}

function renderDetalheUF(L, br, ind, ds) {
  const r = L.find(x => x.u.id === st.ufSel);
  const box = $("e-det");
  if (!r) { box.innerHTML = ""; return; }
  const cls = r.dif == null ? "" : r.dif <= -LIMIAR_PP ? "neg" : r.dif >= LIMIAR_PP ? "pos" : "";
  const reg = L.filter(x => regiao(x.u.id) === regiao(r.u.id));
  const posReg = reg.indexOf(r) + 1;
  // descritores do estado em relação ao Brasil (só faz sentido quando o indicador reúne vários)
  let listas = "";
  if (ind.cods.length > 1) {
    const ds_ = ds.filter(d => ind.cods.includes(d.cod)).map(d => {
      const u = valPre(`U${r.u.id}`, d.cod), b = valPre("BR", d.cod);
      return { d, dif: u && b ? (u.pct - b.pct) * 100 : null };
    }).filter(x => x.dif != null);
    // etiquetas compactas (código + diferença; nome no title): a lista completa com nomes é a tabela "Descritores de …" logo abaixo
    const item = x => `<button type="button" class="etq ${x.dif < 0 ? "delta-neg" : "delta-pos"}" data-cod="${esc(x.d.cod)}"
        title="${esc(x.d.cod)}: ${esc(x.d.descricao || "(descrição não disponível)")}" aria-label="${esc(x.d.cod)}, ${fmtPP(x.dif)}: ${esc(x.d.descricao || "")}">
        <b>${esc(x.d.cod)}</b>${fmtPP(x.dif)}</button>`;
    const neg = ds_.filter(x => x.dif < 0).sort((a, b) => a.dif - b.dif).slice(0, 3);
    const pos = ds_.filter(x => x.dif > 0).sort((a, b) => b.dif - a.dif).slice(0, 3);
    listas = `<h3 class="delta-neg">${ic("desce")}Mais abaixo do Brasil</h3><div class="etqs">${neg.map(item).join("") || `<span class="empty">Nenhum.</span>`}</div>
      <h3 class="delta-pos">${ic("sobe")}Mais acima do Brasil</h3><div class="etqs">${pos.map(item).join("") || `<span class="empty">Nenhum.</span>`}</div>`;
  }
  box.innerHTML = `
    <div class="eyebrow">Estado selecionado</div>
    <h2>${esc(r.u.nome)} <span class="badge">${r.u.sigla}</span></h2>
    <p class="note">${regiao(r.u.id)} · ${esc(ind.nome)}</p>
    <div class="uf-big">${fmtPct(r.pct)}${r.dif == null ? "" : `<span class="pill ${cls}">${fmtPP(r.dif)} × Brasil</span>`}</div>
    <div class="bars">${[["Estado", r.pct, "var(--s-rj)", "losango"], ["Brasil", br?.pct, "var(--s-br)", "menor"]].map(([n, v, c, mk]) => `
      <div class="bar-row"><span class="bl"><i class="${mk}" style="background:${c}"></i>${n}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${v == null ? 0 : (v * 100).toFixed(1)}%;background:${c}"></div></div>
        <span class="bv">${fmtPct(v)}</span></div>`).join("")}</div>
    <div class="kv">
      <span>Posição no Brasil</span><span>${r.pos}ª de ${L.length}</span>
      <span>Posição no ${regiao(r.u.id)}</span><span>${posReg}ª de ${reg.length}</span>
      <span>Respostas</span><span>${fmtInt(r.n)}</span>
      <span>Municípios no painel</span><span>${fmtInt(r.u.n_municipios)}</span>
    </div>
    ${listas}
    <button class="btn" type="button" id="e-ir-painel">Ver os municípios de ${esc(r.u.nome)}${ic("seta")}</button>`;
  box.querySelectorAll(".etq").forEach(b => b.onclick = () => { st.ind = b.dataset.cod; render(); });
  $("e-ir-painel").onclick = async () => {
    st.uf = r.u.id; st.mun = null; $("f-uf").value = st.uf;
    await carregarUF(st.uf);
    location.hash = "#painel";
  };
}

function renderHeatmap(L, ds, T) {
  const box = $("e-heat");
  const F = faixasDif();
  const cel = 26, left = 44, top = 34;
  box.style.minWidth = `${left + ds.length * 30 + 12}px`;
  box.style.height = `${top + L.length * cel + 8}px`;
  const ch = grafico("e-heat");
  ch.resize();
  const dados = [];
  L.forEach((r, y) => ds.forEach((d, x) => {
    const u = valPre(`U${r.u.id}`, d.cod), b = valPre("BR", d.cod);
    if (!u || !b || u.pct == null || b.pct == null) return;
    const dif = (u.pct - b.pct) * 100;
    dados.push({ value: [x, y, dif], r, d, u, b, itemStyle: { color: F.cores[F.classe(dif)] } });
  }));
  $("e-leg-hm").innerHTML = F.cores.map((c, i) => `<span class="cls"><i style="background:${c}"></i>${F.labels[i]}</span>`).join("");
  box.setAttribute("aria-label", "Mapa de calor: diferença de cada estado para o Brasil em cada descritor");
  const selSig = nomeUF(st.ufSel)?.sigla;
  ch.setOption({
    animation: false,
    textStyle: { fontFamily: T.font },
    grid: { left, right: 4, top, bottom: 4 },
    xAxis: {
      type: "category", position: "top", data: ds.map(d => d.cod),
      axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
      axisLabel: { interval: 0, fontSize: 11, color: T.ink2, rotate: ds.length > 24 ? 45 : 0,
        formatter: s => s === st.ind ? `{sel|${s}}` : s, rich: { sel: { color: T.ink, fontWeight: 700, fontSize: 11 } } },
    },
    yAxis: {
      type: "category", inverse: true, data: L.map(r => r.u.sigla),
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { fontSize: 11, color: T.ink2, formatter: s => s === selSig ? `{sel|${s}}` : s,
        rich: { sel: { color: T.ink, fontWeight: 700, fontSize: 11 } } },
    },
    series: [{
      type: "heatmap", data: dados,
      itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1.5 } },
    }],
  }, true);
  ch.off("mousemove"); ch.off("mouseout"); ch.off("globalout"); ch.off("click");
  ch.on("mousemove", p => {
    const { r, d, u, b } = p.data, dif = p.data.value[2];
    showTip(p.event.event, `<b>${esc(r.u.nome)} · ${esc(d.cod)}</b><div class="d">${esc(d.descricao || "(descrição não disponível)")}</div>
      <div class="tr"><span><i class="losango" style="background:var(--s-rj)"></i>Estado</span><b>${fmtPct(u.pct)}</b></div>
      <div class="tr"><span><i class="menor" style="background:var(--s-br)"></i>Brasil</span><span>${fmtPct(b.pct)}</span></div>
      <div class="tr"><span>Diferença</span><b class="${dif <= -LIMIAR_PP ? "delta-neg" : dif >= LIMIAR_PP ? "delta-pos" : ""}">${fmtPP(dif)}</b></div>
      <div class="tr muted"><span>Respostas no estado</span><span>${fmtInt(u.n_resp)}</span></div>
      <div class="d" style="margin:6px 0 0">Clique para levar ${esc(d.cod)} ao mapa</div>`);
  });
  ch.on("mouseout", hideTip); ch.on("globalout", hideTip);
  ch.on("click", p => { hideTip(); st.ind = p.data.d.cod; st.ufSel = p.data.r.u.id; render(); });
}

function renderTabelaEstados(L, ind) {
  $("e-tabela").innerHTML = `<thead><tr><th class="num">Posição</th><th>Estado</th><th>Região</th><th class="num">Respostas</th>
    <th class="num">% acerto</th><th class="num">Dif. × Brasil</th></tr></thead><tbody>` +
    L.map(r => {
      const d = r.dif == null ? "–" : r.dif <= -LIMIAR_PP ? `<span class="status delta-neg">${ic("desce")}${fmtPP(r.dif)}</span>`
        : r.dif >= LIMIAR_PP ? `<span class="status delta-pos">${ic("sobe")}${fmtPP(r.dif)}</span>` : fmtPP(r.dif);
      return `<tr data-uf="${r.u.id}" class="${r.u.id === st.ufSel ? "sel" : ""}"><td class="num">${r.pos}ª</td>
        <td><b>${esc(r.u.nome)}</b> <span class="muted">${r.u.sigla}</span></td><td>${regiao(r.u.id)}</td>
        <td class="num">${fmtInt(r.n)}</td><td class="num"><b>${fmtPct(r.pct)}</b></td><td class="num">${d}</td></tr>`;
    }).join("") + `</tbody>`;
  $("e-tabela").querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => {
    st.ufSel = +tr.dataset.uf; render();
    $("e-det").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
// Descritores do estado selecionado × Brasil (a mesma tabela do painel de municípios, um nível acima)
function linhasDescUF(ds) {
  const id = st.ufSel;
  return ds.map(d => {
    const u = valPre(`U${id}`, d.cod), b = valPre("BR", d.cod);
    const pos = u ? 1 + D.ufs.filter(x => x.id !== id && (valPre(`U${x.id}`, d.cod)?.pct ?? -1) > u.pct).length : null;
    return {
      d, ordem: d.ordem, cod: d.cod, n_itens: d.n_itens, n_resp: u?.n_resp ?? null,
      uf: u?.pct ?? null, br: b?.pct ?? null, dif: u && b ? (u.pct - b.pct) * 100 : null,
      branco: u ? (u.pct_branco ?? 0) + (u.pct_nulo ?? 0) : null, pos,
    };
  });
}
function renderTabelaDescUF(ds) {
  const u = nomeUF(st.ufSel);
  if (!u) return;
  $("e-desc-titulo").textContent = `Descritores de ${u.nome}`;
  $("e-desc-sub").textContent = `${DISC_NOME[st.disc]} · rede ${st.rede === "Pública" ? "pública" : "total"} · ${u.sigla} comparado ao Brasil. Escolha outro estado no mapa ou no ranking.`;
  const linhas = linhasDescUF(ds);
  const { key, dir } = st.sortUF;
  linhas.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null) return 1; if (y == null) return -1;
    return (x - y) * dir;
  });
  const cols = [
    ["ordem", "Descritor"], [null, "Descrição"], ["n_itens", "Itens", "num"], ["n_resp", "Respostas<br>(estado)", "num"],
    ["uf", `Estado (${u.sigla})`, "num"], ["br", "Brasil", "num"], ["dif", "Dif. × Brasil", "num"],
    ["pos", "Posição entre<br>os estados", "num"], ["branco", "Branco/nulo<br>(estado)", "num"],
  ];
  const th = cols.map(([k, t, c]) => {
    const s = k ? `sortable${st.sortUF.key === k ? (st.sortUF.dir > 0 ? " asc" : " desc") : ""}` : "";
    return `<th class="${s} ${c || ""}" ${k ? `data-k="${k}" tabindex="0"` : ""}>${t}</th>`;
  }).join("");
  const tb = linhas.map(r => {
    const dif = r.dif == null ? "–" : r.dif <= -LIMIAR_PP
      ? `<span class="status delta-neg">${ic("desce")}${fmtPP(r.dif)}</span>`
      : r.dif >= LIMIAR_PP ? `<span class="status delta-pos">${ic("sobe")}${fmtPP(r.dif)}</span>` : fmtPP(r.dif);
    const badges = (r.n_itens === 1 ? ` <span class="badge warn" title="Descritor avaliado por um único item: o resultado reflete aquela questão">${ic("alerta")}1 item</span>` : "") +
                   (r.d.matriz === "BNCC" ? ` <span class="badge">BNCC</span>` : "");
    return `<tr data-cod="${esc(r.cod)}" class="${st.ind === r.cod ? "sel" : ""}">
      <td><b>${esc(r.cod)}</b>${badges}</td>
      <td class="desc">${esc(r.d.descricao || "(não disponível)")}<div class="muted" style="font-size:12px">${esc(r.d.topico)}</div></td>
      <td class="num">${r.n_itens}</td><td class="num">${fmtInt(r.n_resp)}</td>
      <td class="num"><b>${fmtPct(r.uf)}</b></td><td class="num">${fmtPct(r.br)}</td><td class="num">${dif}</td>
      <td class="num">${r.pos ? `${r.pos}ª de ${D.ufs.length}` : "–"}</td><td class="num">${fmtPct(r.branco)}</td></tr>`;
  }).join("");
  const t = $("e-tab-desc");
  t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
  t.querySelectorAll("th[data-k]").forEach(h => {
    const go = () => {
      const k = h.dataset.k;
      st.sortUF = { key: k, dir: st.sortUF.key === k ? -st.sortUF.dir : (k === "ordem" || k === "pos" ? 1 : -1) };
      renderTabelaDescUF(ds);
    };
    h.onclick = go; h.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  t.querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => {
    st.ind = tr.dataset.cod; render();
    $("e-mapa").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
function baixarTabelaDescUF() {
  const u = nomeUF(st.ufSel);
  if (!u) return;
  const linhas = linhasDescUF(descritoresAtivos()).sort((a, b) => a.ordem - b.ordem).map(r => [
    r.cod, r.d.descricao || "", r.d.topico, r.n_itens, r.n_resp,
    r.uf == null ? null : +(r.uf * 100).toFixed(1), r.br == null ? null : +(r.br * 100).toFixed(1),
    r.dif == null ? null : +r.dif.toFixed(1), r.pos, r.branco == null ? null : +(r.branco * 100).toFixed(1)]);
  baixarCSV(`descritores_${u.sigla}_${st.disc}_${st.rede === "Pública" ? "publica" : "total"}.csv`,
    ["Descritor", "Descrição", "Tópico", "Itens", "Respostas (estado)", `% Estado (${u.sigla})`, "% Brasil",
     "Dif. × Brasil (pp)", `Posição entre os ${D.ufs.length} estados`, "% Branco/nulo (estado)"], linhas);
}
function baixarTabelaEstados() {
  const ind = indicador(descritoresAtivos());
  const { L } = linhasEstados(ind.cods);
  baixarCSV(`estados_${st.disc}_${st.ind.replace(/[^\w.-]+/g, "_")}_${st.rede === "Pública" ? "publica" : "total"}.csv`,
    ["Posição", "UF", "Estado", "Região", "Indicador", "Respostas", "% acerto", "Dif. × Brasil (pp)"],
    L.map(r => [r.pos, r.u.sigla, r.u.nome, regiao(r.u.id), ind.nome, r.n, +(r.pct * 100).toFixed(1), r.dif == null ? null : +r.dif.toFixed(1)]));
}

/* ---------- metodologia e rodapé ---------- */
function renderMetodologia() {
  $("regras").innerHTML =
    `<thead><tr><th>Regra</th><th>Descrição</th></tr></thead><tbody>` +
    D.metodologia.map(r => `<tr><td><b>${esc(r.regra)}</b></td><td class="desc">${esc(r.descricao)}</td></tr>`).join("") + `</tbody>`;
  if (D.meta.planilha_origem) $("dl-xlsx").setAttribute("href", DIR_FONTE + D.meta.planilha_origem);
  renderRodape();
}
function renderRodape() {
  $("rodape").innerHTML =
    `Fonte: ${esc(D.meta.fonte)}. Dados gerados em ${esc(D.meta.gerado_em)} a partir de <code>${esc(D.meta.planilha_origem)}</code>. ` +
    `Os códigos de município são máscaras do Inep, não códigos do IBGE. <a href="#metodologia">Ver metodologia</a>.`;
}

function render() {
  $("f-bncc").checked = $("e-bncc").checked = st.bncc;
  if (!$("v-estados").hidden) return renderEstados();
  if ($("v-painel").hidden) return;
  document.querySelectorAll(".lg-uf").forEach(e => { e.textContent = `Estado (${ufAtual().sigla})`; });
  seg("f-disc", "disc"); seg("f-rede", "rede"); seg("f-ref", "ref");
  const ds = descritoresAtivos();
  renderResumo(ds);
  renderAtencao(ds);
  renderTopicos(ds);
  renderDetalhe(ds);        // define st.desc antes de desenhar a seleção
  renderDescritores(ds);
  renderTabela(ds);
  renderRodape();
  gravarURL();
}

let rz;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => { Object.values(EC).forEach(c => c.resize()); D && render(); }, 150);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => D && render());
carregar();
