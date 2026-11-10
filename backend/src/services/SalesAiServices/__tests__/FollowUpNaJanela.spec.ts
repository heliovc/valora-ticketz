jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("cron", () => ({ __esModule: true, CronJob: class { start() {} } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
const cache = new Map<string, string>();
jest.mock("../../../libs/cache", () => ({ __esModule: true, cacheLayer: { get: jest.fn(async (k: string) => cache.get(k) ?? null), set: jest.fn(async (k: string, v: string) => { cache.set(k, v); }) } }));
jest.mock("../../../helpers/aiBot", () => ({ __esModule: true, generateBotReply: jest.fn() }));
jest.mock("../../AiBotServices/AiBotProvidersService", () => ({ __esModule: true, provedoresDaEmpresa: jest.fn().mockResolvedValue([{}]) }));
jest.mock("../../CloudApiServices/CloudApiSendService", () => ({ __esModule: true, dentroDaJanela: jest.fn().mockReturnValue(true), sendText: jest.fn().mockResolvedValue({ wamid: "wamid.F" }) }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../SalesAiService", () => ({ __esModule: true, decidir: jest.fn().mockResolvedValue({ reply: true, reason: "ok" }), escopoDeVendas: jest.fn().mockResolvedValue({ enabled: true }), promptDeVendas: jest.fn().mockResolvedValue("p") }));

import Ticket from "../../../models/Ticket";
import Message from "../../../models/Message";
import Contact from "../../../models/Contact";
import Whatsapp from "../../../models/Whatsapp";
import { generateBotReply } from "../../../helpers/aiBot";
import { sendText } from "../../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import { varrerFollowUps } from "../FollowUpNaJanela";

// Lead falou 14h (BRT) de 10/11 e a IA respondeu 14h01.
const ultimaDoLead = new Date(Date.UTC(2026, 10, 10, 17, 0));
const respostaDaIa = new Date(Date.UTC(2026, 10, 10, 17, 1));
const brt = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, dia, h + 3, m));
const ticket = { id: 2293, companyId: 2, contactId: 7, whatsappId: 13, salesSource: "elo_eventos", salesStage: "qualificado", lastInboundAt: ultimaDoLead, aiPausedUntil: null };

describe("follow-ups da Val dentro da janela (1, 2 e 3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    (Ticket.findAll as jest.Mock).mockResolvedValue([ticket]);
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true, createdAt: respostaDaIa });
    (Message.findAll as jest.Mock).mockResolvedValue([{ fromMe: false, body: "Quero conhecer" }, { fromMe: true, body: "Que bom! ..." }]);
    (Contact.findByPk as jest.Mock).mockResolvedValue({ id: 7, name: "Casa Grande", number: "5521900004506" });
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: 13 });
    (generateBotReply as jest.Mock).mockResolvedValue({ kind: "reply", text: "Conseguiu ver o vídeo? Posso te mostrar como ficaria com os pacotes da Casa Grande?" });
  });

  it("1 sai 2h depois da IA, escrito pela Val e gravado como mensagem da IA", async () => {
    expect(await varrerFollowUps(brt(10, 15, 50))).toBe(0);
    expect(await varrerFollowUps(brt(10, 16, 5))).toBe(1);
    expect(sendText).toHaveBeenCalledWith({ id: 13 }, "5521900004506", expect.stringContaining("Casa Grande"));
    expect(CreateMessageService).toHaveBeenCalledWith(expect.objectContaining({ messageData: expect.objectContaining({ sentBy: "ai", fromMe: true }) }));
    expect((generateBotReply as jest.Mock).mock.calls[0][0].userMessage).toContain("primeiro lembrete");
  });

  it("sequência inteira: 1 às 16h05, 2 às 8h (o vencimento das 2h05 é madrugada), 3 às 13h", async () => {
    await varrerFollowUps(brt(10, 16, 5));
    expect(await varrerFollowUps(brt(10, 16, 15))).toBe(0); // a varredura seguinte não repete
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true, createdAt: brt(10, 16, 5) });
    expect(await varrerFollowUps(brt(11, 2, 10))).toBe(0);
    expect(await varrerFollowUps(brt(11, 8, 0))).toBe(1);
    expect((generateBotReply as jest.Mock).mock.calls[1][0].userMessage).toContain("segundo lembrete");
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true, createdAt: brt(11, 8) });
    expect(await varrerFollowUps(brt(11, 12, 50))).toBe(0);
    expect(await varrerFollowUps(brt(11, 13, 0))).toBe(1);
    expect((generateBotReply as jest.Mock).mock.calls[2][0].userMessage).toContain("último lembrete");
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true, createdAt: brt(11, 13) });
    expect(await varrerFollowUps(brt(11, 13, 40))).toBe(0);
    expect(sendText).toHaveBeenCalledTimes(3);
  });

  it("lead respondeu entre os follow-ups: volta ao 1", async () => {
    await varrerFollowUps(brt(10, 16, 5));
    const respondeu = brt(10, 18);
    (Ticket.findAll as jest.Mock).mockResolvedValue([{ ...ticket, lastInboundAt: respondeu }]);
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true, createdAt: brt(10, 18, 1) });
    expect(await varrerFollowUps(brt(10, 20, 5))).toBe(1);
    expect((generateBotReply as jest.Mock).mock.calls[1][0].userMessage).toContain("primeiro lembrete");
  });

  it("silêncio que já recebeu o follow-up antigo (marca \"1\"): não manda mais", async () => {
    cache.set(`followup:${ticket.id}:${ultimaDoLead.getTime()}`, "1");
    expect(await varrerFollowUps(brt(10, 16, 5))).toBe(0);
  });

  it("lead falou por último: não é follow-up", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: false, createdAt: respostaDaIa });
    expect(await varrerFollowUps(brt(10, 16, 5))).toBe(0);
    expect(generateBotReply).not.toHaveBeenCalled();
  });

  it("modelo pediu passagem ou falhou: não manda nada", async () => {
    (generateBotReply as jest.Mock).mockResolvedValue({ kind: "handoff", text: "vou chamar" });
    expect(await varrerFollowUps(brt(10, 16, 5))).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("lead que recusou não recebe follow-up", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([{ ...ticket, salesStage: "sem_interesse" }]);
    expect(await varrerFollowUps(brt(10, 16, 5))).toBe(0);
  });
});
