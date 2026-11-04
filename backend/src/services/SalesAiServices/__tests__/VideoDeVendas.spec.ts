import GetTicketWbot from "../../../helpers/GetTicketWbot";
import Message from "../../../models/Message";
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
jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn() } }));

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
