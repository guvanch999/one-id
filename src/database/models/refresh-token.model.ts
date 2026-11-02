import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  Index,
} from 'sequelize-typescript';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from 'sequelize';
import { User } from './user.model';

@Table({
  tableName: 'refresh_tokens',
  timestamps: true,
  underscored: true,
})
export class RefreshToken extends Model<
  InferAttributes<RefreshToken>,
  InferCreationAttributes<RefreshToken>
> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: CreationOptional<string>;

  @Index
  @Column({
    field: 'token_hash',
    type: DataType.STRING,
    allowNull: false,
  })
  declare tokenHash: string;

  @Column({
    field: 'expires_at',
    type: DataType.DATE,
    allowNull: false,
  })
  declare expiresAt: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare revoked: CreationOptional<boolean>;

  @Index
  @Column({
    field: 'jti',
    type: DataType.UUID,
    allowNull: false,
  })
  declare jti: string;

  @ForeignKey(() => User)
  @Index
  @Column({
    field: 'user_id',
    type: DataType.UUID,
    allowNull: false,
  })
  declare userId: string;

  @BelongsTo(() => User)
  declare user?: User;
}
