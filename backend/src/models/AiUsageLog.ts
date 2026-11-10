import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  AllowNull,
  Default
} from "sequelize-typescript";

/** Uma chamada a um modelo de IA. Ver a migration 20261111120000. */
@Table({ tableName: "AiUsageLogs" })
class AiUsageLog extends Model<AiUsageLog> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @Column
  companyId: number;

  @AllowNull(true)
  @Column
  ticketId: number | null;

  /** val_vendas, val_saude, follow_up, atendimento, teste, transcricao. */
  @Column
  origem: string;

  /** oficial, qr, webchat. */
  @AllowNull(true)
  @Column
  canal: string | null;

  @Column
  provider: string;

  @Column
  model: string;

  /** Impressão digital da chave (sha256, 12 caracteres). */
  @Column
  chave: string;

  @AllowNull(true)
  @Column
  chaveFinal: string | null;

  /** "valora" (chave do ambiente) ou "empresa" (chave da própria empresa). */
  @Column
  dona: string;

  @Default(0)
  @Column
  inputTokens: number;

  @Default(0)
  @Column
  outputTokens: number;

  @AllowNull(true)
  @Column(DataType.DECIMAL(12, 6))
  costUsd: string | null;

  @Column
  ok: boolean;

  @AllowNull(true)
  @Column
  erro: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiUsageLog;
