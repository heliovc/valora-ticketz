jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { generateBotReply } from "../aiBot";
import {
  blocoDeMidias,
  escolherMidias,
  extrairPedidoDeMidias,
  lerMidias,
  linhaDeLink,
  MAX_POR_RESPOSTA
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
