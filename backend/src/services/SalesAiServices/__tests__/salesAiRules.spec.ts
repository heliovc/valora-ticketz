import {
  EntradaDaDecisao,
  REGRAS_PADRAO,
  codigoNasPrimeiras,
  dentroDoHorario,
  extrairCodigo,
  extrairMarcadoresDeVendas,
  lerComandoVal,
  normalizarTelefone,
  produtoDaConversa,
  regrasCompletas,
  removerCodigo,
  shouldAiReply,
  videoDoProduto
} from "../salesAiRules";

describe("parser de código ELO-*", () => {
  it("acha o código entre colchetes, tolerante a caixa e espaços", () => {
    expect(extrairCodigo("Olá! Quero ver uma demonstração do Valora Elo Eventos [ELO-EM1]")).toBe("ELO-EM1");
    expect(extrairCodigo("oi [ elo-site-hero ]")).toBe("ELO-SITE-HERO");
    expect(extrairCodigo("[ELO-S-7F3K] oi")).toBe("ELO-S-7F3K");
  });
  it("ignora texto sem colchetes ou fora do padrão", () => {
    expect(extrairCodigo("ELO-EM1")).toBeNull();
    expect(extrairCodigo("[ELO-]")).toBeNull();
    expect(extrairCodigo("oi, tudo bem?")).toBeNull();
    expect(extrairCodigo(null)).toBeNull();
  });
  it("remove o código do texto e arruma os espaços", () => {
    expect(removerCodigo("Olá! Quero ver a demonstração [ELO-EM2]")).toBe("Olá! Quero ver a demonstração");
    expect(removerCodigo("[ELO-WA] bom dia")).toBe("bom dia");
    expect(removerCodigo("sem código")).toBe("sem código");
  });
  it("procura nas 3 primeiras quando a primeira é só 'oi'", () => {
    expect(codigoNasPrimeiras(["oi", "tudo bem?", "quero ver [ELO-EM3]"], 3)).toEqual({ codigo: "ELO-EM3", indice: 2 });
    expect(codigoNasPrimeiras(["oi", "tudo bem?", "x", "quero ver [ELO-EM3]"], 3)).toBeNull();
    expect(codigoNasPrimeiras(["[ELO-EM1]"], 0)).toEqual({ codigo: "ELO-EM1", indice: 0 });
  });
  it("normaliza telefone para dígitos com DDI 55", () => {
    expect(normalizarTelefone("(21) 93618-6570")).toBe("5521936186570");
    expect(normalizarTelefone("+55 21 93618-6570")).toBe("5521936186570");
  });
});

describe("comandos #val", () => {
  it("lê on, off e pausa", () => {
    expect(lerComandoVal("#val on")).toEqual({ acao: "on" });
    expect(lerComandoVal("#VAL off")).toEqual({ acao: "off" });
    expect(lerComandoVal("#val pausa 2h")).toEqual({ acao: "pausa", minutos: 120 });
    expect(lerComandoVal("#val pausa 30m")).toEqual({ acao: "pausa", minutos: 30 });
    expect(lerComandoVal("#val pausa 1d")).toEqual({ acao: "pausa", minutos: 1440 });
    expect(lerComandoVal("#val qualquer")).toEqual({ acao: "invalido" });
    expect(lerComandoVal("olá #val on")).toBeNull();
  });
});

const AGORA = new Date("2026-10-27T15:00:00Z");

function entrada(sobre: Partial<EntradaDaDecisao> = {}): EntradaDaDecisao {
  return {
    chaveDoAmbiente: true,
    chaveDoPainel: true,
    regras: { ...REGRAS_PADRAO },
    temPlaybook: true,
    conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "novo", aiPausedUntil: null, temAtendente: false },
    contato: { isPersonal: false },
    mensagem: { ehGrupo: false, ehTransmissaoOuStatus: false },
    contadores: { iaNaConversa: 0, iaNoUltimoMinuto: 0, maxPorConversa: 40, maxPorMinuto: 6 },
    dentroDoHorario: true,
    agora: AGORA,
    ...sobre
  };
}

describe("shouldAiReply", () => {
  it("código válido → responde", () => {
    expect(shouldAiReply(entrada())).toEqual({ reply: true, reason: "ok" });
  });
  it("🚨 mensagem pessoal sem código → não responde", () => {
    const d = shouldAiReply(entrada({ conversa: { salesSource: null, salesSourceVia: null, salesStage: null, aiPausedUntil: null, temAtendente: false } }));
    expect(d).toEqual({ reply: false, reason: "sem_origem_elo_eventos" });
  });
  it("código inativo (conversa não atribuída) → não responde", () => {
    // Código inativo não atribui a conversa: ela chega aqui sem origem.
    expect(shouldAiReply(entrada({ conversa: { salesSource: null, salesSourceVia: null, salesStage: null, aiPausedUntil: null, temAtendente: false } })).reply).toBe(false);
  });
  it("grupo → não responde", () => {
    expect(shouldAiReply(entrada({ mensagem: { ehGrupo: true, ehTransmissaoOuStatus: false } }))).toEqual({ reply: false, reason: "grupo_transmissao_ou_status" });
    expect(shouldAiReply(entrada({ mensagem: { ehGrupo: false, ehTransmissaoOuStatus: true } })).reply).toBe(false);
  });
  it("humano respondeu há 1h (pausa de 24h) → não responde", () => {
    const pausa = new Date(AGORA.getTime() + 23 * 3600 * 1000);
    expect(shouldAiReply(entrada({ conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "novo", aiPausedUntil: pausa, temAtendente: false } }))).toEqual({ reply: false, reason: "pausada_atendimento_humano" });
  });
  it("pausa vencida → volta a responder", () => {
    const vencida = new Date(AGORA.getTime() - 1000);
    expect(shouldAiReply(entrada({ conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "novo", aiPausedUntil: vencida, temAtendente: false } })).reply).toBe(true);
  });
  it("🚨 contato pessoal COM código → não responde", () => {
    expect(shouldAiReply(entrada({ contato: { isPersonal: true } }))).toEqual({ reply: false, reason: "contato_pessoal" });
  });
  it("travas: ambiente e painel", () => {
    expect(shouldAiReply(entrada({ chaveDoAmbiente: false })).reason).toBe("chave_do_ambiente_desligada");
    expect(shouldAiReply(entrada({ chaveDoPainel: false })).reason).toBe("chave_do_painel_desligada");
  });
  it("transferida, atendente, horário, limites e playbook", () => {
    expect(shouldAiReply(entrada({ conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "transferido", aiPausedUntil: null, temAtendente: false } })).reason).toBe("conversa_transferida");
    expect(shouldAiReply(entrada({ conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "novo", aiPausedUntil: null, temAtendente: true } })).reason).toBe("atendente_assumiu");
    expect(shouldAiReply(entrada({ dentroDoHorario: false })).reason).toBe("fora_do_horario");
    expect(shouldAiReply(entrada({ contadores: { iaNaConversa: 40, iaNoUltimoMinuto: 0, maxPorConversa: 40, maxPorMinuto: 6 } })).reason).toBe("limite_por_conversa");
    expect(shouldAiReply(entrada({ contadores: { iaNaConversa: 1, iaNoUltimoMinuto: 6, maxPorConversa: 40, maxPorMinuto: 6 } })).reason).toBe("limite_por_minuto");
    expect(shouldAiReply(entrada({ temPlaybook: false })).reason).toBe("sem_playbook_ativa");
  });
  it("cada condição pode ser desligada no painel", () => {
    const semExigir = regrasCompletas({ exigirOrigem: false });
    expect(shouldAiReply(entrada({ regras: semExigir, conversa: { salesSource: null, salesSourceVia: null, salesStage: null, aiPausedUntil: null, temAtendente: false } })).reply).toBe(true);
    const listaDesligada = regrasCompletas({ origemPorLista: false });
    expect(shouldAiReply(entrada({ regras: listaDesligada, conversa: { salesSource: "elo_eventos", salesSourceVia: "lista", salesStage: "novo", aiPausedUntil: null, temAtendente: false } })).reason).toBe("origem_desligada_lista");
    const semPausa = regrasCompletas({ respeitarPausaHumana: false });
    const pausa = new Date(AGORA.getTime() + 3600 * 1000);
    expect(shouldAiReply(entrada({ regras: semPausa, conversa: { salesSource: "elo_eventos", salesSourceVia: "codigo", salesStage: "novo", aiPausedUntil: pausa, temAtendente: false } })).reply).toBe(true);
  });
});

describe("shouldAiReply com sinal de loop", () => {
  it("fica calada com o motivo do loop", () => {
    expect(shouldAiReply(entrada({ motivoDoLoop: "so_cortesia" }))).toEqual({ reply: false, reason: "so_cortesia" });
  });

  it("responde quando não há sinal", () => {
    expect(shouldAiReply(entrada({ motivoDoLoop: null })).reply).toBe(true);
  });

  it("a regra desligada no painel deixa responder", () => {
    const regras = { ...REGRAS_PADRAO, evitarLoop: false };
    expect(shouldAiReply(entrada({ regras, motivoDoLoop: "so_cortesia" })).reply).toBe(true);
  });

  it("configuração salva antes da regra existir já nasce com ela ligada", () => {
    expect(regrasCompletas({ aplicarLimites: true }).evitarLoop).toBe(true);
  });
});

describe("shouldAiReply com outro número da própria empresa", () => {
  it("fica calada, mesmo com tudo o mais liberado", () => {
    expect(shouldAiReply(entrada({ numeroDaEmpresa: true }))).toEqual({ reply: false, reason: "numero_da_empresa" });
  });

  it("vale mesmo com a regra de loop desligada", () => {
    const regras = { ...REGRAS_PADRAO, evitarLoop: false };
    expect(shouldAiReply(entrada({ regras, numeroDaEmpresa: true })).reply).toBe(false);
  });

  it("contato de fora segue atendido", () => {
    expect(shouldAiReply(entrada({ numeroDaEmpresa: false })).reply).toBe(true);
  });
});

describe("horário e marcadores", () => {
  it("horário desligado = sempre dentro; ligado respeita dias e horas (Brasília)", () => {
    expect(dentroDoHorario({ ativo: false }, AGORA)).toBe(true);
    // 15:00 UTC = 12:00 BRT, terça
    expect(dentroDoHorario({ ativo: true, dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" }, AGORA)).toBe(true);
    expect(dentroDoHorario({ ativo: true, dias: [1, 2, 3, 4, 5], inicio: "13:00", fim: "18:00" }, AGORA)).toBe(false);
    expect(dentroDoHorario({ ativo: true, dias: [0, 6], inicio: "08:00", fim: "18:00" }, AGORA)).toBe(false);
  });
  it("tira ETAPA, RESUMO e TRANSFERIR do texto", () => {
    const r = extrairMarcadoresDeVendas("Perfeito, vou chamar o Hélio!\n[[ETAPA=demo_solicitada]]\n[[RESUMO=Ana, buffet em Niterói, quer demo]]");
    expect(r).toEqual({ texto: "Perfeito, vou chamar o Hélio!", etapa: "demo_solicitada", etapaPedida: "demo_solicitada", resumo: "Ana, buffet em Niterói, quer demo", transferir: false, video: false });
    const demoETransferir = extrairMarcadoresDeVendas("Vou chamar o Helio. [[ETAPA=demo_solicitada]] [[TRANSFERIR]]");
    expect(demoETransferir.transferir).toBe(true);
    expect(demoETransferir.etapaPedida).toBe("demo_solicitada");
    const t = extrairMarcadoresDeVendas("Já te passo para o Hélio. [[TRANSFERIR]]");
    expect(t.transferir).toBe(true);
    expect(t.etapa).toBe("transferido");
    expect(t.texto).toBe("Já te passo para o Hélio.");
    expect(extrairMarcadoresDeVendas("x [[ETAPA=inventada]]").etapa).toBeNull();
  });
});

describe("mais de um produto no mesmo número", () => {
  const entrada = (salesSource: string | null): EntradaDaDecisao => ({
    chaveDoAmbiente: true,
    chaveDoPainel: true,
    regras: { ...REGRAS_PADRAO },
    temPlaybook: true,
    conversa: { salesSource, salesSourceVia: "manual", salesStage: "novo", aiPausedUntil: null, temAtendente: false },
    contato: { isPersonal: false },
    mensagem: { ehGrupo: false, ehTransmissaoOuStatus: false },
    contadores: { iaNaConversa: 0, iaNoUltimoMinuto: 0, maxPorConversa: 40, maxPorMinuto: 6 },
    dentroDoHorario: true,
    agora: new Date()
  });

  it("responde conversa do Saúde e do Elo", () => {
    expect(shouldAiReply(entrada("valora_saude")).reply).toBe(true);
    expect(shouldAiReply(entrada("elo_eventos")).reply).toBe(true);
  });

  it("conversa sem origem ou de produto desconhecido continua sem resposta", () => {
    expect(shouldAiReply(entrada(null))).toEqual({ reply: false, reason: "sem_origem_elo_eventos" });
    expect(shouldAiReply(entrada("outro")).reply).toBe(false);
  });

  it("produto sem playbook não responde, mesmo com origem", () => {
    expect(shouldAiReply({ ...entrada("valora_saude"), temPlaybook: false })).toEqual({
      reply: false,
      reason: "sem_playbook_ativa"
    });
  });

  it("contato pessoal segue barrado no Saúde", () => {
    expect(shouldAiReply({ ...entrada("valora_saude"), contato: { isPersonal: true } }).reason).toBe("contato_pessoal");
  });

  it("conversa sem origem usa o produto padrão", () => {
    expect(produtoDaConversa(null)).toBe("elo_eventos");
    expect(produtoDaConversa("valora_saude")).toBe("valora_saude");
    expect(produtoDaConversa("outro")).toBe("elo_eventos");
  });
});

describe("vídeo de demonstração", () => {
  it("o marcador sai do texto e fica no resultado", () => {
    const m = extrairMarcadoresDeVendas("Te explico por aqui. [[VIDEO]]\n[[RESUMO=clínica quer saber mais]]");
    expect(m.video).toBe(true);
    expect(m.texto).toBe("Te explico por aqui.");
    expect(m.resumo).toBe("clínica quer saber mais");
  });

  it("sem marcador, sem vídeo", () => {
    expect(extrairMarcadoresDeVendas("Oi! [[ETAPA=qualificado]]").video).toBe(false);
  });

  it("lê o vídeo do produto certo", () => {
    const produtos = { valora_saude: { videoUrl: " https://site.com/v.mp4 ", videoLegenda: " Veja " } };
    expect(videoDoProduto(produtos, "valora_saude")).toEqual({ url: "https://site.com/v.mp4", legenda: "Veja" });
    expect(videoDoProduto(produtos, "elo_eventos")).toBeNull();
  });

  it("recusa endereço que não é https e configuração vazia", () => {
    expect(videoDoProduto({ valora_saude: { videoUrl: "http://site.com/v.mp4" } }, "valora_saude")).toBeNull();
    expect(videoDoProduto({ valora_saude: {} }, "valora_saude")).toBeNull();
    expect(videoDoProduto(null, "valora_saude")).toBeNull();
  });

  it("legenda vazia vira nula", () => {
    expect(videoDoProduto({ valora_saude: { videoUrl: "https://a.b/v.mp4", videoLegenda: "  " } }, "valora_saude")?.legenda).toBeNull();
  });
});
