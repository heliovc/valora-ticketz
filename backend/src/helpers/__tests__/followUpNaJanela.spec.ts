import { alvoDoFollowUp3, ehHorarioComercial, followUpsJaFeitos, proximoFollowUp, proximoFollowUpQr, somarDiasUteis } from "../followUpNaJanela";

// Horários em Brasília (UTC-3) escritos em UTC. Novembro/2026: 10 = terça, 13 = sexta, 14 = sábado.
const brt = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, dia, h + 3, m));

describe("follow-ups 1, 2 e 3 dentro da janela de 24h (regra de 10/11/2026)", () => {
  // Lead falou às 14h de 10/11; a IA respondeu às 14h01.
  const base = { ultimaDoLead: brt(10, 14), ultimaNossa: brt(10, 14, 1), enviados: 0, ultimoFollowUpEm: null };

  it("follow-up 1: 2 horas depois da mensagem da IA", () => {
    expect(proximoFollowUp(base, brt(10, 15, 59))).toBeNull();
    expect(proximoFollowUp(base, brt(10, 16, 1))).toBe(1);
  });

  it("follow-up 2: 10 horas depois do 1 — e o que vence fora do horário comercial sai às 9h", () => {
    const e = { ...base, enviados: 1, ultimaNossa: brt(10, 16, 1), ultimoFollowUpEm: brt(10, 16, 1) };
    expect(proximoFollowUp(e, brt(11, 2, 1))).toBeNull(); // 10h depois, mas é madrugada
    expect(proximoFollowUp(e, brt(11, 8, 50))).toBeNull(); // antes das 9h
    expect(proximoFollowUp(e, brt(11, 9, 0))).toBe(2);
  });

  it("follow-up 3: 1 hora antes de a janela fechar", () => {
    const e = { ...base, enviados: 2, ultimaNossa: brt(11, 9), ultimoFollowUpEm: brt(11, 9) };
    expect(alvoDoFollowUp3(e.ultimaDoLead, brt(11, 9))).toEqual(brt(11, 13));
    expect(proximoFollowUp(e, brt(11, 12, 50))).toBeNull();
    expect(proximoFollowUp(e, brt(11, 13))).toBe(3);
  });

  it("follow-up 3 que cairia de madrugada sai no último horário comercial (17h50)", () => {
    // Lead às 5h: a janela fecha às 5h do dia seguinte; o ideal (4h) é madrugada.
    expect(alvoDoFollowUp3(brt(10, 5), brt(10, 12))).toEqual(brt(10, 17, 50));
  });

  it("follow-up 3 sem horário comercial depois do 2: não sai", () => {
    // 2 às 17h50; janela fecha às 5h; de 18h50 a 4h50 não há horário comercial.
    expect(alvoDoFollowUp3(brt(10, 5), brt(10, 17, 50))).toBeNull();
  });

  it("depois do 3, nada; janela fechada, nada", () => {
    expect(proximoFollowUp({ ...base, enviados: 3, ultimoFollowUpEm: brt(11, 13) }, brt(11, 13, 30))).toBeNull();
    expect(proximoFollowUp(base, brt(11, 14))).toBeNull();
  });

  it("lead respondeu no meio: a contagem é da nova mensagem dele, volta ao 1", () => {
    const novo = { ultimaDoLead: brt(11, 9), ultimaNossa: brt(11, 9, 1), enviados: 0, ultimoFollowUpEm: null };
    expect(proximoFollowUp(novo, brt(11, 11, 5))).toBe(1);
  });

  it("só em horário comercial: segunda a sexta, das 9h às 18h", () => {
    expect(ehHorarioComercial(brt(10, 9))).toBe(true);
    expect(ehHorarioComercial(brt(10, 17, 59))).toBe(true);
    expect(ehHorarioComercial(brt(10, 18))).toBe(false);
    expect(ehHorarioComercial(brt(10, 8, 59))).toBe(false);
    expect(ehHorarioComercial(brt(10, 21))).toBe(false); // o 8h–22h antigo deixava
    expect(ehHorarioComercial(brt(13, 10))).toBe(true); // sexta
    expect(ehHorarioComercial(brt(14, 10))).toBe(false); // sábado
    expect(ehHorarioComercial(brt(15, 10))).toBe(false); // domingo
    // Lead às 21h, IA às 21h: o 1 vence às 23h e espera as 9h.
    const noite = { ultimaDoLead: brt(10, 21), ultimaNossa: brt(10, 21), enviados: 0, ultimoFollowUpEm: null };
    expect(proximoFollowUp(noite, brt(10, 23))).toBeNull();
    expect(proximoFollowUp(noite, brt(11, 8, 30))).toBeNull();
    expect(proximoFollowUp(noite, brt(11, 9))).toBe(1);
  });

  it("fim de semana: lead que fala sexta à tarde não recebe follow-up no sábado", () => {
    const sexta = { ultimaDoLead: brt(13, 17), ultimaNossa: brt(13, 17, 1), enviados: 0, ultimoFollowUpEm: null };
    expect(proximoFollowUp(sexta, brt(13, 19, 5))).toBeNull(); // sexta depois das 18h
    expect(proximoFollowUp(sexta, brt(14, 10))).toBeNull(); // sábado
  });
});

// Hélio, 12/11/2026: "posso ter feito de forma manual; a IA precisa ler as mensagens antes".
describe("follow-ups já feitos, lidos nas mensagens (inclusive os escritos à mão)", () => {
  const lead = brt(11, 17);
  const msg = (h: number, m: number, sentBy: string | null, fromMe = true) => ({ fromMe, sentBy, createdAt: brt(11, h, m) });

  it("só a resposta ao lead (mesmo em várias mensagens seguidas): nenhum lembrete", () => {
    expect(followUpsJaFeitos([msg(17, 1, "ai"), msg(17, 2, "ai")], lead)).toEqual({ quantos: 0, ultimoEm: null, ultimoPelaEquipe: false });
  });

  it("lembrete escrito à mão no dia seguinte conta como follow-up feito pela equipe", () => {
    const r = followUpsJaFeitos([msg(17, 1, "ai"), { fromMe: true, sentBy: null, createdAt: brt(12, 9, 4) }], lead);
    expect(r).toEqual({ quantos: 1, ultimoEm: brt(12, 9, 4), ultimoPelaEquipe: true });
  });

  it("lembretes da Val e da equipe somam; mensagens antes da última do lead não contam", () => {
    const r = followUpsJaFeitos(
      [msg(10, 0, "humano"), msg(16, 59, null, false), msg(17, 1, "ai"), msg(19, 1, "ai"), msg(21, 0, "humano"), msg(21, 5, "humano")],
      lead
    );
    expect(r).toEqual({ quantos: 2, ultimoEm: brt(11, 21, 5), ultimoPelaEquipe: true });
  });

  it("mensagem sem data (fixture antiga) é ignorada", () => {
    expect(followUpsJaFeitos([{ fromMe: true }, msg(17, 1, "ai")], lead).quantos).toBe(0);
  });
});

// Hélio, 13/11/2026 (caso Claudio): no QR não há janela paga — cadência de ~2 semanas.
describe("cadência longa no QR: 2h, dia útil seguinte, +3 dias úteis, +1 semana", () => {
  it("dias úteis pulam o fim de semana e mantêm a hora", () => {
    expect(somarDiasUteis(brt(13, 17), 1)).toEqual(brt(16, 17)); // sexta → segunda
    expect(somarDiasUteis(brt(11, 16, 5), 3)).toEqual(brt(16, 16, 5)); // quarta → segunda
  });

  const base = { ultimaDoLead: brt(10, 14), ultimaNossa: brt(10, 14, 1), enviados: 0, ultimoFollowUpEm: null };

  it("1: 2h depois da nossa última mensagem", () => {
    expect(proximoFollowUpQr(base, brt(10, 15, 59))).toBeNull();
    expect(proximoFollowUpQr(base, brt(10, 16, 1))).toBe(1);
  });

  it("1 não sai em conversa parada há mais de 3 dias (nada de lembrete atrasado na subida)", () => {
    expect(proximoFollowUpQr(base, brt(13, 15))).toBeNull();
  });

  it("2 no dia útil seguinte, 3 três dias úteis depois, 4 uma semana depois; depois nada", () => {
    const e1 = { ...base, enviados: 1, ultimoFollowUpEm: brt(10, 16, 5) };
    expect(proximoFollowUpQr(e1, brt(11, 16))).toBeNull();
    expect(proximoFollowUpQr(e1, brt(11, 16, 5))).toBe(2);
    const e2 = { ...base, enviados: 2, ultimoFollowUpEm: brt(11, 16, 5) };
    expect(proximoFollowUpQr(e2, brt(13, 17))).toBeNull();
    expect(proximoFollowUpQr(e2, brt(16, 16, 5))).toBe(3);
    const e3 = { ...base, enviados: 3, ultimoFollowUpEm: brt(16, 16, 5) };
    expect(proximoFollowUpQr(e3, brt(23, 16))).toBeNull();
    expect(proximoFollowUpQr(e3, brt(23, 16, 5))).toBe(4);
    expect(proximoFollowUpQr({ ...e3, enviados: 4 }, brt(30, 10))).toBeNull();
  });

  it("vencido fora do horário comercial: sai na abertura seguinte", () => {
    const e1 = { ...base, enviados: 1, ultimoFollowUpEm: brt(13, 17, 55) }; // sexta 17h55 → segunda 17h55
    expect(proximoFollowUpQr(e1, brt(14, 18))).toBeNull(); // sábado
    expect(proximoFollowUpQr(e1, brt(16, 17, 55))).toBe(2);
    const e3 = { ...base, enviados: 3, ultimoFollowUpEm: brt(13, 10) }; // +7 = sexta 20/11 10h
    expect(proximoFollowUpQr(e3, brt(20, 9, 50))).toBeNull();
    expect(proximoFollowUpQr(e3, brt(20, 10))).toBe(4);
  });

  it("silêncio do lead com mais de 21 dias: para", () => {
    const e3 = { ...base, enviados: 3, ultimoFollowUpEm: brt(25, 10) };
    expect(proximoFollowUpQr(e3, brt(32 /* 02/12 */, 10))).toBeNull();
  });
});
