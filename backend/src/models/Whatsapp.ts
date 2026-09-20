import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  AllowNull,
  HasMany,
  Unique,
  BelongsToMany,
  ForeignKey,
  BelongsTo,
  HasOne
} from "sequelize-typescript";
import Queue from "./Queue";
import Ticket from "./Ticket";
import WhatsappQueue from "./WhatsappQueue";
import Company from "./Company";
import Wavoip from "./Wavoip";

@Table
class Whatsapp extends Model<Whatsapp> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull
  @Unique
  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  session: string;

  @Column(DataType.TEXT)
  qrcode: string;

  @Column
  status: string;

  @Column
  battery: string;

  @Column
  plugged: boolean;

  @Column
  retries: number;

  @Default("")
  @Column(DataType.TEXT)
  greetingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  farewellMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  complationMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  outOfHoursMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  ratingMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  transferMessage: string;

  @Column({ defaultValue: "stable" })
  provider: string;

  @Default(false)
  @AllowNull
  @Column
  isDefault: boolean;

  @Column
  language: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @BelongsToMany(() => Queue, () => WhatsappQueue)
  queues: Array<Queue & { WhatsappQueue: WhatsappQueue }>;

  @HasMany(() => WhatsappQueue)
  whatsappQueues: WhatsappQueue[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  token: string;

  @Column(DataType.TEXT)
  facebookUserId: string;

  @Column(DataType.TEXT)
  facebookUserToken: string;

  @Column(DataType.TEXT)
  facebookPageUserId: string;

  @Column(DataType.TEXT)
  tokenMeta: string;

  @HasOne(() => Wavoip)
  wavoip: Wavoip;

  @Column(DataType.TEXT)
  channel: string;

  // --- WhatsApp Oficial (Meta Cloud API) -----------------------------------
  // Preenchidas só quando `channel = "whatsapp_official"`. Ver a migration
  // 20260920100000 para o porquê de não reusar os campos `facebookUser*`.

  /** Chave de roteamento do webhook — única. */
  @Column(DataType.TEXT)
  cloudApiPhoneNumberId: string;

  @Column(DataType.TEXT)
  cloudApiWabaId: string;

  /** Vazio na fase 1; usado pelo Embedded Signup multi-lojista. */
  @Column(DataType.TEXT)
  cloudApiBusinessId: string;

  /** System User token, cifrado (AES-256-GCM). Nunca sai em resposta HTTP. */
  @Column(DataType.TEXT)
  cloudApiTokenEnc: string;

  @Column(DataType.TEXT)
  cloudApiDisplayNumber: string;

  @Column(DataType.TEXT)
  cloudApiVerifiedName: string;
}

export default Whatsapp;
