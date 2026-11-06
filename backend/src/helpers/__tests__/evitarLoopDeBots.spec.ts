import {
  MensagemDoLoop,
  SEGUNDOS_TROCA_RAPIDA,
  TROCAS_RAPIDAS_MAX,
  ehSoConfirmacao,
  ehSoCortesia,
  motivoDoLoop,
  reabreConversa,
  trocasRapidasSeguidas
} from "../evitarLoopDeBots";

const INICIO = new Date("2026-11-06T13:10:00Z").getTime();

function bot(body: string, segundos: number, sentBy = "ai"): MensagemDoLoop {
  return { fromMe: true, body, sentBy, createdAt: new Date(INICIO + segundos * 1000) };
}

function contato(body: string, segundos: number, mediaType: string | null = null): MensagemDoLoop {
  return { fromMe: false, body, mediaType, createdAt: new Date(INICIO + segundos * 1000) };
}

describe("ehSoCortesia", () => {
  it.each([
    "Obrigada! 🙂",
    "Por nada! Ficamos à disposição 😊",
    "Obrigada! Desejamos um ótimo dia para você também 😊",
    "Disponha! Tenha um ótimo dia. 🙂",
    "Obrigado pela atenção",
    "Valeu!",
    "Muito obrigada, boa tarde",
    "Até mais",
    "Imagina, estamos à disposição",
    "Nós que agradecemos o contato"
  ])("%s", texto => {
    expect(ehSoCortesia(texto)).toBe(true);
  });

  it.each([
    "Oi",
    "Bom dia",
    "Boa tarde, tudo bem?",
    "Boa tarde, tudo bem",
    "Obrigado, quanto custa?",
    "Obrigada, quero ver a demonstração",
    "Sim, obrigada",
    "Obrigado, mas e a taxa",
    "Não tenho interesse, obrigado",
    "Estou aqui",
    "Tenho",
    ""
  ])("não: %s", texto => {
    expect(ehSoCortesia(texto)).toBe(false);
  });
});

describe("ehSoConfirmacao", () => {
  it.each(["ok", "Ok, obrigada", "Certo!", "👍", "🙏🙏", "Perfeito"])("%s", texto => {
    expect(ehSoConfirmacao(texto)).toBe(true);
  });

  it.each(["", "ok?", "ok, pode mandar", "Sim"])("não: %s", texto => {
    expect(ehSoConfirmacao(texto)).toBe(false);
  });
});

describe("reabreConversa", () => {
  it.each([
    "Como funciona?",
    "Mudei de ideia, quero ver",
    "Pode me enviar a proposta",
    "Quanto custa",
    "Temos interesse sim",
    "Queria agendar uma demonstração"
  ])("%s", texto => {
    expect(reabreConversa(texto)).toBe(true);
  });

  it.each([
    "Agradecemos a apresentação. Caso haja interesse, nossa equipe entrará em contato por aqui 😊",
    "Obrigada pela disponibilidade. Ficaremos com seu contato para futuras necessidades",
    "Vou encaminhar sua proposta para a equipe responsável avaliar.",
    "Não temos interesse no momento",
    "Não quero, obrigado"
  ])("não: %s", texto => {
    expect(reabreConversa(texto)).toBe(false);
  });
});

/** Conversa real da Val Saúde com a Bella (ticket 1051, 06/11/2026). */
describe("conversa com a robô da Clínica Valim", () => {
  const abordagem = bot("Olá, tudo bem? Posso te mostrar como funciona? 🙂", 30, "automacao");
  const historico: MensagemDoLoop[] = [
    abordagem,
    contato("Olá! Eu sou a Bella, assistente virtual da Clínica Dr. Ramon Valim. 😊 Pode enviar mais detalhes sobre como funciona a proposta?", 52),
    bot("Claro! A clínica cadastra o procedimento uma vez só.\n\nHoje como vocês fazem o repasse para a equipe?", 63),
    bot("Veja em 24 segundos como funciona o Valora Saúde.", 65),
    contato("Não tenho informações suficientes para responder a essa pergunta. Vou esclarecer os detalhes e retornar para você.", 107),
    bot("Sem problemas! Quer que eu mostre em uma demonstração rápida de 15 minutos?", 117),
    contato("Vou encaminhar sua proposta para a equipe responsável avaliar. Obrigada pelo contato 😊", 138)
  ];

  it("as três primeiras mensagens são respondidas", () => {
    expect(motivoDoLoop(historico.slice(0, 2), "novo")).toBeNull();
    expect(motivoDoLoop(historico.slice(0, 5), "novo")).toBeNull();
    expect(motivoDoLoop(historico, "novo")).toBeNull();
  });

  const despedida = bot("Tudo bem, agradeço o retorno! Se um dia fizer sentido, é só me chamar por aqui. 🙂", 152);

  it.each([
    "Agradecemos a apresentação. Caso haja interesse, nossa equipe entrará em contato por aqui 😊",
    "Obrigada pela disponibilidade. Ficaremos com seu contato para futuras necessidades",
    "Obrigada! Desejamos um ótimo dia para você também 😊",
    "Por nada! Ficamos à disposição 😊"
  ])("depois da despedida, fica calada: %s", texto => {
    const motivo = motivoDoLoop([...historico, despedida, contato(texto, 174)], "sem_interesse");
    expect(motivo).not.toBeNull();
  });

  it("uma pessoa que aparece depois com pergunta é atendida", () => {
    const conversa = [...historico, despedida, contato("Oi, aqui é a Ana, da clínica. Qual é a taxa no Pix?", 4000)];
    expect(motivoDoLoop(conversa, "sem_interesse")).toBeNull();
  });
});

describe("motivoDoLoop", () => {
  it("sem nada novo do contato não há o que decidir", () => {
    expect(motivoDoLoop([bot("Oi", 0)], "novo")).toBeNull();
  });

  it("agradecimento ao disparo recebe uma resposta", () => {
    expect(motivoDoLoop([bot("Abordagem", 0, "automacao"), contato("Obrigada!", 30)], "novo")).toBeNull();
  });

  it("agradecimento depois de falarmos não recebe resposta", () => {
    expect(motivoDoLoop([bot("Disponha!", 0), contato("Obrigada!", 30)], "novo")).toBe("so_cortesia");
  });

  it("vale para bot de atendimento, sem etapa e sem marca de autor", () => {
    const fala: MensagemDoLoop = { fromMe: true, body: "Disponha!", sentBy: null, createdAt: new Date(INICIO) };
    expect(motivoDoLoop([fala, contato("Obrigada!", 30)])).toBe("so_cortesia");
  });

  it("'ok' responde uma pergunta nossa", () => {
    expect(motivoDoLoop([bot("Quer ver funcionando?", 0), contato("ok", 30)], "novo")).toBeNull();
  });

  it("'ok' sem pergunta nossa é fim de papo", () => {
    expect(motivoDoLoop([bot("Fico no aguardo.", 0), contato("ok", 30)], "novo")).toBe("so_cortesia");
  });

  it("sem interesse: 'sim' ao follow-up do funil é atendido", () => {
    const conversa = [
      bot("Tudo bem, agradeço o retorno!", 0),
      bot("Posso te mostrar em 15 minutos?", 900000, "automacao"),
      contato("Sim", 900100)
    ];
    expect(motivoDoLoop(conversa, "sem_interesse")).toBeNull();
  });

  it("sem interesse: conversa encerrada fica calada mesmo sem cortesia", () => {
    const conversa = [bot("Tudo bem, agradeço o retorno!", 0), contato("Registramos sua solicitação", 30)];
    expect(motivoDoLoop(conversa, "sem_interesse")).toBe("conversa_encerrada");
  });

  it("resposta pronta repetida não recebe resposta", () => {
    const pronta = "Recebemos sua mensagem e retornaremos em breve";
    const conversa = [bot("Oi", 0), contato(pronta, 10), bot("Combinado.", 400), contato(pronta, 410)];
    expect(motivoDoLoop(conversa, "novo")).toBe("mensagem_repetida");
  });

  it("texto curto repetido é gente: passa", () => {
    const conversa = [bot("Oi", 0), contato("Sim", 100), bot("E então?", 400), contato("Sim", 500)];
    expect(motivoDoLoop(conversa, "novo")).toBeNull();
  });

  it("áudio não é lido como cortesia", () => {
    expect(motivoDoLoop([bot("Disponha!", 0), contato("Obrigada", 30, "audio")], "novo")).toBeNull();
  });
});

describe("trocas rápidas", () => {
  function rajada(trocas: number, intervalo = 20): MensagemDoLoop[] {
    const conversa: MensagemDoLoop[] = [];
    for (let i = 0; i < trocas; i += 1) {
      conversa.push(bot(`Fala nossa ${i}`, i * intervalo * 2));
      conversa.push(contato(`Fala do outro robô número ${i}`, i * intervalo * 2 + intervalo));
    }
    return conversa;
  }

  it("conta as trocas seguidas", () => {
    expect(trocasRapidasSeguidas(rajada(3))).toBe(3);
  });

  it("texto e vídeo em seguida contam como uma fala", () => {
    const conversa = [bot("Texto", 0), bot("Vídeo", 2), contato("Recebi o material", 20)];
    expect(trocasRapidasSeguidas(conversa)).toBe(1);
  });

  it("para no limite", () => {
    expect(motivoDoLoop(rajada(TROCAS_RAPIDAS_MAX), "novo")).toBe("possivel_loop_de_robos");
  });

  it("abaixo do limite continua respondendo", () => {
    expect(motivoDoLoop(rajada(TROCAS_RAPIDAS_MAX - 1), "novo")).toBeNull();
  });

  it("gente que responde devagar não é barrada", () => {
    expect(motivoDoLoop(rajada(TROCAS_RAPIDAS_MAX + 2, SEGUNDOS_TROCA_RAPIDA + 1), "novo")).toBeNull();
  });

  it("disparo do funil no meio quebra a sequência", () => {
    const conversa = [...rajada(TROCAS_RAPIDAS_MAX - 1), bot("Follow-up", 2000, "automacao"), contato("Oi, vi agora", 2010)];
    expect(trocasRapidasSeguidas(conversa)).toBe(0);
  });

  it("quem escreve horas depois do bot calar é atendido", () => {
    const conversa = [...rajada(TROCAS_RAPIDAS_MAX), contato("Aqui é a Ana, da recepção, pode me ligar", 90000)];
    expect(motivoDoLoop(conversa, "novo")).toBeNull();
  });
});
