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
  Default,
  DataType,
  HasMany
} from "sequelize-typescript";

import Company from "./Company";
import Whatsapp from "./Whatsapp";
import User from "./User";
// eslint-disable-next-line import/no-cycle
import CloudApiBroadcastRecipient from "./CloudApiBroadcastRecipient";

/** Disparo em massa pelo WhatsApp Oficial. Ver a migration. */
@Table({ tableName: "CloudApiBroadcasts" })
class CloudApiBroadcast extends Model<CloudApiBroadcast> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @ForeignKey(() => User)
  @Column
  userId: number | null;

  @BelongsTo(() => User)
  user: User;

  @Column
  name: string;

  @Column
  templateName: string;

  @Column
  templateLanguage: string;

  /** Valor de cada `{{n}}`. `{{nome}}` é trocado pelo nome do destinatário. */
  @Default([])
  @Column(DataType.JSONB)
  params: string[];

  /** EM_ANDAMENTO → CONCLUIDO | CANCELADO */
  @Default("EM_ANDAMENTO")
  @Column
  status: string;

  @Default(0)
  @Column
  total: number;

  @HasMany(() => CloudApiBroadcastRecipient)
  recipients: CloudApiBroadcastRecipient[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CloudApiBroadcast;
