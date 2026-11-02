import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from 'sequelize';
import { RefreshToken } from './refresh-token.model';
import { UserStatus } from '../../common/enums/user-status.enum';

@Table({
  tableName: 'users',
  timestamps: true,
  underscored: true,
})
export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: CreationOptional<string>;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  declare email: string;

  @Column({
    field: 'password_hash',
    type: DataType.STRING,
    allowNull: false,
  })
  declare passwordHash: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare firstName: string | null;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare lastName: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(UserStatus)),
    defaultValue: UserStatus.ACTIVE,
    allowNull: false,
  })
  declare status: CreationOptional<UserStatus>;

  @HasMany(() => RefreshToken)
  declare refreshTokens?: RefreshToken[];
}
