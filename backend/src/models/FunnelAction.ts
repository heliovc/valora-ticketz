import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DataType,
  Default,
  AllowNull
} from "sequelize-typescript";
import Company from "./Company";
import Tag from "./Tag";

/** O que a automação faz. Tipo desconhecido é ignorado, nunca quebra o fluxo. */
export type TipoDeAcao = "mensagem" | "bot_ligar" | "bot_desligar";

/**
 * Uma ação automática do funil.
 *
 * Antes o gatilho era uma mensagem só, guardada em quatro colunas na própria
 * `Tag`. Isso resolvia "card entrou na lista → manda texto" e mais nada: para
 * ligar o Bot de IA numa lista já não havia onde pôr a informação.
 *
 * Agora cada lista tem uma LISTA de ações, executadas na ordem. Somar uma ação
 * nova (mover de lista, trocar responsável, webhook) passa a ser uma linha no
 * `switch` do executor, não outra migração de colunas.
 *
 * `tagId` nulo = a automação vale para **conversa nova** (a coluna "Entrada" do
 * funil, onde o cliente acabou de escrever e ninguém atendeu). É o único evento
 * que não nasce de uma lista, e é onde ligar o Bot faz mais sentido.
 */
@Table({ tableName: "FunnelActions" })
class FunnelAction extends Model<FunnelAction> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Tag)
  @AllowNull(true)
  @Column
  tagId: number | null;

  @BelongsTo(() => Tag)
  tag: Tag;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /** Ordem de execução dentro da mesma lista. */
  @Default(0)
  @Column
  ordem: number;

  @Column(DataType.STRING)
  tipo: TipoDeAcao;

  /**
   * Parâmetros da ação. Hoje: `{ mensagem: string }` para `tipo="mensagem"`.
   * As ações de bot não têm configuração — ligar é ligar.
   */
  @Default({})
  @Column(DataType.JSONB)
  config: Record<string, unknown>;

  /** Espera antes de executar. Ação de bot com atraso 0 roda na hora — ver o executor. */
  @Default(0)
  @Column
  atrasoMinutos: number;

  /** Não repete se o card voltar para a lista. */
  @Default(true)
  @Column
  umaVezSo: boolean;

  /** Fora do expediente, adia em vez de tocar o telefone do cliente de madrugada. */
  @Default(true)
  @Column
  soHorarioComercial: boolean;

  @Default(true)
  @Column
  ativo: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelAction;
