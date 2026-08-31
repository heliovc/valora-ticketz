import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  BelongsToMany,
  ForeignKey,
  BelongsTo,
  HasMany,
  DataType,
  Default
} from "sequelize-typescript";
import Company from "./Company";
import Ticket from "./Ticket";
import TicketTag from "./TicketTag";
import Contact from "./Contact";
import ContactTag from "./ContactTag";

@Table
class Tag extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column
  color: string;

  @Column
  kanban: number;

  // ── Gatilho da lista ──────────────────────────────────────
  // Quando um card entra nesta lista, o CRM manda esta mensagem sozinho.
  // Vazio = lista sem gatilho, que é o estado de toda lista já existente.

  @Column(DataType.TEXT)
  autoMessage: string | null;

  /** Espera antes de enviar. Zero = na hora que o card entra. */
  @Default(0)
  @Column
  autoDelayMinutes: number;

  /** Card que volta para a mesma lista não dispara de novo. */
  @Default(true)
  @Column
  autoOnce: boolean;

  /** Fora do expediente, a mensagem espera a abertura em vez de sair de madrugada. */
  @Default(true)
  @Column
  autoBusinessHoursOnly: boolean;

  @HasMany(() => TicketTag)
  ticketTags: TicketTag[];

  @BelongsToMany(() => Ticket, () => TicketTag)
  tickets: Ticket[];

  @HasMany(() => ContactTag)
  contactTags: ContactTag[];

  @BelongsToMany(() => Contact, () => ContactTag)
  contacts: Contact[];

  @Column({
    type: DataType.VIRTUAL,
    get() {
      return (this as any).ticketTags?.length || 0;
    }
  })
  ticketsCount: number;

  @Column({
    type: DataType.VIRTUAL,
    get() {
      return (this as any).contactTags?.length || 0;
    }
  })
  contactsCount: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Tag;
