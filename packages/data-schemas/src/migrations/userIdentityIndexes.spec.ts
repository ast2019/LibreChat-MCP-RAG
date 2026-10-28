import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { migrateUserIdentityIndexes } from './userIdentityIndexes';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
});

const indexNames = async () =>
  (await mongoose.connection.db!.collection('users').indexes()).map((idx) => idx.name);

describe('migrateUserIdentityIndexes', () => {
  it('is a no-op when the collection does not exist', async () => {
    await expect(migrateUserIdentityIndexes(mongoose.connection)).resolves.toEqual({
      created: [],
      dropped: [],
    });
  });

  it('replaces the legacy email index so phone-only users can coexist', async () => {
    const users = mongoose.connection.db!.collection('users');
    await users.createIndex(
      { email: 1, tenantId: 1 },
      { unique: true, name: 'email_1_tenantId_1' },
    );
    await users.insertOne({ email: 'a@example.com', name: 'A' });

    const result = await migrateUserIdentityIndexes(mongoose.connection);
    expect(result).toEqual({
      created: ['users.tenantId_1_email_1', 'users.phone_1_tenantId_1'],
      dropped: ['users.email_1_tenantId_1'],
    });
    expect(await indexNames()).not.toContain('email_1_tenantId_1');

    await users.insertOne({ phone: '+989120000001' });
    await users.insertOne({ phone: '+989120000002' });
    await expect(users.insertOne({ phone: '+989120000001' })).rejects.toMatchObject({
      code: 11000,
    });
    await expect(users.insertOne({ email: 'a@example.com' })).rejects.toMatchObject({
      code: 11000,
    });

    await expect(migrateUserIdentityIndexes(mongoose.connection)).resolves.toEqual({
      created: [],
      dropped: [],
    });
  });
});
