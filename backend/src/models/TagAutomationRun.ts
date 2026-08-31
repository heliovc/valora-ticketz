import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import Tag from "./Tag";
import Ticket from "./Ticket";

/**
 * Um disparo do gatilho de lista: este card entrou nesta lista e o CRM mandou
 * (ou deixou de mandar) a mensagem automática.
 *
 * Sustenta o "só na primeira vez" e serve de prova do que saiu sem ninguém
 * digitar — mensagem automática que ninguém consegue auditar vira discussão.
 */
@Table({ tableName: "TagAutomationRuns" })
class TagAutomationRun extends Model<TagAutomationRun> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => Tag)
  @Column
  tagId: number;

  @BelongsTo(() => Tag)
  tag: Tag;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /** Preenchido só quando a mensagem sai de verdade. Nulo = enfileirada. */
  @Column
  sentAt: Date | null;

  /** Motivo de não ter saído (card saiu da lista, envio falhou). */
  @Column
  skippedReason: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default TagAutomationRun;
