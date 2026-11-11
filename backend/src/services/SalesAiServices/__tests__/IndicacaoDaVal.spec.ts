jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/ContactCustomField", () => ({ __esModule: true, default: { findOrCreate: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../models/FunnelAction", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/SalesAi", () => ({ __esModule: true, SalesAiConfig: class {} }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: { findOrCreate: jest.fn() } }));
jest.mock("../../../models/TagAutomationRun", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/TicketNote", () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock("../../../models/TicketTag", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: jest.fn(), findByPk: jest.fn() } }));
jest.mock("../../AiBotServices/AcoesDoBot", () => ({ __esModule: true, listasDoQuadro: jest.fn(), moverParaLista: jest.fn() }));
jest.mock("../../AiBotServices/NumerosProprios", () => ({ __esModule: true, ehNumeroDaEmpresa: jest.fn() }));
jest.mock("../../FunnelImportServices/ImportarParaListaService", () => ({ __esModule: true, importarParaLista: jest.fn() }));
jest.mock("../../TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn().mockResolvedValue({}) }));

import Contact from "../../../models/Contact";
import ContactCustomField from "../../../models/ContactCustomField";
import FunnelAction from "../../../models/FunnelAction";
import Message from "../../../models/Message";
import TagAutomationRun from "../../../models/TagAutomationRun";
import Ticket from "../../../models/Ticket";
import TicketNote from "../../../models/TicketNote";
import TicketTag from "../../../models/TicketTag";
import Whatsapp from "../../../models/Whatsapp";
import { listasDoQuadro, moverParaLista } from "../../AiBotServices/AcoesDoBot";
import { ehNumeroDaEmpresa } from "../../AiBotServices/NumerosProprios";
import { importarParaLista } from "../../FunnelImportServices/ImportarParaListaService";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import {
  CAMPO_DO_OUTRO_NUMERO,
  acompanharAbertura,
  contextoDaIndicacao,
  encaminharIndicacao,
  estadoDaAbertura,
  motivoDaFalhaDeEntrega,
  moverParaAgendamento
} from "../IndicacaoDaVal";

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("situação da abertura no outro número", () => {
  it("erro de entrega ou ack negativo = falhou; lido/entregue = entregue; só enviada = enviada", () => {
    expect(estadoDaAbertura({ ack: -1, deliveryError: "Não entregue: a Meta segurou" }, false)).toBe("falhou");
    expect(estadoDaAbertura({ ack: 1, deliveryError: "x" }, false)).toBe("falhou");
    expect(estadoDaAbertura({ ack: 3, deliveryError: null }, false)).toBe("entregue");
    expect(estadoDaAbertura({ ack: 1, deliveryError: null }, false)).toBe("enviada");
  });
  it("sem mensagem: falhou se a automação falhou, senão ainda não saiu", () => {
    expect(estadoDaAbertura(null, true)).toBe("falhou");
    expect(estadoDaAbertura(null, false)).toBe("nao_saiu");
  });
  it("motivo legível, sem o prefixo repetido", () => {
    const m = motivoDaFalhaDeEntrega("5521983997414", "Não entregue: a Meta segurou a mensagem de marketing. Tente outro dia.");
    expect(m).toBe(
      "pediu para chamarmos no 5521983997414, mas a Meta não entregou a mensagem nesse número (a Meta segurou a mensagem de marketing. Tente outro dia.). Ligue ou chame por outro meio"
    );
  });
});

describe("acompanhar a abertura antes de fechar o card antigo", () => {
  beforeEach(() => jest.clearAllMocks());
  const antigo = { id: 2401, companyId: 2, contactId: 2922 };

  it("Meta recusou: o card antigo volta para a pessoa e NÃO fecha", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue({ ack: -1, deliveryError: "Não entregue: limite de marketing" });
    (TicketTag.findAll as jest.Mock).mockResolvedValue([]);
    const aoFalhar = jest.fn().mockResolvedValue(undefined);
    acompanharAbertura(antigo, 2950, "5521983997414", aoFalhar, [5, 10]);
    await esperar(40);
    expect(aoFalhar).toHaveBeenCalledWith(expect.stringContaining("a Meta não entregou"));
    expect(UpdateTicketService).not.toHaveBeenCalled();
  });

  it("entregue: o card antigo fecha sem despedida", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue({ ack: 3, deliveryError: null });
    (TicketTag.findAll as jest.Mock).mockResolvedValue([]);
    const aoFalhar = jest.fn();
    acompanharAbertura(antigo, 2950, "5521983997414", aoFalhar, [5, 10]);
    await esperar(40);
    expect(aoFalhar).not.toHaveBeenCalled();
    expect(UpdateTicketService).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 2401, ticketData: expect.objectContaining({ status: "closed", justClose: true }) })
    );
  });

  it("ainda não saiu (fora do horário): confere de novo e, no fim, só anota", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue(null);
    (TicketTag.findAll as jest.Mock).mockResolvedValue([]);
    const aoFalhar = jest.fn();
    acompanharAbertura(antigo, 2950, "5521983997414", aoFalhar, [5, 10]);
    await esperar(50);
    expect(Message.findOne).toHaveBeenCalledTimes(2);
    expect(aoFalhar).not.toHaveBeenCalled();
    expect(UpdateTicketService).not.toHaveBeenCalled();
    expect((TicketNote.create as jest.Mock).mock.calls.pop()[0].note).toContain("ainda não saiu");
  });

  it("automação marcou a falha antes de existir mensagem: falhou", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue(null);
    (TicketTag.findAll as jest.Mock).mockResolvedValue([{ tag: { name: "Automação falhou" } }]);
    const aoFalhar = jest.fn().mockResolvedValue(undefined);
    acompanharAbertura(antigo, 2950, "5521983997414", aoFalhar, [5, 10]);
    await esperar(40);
    expect(aoFalhar).toHaveBeenCalled();
  });
});

describe("encaminhar o outro número do próprio lead", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ehNumeroDaEmpresa as jest.Mock).mockResolvedValue(false);
    (listasDoQuadro as jest.Mock).mockResolvedValue([{ id: 72, name: "Disparo Eventos", autoMessage: null }]);
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: 13, channel: "whatsapp_official" });
    (FunnelAction.findAll as jest.Mock).mockResolvedValue([
      { tagId: 72, tipo: "modelo", atrasoMinutos: 0, config: {} },
      { tagId: 72, tipo: "bot_ligar", atrasoMinutos: 0, config: { bot: "val_vendas" } }
    ]);
    (TicketTag.findAll as jest.Mock).mockResolvedValue([]);
    (TagAutomationRun.findAll as jest.Mock).mockResolvedValue([]);
    (importarParaLista as jest.Mock).mockResolvedValue({ criados: 1, movidos: 0, jaNaLista: 0, abordadosPeloOutroNumero: 0, invalidos: [] });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 3678 });
    (Ticket.findOne as jest.Mock).mockResolvedValue({ id: 2950, contactId: 3678 });
    (ContactCustomField.findOrCreate as jest.Mock).mockResolvedValue([{ update: jest.fn() }, true]);
  });
  const ticket = { id: 2401, companyId: 2, contactId: 2922, whatsappId: 13, salesSource: "elo_eventos", channel: "whatsapp_official" } as any;
  const contato = { id: 2922, name: "Baladinha Casa de Festas Infantil", number: "5521985883391" } as any;

  it("card novo com o nome do próprio lead, campo 'Outro número de' e o antigo NÃO fecha na hora", async () => {
    const aoFalhar = jest.fn();
    const r = await encaminharIndicacao(ticket, contato, { nome: null, numero: "5521983997414", proprio: true }, "quer conhecer", aoFalhar);
    expect(r).toEqual({ ok: true, novoTicketId: 2950, lista: "Disparo Eventos" });
    expect(importarParaLista).toHaveBeenCalledWith(2, { tagId: 72, contatos: "Baladinha Casa de Festas Infantil;5521983997414" });
    expect(ContactCustomField.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: 3678, name: CAMPO_DO_OUTRO_NUMERO } }));
    const notas = (TicketNote.create as jest.Mock).mock.calls.map(c => c[0].note).join("\n");
    expect(notas).toContain("fecha quando a abertura chegar");
    expect(UpdateTicketService).not.toHaveBeenCalled();
  });

  it("o mesmo número da conversa não vira card", async () => {
    const r = await encaminharIndicacao(ticket, contato, { nome: null, numero: "5521985883391", proprio: true }, null, jest.fn());
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("próprio número desta conversa");
    expect(importarParaLista).not.toHaveBeenCalled();
  });

  it("contexto para a Val no número novo: mesmo lead, continua de onde parou", async () => {
    (ContactCustomField.findAll as jest.Mock).mockResolvedValue([{ name: CAMPO_DO_OUTRO_NUMERO, value: "Baladinha, que falou pelo 5521985883391" }]);
    const c = await contextoDaIndicacao(3678);
    expect(c).toContain("é o mesmo lead");
    expect(c).toContain("sem se apresentar do zero");
  });
});

describe("demo marcada leva o card para Agendamento", () => {
  beforeEach(() => jest.clearAllMocks());
  it("move para a lista do quadro sem desligar a Val", async () => {
    (listasDoQuadro as jest.Mock).mockResolvedValue([{ id: 76, name: "Agendamento" }]);
    (moverParaLista as jest.Mock).mockResolvedValue('movido para "Agendamento"');
    const r = await moverParaAgendamento({ id: 2384, companyId: 2, whatsappId: 13 } as any, { handoff: {} } as any);
    expect(r).toBe('movido para "Agendamento"');
    expect(moverParaLista).toHaveBeenCalledWith(expect.objectContaining({ id: 2384 }), 76, { manterBot: true });
  });
  it("nome da lista configurável em handoff.listaDeAgendamento", async () => {
    (listasDoQuadro as jest.Mock).mockResolvedValue([{ id: 90, name: "Demo marcada" }]);
    (moverParaLista as jest.Mock).mockResolvedValue("ok");
    await moverParaAgendamento({ id: 1, companyId: 2 } as any, { handoff: { listaDeAgendamento: "demo marcada" } } as any);
    expect(moverParaLista).toHaveBeenCalledWith(expect.anything(), 90, { manterBot: true });
  });
});
