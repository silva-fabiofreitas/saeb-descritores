"use strict";
const DIR_DADOS = "data/";   // dados.json, municipios.json e uf/<ID_UF>.json
const DIR_FONTE = "fonte/";  // planilha de origem (download)
const LIMITE = 30;          // respostas mínimas para confiabilidade
const LIMIAR_PP = 5;        // diferença destacada (pontos percentuais)
const N_ATENCAO = 4;        // itens em cada lista de pontos de atenção
const S = { mun: "var(--s-mun)", UF: "var(--s-rj)", BR: "var(--s-br)" };
const NOME = { mun: "Município", get UF() { return `Estado (${ufAtual().sigla})`; }, BR: "Brasil" };
const DISC_NOME = { LP: "Língua Portuguesa", MT: "Matemática" };

const st = { disc: "LP", uf: null, mun: null, rede: "Pública", ref: "UF", bncc: false, desc: null, sort: { key: "ordem", dir: 1 } };
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
    const el = $("erro");
    el.style.display = "block";
    el.innerHTML = `<b>Não foi possível ler <code>${DIR_DADOS}dados.json</code>.</b> ${esc(e.message)}<br>
      Se você abriu o arquivo com duplo clique, o navegador bloqueia a leitura. Publique a pasta no GitHub Pages
      ou rode <code>python -m http.server</code> dentro dela e acesse <code>http://localhost:8000</code>.`;
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
      const el = $("erro");
      el.style.display = "block";
      el.innerHTML = `<b>Não foi possível ler <code>${DIR_DADOS}uf/${id}.json</code>.</b> ${esc(e.message)}`;
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
  const met = location.hash.startsWith("#m") && location.hash !== "#painel";
  const sec = met && location.hash !== "#metodologia" ? location.hash : null;   // âncora interna da metodologia
  $("v-painel").hidden = met;
  $("v-metodologia").hidden = !met;
  document.querySelectorAll(".tabs a").forEach(a =>
    a.setAttribute("aria-current", (a.dataset.view === "metodologia") === met ? "page" : "false"));
  if (D) { met ? renderMetodologia() : render(); }
  if (sec) document.querySelector(sec)?.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}
addEventListener("hashchange", rota);

/* ---------- valores ---------- */
// Retorna {pct, n_resp, n_acertos, n_alunos, pct_branco, baixa} para um nível
function val(nivel, cod) {
  const pre = nivel === "mun" ? `M${st.mun}` : nivel === "UF" ? `U${st.uf}` : "BR";
  const key = `${pre}|${st.rede}|${st.disc}|${cod}`;
  const o = IDX[key];
  if (!o) return null;
  const pond = nivel !== "mun" && st.rede === "Total";
  return {
    pct: pond ? o.pct_pond : o.pct, n_resp: o.n_resp, n_acertos: o.n_acertos,
    n_alunos: o.n_alunos, pct_branco: o.pct_branco, pct_nulo: o.pct_nulo,
    baixa: o.n_resp < LIMITE,
  };
}
// Agregado de vários descritores: Σ acertos / Σ respostas (ou média ponderada por respostas do % ponderado)
function agreg(nivel, cods) {
  let num = 0, den = 0, resp = 0;
  for (const c of cods) {
    const v = val(nivel, c); if (!v || v.pct == null) continue;
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
  const cb = $("f-bncc");
  cb.checked = st.bncc;
  cb.onchange = () => { st.bncc = cb.checked; render(); };
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
}
function gravarURL() {
  const p = new URLSearchParams({ disc: st.disc, uf: st.uf, mun: st.mun, rede: st.rede, ref: st.ref });
  if (st.bncc) p.set("bncc", "1");
  if (st.desc) p.set("desc", st.desc);
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
    return `<div class="tr"><span><i style="background:${S[n]}"></i>${NOME[n]}</span><b>${v ? fmtPct(v.pct) : "–"}</b></div>`;
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
function dotPlot(container, rows, opts) {
  // rows: [{tipo:"cab", label} | {tipo:"lin", id, label, sub, warn, vals:{mun,UF,BR}, tip}]
  container.innerHTML = "";
  const W = Math.max(300, container.clientWidth);
  const narrow = W < 560;
  const stack = narrow && opts.stackNarrow;          // rótulo acima dos pontos
  const labW = stack ? 0 : narrow ? (opts.labNarrow || 64) : Math.min(opts.lab || 300, Math.round(W * 0.46));
  const right = 16, top = 26, headH = 30;
  const rowH = stack ? 44 : (opts.rowH || 30);
  let H = top;
  rows.forEach(r => { H += r.tipo === "cab" ? headH : rowH; });
  H += 8;
  // escala ajustada aos dados (de 10 em 10 pontos), para separar os pontos
  const todos = rows.flatMap(r => r.tipo === "lin" ? ["mun", "UF", "BR"].map(n => r.vals[n]?.pct).filter(v => v != null) : []);
  const lo = Math.max(0, Math.floor((Math.min(...todos) - 0.03) * 10) / 10);
  const hi = Math.min(1, Math.ceil((Math.max(...todos) + 0.03) * 10) / 10);
  const x0 = labW + (stack ? 4 : 8), x1 = W - right;
  const X = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.aria });

  // grade e eixo
  const g = el("g", { class: "grid" }, svg);
  const passo = narrow && (hi - lo) > 0.4 ? 0.2 : 0.1;
  for (let t = lo; t <= hi + 1e-9; t += passo) {
    el("line", { x1: X(t), x2: X(t), y1: top - 6, y2: H - 4 }, g);
    const tk = el("g", { class: "tick" }, svg);
    const ancora = X(t) < 16 ? "start" : X(t) > W - 16 ? "end" : "middle";
    const tx = el("text", { x: X(t), y: top - 12, "text-anchor": ancora }, tk);
    tx.textContent = Math.round(t * 100) + "%";
  }

  let y = top;
  for (const r of rows) {
    if (r.tipo === "cab") {
      const t = el("text", { x: 0, y: y + 20, class: "topic-label" }, svg);
      t.textContent = narrow && r.label.length > 44 ? r.label.slice(0, 42) + "…" : r.label;
      y += headH; continue;
    }
    const cy = stack ? y + rowH - 12 : y + rowH / 2;
    const hit = el("rect", { x: 0, y, width: W, height: rowH, rx: 6, class: "row-hit" + (opts.selected === r.id ? " sel" : "") }, svg);
    // rótulo
    const lab = el("text", { x: 4, y: stack ? y + 15 : cy + 4 }, svg);
    if (r.code) {
      const c = el("tspan", { class: "code" }, lab); c.textContent = r.code;
      if (r.warn) { const w = el("tspan", { class: "warn", dx: 3 }, lab); w.textContent = "!"; }
      if (!narrow && r.label) {
        const maxCh = Math.floor((labW - 56) / 6.4);
        const s = el("tspan", { x: 52 }, lab);
        s.textContent = r.label.length > maxCh ? r.label.slice(0, maxCh - 1) + "…" : r.label;
      }
    } else {
      const maxCh = stack ? 60 : Math.floor((labW - 8) / 6.6);
      lab.textContent = r.label.length > maxCh ? r.label.slice(0, maxCh - 1) + "…" : r.label;
    }
    // faixa entre min e max
    const vs = ["mun", "UF", "BR"].map(n => r.vals[n]?.pct).filter(v => v != null);
    if (vs.length > 1) el("line", { x1: X(Math.min(...vs)), x2: X(Math.max(...vs)), y1: cy, y2: cy, class: "rng" }, svg);
    // pontos: Brasil, estado, município por cima
    for (const n of ["BR", "UF", "mun"]) {
      const v = r.vals[n]; if (!v || v.pct == null) continue;
      const hollow = n === "mun" && v.baixa;
      el("circle", {
        cx: X(v.pct), cy, r: n === "mun" ? 6 : 5, class: "dot",
        fill: hollow ? "var(--surface)" : S[n],
        ...(hollow ? { stroke: S[n], "stroke-width": 2.5 } : {}),
      }, svg);
    }
    hit.addEventListener("mousemove", e => showTip(e, r.tip));
    hit.addEventListener("mouseleave", hideTip);
    if (opts.onClick) hit.addEventListener("click", () => { hideTip(); opts.onClick(r.id); });
    // trazer hit para frente sem cobrir pontos visualmente (transparente)
    svg.appendChild(hit);
    y += rowH;
  }
  container.appendChild(svg);
}

/* ---------- 1. resumo ---------- */
function renderResumo(ds) {
  const cods = ds.map(d => d.cod);
  const a = { mun: agreg("mun", cods), UF: agreg("UF", cods), BR: agreg("BR", cods) };
  const dif = a.mun && a[st.ref] ? (a.mun.pct - a[st.ref].pct) * 100 : null;
  const cls = dif == null ? "" : dif <= -LIMIAR_PP ? "neg" : dif >= LIMIAR_PP ? "pos" : "";
  const disc = DISC_NOME[st.disc];
  const rede = st.rede === "Pública" ? "na rede pública" : "em todas as redes";

  // frase-resumo
  const lista = difs(ds).filter(x => x.dif != null && !x.m.baixa);
  const abaixo = lista.filter(x => x.dif <= -LIMIAR_PP).length;
  const acima = lista.filter(x => x.dif >= LIMIAR_PP).length;
  const comp = dif == null ? "" : Math.abs(dif) < 0.5 ? `praticamente igual ao ${refNome()}`
    : `<b class="${dif < 0 ? "delta-neg" : "delta-pos"}">${fmtPP(Math.abs(dif)).replace("+", "")} ${dif < 0 ? "abaixo" : "acima"}</b> do ${refNome()}`;
  $("headline").innerHTML = a.mun
    ? `Em <b>${disc}</b>, ${rede}, os alunos de <b>${esc(nomeMun(st.mun))}</b> acertaram <b>${fmtPct(a.mun.pct)}</b> das questões, ` +
      `${comp}. ${lista.length ? `Em <b>${abaixo}</b> de ${lista.length} descritores o município fica ${LIMIAR_PP} pp ou mais abaixo; em <b>${acima}</b>, ${LIMIAR_PP} pp ou mais acima.` : ""}`
    : `Sem dados de ${disc} ${rede} para ${esc(nomeMun(st.mun))}.`;

  $("tiles").innerHTML = `
    <div class="tile main"><div class="lab"><i style="background:var(--s-mun)"></i>Município · acerto geral</div>
      <div class="val">${fmtPct(a.mun?.pct)}${dif == null ? "" : `<span class="pill ${cls}">${fmtPP(dif)} × ${refCurto()}</span>`}</div>
      <div class="foot">${fmtInt(a.mun?.n_resp)} respostas · ${disc}</div></div>
    <div class="tile"><div class="lab"><i style="background:var(--s-rj)"></i>${esc(ufAtual().nome)}</div>
      <div class="val">${fmtPct(a.UF?.pct)}</div><div class="foot">${fmtInt(a.UF?.n_resp)} respostas</div></div>
    <div class="tile"><div class="lab"><i style="background:var(--s-br)"></i>Brasil</div>
      <div class="val">${fmtPct(a.BR?.pct)}</div><div class="foot">${fmtInt(a.BR?.n_resp)} respostas</div></div>
    <div class="tile"><div class="lab">Descritores abaixo ${st.ref === "UF" ? "do estado" : "do Brasil"}</div>
      <div class="val ${abaixo ? "delta-neg" : ""}">${lista.length ? abaixo : "–"}<span class="muted" style="font-size:16px;font-weight:500"> de ${lista.length}</span></div>
      <div class="foot">diferença de ${LIMIAR_PP} pp ou mais</div></div>`;
}

/* ---------- 2. pontos de atenção ---------- */
function renderAtencao(ds) {
  const lista = difs(ds).filter(x => x.dif != null && !x.m.baixa);
  const item = x => `<li><button type="button" data-cod="${esc(x.d.cod)}" title="${esc(x.d.descricao || "")}">
      <span class="c">${esc(x.d.cod)}${x.d.n_itens === 1 ? '<b style="color:var(--warning-ink)"> !</b>' : ""}</span>
      <span class="t">${esc(x.d.descricao || "(descrição não disponível)")}</span>
      <span class="v ${x.dif < 0 ? "delta-neg" : "delta-pos"}">${fmtPP(x.dif)}</span></button></li>`;
  const neg = lista.filter(x => x.dif < 0).sort((a, b) => a.dif - b.dif).slice(0, N_ATENCAO);
  const pos = lista.filter(x => x.dif > 0).sort((a, b) => b.dif - a.dif).slice(0, N_ATENCAO);
  $("lst-neg").innerHTML = neg.length ? neg.map(item).join("") : `<li class="empty">Nenhum descritor abaixo da referência.</li>`;
  $("lst-pos").innerHTML = pos.length ? pos.map(item).join("") : `<li class="empty">Nenhum descritor acima da referência.</li>`;
  $("att-note").textContent = `Diferença em relação ao ${refNome()}, só com resultados de ${LIMITE} respostas ou mais.`;
  document.querySelectorAll(".rank button").forEach(b => b.onclick = () => selecionar(b.dataset.cod));
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
  dotPlot($("ch-topicos"), rows, { lab: 420, stackNarrow: true, rowH: 34, aria: "Acerto por tópico: município, estado e Brasil" });
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
    lab: 340, labNarrow: 60, rowH: 28, selected: st.desc,
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
  const badges = (d.n_itens === 1 ? `<span class="badge warn">1 item</span>` : `<span class="badge">${d.n_itens} itens</span>`) +
                 (d.matriz === "BNCC" ? ` <span class="badge">BNCC</span>` : "") +
                 (v.mun?.baixa ? ` <span class="badge warn">&lt; ${LIMITE} resp.</span>` : "");
  $("dt-cod").innerHTML = `${esc(d.cod)} ${badges}`;
  $("dt-desc").textContent = d.descricao || "(descrição não disponível na Matriz de 2001)";
  $("dt-top").textContent = d.topico;
  $("dt-bars").innerHTML = ["mun", "UF", "BR"].map(n => `
    <div class="bar-row"><span class="bl"><i style="background:${S[n]}"></i>${n === "mun" ? "Município" : n === "UF" ? `Estado (${ufAtual().sigla})` : "Brasil"}</span>
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
      ? `<span class="status delta-neg">▼ ${fmtPP(r.dif)}</span>`
      : r.dif >= LIMIAR_PP ? `<span class="status delta-pos">▲ ${fmtPP(r.dif)}</span>` : fmtPP(r.dif);
    const badges = (r.n_itens === 1 ? ` <span class="badge warn">1 item</span>` : "") +
                   (r.d.matriz === "BNCC" ? ` <span class="badge">BNCC</span>` : "") +
                   (r.baixa ? ` <span class="badge warn">&lt; ${LIMITE} resp.</span>` : "");
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
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => D && render(), 150); });
carregar();
