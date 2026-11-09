jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/SalesAi", () => ({ __esModule: true, SalesAiConfig: class {} }));
jest.mock("../../TagServices/notificarValora", () => ({ __esModule: true, notificarValoraPorEmail: jest.fn().mockResolvedValue(true) }));
jest.mock("../../WbotServices/AvisoNoProprioWhatsapp", () => ({ __esModule: true, avisarNoProprioWhatsapp: jest.fn().mockResolvedValue(true) }));

import axios from "axios";
import Company from "../../../models/Company";
import Contact from "../../../models/Contact";
import { notificarValoraPorEmail } from "../../TagServices/notificarValora";
import { avisarNoProprioWhatsapp } from "../../WbotServices/AvisoNoProprioWhatsapp";
import { ferramentasDaVal, textoDoAviso } from "../FerramentasDaVal";
import { extrairMarcadoresDeVendas } from "../salesAiRules";

const ticket = { id: 1460, companyId: 2, contactId: 9, salesSource: "valora_saude" } as any;
const cfg = { handoff: { email: "hel@x.com" }, whatsappIds: [8, 13] } as any;

describe("Val marca a demonstração na agenda da Valora", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VALORA_INTERNAL_URL = "http://api:3001/api";
    process.env.VALORA_INTERNAL_SECRET = "s";
    (Company.findByPk as jest.Mock).mockResolvedValue({ id: 2, externalId: "user-valora" });
    (Contact.findByPk as jest.Mock).mockResolvedValue({ name: "Clínica X", number: "5521988887777" });
  });

  it("marcou: avisa por e-mail e no próprio WhatsApp, uma vez só", async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { marcado: true, quando: "qui 12/11 às 10:00", texto: "Marcado e confirmado" } });
    const f = await ferramentasDaVal(ticket, cfg);
    const r1 = await f!.executar([{ nome: "MARCAR_DEMO", args: { data: "12/11/2026", hora: "10:00" } }]);
    await f!.executar([{ nome: "MARCAR_DEMO", args: { data: "12/11/2026", hora: "10:00" } }]);
    expect(r1).toContain("Marcado e confirmado");
    expect(axios.post).toHaveBeenCalledWith(
      "http://api:3001/api/internal/agenda/demo/marcar",
      expect.objectContaining({ tenantId: "user-valora", produto: "valora_saude", ticketId: 1460, data: "12/11/2026", hora: "10:00" }),
      expect.anything()
    );
    expect(notificarValoraPorEmail).toHaveBeenCalledTimes(1);
    expect(notificarValoraPorEmail).toHaveBeenCalledWith(expect.objectContaining({ para: "hel@x.com", ticketId: 1460 }));
    expect(avisarNoProprioWhatsapp).toHaveBeenCalledTimes(1);
    expect(avisarNoProprioWhatsapp).toHaveBeenCalledWith(2, expect.stringContaining("qui 12/11 às 10:00"), [8, 13]);
  });

  it("consultar não avisa ninguém", async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { texto: "Horários livres..." } });
    const f = await ferramentasDaVal(ticket, cfg);
    await f!.executar([{ nome: "CONSULTAR_DEMO", args: {} }]);
    expect(notificarValoraPorEmail).not.toHaveBeenCalled();
    expect(avisarNoProprioWhatsapp).not.toHaveBeenCalled();
  });

  it("agenda fora do ar: a Val pergunta o horário e transfere", async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error("caiu"));
    const f = await ferramentasDaVal(ticket, cfg);
    const r = await f!.executar([{ nome: "MARCAR_DEMO", args: { data: "12/11/2026", hora: "10:00" } }]);
    expect(r).toContain("[[TRANSFERIR]]");
  });

  it("comando repetido na resposta final não vai para o lead", () => {
    const m = extrairMarcadoresDeVendas('Combinado! [[MARCAR_DEMO data="12/11/2026" hora="10:00"]] [[ETAPA=demo_solicitada]]');
    expect(m.texto).toBe("Combinado!");
    expect(m.etapa).toBe("demo_solicitada");
  });

  it("aviso no WhatsApp traz horário, lead e card", () => {
    const t = textoDoAviso({ produto: "elo_eventos", quando: "sex 13/11 às 14:30", remarcado: true, nome: "Casarão", numero: "5521999", ticketId: 2240 });
    expect(t).toContain("REMARCADA");
    expect(t).toContain("sex 13/11 às 14:30");
    expect(t).toContain("Casarão · 5521999");
    expect(t).toContain("#2240");
  });
});
