import { describe, expect, it, vi } from 'vitest';
import { publicWriteValidators } from './publicWriteSecurity.js';

function validate(body: Record<string, unknown>) {
  const next = vi.fn(); const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const request = { body: structuredClone(body) };
  publicWriteValidators.comment(request as any, response as any, next);
  return { request, response, next };
}
describe('comment submission identity and approval boundary', () => {
  it('accepts the modern idempotent submission identifier without accepting approval fields', () => {
    const body = { content: 'A thoughtful comment', submissionId: 'a22b04ad-3b40-431d-9346-bb238f982ed0' };
    const valid = validate(body); expect(valid.next).toHaveBeenCalledOnce(); expect(valid.request.body).toEqual(body);
    for (const field of ['status', 'readerHash', 'readerEmail', 'readerName', 'approved']) {
      const invalid = validate({ ...body, [field]: field === 'approved' ? true : 'approved' });
      expect(invalid.next).not.toHaveBeenCalled(); expect(invalid.response.status).toHaveBeenCalledWith(400);
    }
  });
  it('keeps existing clients compatible without a submission identifier', () => {
    expect(validate({ content: 'An older-client comment' }).next).toHaveBeenCalledOnce();
  });
  it.each(['short', '../invalid-submission', 'a'.repeat(81), 42, {}])('rejects invalid submission identifier %j', submissionId => {
    const result = validate({ content: 'A comment', submissionId });
    expect(result.next).not.toHaveBeenCalled(); expect(result.response.status).toHaveBeenCalledWith(400);
  });
});
