
const CONFIG = {
  SUPABASE_URL: "", 
  SUPABASE_KEY: ""    
};

const NUVEM = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

function mostrarTela(id) {
  ["tela-login", "tela-agendar", "tela-painel"].forEach((t) => ($(t).hidden = t !== id));
  limparAviso();
  window.scrollTo(0, 0);
}

function aviso(texto, tipo) {
  const el = $("aviso");
  el.textContent = texto;
  el.className = "aviso " + tipo;
  el.hidden = false;
}
function limparAviso() { $("aviso").hidden = true; }

function emailValido(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function soDigitos(v) { return v.replace(/\D/g, ""); }

function marcarInvalido(campo, invalido) {
  campo.classList.toggle("invalido", invalido);
}

async function gerarHash(texto) {
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return btoa(unescape(encodeURIComponent(texto))); // alternativa simples
}

function lerLocal(chave) {
  try { return JSON.parse(localStorage.getItem(chave)) || []; } catch (e) { return []; }
}
function gravarLocal(chave, valor) { localStorage.setItem(chave, JSON.stringify(valor)); }

const Dados = {
  sessao() {
    try { return JSON.parse(localStorage.getItem("pp_sessao")); } catch (e) { return null; }
  },
  salvarSessao(s) { localStorage.setItem("pp_sessao", JSON.stringify(s)); },
  sair() { localStorage.removeItem("pp_sessao"); },

  async cadastrar(email, senha) {
    if (NUVEM) {
      const r = await this._sb("/auth/v1/signup", "POST", { email, password: senha });
      if (!r.access_token) {
        return "Cadastro criado. Confirme o e-mail enviado para poder entrar.";
      }
      this.salvarSessao({ nome: email, email, token: r.access_token });
      return null;
    }
    const usuarios = lerLocal("pp_usuarios");
    if (usuarios.some((u) => u.email === email)) throw new Error("Este e-mail já está cadastrado. Use o botão Entrar.");
    usuarios.push({ email, hash: await gerarHash(senha) });
    gravarLocal("pp_usuarios", usuarios);
    this.salvarSessao({ nome: email, email });
    return null;
  },

  async entrar(email, senha) {
    if (NUVEM) {
      const r = await this._sb("/auth/v1/token?grant_type=password", "POST", { email, password: senha });
      this.salvarSessao({ nome: email, email, token: r.access_token });
      return;
    }
    const hash = await gerarHash(senha);
    const u = lerLocal("pp_usuarios").find((x) => x.email === email && x.hash === hash);
    if (!u) throw new Error("E-mail ou senha incorretos.");
    this.salvarSessao({ nome: u.email, email: u.email });
  },

  async salvarSolicitacao(s) {
    if (NUVEM) {
      await this._sb("/rest/v1/solicitacoes_consulta", "POST", s, { Prefer: "return=minimal" });
      return;
    }
    const lista = lerLocal("pp_solicitacoes");
    lista.push({ id: Date.now(), criado_em: new Date().toISOString(), ...s });
    gravarLocal("pp_solicitacoes", lista);
  },

  async listarSolicitacoes() {
    if (NUVEM) {
      return this._sb("/rest/v1/solicitacoes_consulta?select=*&order=criado_em.desc", "GET");
    }
    return lerLocal("pp_solicitacoes").sort((a, b) => b.id - a.id);
  },

  async _sb(caminho, metodo, corpo, extras) {
    const s = this.sessao();
    const resp = await fetch(CONFIG.SUPABASE_URL + caminho, {
      method: metodo,
      headers: Object.assign({
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: "Bearer " + ((s && s.token) || CONFIG.SUPABASE_KEY)
      }, extras || {}),
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const texto = await resp.text();
    const json = texto ? JSON.parse(texto) : {};
    if (!resp.ok) {
      const msg = json.msg || json.error_description || json.message || "Erro ao falar com o servidor.";
      throw new Error(msg);
    }
    return json;
  }
};

/* ---------- Login e cadastro (mesmo formulário) ---------- */
function lerCredenciais() {
  const email = $("login-email").value.trim().toLowerCase();
  const senha = $("login-senha").value;
  if (!emailValido(email)) { aviso("Informe um e-mail válido.", "erro"); return null; }
  if (senha.length < 6) { aviso("A senha precisa ter pelo menos 6 caracteres.", "erro"); return null; }
  return { email, senha };
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const c = lerCredenciais();
  if (!c) return;
  try {
    await Dados.entrar(c.email, c.senha);
    $("form-login").reset();
    abrirPainel();
  } catch (err) {
    aviso(err.message, "erro");
  }
});

$("btn-cadastrar").addEventListener("click", async () => {
  const c = lerCredenciais();
  if (!c) return;
  try {
    const recado = await Dados.cadastrar(c.email, c.senha);
    $("form-login").reset();
    if (recado) return aviso(recado, "ok");
    abrirPainel();
  } catch (err) {
    aviso(err.message, "erro");
  }
});

/* ---------- Pré-agendamento ---------- */
$("ir-agendar").addEventListener("click", () => {
  const hoje = new Date().toISOString().slice(0, 10);
  $("ag-data").min = hoje;
  mostrarTela("tela-agendar");
});
document.querySelectorAll("[data-voltar]").forEach((b) =>
  b.addEventListener("click", () => mostrarTela("tela-login"))
);

$("form-agendar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const campos = {
    tutor: $("ag-tutor"), telefone: $("ag-telefone"),
    animal: $("ag-animal"), sintoma: $("ag-sintoma")
  };
  const tutorOk = campos.tutor.value.trim().length >= 3;
  const telOk = soDigitos(campos.telefone.value).length >= 10;
  const animalOk = campos.animal.value.trim().length >= 1;
  const sintomaOk = campos.sintoma.value.trim().length >= 5;

  marcarInvalido(campos.tutor, !tutorOk);
  marcarInvalido(campos.telefone, !telOk);
  marcarInvalido(campos.animal, !animalOk);
  marcarInvalido(campos.sintoma, !sintomaOk);

  const email = $("ag-email").value.trim();
  if (!tutorOk || !telOk || !animalOk || !sintomaOk) {
    return aviso("Preencha os campos obrigatórios: nome do tutor, telefone com DDD, nome do animal e sintoma.", "erro");
  }
  if (email && !emailValido(email)) {
    return aviso("O e-mail informado não é válido.", "erro");
  }

  try {
    await Dados.salvarSolicitacao({
      nome_tutor: campos.tutor.value.trim(),
      telefone: soDigitos(campos.telefone.value),
      email: email || null,
      nome_animal: campos.animal.value.trim(),
      especie: $("ag-especie").value,
      sintoma: campos.sintoma.value.trim(),
      data_preferida: $("ag-data").value || null
    });
    $("form-agendar").reset();
    Object.values(campos).forEach((c) => marcarInvalido(c, false));
    mostrarTela("tela-login");
    aviso("Solicitação enviada! A recepção entrará em contato para confirmar o horário.", "ok");
  } catch (err) {
    aviso("Não foi possível enviar agora: " + err.message, "erro");
  }
});

/* ---------- Painel da equipe ---------- */
function formatarTelefone(t) {
  const d = soDigitos(String(t));
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
function formatarData(iso, comHora) {
  if (!iso) return "-";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return comHora ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                 : d.toLocaleDateString("pt-BR");
}
function celula(tr, texto, classe) {
  const td = document.createElement("td");
  td.textContent = texto;
  if (classe) td.className = classe;
  tr.appendChild(td);
}

async function abrirPainel() {
  const s = Dados.sessao();
  if (!s) return mostrarTela("tela-login");
  $("boas-vindas").textContent = "Olá, " + s.nome + ".";
  mostrarTela("tela-painel");
  const corpo = $("lista");
  corpo.innerHTML = "";
  try {
    const lista = await Dados.listarSolicitacoes();
    $("vazio").hidden = lista.length > 0;
    lista.forEach((r) => {
      const tr = document.createElement("tr");
      celula(tr, formatarData(r.criado_em, true));
      celula(tr, r.nome_tutor);
      celula(tr, formatarTelefone(r.telefone));
      celula(tr, r.nome_animal + (r.especie ? " (" + r.especie + ")" : ""));
      celula(tr, r.sintoma, "sintoma");
      celula(tr, formatarData(r.data_preferida, false));
      corpo.appendChild(tr);
    });
  } catch (err) {
    aviso("Não foi possível carregar as solicitações: " + err.message, "erro");
  }
}

$("btn-sair").addEventListener("click", () => {
  Dados.sair();
  mostrarTela("tela-login");
});

/* ---------- Início ---------- */
if (Dados.sessao()) abrirPainel();
