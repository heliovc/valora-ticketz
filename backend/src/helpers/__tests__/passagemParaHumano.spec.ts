import { lerPassagemParaHumano } from "../aiBot";

/**
 * Regra em linguagem natural do Hélio (27/10/2026): "Caso o cliente queira
 * fazer uma reclamação, informe que vai transferir para o responsável e mova o
 * card para a lista 'Aguardando atendimento'".
 */
describe("passagem para uma pessoa", () => {
  it("[[HUMANO]] mantém o texto da IA e os comandos MOVER/SALVAR", () => {
    const r = lerPassagemParaHumano(
      'Sinto muito pelo ocorrido, Mariana. Vou transferir para o responsável agora.\n[[MOVER lista="Aguardando atendimento"]]\n[[HUMANO motivo="reclamação"]]'
    );
    expect(r).not.toBeNull();
    expect(r!.texto).toBe("Sinto muito pelo ocorrido, Mariana. Vou transferir para o responsável agora.");
    expect(r!.comandos).toEqual(['[[MOVER lista="Aguardando atendimento"]]']);
    expect(r!.motivo).toBe("reclamação");
  });

  it("[[HUMANO]] sem motivo e sem texto: texto vazio (o motor usa a mensagem de espera)", () => {
    const r = lerPassagemParaHumano("[[HUMANO]]");
    expect(r).toEqual({ texto: "", comandos: [], motivo: undefined });
  });

  it("o token antigo __HUMANO__ continua valendo, com a mensagem padrão", () => {
    const r = lerPassagemParaHumano('__HUMANO__\n[[SALVAR campo="Nome" valor="Ana"]]');
    expect(r!.texto).toBe("");
    expect(r!.comandos).toEqual(['[[SALVAR campo="Nome" valor="Ana"]]']);
  });

  it("resposta comum não é passagem", () => {
    expect(lerPassagemParaHumano('Temos o sábado 06/03 livre.\n[[MOVER lista="Data verificada"]]')).toBeNull();
    expect(lerPassagemParaHumano("")).toBeNull();
  });
});
