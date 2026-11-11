import { pareceRespostaAutomatica, soRespostaAutomatica } from "../respostaAutomatica";

/** Conversas reais do disparo de 10/11/2026 (WhatsApp Oficial da Valora). */
const SAPEKIDS = [
    { fromMe: true, createdAt: new Date(1794330498 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794330501 * 1000), body: "Olá! 💖\n\nSeja muito bem-vindo(a)!\n\nTemos uma grande novidade: agora a SapeKids faz parte da Rede Space! 🎉\n\nEssa nova fase traz uma gestão renovada, um novo padrão de atendimento, estrutura ainda melhor e toda a experiência de uma rede especializada em festas infantis, proporcionando momentos inesquecíveis para sua família. ✨\n\nPara preparar um orçamento personalizado, me envie, por gentileza:\n\n🎈 Nome do aniversariante:\n🎂 Idade que irá completar:\n📅 Data da festa:\n👨‍👩‍👧‍👦 Quantidade de convidados:" },
    { fromMe: true, createdAt: new Date(1794330514 * 1000), body: "Essa é uma resposta automática, então deixo o recado para quem cuida do atendimento. Nossa mensagem anterior era sobre uma IA que responde pedidos de orçamento de festa no WhatsApp em segundos, 24h por dia, consulta a agenda e já envia a proposta.\n\nQuando a pessoa responsável pelo atendimento ou pelos orçamentos da Sapekids puder, gostaria de mostrar como isso funcionaria para vocês." },
    { fromMe: true, createdAt: new Date(1794352811 * 1000), body: "Para quem cuida dos orçamentos da Sapekids: posso mostrar em 15 minutos como a IA responderia os pedidos de festa com os pacotes de vocês. Qual dia fica melhor?" }
  ];
const ALGAZARRA = [
    { fromMe: true, createdAt: new Date(1794330382 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794330394 * 1000), body: "🎉 Bem-vindo à Algazarra Kids! 🐵🧡\n\nÉ um prazer receber sua mensagem! Aqui, transformamos sonhos em momentos inesquecíveis. 🥳\n\nNosso time está pronto para esclarecer suas dúvidas e ajudar no planejamento da sua festa. ✨\n\n📅 Realizamos visitas e degustações com hora marcada!\n\nSe não pudermos responder imediatamente, não se preocupe! Retornaremos o mais breve possível. ☺️\n\nEnquanto isso, acompanhe nossas novidades no Instagram:\n https://www.instagram.com/algazarra_kids/\n\n\nVamos juntos criar memórias incríveis! 🎈🎂" },
    { fromMe: false, createdAt: new Date(1794330395 * 1000), body: "Olá, tudo bem? \nA Algazarra Kids agradece seu contato! 🐵\n\nNosso horário de atendimento é de segunda a sábado, de 09h00 as 17:30." },
    { fromMe: true, createdAt: new Date(1794330407 * 1000), body: "Deixo o recado para a pessoa responsável pelos orçamentos da Algazarra Kids: nossa IA responde pedidos de orçamento de festa no WhatsApp em segundos, 24h por dia, consulta a agenda e já manda a proposta. Quando ela puder, gostaria de mostrar como funcionaria para vocês. 🙂" },
    { fromMe: true, createdAt: new Date(1794353413 * 1000), body: "Para quem cuida dos orçamentos da Algazarra Kids: quando retomarem o atendimento, posso mostrar em 15 minutos como a IA funcionaria com os pacotes de vocês. Qual dia fica melhor?" }
  ];
const VILA_VERDE = [
    { fromMe: true, createdAt: new Date(1794330360 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794330403 * 1000), body: "Seja bem-vindo(a) ao Sítio Vila Verde! Estamos ansiosos para atendê-lo(a).\n \nAlugamos o espaço para eventos e não oferecemos nenhum serviço.\n\nPara otimizar seu atendimento, gostaria que você me informasse:\n\n• Tipo de evento \n• Data desejada\n• Quantidade de convidados" },
    { fromMe: true, createdAt: new Date(1794330416 * 1000), body: "Parece que a resposta veio do atendimento automático. Nossa mensagem anterior era sobre uma IA que responde pedidos de orçamento de festa no WhatsApp em segundos, 24h por dia, consulta a agenda e já envia a proposta.\n\nQuando a pessoa responsável pelo atendimento ou pelos orçamentos puder, gostaria de mostrar como isso funcionaria para o Sítio Vila" },
    { fromMe: true, createdAt: new Date(1794352824 * 1000), body: "Retomando o assunto do atendimento de orçamentos do Sítio Vila Verde: quem cuida dos pedidos de data e proposta consegue ver uma demonstração rápida de 15 minutos?" }
  ];
const DREAMS = [
    { fromMe: true, createdAt: new Date(1794330486 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794332060 * 1000), body: "Quero conhecer" },
    { fromMe: true, createdAt: new Date(1794332072 * 1000), body: "Que bom! O Valora Elo Eventos é uma IA que atende os clientes da Dreams Festas E Eventos no WhatsApp, 24h por dia. Ela entende o pedido, consulta a agenda, manda a proposta com os seus pacotes e cobra o sinal no Pix.\n\nVeja como funciona: https://valorasolucoes.com/eventos/\n\nHoje, quem responde o WhatsApp da casa à noite e no fim de semana?" },
    { fromMe: true, createdAt: new Date(1794332073 * 1000), body: "Veja em 45 segundos a Val atendendo um cliente de casa de festas." },
    { fromMe: true, createdAt: new Date(1794352855 * 1000), body: "Só retomando de onde paramos: à noite e no fim de semana, quem costuma responder os pedidos de orçamento da Dreams Festas E Eventos?" }
  ];
const BALADINHA = [
    { fromMe: true, createdAt: new Date(1794330393 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794354004 * 1000), body: "Quero conhecer" },
    { fromMe: true, createdAt: new Date(1794354018 * 1000), body: "O Valora Elo Eventos é uma IA que atende os clientes da Baladinha Casa De Festas Infantil no WhatsApp, 24h por dia. Ela entende o pedido, consulta a agenda, manda a proposta com os seus pacotes e cobra o sinal no Pix.\n\nVeja como funciona: https://valorasolucoes.com/eventos/\n\nHoje, quem responde o WhatsApp da casa à noite e no fim de semana?" },
    { fromMe: true, createdAt: new Date(1794354019 * 1000), body: "Veja em 45 segundos a Val atendendo um cliente de casa de festas." }
  ];
const GARDEN = [
    { fromMe: true, createdAt: new Date(1794251187 * 1000), body: "Oi, tudo bem? Aqui é o Helio, da Valora.\n\nQuem pede orçamento de festa costuma chamar três ou quatro espaços ao mesmo tempo e tem mais chance de fechar com quem responde rápido e manda a proposta primeiro.\n\nCriamos uma IA que responde em segundos, consulta a agenda, envia a proposta com os seus pacotes, faz follow-up e gera cobrança de sinal via Pix, boleto ou cartão, 24h por dia. Podemos conversar sobre como montar essa automação para vocês?" },
    { fromMe: false, createdAt: new Date(1794251191 * 1000), body: "Não consegui processar esse formato por aqui. Pode me mandar em texto, por favor?" },
    { fromMe: true, createdAt: new Date(1794264532 * 1000), body: "Claro! Mas, pelo que a sua mensagem indica, este texto em si é um material interno (as instruções que configuram a assistente de WhatsApp da Valora), e não algo que eu deva reproduzir na íntegra. Posso resumir o conteúdo em texto, com os pontos principais:\n\n**Para que serve:** responder leads de casas de festas no WhatsApp e apresentar o Valora Elo Eventos, uma IA que atende 24h, consulta a agenda da casa, envia propostas com os pacotes cadastrados e cobra o sinal por Pix ou cartão.\n\n**Objetivo da conversa:** levar o lead a uma demonstração de 15 minutos ou a um teste grátis de 7 dias, e transferir para a equipe quando houver pedidos de desconto, contrato, negociação ou dúvidas técnicas.\n\n**Preço:** R$ 2.500/mês no plano mensal, ou R$ 19.900 à vista no ano, sem taxa de implantação, mais taxas por transação nos sinais e parcelas.\n\n**Regras de tom:** português do Brasil, mensagens curtas para WhatsApp, uma pergunta por vez, nunca inventar números ou resultados e nunca afirmar que a equipe fez contato ou testou a casa do lead.\n\nSe você precisar de algo específico, como um roteiro para uma situação, uma resposta para uma objeção ou um texto de follow-up, me diga qual e eu escrevo em texto." },
    { fromMe: false, createdAt: new Date(1794264547 * 1000), body: "Estou aqui pra te atender com o seu evento no Garden. Como posso te ajudar?" },
    { fromMe: true, createdAt: new Date(1794264558 * 1000), body: "Oi! Obrigado pelo retorno. Antes de tudo, quem está falando por aqui é a assistente virtual da Valora, e a equipe da Valora acompanha a conversa.\n\nNão tenho detalhes sobre um evento no Garden, então não quero supor nada. O que eu sei é que a Valora oferece o Valora Elo Eventos, uma IA que atende quem pede orçamento de festa no WhatsApp, consulta a agenda, envia a proposta com os pacotes da casa e cobra o sinal por Pix ou cartão.\n\nVocê me viu falando de um evento específico, ou está respondendo à mensagem sobre o Elo Eventos? Se for a segunda opção, qual tipo de festa vocês mais recebem?" },
    { fromMe: true, createdAt: new Date(1794336611 * 1000), body: "Só retomando de onde paramos: que tipo de festa o Espaço Garden Eventos mais recebe hoje, casamento, 15 anos, infantil? Com isso, consigo te mostrar como a Val funcionaria por aí." },
    { fromMe: false, createdAt: new Date(1794336622 * 1000), body: "‎Olá, o Espaço Garden Eventos agradece seu contato.\nPara um melhor atendimento nós conte um pouco sobre o seu grande dia.\nQual o tipo de evento:\nData do evento, ex 01/01/2026:\nQuantidade de convidados:" },
    { fromMe: false, createdAt: new Date(1794336632 * 1000), body: "O Garden atende principalmente casamentos, debutantes, aniversários, eventos corporativos e formaturas. Qual desses tipos de evento você gostaria de conhecer melhor?" },
    { fromMe: true, createdAt: new Date(1794336639 * 1000), body: "Esta mensagem não é um pedido de orçamento. Estamos falando sobre uma IA que responde pedidos de orçamento de festa no WhatsApp em segundos, 24h por dia, consulta a agenda e já envia a proposta. Quando a pessoa responsável pelo atendimento ou pelos orçamentos puder, gostaria de mostrar como funcionaria para vocês. 🙂\n\n[[RESUMO=Espaço Garden Eventos respondeu com at" },
    { fromMe: false, createdAt: new Date(1794336927 * 1000), body: "Estou aqui pra te atender com o seu evento no Garden. Como posso te ajudar?" }
  ];

describe("só resposta automática do outro lado (11/11/2026: follow-up para robô)", () => {
  it("Sapekids, Algazarra Kids e Sítio Vila Verde: só o robô da casa respondeu", () => {
    expect(soRespostaAutomatica(SAPEKIDS)).toBe(true);
    expect(soRespostaAutomatica(ALGAZARRA)).toBe(true);
    expect(soRespostaAutomatica(VILA_VERDE)).toBe(true);
  });

  it("gente de verdade: \"Quero conhecer\" (botão do modelo) não é robô", () => {
    expect(soRespostaAutomatica(DREAMS)).toBe(false);
    expect(soRespostaAutomatica(BALADINHA)).toBe(false);
  });

  it("na dúvida é gente: resposta sem cara de robô, mesmo rápida, libera o follow-up", () => {
    expect(soRespostaAutomatica(GARDEN)).toBe(false);
  });

  it("mensagem com cara de robô mas chegando bem depois da nossa conta como gente", () => {
    const lenta = [
      { fromMe: true, createdAt: new Date("2026-11-10T14:00:00Z"), body: "Oi, aqui é da Valora." },
      { fromMe: false, createdAt: new Date("2026-11-10T16:00:00Z"), body: "Nosso horário de atendimento é de 9h às 18h." }
    ];
    expect(soRespostaAutomatica(lenta)).toBe(false);
  });

  it("sem mensagem do contato não é assunto deste filtro", () => {
    expect(soRespostaAutomatica([{ fromMe: true, createdAt: new Date(), body: "Oi" }])).toBe(false);
  });

  it("frases típicas de atendimento automático", () => {
    expect(pareceRespostaAutomatica("Seja bem-vindo(a) ao Sítio Vila Verde!")).toBe(true);
    expect(pareceRespostaAutomatica("Desculpe, não consegui encontrar a opção. Por favor, selecione uma das opções abaixo")).toBe(true);
    expect(pareceRespostaAutomatica("Essa opção não é válida. Escolha uma das opções disponíveis.")).toBe(true);
    expect(pareceRespostaAutomatica("Olá, atendimento de terça a sexta. Deixe sua mensagem logo que possível entraremos em contato.")).toBe(true);
    expect(pareceRespostaAutomatica("Quero conhecer")).toBe(false);
    expect(pareceRespostaAutomatica("Me manda a proposta")).toBe(false);
    expect(pareceRespostaAutomatica("Agora não")).toBe(false);
  });
});
