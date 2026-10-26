/**
 * Inventário das automações do CRM que ainda vivem no código (auditoria de
 * 26/10/2026, docs/automacoes-auditoria.md no Valora Smart). Aparecem na tela
 * "Visão geral de automações" — as não editáveis como "somente leitura —
 * migrar". O estado ao vivo (ligado/desligado, última execução) é montado no
 * controller a partir do banco.
 */
export interface ItemDoCatalogo {
  chave: string;
  nome: string;
  descricao: string;
  onde: string;
  gatilho: string;
  valoresFixos: string;
  /** sim | parcial | somente_leitura */
  editavel: "sim" | "parcial" | "somente_leitura";
  /** Setting/tabela que diz se está ligado, quando houver. */
  chaveDeEstado?: string;
  conflitaComValVendas: boolean;
}

export const CATALOGO_DO_CRM: ItemDoCatalogo[] = [
  { chave: "ia_antiga", nome: "IA antiga do CRM (bot por empresa)", descricao: "Responde quando a chave da empresa está ligada e a conversa não foi desligada. Nas conexões da Val Vendas ela não responde mais.", onde: "funnelActionRules.ts:185", gatilho: "mensagem recebida", valoresFixos: "espera 7 s, histórico 12, 600 tokens", editavel: "parcial", chaveDeEstado: "setting:aiBotEnabled", conflitaComValVendas: true },
  { chave: "menu_filas", nome: "Menu de filas e saudação", descricao: "Manda a saudação e as opções de fila antes da IA, em conversa sem fila.", onde: "wbotMessageListener.ts:1276", gatilho: "conversa sem fila numa conexão com filas", valoresFixos: "—", editavel: "sim", chaveDeEstado: "conexao:filas", conflitaComValVendas: true },
  { chave: "chatbot_opcoes", nome: "Chatbot de opções", descricao: "Navega as opções da fila; \"#\" volta ao menu.", onde: "wbotMessageListener.ts:1382", gatilho: "conversa em modo chatbot", valoresFixos: "—", editavel: "sim", conflitaComValVendas: true },
  { chave: "saudacao_conexao", nome: "Saudação da conexão", descricao: "Mensagem de boas-vindas na primeira mensagem, em conexão sem fila.", onde: "wbotMessageListener.ts:2092", gatilho: "primeira mensagem", valoresFixos: "1 s", editavel: "sim", chaveDeEstado: "conexao:greetingMessage", conflitaComValVendas: true },
  { chave: "fora_expediente", nome: "Fora do expediente", descricao: "Manda o texto de fora do horário e aplica a ação configurada.", onde: "wbotMessageListener.ts:1985", gatilho: "mensagem fora do horário", valoresFixos: "texto reserva fixo, cache 5 min", editavel: "sim", chaveDeEstado: "setting:scheduleType", conflitaComValVendas: true },
  { chave: "avaliacao", nome: "Avaliação do atendimento", descricao: "Pede nota de 1 a 5 ao encerrar; agradece; \"!\" reabre.", onde: "UpdateTicketService.ts:189; wbotMessageListener.ts:1763", gatilho: "atendente encerra", valoresFixos: "textos \"Rating Cancelled\", \"Service reopened\"", editavel: "parcial", chaveDeEstado: "setting:userRating", conflitaComValVendas: false },
  { chave: "recusa_chamada", nome: "Recusa de chamada", descricao: "Recusa chamada de voz/vídeo e manda texto fixo.", onde: "wbotMonitor.ts:23", gatilho: "chamada recebida", valoresFixos: "texto fixo", editavel: "parcial", chaveDeEstado: "setting:call", conflitaComValVendas: false },
  { chave: "limite_arquivo", nome: "Arquivo acima do limite", descricao: "Avisa que o arquivo passou do limite.", onde: "wbotMessageListener.ts:497", gatilho: "mídia grande", valoresFixos: "15 MB padrão", editavel: "sim", conflitaComValVendas: false },
  { chave: "grupos", nome: "Mensagens de grupo", descricao: "Ignora grupos conforme a chave; a tela antiga mostra o contrário quando a chave não existe.", onde: "wbotMessageListener.ts:1703", gatilho: "mensagem de grupo", valoresFixos: "chave ausente = ignora", editavel: "parcial", chaveDeEstado: "setting:CheckMsgIsGroup", conflitaComValVendas: false },
  { chave: "falha_provedor", nome: "Falha de todos os provedores de IA", descricao: "Avisa o cliente uma vez e pausa a IA na conversa (corrigido em 27/10; antes repetia).", onde: "aiBot.ts:522", gatilho: "erro da IA", valoresFixos: "texto de espera", editavel: "somente_leitura", conflitaComValVendas: false },
  { chave: "chaves_valora", nome: "Chaves de IA da Valora como reserva", descricao: "Empresa sem chave própria usa as chaves da Valora do ambiente.", onde: "AiBotProvidersService.ts:47", gatilho: "—", valoresFixos: "env", editavel: "somente_leitura", conflitaComValVendas: false },
  { chave: "acoes_ia", nome: "Ações da IA (mover card, salvar campo)", descricao: "Mover card dispara as automações da lista de destino.", onde: "AcoesDoBot.ts:213", gatilho: "resposta da IA antiga", valoresFixos: "20 campos, 300 caracteres", editavel: "parcial", conflitaComValVendas: false },
  { chave: "etiqueta_antiga", nome: "Mensagem automática da etiqueta (antiga)", descricao: "Nunca roda; a tela antiga ainda grava o texto.", onde: "queues/tagAutomation.ts", gatilho: "nunca", valoresFixos: "—", editavel: "somente_leitura", conflitaComValVendas: false },
  { chave: "campanhas", nome: "Campanhas e disparo do Oficial", descricao: "Envio em massa; a resposta abre conversa.", onde: "queues/campaign.ts; CloudApiBroadcastService.ts", gatilho: "agendamento", valoresFixos: "20 s / 60 s / 300 ms", editavel: "sim", conflitaComValVendas: false },
  { chave: "agendamentos", nome: "Mensagens agendadas", descricao: "Envia agendamentos pela conexão padrão.", onde: "queues.ts:75", gatilho: "a cada 5 s", valoresFixos: "30 s, 40 s", editavel: "parcial", conflitaComValVendas: false },
  { chave: "timeouts", nome: "Timeouts (sem fila, aberto, chatbot)", descricao: "Move ou fecha conversa parada.", onde: "queues.ts:263-543", gatilho: "a cada minuto", valoresFixos: "—", editavel: "sim", conflitaComValVendas: false },
  { chave: "ostra", nome: "Bot do grupo Ostra Carioca", descricao: "Responde no grupo da Ostra quando chamado.", onde: "OstraBotService.ts", gatilho: "\"Claude, …\" no grupo", valoresFixos: "8h–21h, 10 min, 24 h", editavel: "somente_leitura", conflitaComValVendas: false },
  { chave: "importar_historico", nome: "Importar histórico no pareamento", descricao: "Traz conversas antigas ao ler o QR.", onde: "ImportarHistoricoService.ts", gatilho: "pareamento", valoresFixos: "HISTORICO_DIAS 3", editavel: "somente_leitura", conflitaComValVendas: false }
];

/** Settings que mostram estado ao vivo no inventário. */
export const SETTINGS_DE_ESTADO = [
  "aiBotEnabled",
  "CheckMsgIsGroup",
  "call",
  "userRating",
  "scheduleType",
  "outOfHoursAction",
  "noQueueTimeout",
  "openTicketTimeout",
  "chatbotTicketTimeout",
  "audioTranscriptions",
  "aiBotTools"
];
