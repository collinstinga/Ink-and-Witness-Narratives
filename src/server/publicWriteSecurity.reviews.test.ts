import { describe, expect, it, vi } from 'vitest';
import { publicWriteValidators } from './publicWriteSecurity.js';

function validate(body: unknown) {
  const next = vi.fn();
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const request = { body: structuredClone(body) };
  publicWriteValidators.review(request as any, response as any, next);
  return { request, response, next };
}
const validBody = { rating: 5, review: 'A considered reader response.', submissionId: 'a22b04ad-3b40-431d-9346-bb238f982ed0' };
function expectRejected(body: unknown, status = 400) {
  const result = validate(body);
  expect(result.next).not.toHaveBeenCalled();
  expect(result.response.status).toHaveBeenCalledWith(status);
}

describe('review intent and publication authority boundary', () => {
  it('accepts a deliberate response identifier and trims only supported text fields', () => {
    const result = validate({ ...validBody, review: `  ${validBody.review}  `, submissionId: ` ${validBody.submissionId} ` });
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.request.body).toEqual(validBody);
  });
  it('keeps legacy clients compatible without a submission identifier', () => {
    expect(validate({ rating: 4, review: validBody.review }).next).toHaveBeenCalledOnce();
  });
  it('rejects client-selected identities, verification flags, publication and moderation fields', () => {
    for (const field of ['id', 'articleId', 'userId', 'readerName', 'readerEmail', 'readerHash', 'status', 'featured', 'verifiedReader', 'createdAt', 'updatedAt']) {
      expectRejected({ ...validBody, [field]: ['featured', 'verifiedReader'].includes(field) ? true : 'approved' });
    }
    expectRejected(JSON.parse('{"rating":5,"review":"A considered reader response.","__proto__":{"featured":true}}'));
    expectRejected({ ...validBody, constructor: { prototype: { status: 'approved' } } });
  });
  it.each([0, 6, 1.5, NaN, Infinity, '5', true, {}, null, undefined])('rejects invalid whole-number rating %j', rating => {
    expectRejected({ ...validBody, rating });
  });
  it.each(['short', '../invalid-submission', 'a'.repeat(81), 42, {}])('rejects malformed response intent %j', submissionId => {
    expectRejected({ ...validBody, submissionId });
  });
  it('rejects missing, short, excessive and malformed written responses', () => {
    for (const review of ['', 'short', ' '.repeat(40), 'a'.repeat(2001), 42, ['review'], null]) expectRejected({ ...validBody, review });
    expectRejected([]);
    expectRejected(null);
    // Four-byte characters also enforce the complete encoded request budget.
    expectRejected({ ...validBody, review: '🖋'.repeat(2100) }, 413);
  });
});
