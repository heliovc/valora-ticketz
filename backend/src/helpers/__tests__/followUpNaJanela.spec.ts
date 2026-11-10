import { deveMandarFollowUp, ehDiurno } from "../followUpNaJanela";

// Horários em Brasília (UTC-3) escritos em UTC.
const brt = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, dia, h + 3, m));

describe("follow-up dentro da janela de 24h (10/11/2026)", () => {
  it("Casa Grande: respondeu 16h05; manda às 12h05 do dia seguinte (20h depois)", () => {
    const ultima = brt(9, 16, 5);
    expect(deveMandarFollowUp(ultima, brt(10, 11, 55))).toBe(false);
    expect(deveMandarFollowUp(ultima, brt(10, 12, 5))).toBe(true);
  });

  it("nunca de madrugada", () => {
    expect(ehDiurno(brt(10, 3))).toBe(false);
    expect(deveMandarFollowUp(brt(9, 7), brt(10, 3))).toBe(false);
  });

  it("janela fechando de madrugada: antecipa para o horário diurno, depois de 8h de silêncio", () => {
    // Respondeu à 1h: as 20h caem às 21h (fora do diurno) e a janela fecha 0h30.
    const ultima = brt(10, 1);
    expect(deveMandarFollowUp(ultima, brt(10, 8, 30))).toBe(false); // só 7h30 de silêncio
    expect(deveMandarFollowUp(ultima, brt(10, 9, 10))).toBe(true);
  });

  it("se ainda vai haver horário diurno antes de fechar, espera as 20h", () => {
    // Respondeu às 10h: 20h depois = 6h (madrugada), mas das 8h às 9h30 ainda é diurno.
    const ultima = brt(10, 10);
    expect(deveMandarFollowUp(ultima, brt(10, 20))).toBe(false);
    expect(deveMandarFollowUp(ultima, brt(11, 8, 10))).toBe(true);
  });

  it("janela fechada: não manda (só sairia modelo pago)", () => {
    expect(deveMandarFollowUp(brt(9, 10), brt(10, 10))).toBe(false);
  });
});
