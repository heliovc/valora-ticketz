import { descreverContatoCompartilhado } from "../contatoCompartilhado";

/**
 * Contato mandado pelo lead no WhatsApp Oficial: o nome e o telefone têm de
 * ficar na conversa. A Meta não deixa buscar a mensagem depois.
 */
describe("contato compartilhado no Oficial", () => {
  it("guarda nome e telefone", () => {
    const msg = {
      type: "contacts",
      contacts: [
        {
          name: { formatted_name: "Pedro Silva", first_name: "Pedro" },
          phones: [{ phone: "+55 21 99999-0000", wa_id: "5521999990000", type: "CELL" }]
        }
      ]
    };
    expect(descreverContatoCompartilhado(msg)).toBe("👤 Contato: Pedro Silva — +55 21 99999-0000");
  });

  it("sem formatted_name, monta o nome; usa wa_id se faltar phone; inclui empresa e e-mail", () => {
    const msg = {
      contacts: [
        {
          name: { first_name: "Pedro", last_name: "Souza" },
          phones: [{ wa_id: "5521988887777" }],
          org: { company: "Casarão" },
          emails: [{ email: "pedro@casarao.com" }]
        }
      ]
    };
    expect(descreverContatoCompartilhado(msg)).toBe(
      "👤 Contato: Pedro Souza — 5521988887777 (Casarão, pedro@casarao.com)"
    );
  });

  it("vários contatos viram lista", () => {
    const msg = {
      contacts: [
        { name: { formatted_name: "Pedro" }, phones: [{ phone: "+55 21 1" }] },
        { name: { formatted_name: "Ana" }, phones: [{ phone: "+55 21 2" }, { phone: "+55 21 2" }] }
      ]
    };
    expect(descreverContatoCompartilhado(msg)).toBe("👤 Contatos:\n• Pedro — +55 21 1\n• Ana — +55 21 2");
  });

  it("payload vazio não quebra", () => {
    expect(descreverContatoCompartilhado({})).toBe("👤 Contato recebido (sem nome nem telefone)");
    expect(descreverContatoCompartilhado({ contacts: [{}] })).toBe("👤 Contato recebido (sem nome nem telefone)");
  });
});
