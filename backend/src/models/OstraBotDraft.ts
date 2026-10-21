import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  Default
} from "sequelize-typescript";

export type OstraBotDraftStatus =
  | "GERANDO"
  | "PENDENTE"
  | "APROVADO"
  | "ENVIANDO"
  | "ENVIADO"
  | "DESCARTADO"
  | "EXPIRADO"
  | "ERRO";

/** Rascunho do assistente do grupo Ostra Carioca. Ver a migration. */
@Table({ tableName: "ostra_bot_drafts", underscored: true })
class OstraBotDraft extends Model<OstraBotDraft> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column({ field: "group_jid" })
  groupJid: string;

  /** Id da mensagem do grupo que pediu; único para não gerar dois rascunhos. */
  @Column({ field: "mensagem_id" })
  mensagemId: string;

  @Column(DataType.TEXT)
  pergunta: string;

  @Column
  autor: string;

  @Column({ field: "autor_jid" })
  autorJid: string;

  @Column(DataType.TEXT)
  rascunho: string;

  @Column
  status: OstraBotDraftStatus;

  @Column({ field: "expira_em" })
  expiraEm: Date;

  @Column({ field: "aprovado_em" })
  aprovadoEm: Date;

  @Column({ field: "enviado_em" })
  enviadoEm: Date;

  @Column(DataType.TEXT)
  erro: string;

  /** Quando o Mac buscou o pedido. Vencido em 5 min, volta para a fila. */
  @Column({ field: "pego_em" })
  pegoEm: Date;

  @Default(false)
  @Column({ field: "avisado_mac" })
  avisadoMac: boolean;

  @CreatedAt
  @Column({ field: "criado_em" })
  criadoEm: Date;

  @UpdatedAt
  @Column({ field: "atualizado_em" })
  atualizadoEm: Date;
}

export default OstraBotDraft;
