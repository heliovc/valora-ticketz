jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { generateBotReply } from "../aiBot";
import {
  blocoDeMidias,
  completarPedidoDeMidias,
  escolherMidias,
  extrairPedidoDeMidias,
  lerMidias,
  linhaDeLink,
  MAX_POR_RESPOSTA,
  pedidoDoCliente
} from "../../services/AiBotServices/MidiasDoBot";
import { montarImagem } from "../../services/CloudApiServices/CloudApiSendService";

const BASE = "https://smartpay.valorasolucoes.com/api/public/eventos/midias";
const LISTA = [
  { codigo: "F1", tipo: "foto", legenda: "Salão Jardim de dia", url: `${BASE}/a`, mime: "image/jpeg" },
  { codigo: "F2", tipo: "foto", legenda: "Espaço Kids", url: `${BASE}/b`, mime: "image/png" },
  { codigo: "V1", tipo: "video", legenda: "Tour pelo espaço", url: `${BASE}/c`, mime: "video/mp4" }
];

describe("fotos e vídeos do espaço no bot", () => {
  it("lê a chave da Valora e ignora item quebrado", () => {
    const midias = lerMidias(JSON.stringify([...LISTA, { codigo: "X9", url: "ftp://x" }, { codigo: "F3", url: "javascript:alert(1)" }]));
    expect(midias.map(m => m.codigo)).toEqual(["F1", "F2", "V1"]);
    expect(lerMidias("não é json")).toEqual([]);
    expect(lerMidias("")).toEqual([]);
  });

  it("bloco do prompt lista os itens, marca o que já foi e explica o comando", () => {
    const midias = lerMidias(JSON.stringify(LISTA));
    const bloco = blocoDeMidias(midias, new Set([`${BASE}/c`]));
    expect(bloco).toContain("- F1: Salão Jardim de dia (foto)");
    expect(bloco).toContain("- V1: Tour pelo espaço (vídeo) — já enviado nesta conversa");
    expect(bloco).toContain('[[ENVIAR_MIDIA codigos="F1,F2"]]');
    expect(bloco).toContain("Nunca diga que não tem fotos");
    expect(blocoDeMidias([], new Set())).toBe("");
  });

  it("tira o comando do texto e devolve os códigos, sem repetir", () => {
    const r = extrairPedidoDeMidias('Seguem fotos do salão!\n[[ENVIAR_MIDIA codigos="f1, F2"]]\n[[ENVIAR_MIDIA codigos="F2,V1"]]');
    expect(r.texto).toBe("Seguem fotos do salão!");
    expect(r.codigos).toEqual(["F1", "F2", "V1"]);
    expect(extrairPedidoDeMidias("Sem fotos aqui").codigos).toEqual([]);
    expect(extrairPedidoDeMidias("Olha só [[ENVIAR_MIDIA F1 V1]]").codigos).toEqual(["F1", "V1"]);
  });

  it("escolhe só o que existe, no máximo 4", () => {
    const midias = lerMidias(JSON.stringify(LISTA));
    expect(escolherMidias(midias, ["F9", "V1", "F1"]).map(m => m.codigo)).toEqual(["V1", "F1"]);
    const muitas = lerMidias(JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ codigo: `F${i + 1}`, tipo: "foto", legenda: "x", url: `${BASE}/${i}` }))));
    expect(escolherMidias(muitas, muitas.map(m => m.codigo))).toHaveLength(MAX_POR_RESPOSTA);
  });

  it("link de reserva e corpo da imagem no Oficial", () => {
    expect(linhaDeLink(lerMidias(JSON.stringify(LISTA))[2])).toBe(`🎬 Tour pelo espaço: ${BASE}/c`);
    expect(montarImagem("+55 (21) 99999-0000", `${BASE}/a`, "Salão")).toEqual({
      to: "5521999990000",
      type: "image",
      image: { link: `${BASE}/a`, caption: "Salão" }
    });
  });

  it("o comando sobrevive à rodada de ferramenta (escrito junto com a consulta)", async () => {
    (axios.post as jest.Mock)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '[[CONSULTAR_AGENDA data="24/11/2026"]]\n[[ENVIAR_MIDIA codigos="F2"]]' } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: "O dia 24/11 está ocupado. Seguem fotos do Espaço Kids!" } }] } });
    const r = await generateBotReply({
      persona: "Ana",
      history: [],
      userMessage: "e o dia 30? manda fotos",
      agora: new Date("2026-11-10T12:00:00Z"),
      provedores: [{ provider: "openrouter", model: "m", apiKey: "k" }],
      ferramentas: { nomes: ["CONSULTAR_AGENDA"], catalogo: "", executar: jest.fn().mockResolvedValue("CONSULTAR_AGENDA: ocupado") }
    });
    expect(r?.text).toContain("Seguem fotos do Espaço Kids!");
    expect(r?.text).toContain('[[ENVIAR_MIDIA codigos="F2"]]');
  });
});

const DEMO = [
  { codigo: "F1", tipo: "foto", legenda: "Salão principal montado para banquete", url: `${BASE}/1`, mime: "image/jpeg" },
  { codigo: "F2", tipo: "foto", legenda: "Mesa posta com flores para casamento", url: `${BASE}/2`, mime: "image/jpeg" },
  { codigo: "F3", tipo: "foto", legenda: "Recepção de casamento com mesa decorada", url: `${BASE}/3`, mime: "image/jpeg" },
  { codigo: "F4", tipo: "foto", legenda: "Bolo e decoração de festa de 15 anos", url: `${BASE}/4`, mime: "image/jpeg" },
  { codigo: "F5", tipo: "foto", legenda: "Decoração de festa infantil", url: `${BASE}/5`, mime: "image/jpeg" },
  { codigo: "V1", tipo: "video", legenda: "Tour pelo espaço: salão, mesas e decorações", url: `${BASE}/6`, mime: "video/mp4" }
];
const codigosDe = (t: string) => extrairPedidoDeMidias(t).codigos;

describe("rede de segurança: cliente pediu fotos e o modelo não mandou", () => {
  const midias = lerMidias(JSON.stringify(DEMO));

  it("reconhece o pedido de ver fotos, e não 'tirar fotos' nem fotógrafo", () => {
    expect(pedidoDoCliente("Tem fotos do lugar?")).toEqual({ fotos: true, video: false });
    expect(pedidoDoCliente("me manda um vídeo do salão")).toEqual({ fotos: true, video: true });
    expect(pedidoDoCliente("queria ver como é o espaço").fotos).toBe(true);
    expect(pedidoDoCliente("posso tirar fotos no jardim?").fotos).toBe(false);
    expect(pedidoDoCliente("vocês têm fotógrafo?").fotos).toBe(false);
    expect(pedidoDoCliente("qual o valor para 150 pessoas?").fotos).toBe(false);
  });

  it("a resposta real da demo (10/11): some o 'não tenho' e o Instagram, e as fotos vão", () => {
    const r = completarPedidoDeMidias(
      "Não tenho fotos aqui no chat, mas nosso Instagram @villaauroraeventos tem várias do espaço e de festas reais.",
      "Tem fotos do lugar?",
      midias,
      new Set()
    );
    expect(r.texto).not.toMatch(/instagram|não tenho/i);
    expect(r.texto).toContain("Claro! Seguem algumas fotos do espaço:");
    // sem tipo de festa conhecido: o salão e um de cada tipo
    expect(r.automatico).toEqual(["F1", "F2", "F4", "F5"]);
    expect(codigosDe(r.texto)).toEqual(r.automatico);
  });

  it("com o tipo da conversa, as fotos daquele tipo vêm primeiro e o resto da resposta fica", () => {
    const r = completarPedidoDeMidias("Qual data você prefere?", "tem fotos?", midias, new Set(), "casamento");
    expect(r.automatico).toEqual(["F2", "F3", "F1", "F4"]);
    expect(r.texto.startsWith("Qual data você prefere?\n\nSeguem algumas fotos do espaço:")).toBe(true);
  });

  it("pediu vídeo: o tour vai na frente", () => {
    const r = completarPedidoDeMidias("", "tem vídeo do espaço?", midias, new Set());
    expect(r.automatico[0]).toBe("V1");
    expect(r.texto).toContain("Seguem fotos e vídeo do espaço:");
  });

  it("não reenvia o que já foi; se tudo já foi, manda de novo", () => {
    const ja = new Set([`${BASE}/1`, `${BASE}/2`, `${BASE}/4`, `${BASE}/5`]);
    expect(completarPedidoDeMidias("", "mais fotos?", midias, ja).automatico).toEqual(["F3", "V1"]);
    const tudo = new Set(DEMO.map(m => m.url));
    expect(completarPedidoDeMidias("", "manda as fotos de novo", midias, tudo).automatico).toHaveLength(MAX_POR_RESPOSTA);
  });

  it("comandos do modelo continuam inteiros (SALVAR com 'Instagram' não é cortado)", () => {
    const r = completarPedidoDeMidias(
      'Que bom que nos achou! [[SALVAR campo="como_conheceu" valor="Instagram"]]',
      "vi no instagram, tem fotos?",
      midias,
      new Set()
    );
    expect(r.texto).toContain('[[SALVAR campo="como_conheceu" valor="Instagram"]]');
    expect(r.texto).toContain("Que bom que nos achou!");
    expect(r.automatico).toHaveLength(MAX_POR_RESPOSTA);
  });

  it("modelo mandou o comando sem nenhuma palavra: ganha a frase; sem pedido nada muda", () => {
    const so = '[[ENVIAR_MIDIA codigos="F1"]]';
    const r = completarPedidoDeMidias(so, "tem fotos?", midias, new Set());
    expect(r.automatico).toEqual([]);
    expect(extrairPedidoDeMidias(r.texto)).toEqual({ texto: "Claro! Seguem algumas fotos do espaço:", codigos: ["F1"] });
    expect(completarPedidoDeMidias("Temos sim, 250 lugares.", "cabe 200 pessoas?", midias, new Set()).texto).toBe("Temos sim, 250 lugares.");
    expect(completarPedidoDeMidias("Não temos fotos.", "tem fotos?", [], new Set()).texto).toBe("Não temos fotos.");
  });
});
