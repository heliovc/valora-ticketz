import GetTicketWbot from "../../../helpers/GetTicketWbot";
import Message from "../../../models/Message";
import Whatsapp from "../../../models/Whatsapp";
import { montarVideo, sendVideo } from "../../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import { verifyMediaMessage } from "../../WbotServices/wbotMessageListener";
import { registrarEnvio } from "../SalesAiService";
import { enviarVideoDeVendas } from "../VideoDeVendas";

jest.mock("../../../helpers/GetTicketWbot", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { count: jest.fn() } }));
jest.mock("../../../models/SalesAi", () => ({ __esModule: true, SalesAiConfig: class {} }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../WbotServices/wbotMessageListener", () => ({ __esModule: true, verifyMediaMessage: jest.fn() }));
jest.mock("../../WbotServices/getJidOf", () => ({ __esModule: true, getJidOf: () => "5521999999999@s.whatsapp.net" }));
jest.mock("../SalesAiService", () => ({ __esModule: true, registrarEnvio: jest.fn() }));
jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../CloudApiServices/CloudApiChannel", () => ({ __esModule: true, CHANNEL: "whatsapp_official" }));
jest.mock("../../CloudApiServices/CloudApiSendService", () => {
  const real = jest.requireActual("../../CloudApiServices/CloudApiSendService");
  return { __esModule: true, montarVideo: real.montarVideo, sendVideo: jest.fn() };
});
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));

const sendMessage = jest.fn();
const ticket = { id: 7, salesSource: "valora_saude", contact: { id: 1 } } as any;
const cfgComVideo = {
  produtos: { valora_saude: { videoUrl: "https://site.com/demo.mp4", videoLegenda: "Veja como funciona" } }
} as any;

describe("vídeo de demonstração pelo QR", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (GetTicketWbot as jest.Mock).mockResolvedValue({ sendMessage });
    (Message.count as jest.Mock).mockResolvedValue(0);
    sendMessage.mockResolvedValue({ key: { id: "ABC" } });
  });

  it("envia com a legenda e marca como enviado pela IA", async () => {
    await expect(enviarVideoDeVendas(ticket, cfgComVideo)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      "5521999999999@s.whatsapp.net",
      expect.objectContaining({ video: { url: "https://site.com/demo.mp4" }, caption: "Veja como funciona" })
    );
    expect(registrarEnvio).toHaveBeenCalledWith("ABC", "ai");
    expect(verifyMediaMessage).toHaveBeenCalled();
  });

  it("marca antes de gravar: a mensagem não pode virar humana e pausar a IA", async () => {
    await enviarVideoDeVendas(ticket, cfgComVideo);
    const marcou = (registrarEnvio as jest.Mock).mock.invocationCallOrder[0];
    const gravou = (verifyMediaMessage as jest.Mock).mock.invocationCallOrder[0];
    expect(marcou).toBeLessThan(gravou);
  });

  it("não repete na mesma conversa", async () => {
    (Message.count as jest.Mock).mockResolvedValue(1);
    await expect(enviarVideoDeVendas(ticket, cfgComVideo)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("produto sem vídeo no painel não envia nada", async () => {
    await expect(enviarVideoDeVendas(ticket, { produtos: {} } as any)).resolves.toBe(false);
    expect(GetTicketWbot).not.toHaveBeenCalled();
  });

  it("conversa do Elo não recebe o vídeo do Saúde", async () => {
    await expect(enviarVideoDeVendas({ ...ticket, salesSource: "elo_eventos" }, cfgComVideo)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("falha no envio não derruba a conversa", async () => {
    sendMessage.mockRejectedValue(new Error("caiu"));
    await expect(enviarVideoDeVendas(ticket, cfgComVideo)).resolves.toBe(false);
  });
});

describe("vídeo de demonstração pelo WhatsApp Oficial", () => {
  const oficial = {
    id: 9,
    companyId: 2,
    whatsappId: 13,
    channel: "whatsapp_official",
    salesSource: "valora_saude",
    contact: { id: 5, number: "5521988887777" }
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (Message.count as jest.Mock).mockResolvedValue(0);
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: 13 });
    (sendVideo as jest.Mock).mockResolvedValue({ wamid: "wamid.X" });
  });

  it("sai por link pela API oficial e entra na conversa como vídeo da IA", async () => {
    await expect(enviarVideoDeVendas(oficial, cfgComVideo)).resolves.toBe(true);
    expect(GetTicketWbot).not.toHaveBeenCalled();
    expect(sendVideo).toHaveBeenCalledWith({ id: 13 }, "5521988887777", "https://site.com/demo.mp4", "Veja como funciona");
    expect(CreateMessageService).toHaveBeenCalledWith({
      messageData: expect.objectContaining({
        id: "wamid.X",
        ticketId: 9,
        contactId: 5,
        fromMe: true,
        sentBy: "ai",
        mediaType: "video",
        mediaUrl: "https://site.com/demo.mp4",
        channel: "whatsapp_official"
      }),
      companyId: 2
    });
  });

  it("não repete na mesma conversa", async () => {
    (Message.count as jest.Mock).mockResolvedValue(1);
    await expect(enviarVideoDeVendas(oficial, cfgComVideo)).resolves.toBe(false);
    expect(sendVideo).not.toHaveBeenCalled();
  });

  it("sem conexão no card não envia", async () => {
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue(null);
    await expect(enviarVideoDeVendas(oficial, cfgComVideo)).resolves.toBe(false);
    expect(sendVideo).not.toHaveBeenCalled();
  });

  it("recusa da Meta não derruba a conversa", async () => {
    (sendVideo as jest.Mock).mockRejectedValue(new Error("recusado"));
    await expect(enviarVideoDeVendas(oficial, cfgComVideo)).resolves.toBe(false);
  });

  it("monta o corpo do envio com link e legenda", () => {
    expect(montarVideo("+55 (21) 98888-7777", "https://site.com/demo.mp4", "Veja")).toEqual({
      to: "5521988887777",
      type: "video",
      video: { link: "https://site.com/demo.mp4", caption: "Veja" }
    });
    expect(montarVideo("5521988887777", "https://site.com/demo.mp4", "")).toEqual({
      to: "5521988887777",
      type: "video",
      video: { link: "https://site.com/demo.mp4" }
    });
  });
});
