import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Transaction } from 'sequelize';
import { User } from '../../database/models/user.model';
import { normalizeEmail, UsersService } from './users.service';

describe('UsersService', () => {
  const userModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
  };
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User), useValue: userModel },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('normalizes e-mail addresses', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('looks users up by the normalized e-mail', async () => {
    await service.findByEmail('Alice@Example.com');

    expect(userModel.findOne).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
      transaction: undefined,
    });
  });

  it('stores the normalized e-mail on create', async () => {
    const transaction = {} as Transaction;

    await service.create(
      { email: ' Bob@Example.com ', passwordHash: 'hash' },
      transaction,
    );

    expect(userModel.create).toHaveBeenCalledWith(
      { email: 'bob@example.com', passwordHash: 'hash' },
      { transaction },
    );
  });
});
