import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  AutoIncrement,
  Default
} from "sequelize-typescript";

import Company from "./Company";
// eslint-disable-next-line import/no-cycle
import CloudApiBroadcast from "./CloudApiBroadcast";

/**
 * Um destinatário de um disparo.
 * PENDENTE → ENVIADO → ENTREGUE → LIDO, ou FALHOU (com `error`).
 */
@Table({ tableName: "CloudApiBroadcastRecipients" })
class CloudApiBroadcastRecipient extends Model<CloudApiBroadcastRecipient> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => CloudApiBroadcast)
  @Column
  broadcastId: number;

  @BelongsTo(() => CloudApiBroadcast)
  broadcast: CloudApiBroadcast;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column
  number: string;

  @Column
  name: string | null;

  @Default("PENDENTE")
  @Column
  status: string;

  @Column
  wamid: string | null;

  @Column
  error: string | null;

  /** O texto exato que saiu — aparece no card quando o cliente responder. */
  @Column
  text: string | null;

  @Column
  sentAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CloudApiBroadcastRecipient;
