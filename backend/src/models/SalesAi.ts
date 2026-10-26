import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  Default,
  AllowNull
} from "sequelize-typescript";

/** Configuração da Val Vendas por empresa. Ver a migration 20261027120000. */
@Table({ tableName: "SalesAiConfigs" })
export class SalesAiConfig extends Model<SalesAiConfig> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  companyId: number;

  @Default(false)
  @Column
  enabled: boolean;

  @Default([])
  @Column(DataType.JSONB)
  whatsappIds: number[];

  @AllowNull(true)
  @Column(DataType.DATE)
  campaignStartAt: Date | null;

  @Column
  listWindowDays: number;

  @Column
  refCodeScanMessages: number;

  @Column
  humanPauseMinutes: number;

  @Column
  valCommandsEnabled: boolean;

  @Column
  maxAiMessagesPerConversation: number;

  @Column
  maxAiMessagesPerMinute: number;

  @Column(DataType.JSONB)
  rules: Record<string, boolean>;

  @Column(DataType.JSONB)
  businessHours: Record<string, unknown>;

  @Column(DataType.JSONB)
  handoff: Record<string, unknown>;

  @Column(DataType.JSONB)
  prospecting: Record<string, unknown>;

  @AllowNull(true)
  @Column(DataType.TEXT)
  protocol: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

@Table({ tableName: "CampaignRefs" })
export class CampaignRef extends Model<CampaignRef> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  companyId: number;

  @Column
  code: string;

  @Column
  channel: string;

  @Column
  campaignName: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  prefilledText: string | null;

  @Default(true)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

@Table({ tableName: "CampaignListMembers" })
export class CampaignListMember extends Model<CampaignListMember> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  companyId: number;

  @Column
  listName: string;

  @Column
  number: string;

  @AllowNull(true)
  @Column
  campaignRef: string | null;

  @AllowNull(true)
  @Column(DataType.DATE)
  lastCampaignMessageAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

@Table({ tableName: "AiDecisionLogs" })
export class AiDecisionLog extends Model<AiDecisionLog> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @Column
  companyId: number;

  @AllowNull(true)
  @Column
  ticketId: number | null;

  @AllowNull(true)
  @Column
  contactId: number | null;

  @AllowNull(true)
  @Column
  messageId: string | null;

  @AllowNull(true)
  @Column
  whatsappId: number | null;

  @Column
  reply: boolean;

  @Column
  reason: string;

  @AllowNull(true)
  @Column(DataType.JSONB)
  details: Record<string, unknown> | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

@Table({ tableName: "SalesPlaybookVersions" })
export class SalesPlaybookVersion extends Model<SalesPlaybookVersion> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  companyId: number;

  @Column
  version: number;

  @Column(DataType.TEXT)
  content: string;

  @AllowNull(true)
  @Column
  note: string | null;

  @AllowNull(true)
  @Column
  author: string | null;

  @Default(false)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}
