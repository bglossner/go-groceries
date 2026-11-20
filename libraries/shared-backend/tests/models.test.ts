import { expect, test, vi } from 'vitest';
import { ErrorWrapper } from '../src/endpoints/error';
import { Model, ModelSelector } from '../src/models';
class FakeModel extends Model { getModelName() { return 'fake'; } }
test('error wrapper retains message, status, Error identity and stack', () => {
  const error = new ErrorWrapper({message: 'synthetic failure', statusCode: 409});
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('synthetic failure');
  expect(error.statusCode).toBe(409);
  expect(error.stack).toContain('synthetic failure');
});
test('default model is loaded lazily and reused', async () => {
  const model = new FakeModel(); const loader = vi.fn(async () => model);
  const selector = new ModelSelector({defaultClientModel: 'one', modelLoader: loader});
  expect(loader).not.toHaveBeenCalled();
  expect(await selector.getDefaultModel()).toBe(model);
  expect(await selector.getModel('one')).toBe(model);
  expect(loader).toHaveBeenCalledExactlyOnceWith('one');
});
test('allowlist rejects clients before loading', async () => {
  const loader = vi.fn(async () => new FakeModel());
  const selector = new ModelSelector({defaultClientModel: 'one', modelLoader: loader, allowClients: ['one']});
  expect(await selector.getModel('two')).toBeUndefined(); expect(loader).not.toHaveBeenCalled();
});
test('explicit single and bulk registrations override loader', async () => {
  const loader = vi.fn(async () => new FakeModel()); const one = new FakeModel(); const two = new FakeModel();
  const selector = new ModelSelector({defaultClientModel: 'one', modelLoader: loader});
  selector.addModel('one', one); selector.addModels({two});
  expect(await selector.getDefaultModel()).toBe(one); expect(await selector.getModel('two')).toBe(two);
  expect(loader).not.toHaveBeenCalled();
});
test('failed loader does not poison later retries', async () => {
  const model = new FakeModel(); const loader = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(model);
  const selector = new ModelSelector({defaultClientModel: 'one', modelLoader: loader});
  await expect(selector.getDefaultModel()).rejects.toThrow('temporary');
  expect(await selector.getDefaultModel()).toBe(model); expect(loader).toHaveBeenCalledTimes(2);
});
