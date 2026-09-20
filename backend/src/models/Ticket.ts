import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  HasMany,
  AutoIncrement,
  Default,
  BeforeCreate,
  BelongsToMany,
  HasOne,
  DataType
} from "sequelize-typescript";
import { v4 as uuidv4 } from "uuid";

import Contact from "./Contact";
import Message from "./Message";
import Queue from "./Queue";
import User from "./User";
import Whatsapp from "./Whatsapp";
import Company from "./Company";
import QueueOption from "./QueueOption";
import Tag from "./Tag";
import TicketTag from "./TicketTag";
import TicketTraking from "./TicketTraking";

@Table
class Ticket extends Model<Ticket> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column({ defaultValue: "pending" })
  status: string;

  @Column({ defaultValue: "whatsapp" })
  channel: string;

  @Column
  unreadMessages: number;

  /**
   * Bot de IA nesta conversa: `null` segue a configuração da empresa (o
   * comportamento de sempre), `true`/`false` é decisão desta conversa e vence
   * a da empresa.
   *
   * Existe para a automação do funil poder dizer "o bot atende quem está na
   * lista Triagem, e para quando um humano assume".
   */
  @Column(DataType.BOOLEAN)
  aiBotEnabled: boolean | null;

  @Column
  lastMessage: string;

  /**
   * Quando o CLIENTE falou pela última vez. Só o canal oficial (Cloud API)
   * escreve e lê isto: passadas 24h desta marca, a Meta recusa texto livre e
   * só aceita template aprovado. Nulo = nunca recebeu mensagem do cliente.
   */
  @Column(DataType.DATE)
  lastInboundAt: Date | null;

  // --- De qual anúncio veio esta conversa -----------------------------------
  // A Meta manda o `referral` só na PRIMEIRA mensagem depois do clique no
  // anúncio. Quem não grava na hora perde. Tudo nulo = conversa orgânica.
  // Só o canal oficial recebe isto; o canal por QR Code nunca preenche.

  /** ID do anúncio ou da publicação na Meta. */
  @Column(DataType.TEXT)
  referralSourceId: string | null;

  /** `ad` (anúncio) ou `post` (publicação). */
  @Column(DataType.TEXT)
  referralSourceType: string | null;

  @Column(DataType.TEXT)
  referralSourceUrl: string | null;

  /** Título do anúncio — é o que o atendente reconhece. */
  @Column(DataType.TEXT)
  referralHeadline: string | null;

  @Column(DataType.TEXT)
  referralBody: string | null;

  /**
   * Identificador do clique. Não aparece na tela: serve para casar a venda com
   * a campanha no gerenciador da Meta depois.
   */
  @Column(DataType.TEXT)
  referralCtwaClid: string | null;

  @Default(false)
  @Column
  isGroup: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;


  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @BelongsTo(() => Queue)
  queue: Queue;

  @Column
  chatbot: boolean;

  @ForeignKey(() => QueueOption)
  @Column
  queueOptionId: number;

  @BelongsTo(() => QueueOption)
  queueOption: QueueOption;

  @HasMany(() => Message)
  messages: Message[];

  @HasMany(() => TicketTag)
  ticketTags: TicketTag[];

  @BelongsToMany(() => Tag, () => TicketTag)
  tags: Tag[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Default(uuidv4())
  @Column
  uuid: string;

  @BeforeCreate
  static setUUID(ticket: Ticket) {
    ticket.uuid = uuidv4();
  }

  @HasMany(() => TicketTraking)
  ticketTrakings: TicketTraking;
}

export default Ticket;
