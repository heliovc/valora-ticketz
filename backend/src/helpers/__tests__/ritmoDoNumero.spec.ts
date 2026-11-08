import {
  ABERTURAS_POR_DIA_PADRAO,
  INTERVALO_PADRAO_MS,
  dataEmBrasilia,
  decidirRitmo,
  lerConfigDoRitmo,
  msAteAmanhaAsNove
} from "../ritmoDoNumero";

const config = { intervaloMs: 120_000, maxAberturasPorDia: 30 };
// 08/11/2026 14:00 em Brasília = 17:00 UTC
const agora = new Date("2026-11-08T17:00:00.000Z");

describe("lerConfigDoRitmo", () => {
  it("usa 2 minutos e 30 aberturas quando o ambiente não diz nada", () => {
    expect(lerConfigDoRitmo({})).toEqual({
      intervaloMs: INTERVALO_PADRAO_MS,
      maxAberturasPorDia: ABERTURAS_POR_DIA_PADRAO
    });
    expect(INTERVALO_PADRAO_MS).toBe(120_000);
    expect(ABERTURAS_POR_DIA_PADRAO).toBe(30);
  });

  it("aceita o ambiente, inclusive 0 para desligar, e ignora lixo", () => {
    expect(lerConfigDoRitmo({ FUNIL_QR_INTERVALO_SEGUNDOS: "60", FUNIL_QR_ABERTURAS_POR_DIA: "0" })).toEqual({
      intervaloMs: 60_000,
      maxAberturasPorDia: 0
    });
    expect(lerConfigDoRitmo({ FUNIL_QR_INTERVALO_SEGUNDOS: "abc", FUNIL_QR_ABERTURAS_POR_DIA: "-3" })).toEqual({
      intervaloMs: INTERVALO_PADRAO_MS,
      maxAberturasPorDia: ABERTURAS_POR_DIA_PADRAO
    });
  });
});

describe("dia de Brasília", () => {
  it("vira à meia-noite de Brasília, não à meia-noite UTC", () => {
    expect(dataEmBrasilia(new Date("2026-11-09T02:59:00.000Z"))).toBe("2026-11-08");
    expect(dataEmBrasilia(new Date("2026-11-09T03:00:00.000Z"))).toBe("2026-11-09");
  });

  it("amanhã às 9h de Brasília é 12h UTC do dia seguinte", () => {
    const ms = msAteAmanhaAsNove(agora);
    expect(new Date(agora.getTime() + ms).toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });

  it("às 23h30 de Brasília, amanhã é o dia seguinte em Brasília", () => {
    const tarde = new Date("2026-11-09T02:30:00.000Z"); // 08/11 23:30 em Brasília
    const ms = msAteAmanhaAsNove(tarde);
    expect(new Date(tarde.getTime() + ms).toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });
});

describe("decidirRitmo", () => {
  const base = { agora, proximoLivreEm: null, aberturasHoje: 0, ehAbertura: true, config };

  it("número livre: envia e marca o próximo horário em 2 minutos", () => {
    expect(decidirRitmo(base)).toEqual({ acao: "enviar", novoProximoLivreEm: agora.getTime() + 120_000 });
  });

  it("próximo livre no passado: envia", () => {
    expect(decidirRitmo({ ...base, proximoLivreEm: agora.getTime() - 5_000 }).acao).toBe("enviar");
  });

  it("dentro do intervalo: reserva o horário livre e anda o próximo", () => {
    const livre = agora.getTime() + 90_000;
    expect(decidirRitmo({ ...base, proximoLivreEm: livre })).toEqual({
      acao: "reservar",
      esperarMs: 90_000,
      horarioReservado: livre,
      novoProximoLivreEm: livre + 120_000
    });
  });

  it("três jobs juntos ganham horários espaçados de 2 minutos", () => {
    let proximo: number | null = null;
    const horarios: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const d = decidirRitmo({ ...base, proximoLivreEm: proximo });
      if (d.acao === "enviar") {
        horarios.push(agora.getTime());
        proximo = d.novoProximoLivreEm;
      } else if (d.acao === "reservar") {
        horarios.push(d.horarioReservado);
        proximo = d.novoProximoLivreEm;
      }
    }
    expect(horarios).toEqual([agora.getTime(), agora.getTime() + 120_000, agora.getTime() + 240_000]);
  });

  it("job que chega no horário reservado sai sem reservar outro", () => {
    expect(
      decidirRitmo({ ...base, proximoLivreEm: agora.getTime() + 120_000, horarioReservado: agora.getTime() - 200 })
    ).toEqual({ acao: "enviar", novoProximoLivreEm: null });
  });

  it("teto de aberturas: abertura vai para amanhã às 9h", () => {
    const d = decidirRitmo({ ...base, aberturasHoje: 30 });
    expect(d.acao).toBe("amanha");
    if (d.acao === "amanha") {
      expect(new Date(agora.getTime() + d.esperarMs).toISOString()).toBe("2026-11-09T12:00:00.000Z");
    }
  });

  it("teto vale também para quem já tinha horário reservado", () => {
    expect(decidirRitmo({ ...base, aberturasHoje: 30, horarioReservado: agora.getTime() }).acao).toBe("amanha");
  });

  it("follow-up não conta no teto, mas respeita o intervalo", () => {
    expect(decidirRitmo({ ...base, ehAbertura: false, aberturasHoje: 99 }).acao).toBe("enviar");
    expect(
      decidirRitmo({ ...base, ehAbertura: false, aberturasHoje: 99, proximoLivreEm: agora.getTime() + 60_000 }).acao
    ).toBe("reservar");
  });

  it("intervalo 0 desliga o espaçamento; teto 0 desliga o teto", () => {
    const solto = { intervaloMs: 0, maxAberturasPorDia: 0 };
    expect(
      decidirRitmo({ ...base, config: solto, aberturasHoje: 500, proximoLivreEm: agora.getTime() + 60_000 })
    ).toEqual({ acao: "enviar", novoProximoLivreEm: null });
  });
});
