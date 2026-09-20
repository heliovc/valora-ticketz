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

/** Arquivo de consulta do bot de IA, por empresa. Ver a migration. */
@Table
class AiBotFile extends Model<AiBotFile> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  /** Nome original, mostrado na tela. */
  @Column
  name: string;

  @Column
  mimetype: string;

  /** Nome no disco (pasta privada), não é o que o lojista vê. */
  @Column
  filename: string;

  @Default(0)
  @Column
  size: number;

  /** Texto extraído na hora do upload — é isto que vai para o prompt. */
  @Default("")
  @Column
  extractedText: string;

  /** Tamanho do texto extraído. Zero significa que nada foi lido do arquivo. */
  @Default(0)
  @Column
  charCount: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;
}

export default AiBotFile;
