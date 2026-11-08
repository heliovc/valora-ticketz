import axios from "axios";
import {
  encaminharParaValora,
  modoDaConexao,
  montarEncaminhamento
} from "../EncaminharConteudo";
import { montarBotoes, montarLista } from "../../CloudApiServices/CloudApiSendService";
import { textoDoRegistro } from "../../../controllers/ValoraConteudoController";

jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: class {} }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../CloudApiServices/CloudApiChannel", () => ({ __esModule: true, CHANNEL: "whatsapp_official", getToken: () => "t", graphUrl: (p: string) => p, conexaoDoTicket: jest.fn() }));
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));

/**
 * Consultora do Conteúdo IA (Valora): o que este motor repassa e como responde.
 * Provado sem a Meta e sem a Valora.
 */

const conexao = { id: 13, companyId: 2, valoraConteudoIa: "autorizados" };

describe("modo da conexão", () => {
  it("só aceita os três modos; o resto é desligado", () => {
    expect(modoDaConexao({ valoraConteudoIa: "autorizados" })).toBe("autorizados");
    expect(modoDaConexao({ valoraConteudoIa: "todos" })).toBe("todos");
    expect(modoDaConexao({ valoraConteudoIa: "xyz" })).toBe("off");
    expect(modoDaConexao({})).toBe("off");
  });
});

describe("o que vai para a Valora", () => {
  it("texto", () => {
    const e = montarEncaminhamento({
      whatsapp: conexao, ticketId: 5, contactId: 9,
      value: { contacts: [{ profile: { name: "Dona" } }] },
      msg: { id: "wamid.1", from: "5521981243812", type: "text", text: { body: "acabou a camisola" }, timestamp: "1762600000" },
      midia: null
    });
    expect(e).toMatchObject({ wamid: "wamid.1", modo: "autorizados", from: "5521981243812", text: "acabou a camisola", profileName: "Dona", ticketId: 5, timestamp: 1762600000000 });
  });

  it("🚨 botão: leva o ID, não só o título (o título se repete entre cartões)", () => {
    const e = montarEncaminhamento({
      whatsapp: conexao, ticketId: 5, contactId: 9, value: {},
      msg: { id: "w2", from: "55", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "draft:abc:confirm", title: "Confirmar" } } },
      midia: null
    });
    expect(e).toMatchObject({ buttonId: "draft:abc:confirm", text: "Confirmar", listId: null });
    const l = montarEncaminhamento({
      whatsapp: conexao, ticketId: 5, contactId: 9, value: {},
      msg: { id: "w3", from: "55", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "loc:1", title: "Loja Centro" } } },
      midia: null
    });
    expect(l).toMatchObject({ listId: "loc:1", text: "Loja Centro" });
  });

  it("mídia: caminho do arquivo salvo e legenda", () => {
    const e = montarEncaminhamento({
      whatsapp: conexao, ticketId: 5, contactId: 9, value: {},
      msg: { id: "w4", from: "55", type: "image", image: { caption: "kit 3 calcinhas 39,90", mime_type: "image/jpeg" } },
      midia: { mediaUrl: "2/9/5/abc/foto.jpg", mediaType: "image", filename: "foto.jpg" }
    });
    expect(e).toMatchObject({ type: "image", text: "kit 3 calcinhas 39,90", mediaPath: "2/9/5/abc/foto.jpg", mimeType: "image/jpeg" });
  });
});

describe("pergunta à Valora", () => {
  beforeEach(() => {
    process.env.VALORA_INTERNAL_URL = "http://valora/api";
    process.env.VALORA_INTERNAL_SECRET = "segredo-interno-123456";
  });
  const base = montarEncaminhamento({
    whatsapp: conexao, ticketId: 1, contactId: 1, value: {},
    msg: { id: "w9", from: "55", type: "text", text: { body: "oi" } }, midia: null
  });

  it("Valora assumiu → true", async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({ data: { handled: true } });
    expect(await encaminharParaValora(base)).toBe(true);
    expect((axios.post as jest.Mock).mock.calls[0][0]).toBe("http://valora/api/internal/conteudo/inbound");
    expect((axios.post as jest.Mock).mock.calls[0][2].headers["x-internal-secret"]).toBe("segredo-interno-123456");
  });

  it("🚨 Valora fora do ar → false (a mensagem segue o fluxo normal)", async () => {
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await encaminharParaValora(base)).toBe(false);
  });

  it("conexão desligada nem chama a Valora", async () => {
    expect(await encaminharParaValora({ ...base, modo: "off" })).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("mensagens interativas da Cloud API", () => {
  it("botões: até 3, título cortado em 20", () => {
    const p: any = montarBotoes("55 21 98124-3812", "Confere?", [
      { id: "d:1:ok", title: "Confirmar" },
      { id: "d:1:fix", title: "Corrigir um detalhe do cadastro" }
    ]);
    expect(p.to).toBe("5521981243812");
    expect(p.interactive.action.buttons[1].reply.title.length).toBeLessThanOrEqual(20);
    expect(() => montarBotoes("55", "x", [1, 2, 3, 4].map(i => ({ id: `${i}`, title: `${i}` })))).toThrow();
  });

  it("lista: até 10 opções", () => {
    const p: any = montarLista("55", "De qual loja?", "Escolher", [{ rows: [{ id: "loc:1", title: "Loja Centro" }] }]);
    expect(p.interactive.type).toBe("list");
    expect(p.interactive.action.sections[0].rows[0].id).toBe("loc:1");
    const muitas = Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: `${i}` }));
    expect(() => montarLista("55", "x", "y", [{ rows: muitas }])).toThrow();
  });

  it("o painel registra o que a consultora mandou, com os botões", () => {
    expect(textoDoRegistro({ kind: "buttons", text: "Confere?", buttons: [{ id: "a", title: "Confirmar" }, { id: "b", title: "Corrigir" }] }))
      .toBe("Confere?\n[Confirmar] [Corrigir]");
  });
});
