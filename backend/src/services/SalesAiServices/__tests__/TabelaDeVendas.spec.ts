import GetTicketWbot from "../../../helpers/GetTicketWbot";
import Message from "../../../models/Message";
import Whatsapp from "../../../models/Whatsapp";
import { montarDocumento, sendDocument } from "../../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import { verifyMediaMessage } from "../../WbotServices/wbotMessageListener";
import { registrarEnvio } from "../SalesAiService";
import { enviarTabelaDeVendas } from "../TabelaDeVendas";

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
  return { __esModule: true, montarDocumento: real.montarDocumento, sendDocument: jest.fn() };
});
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));

const URL = "https://smartpay.example/api/saude/publico/tabela-de-taxas.pdf?chave=abc";
const sendMessage = jest.fn();
const ticket = { id: 7, salesSource: "valora_saude", contact: { id: 1 } } as any;
const cfgComTabela = {
  produtos: { valora_saude: { videoUrl: "https://site.com/demo.mp4", tabelaUrl: URL, tabelaNome: "Valora Saúde - tabela de taxas" } }
} as any;

describe("tabela de taxas pelo QR", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (GetTicketWbot as jest.Mock).mockResolvedValue({ sendMessage });
    (Message.count as jest.Mock).mockResolvedValue(0);
    sendMessage.mockResolvedValue({ key: { id: "PDF1" } });
  });

  it("envia o PDF com o nome do arquivo e marca como enviado pela IA", async () => {
    await expect(enviarTabelaDeVendas(ticket, cfgComTabela)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith("5521999999999@s.whatsapp.net", {
      document: { url: URL },
      mimetype: "application/pdf",
      fileName: "Valora Saúde - tabela de taxas.pdf"
    });
    expect(registrarEnvio).toHaveBeenCalledWith("PDF1", "ai");
    const marcou = (registrarEnvio as jest.Mock).mock.invocationCallOrder[0];
    const gravou = (verifyMediaMessage as jest.Mock).mock.invocationCallOrder[0];
    expect(marcou).toBeLessThan(gravou);
  });

  it("não repete na mesma conversa", async () => {
    (Message.count as jest.Mock).mockResolvedValue(1);
    await expect(enviarTabelaDeVendas(ticket, cfgComTabela)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(Message.count).toHaveBeenCalledWith({ where: expect.objectContaining({ mediaType: "application", sentBy: "ai" }) });
  });

  it("produto sem tabela no painel não envia nada", async () => {
    await expect(enviarTabelaDeVendas(ticket, { produtos: { valora_saude: { videoUrl: "https://site.com/v.mp4" } } } as any)).resolves.toBe(false);
    expect(GetTicketWbot).not.toHaveBeenCalled();
  });

  it("conversa do Elo não recebe a tabela do Saúde", async () => {
    await expect(enviarTabelaDeVendas({ ...ticket, salesSource: "elo_eventos" }, cfgComTabela)).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("falha no envio não derruba a conversa", async () => {
    sendMessage.mockRejectedValue(new Error("caiu"));
    await expect(enviarTabelaDeVendas(ticket, cfgComTabela)).resolves.toBe(false);
  });
});

describe("tabela de taxas pelo WhatsApp Oficial", () => {
  const oficial = {
    id: 9, companyId: 2, whatsappId: 13, channel: "whatsapp_official", salesSource: "valora_saude",
    contact: { id: 5, number: "5521988887777" }
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (Message.count as jest.Mock).mockResolvedValue(0);
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: 13 });
    (sendDocument as jest.Mock).mockResolvedValue({ wamid: "wamid.PDF" });
  });

  it("sai por link pela API oficial e entra na conversa como documento da IA", async () => {
    await expect(enviarTabelaDeVendas(oficial, cfgComTabela)).resolves.toBe(true);
    expect(GetTicketWbot).not.toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledWith({ id: 13 }, "5521988887777", URL, "Valora Saúde - tabela de taxas.pdf", "");
    expect(CreateMessageService).toHaveBeenCalledWith({
      messageData: expect.objectContaining({ id: "wamid.PDF", ticketId: 9, fromMe: true, sentBy: "ai", mediaType: "application", mediaUrl: URL }),
      companyId: 2
    });
  });

  it("sem conexão no card não envia", async () => {
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue(null);
    await expect(enviarTabelaDeVendas(oficial, cfgComTabela)).resolves.toBe(false);
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it("monta o corpo do envio com link, nome e legenda opcional", () => {
    expect(montarDocumento("+55 (21) 98888-7777", URL, "t.pdf", "")).toEqual({
      to: "5521988887777", type: "document", document: { link: URL, filename: "t.pdf" }
    });
    expect(montarDocumento("5521988887777", URL, "t.pdf", "Veja")).toEqual({
      to: "5521988887777", type: "document", document: { link: URL, filename: "t.pdf", caption: "Veja" }
    });
  });
});
