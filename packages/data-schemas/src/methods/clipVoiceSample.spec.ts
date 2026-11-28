import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ClipVoiceSampleMethods } from './clipVoiceSample';
import { createClipVoiceSampleMethods } from './clipVoiceSample';
import { createClipVoiceSampleModel } from '~/models/clipVoiceSample';

let server: MongoMemoryServer;
let methods: ClipVoiceSampleMethods;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  createClipVoiceSampleModel(mongoose);
  methods = createClipVoiceSampleMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

describe('clip voice samples', () => {
  it('returns null for an unknown key', async () => {
    expect(await methods.findClipVoiceSample('missing')).toBeNull();
  });

  it('stores a sample and replaces it under the same key without a duplicate', async () => {
    await methods.saveClipVoiceSample({ key: 'edge|a|fa', mime: 'audio/mpeg', base64: 'AAAA' });
    await methods.saveClipVoiceSample({ key: 'edge|a|fa', mime: 'audio/mpeg', base64: 'BBBB' });
    expect(await methods.findClipVoiceSample('edge|a|fa')).toEqual({
      key: 'edge|a|fa',
      mime: 'audio/mpeg',
      base64: 'BBBB',
    });
    expect(await mongoose.models.ClipVoiceSample.countDocuments({ key: 'edge|a|fa' })).toBe(1);
  });
});
