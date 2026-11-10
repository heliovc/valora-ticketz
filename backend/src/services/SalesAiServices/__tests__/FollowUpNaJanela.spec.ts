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

// Casa Grande: lead falou 16h05 (BRT) de 09/11; agora 12h05 de 10/11.
const ultimaDoLead = new Date(Date.UTC(2026, 10, 9, 19, 5));
const agora = new Date(Date.UTC(2026, 10, 10, 15, 6));
const ticket = { id: 2293, companyId: 2, contactId: 7, whatsappId: 13, salesSource: "elo_eventos", salesStage: "qualificado", lastInboundAt: ultimaDoLead, aiPausedUntil: null };

describe("follow-up da Val dentro da janela", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    (Ticket.findAll as jest.Mock).mockResolvedValue([ticket]);
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true });
    (Message.findAll as jest.Mock).mockResolvedValue([{ fromMe: false, body: "Quero conhecer" }, { fromMe: true, body: "Que bom! ..." }]);
    (Contact.findByPk as jest.Mock).mockResolvedValue({ id: 7, name: "Casa Grande", number: "5521900004506" });
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: 13 });
    (generateBotReply as jest.Mock).mockResolvedValue({ kind: "reply", text: "Conseguiu ver o vídeo? Posso te mostrar como ficaria com os pacotes da Casa Grande?" });
  });

  it("manda um follow-up escrito pela Val e grava como mensagem da IA", async () => {
    expect(await varrerFollowUps(agora)).toBe(1);
    expect(sendText).toHaveBeenCalledWith({ id: 13 }, "5521900004506", expect.stringContaining("Casa Grande"));
    expect(CreateMessageService).toHaveBeenCalledWith(expect.objectContaining({ messageData: expect.objectContaining({ sentBy: "ai", fromMe: true }) }));
  });

  it("uma vez por silêncio: a varredura seguinte não repete", async () => {
    await varrerFollowUps(agora);
    expect(await varrerFollowUps(new Date(agora.getTime() + 10 * 60 * 1000))).toBe(0);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("lead falou por último: não é follow-up", async () => {
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: false });
    expect(await varrerFollowUps(agora)).toBe(0);
    expect(generateBotReply).not.toHaveBeenCalled();
  });

  it("modelo pediu passagem ou falhou: não manda nada", async () => {
    (generateBotReply as jest.Mock).mockResolvedValue({ kind: "handoff", text: "vou chamar" });
    expect(await varrerFollowUps(agora)).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("lead que recusou não recebe follow-up", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([{ ...ticket, salesStage: "sem_interesse" }]);
    expect(await varrerFollowUps(agora)).toBe(0);
  });

  it("cedo demais (antes das 20h de silêncio, com dia ainda pela frente): espera", async () => {
    expect(await varrerFollowUps(new Date(Date.UTC(2026, 10, 10, 13, 0)))).toBe(0);
  });
});
