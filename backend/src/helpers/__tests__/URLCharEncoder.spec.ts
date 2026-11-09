import { URLCharEncoder, URLExternaEncoder } from "../URLCharEncoder";

describe("link de mídia no CRM", () => {
  it("link externo mantém a consulta: o vídeo da Val abre no CRM", () => {
    expect(
      URLExternaEncoder("https://valorasolucoes.com/assets/videos/saude/valora-saude-direto-ao-ponto-v2.mp4?v=fc43b846")
    ).toBe("https://valorasolucoes.com/assets/videos/saude/valora-saude-direto-ao-ponto-v2.mp4?v=fc43b846");
    expect(URLExternaEncoder("https://x.com/tabela.pdf?chave=abc&v=2")).toBe("https://x.com/tabela.pdf?chave=abc&v=2");
  });
  it("espaço e acento continuam codificados", () => {
    expect(URLExternaEncoder("https://x.com/vídeo novo.mp4")).toBe("https://x.com/v%C3%ADdeo%20novo.mp4");
  });
  it("arquivo local segue igual a antes", () => {
    expect(URLCharEncoder("123/arquivo com espaço.pdf")).toBe("123/arquivo%20com%20espa%C3%A7o.pdf");
  });
});
