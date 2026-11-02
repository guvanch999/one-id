import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Transaction } from 'sequelize';
import { User } from '../../database/models/user.model';

/** E-mail addresses are stored and looked up in a canonical form. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  async create(
    payload: CreationAttributes<User>,
    transaction?: Transaction,
  ): Promise<User> {
    return this.userModel.create(
      { ...payload, email: normalizeEmail(payload.email) },
      { transaction },
    );
  }

  async findByEmail(
    email: string,
    transaction?: Transaction,
  ): Promise<User | null> {
    return this.userModel.findOne({
      where: { email: normalizeEmail(email) },
      transaction,
    });
  }

  async findById(id: string, transaction?: Transaction): Promise<User | null> {
    return this.userModel.findByPk(id, { transaction });
  }
}
