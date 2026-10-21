import {
  Table,
  Column,
  CreatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType
} from "sequelize-typescript";

/** Mensagem do grupo Ostra Carioca guardada como contexto. Ver a migration. */
@Table({ tableName: "ostra_bot_messages", underscored: true, updatedAt: false })
class OstraBotMessage extends Model<OstraBotMessage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column({ field: "group_jid" })
  groupJid: string;

  @Column({ field: "mensagem_id" })
  mensagemId: string;

  @Column
  autor: string;

  /** Texto, ou a mídia descrita: "[foto]", "[áudio]", "[PDF: nome]". */
  @Column(DataType.TEXT)
  texto: string;

  @Column({ field: "enviada_em" })
  enviadaEm: Date;

  @CreatedAt
  @Column({ field: "criado_em" })
  criadoEm: Date;
}

export default OstraBotMessage;
