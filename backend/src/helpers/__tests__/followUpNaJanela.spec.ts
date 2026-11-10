import { alvoDoFollowUp3, ehDiurno, proximoFollowUp } from "../followUpNaJanela";

// Horários em Brasília (UTC-3) escritos em UTC.
const brt = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, dia, h + 3, m));

describe("follow-ups 1, 2 e 3 dentro da janela de 24h (regra de 10/11/2026)", () => {
  // Lead falou às 14h de 10/11; a IA respondeu às 14h01.
  const base = { ultimaDoLead: brt(10, 14), ultimaNossa: brt(10, 14, 1), enviados: 0, ultimoFollowUpEm: null };

  it("follow-up 1: 2 horas depois da mensagem da IA", () => {
    expect(proximoFollowUp(base, brt(10, 15, 59))).toBeNull();
    expect(proximoFollowUp(base, brt(10, 16, 1))).toBe(1);
  });

  it("follow-up 2: 10 horas depois do 1 — e o que vence de madrugada sai às 8h", () => {
    const e = { ...base, enviados: 1, ultimaNossa: brt(10, 16, 1), ultimoFollowUpEm: brt(10, 16, 1) };
    expect(proximoFollowUp(e, brt(11, 2, 1))).toBeNull(); // 10h depois, mas é madrugada
    expect(proximoFollowUp(e, brt(11, 7, 50))).toBeNull();
    expect(proximoFollowUp(e, brt(11, 8, 0))).toBe(2);
  });

  it("follow-up 3: 1 hora antes de a janela fechar", () => {
    const e = { ...base, enviados: 2, ultimaNossa: brt(11, 8), ultimoFollowUpEm: brt(11, 8) };
    expect(alvoDoFollowUp3(e.ultimaDoLead, brt(11, 8))).toEqual(brt(11, 13));
    expect(proximoFollowUp(e, brt(11, 12, 50))).toBeNull();
    expect(proximoFollowUp(e, brt(11, 13))).toBe(3);
  });

  it("follow-up 3 que cairia de madrugada sai no último horário antes das 22h", () => {
    // Lead às 5h: a janela fecha às 5h do dia seguinte; o ideal (4h) é madrugada.
    expect(alvoDoFollowUp3(brt(10, 5), brt(10, 17))).toEqual(brt(10, 21, 50));
  });

  it("follow-up 3 sem horário permitido depois do 2: não sai", () => {
    // 2 às 21h50; janela fecha às 5h; de 22h50 a 4h50 é tudo madrugada.
    expect(alvoDoFollowUp3(brt(10, 5), brt(10, 21, 50))).toBeNull();
  });

  it("depois do 3, nada; janela fechada, nada", () => {
    expect(proximoFollowUp({ ...base, enviados: 3, ultimoFollowUpEm: brt(11, 13) }, brt(11, 13, 30))).toBeNull();
    expect(proximoFollowUp(base, brt(11, 14))).toBeNull();
  });

  it("lead respondeu no meio: a contagem é da nova mensagem dele, volta ao 1", () => {
    const novo = { ultimaDoLead: brt(11, 9), ultimaNossa: brt(11, 9, 1), enviados: 0, ultimoFollowUpEm: null };
    expect(proximoFollowUp(novo, brt(11, 11, 5))).toBe(1);
  });

  it("nunca entre 22h e 8h", () => {
    expect(ehDiurno(brt(10, 21, 59))).toBe(true);
    expect(ehDiurno(brt(10, 22))).toBe(false);
    expect(ehDiurno(brt(10, 7, 59))).toBe(false);
    expect(ehDiurno(brt(10, 8))).toBe(true);
    // Lead às 21h, IA às 21h: o 1 vence às 23h e espera as 8h.
    const noite = { ultimaDoLead: brt(10, 21), ultimaNossa: brt(10, 21), enviados: 0, ultimoFollowUpEm: null };
    expect(proximoFollowUp(noite, brt(10, 23))).toBeNull();
    expect(proximoFollowUp(noite, brt(11, 8))).toBe(1);
  });
});
