import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ videos: vi.fn(), comments: vi.fn(), completion: vi.fn(), youtube: vi.fn(), groq: vi.fn() }));
vi.mock('@googleapis/youtube', () => ({ youtube_v3: { Youtube: class {
  constructor(options) { mocks.youtube(options); }
  videos = {list: mocks.videos}; commentThreads = {list: mocks.comments};
} } }));
vi.mock('groq-sdk', () => ({ default: class {
  constructor(options) { mocks.groq(options); }
  chat = {completions: {create: mocks.completion}};
}, APIError: class extends Error {} }));
let app;
const env = {ENABLE_PASS: 'true', PASS: 'test-pass', YOUTUBE_API_KEY: 'fake-youtube', GROQ_API_KEY: 'fake-groq'};
const output = {mealName: 'Soup', ingredients: [{name:'carrot', quantity:2}], tags:['vegan'], recipe:'Boil carrots'};
const snippet = {title:'Video title', description:'Recipe description', channelId:'owner', tags:['video-tag'], thumbnails:{standard:{url:'https://example.invalid/thumb.png'}}};
const comment = (author, text) => ({snippet:{topLevelComment:{snippet:{authorChannelId:{value:author}, textDisplay:text}}}});
beforeEach(async () => {
  vi.resetModules(); Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.videos.mockResolvedValue({data:{items:[{snippet}]}});
  mocks.comments.mockResolvedValue({data:{items:[comment('owner','Creator recipe'),comment('other','Unrelated comment')]}});
  mocks.completion.mockResolvedValue({choices:[{message:{content:JSON.stringify(output)}}]});
  app = (await import('../src/index.ts')).default;
});
async function request(body, overrides = {}) {
  const response = await app.fetch(new Request('http://localhost/youtube/generate-meal-data', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass:env.PASS, ...body}),
  }), {...env,...overrides});
  return {status:response.status, body:await response.json()};
}
test.each(['https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk',
  'https://youtube.com/embed/abcdefghijk', 'https://youtube.com/shorts/abcdefghijk',
  'https://youtube.com/watch?feature=share&v=abcdefghijk'])('parses video ID via handler: %s', async url => {
  expect((await request({url})).status).toBe(200);
  expect(mocks.videos.mock.calls[0][0].id).toEqual(['abcdefghijk']);
});
test('malformed JSON, missing URL, wrong pass and missing API key reject requests', async () => {
  const malformed = await app.fetch(new Request('http://localhost/youtube/generate-meal-data',{method:'POST',body:'{'}),env);
  expect(malformed.status).toBe(400);
  expect((await request({})).status).toBe(400);
  expect((await request({url:'https://youtu.be/abcdefghijk',pass:'wrong'})).status).toBe(403);
  expect((await request({url:'https://youtu.be/abcdefghijk'},{YOUTUBE_API_KEY:''})).status).toBe(500);
  expect(mocks.videos).not.toHaveBeenCalled(); expect(mocks.completion).not.toHaveBeenCalled();
});
test('invalid URL, absent video, absent channel and absent content produce 400', async () => {
  expect((await request({url:'https://example.invalid/short'})).status).toBe(400);
  mocks.videos.mockResolvedValueOnce({data:{items:[]}});
  expect((await request({url:'https://youtu.be/abcdefghijk'})).status).toBe(400);
  mocks.videos.mockResolvedValueOnce({data:{items:[{snippet:{...snippet,channelId:''}}]}});
  expect((await request({url:'https://youtu.be/abcdefghijk'})).status).toBe(400);
  mocks.videos.mockResolvedValueOnce({data:{items:[{snippet:{...snippet,description:''}}]}});
  mocks.comments.mockResolvedValueOnce({data:{items:[]}});
  expect((await request({url:'https://youtu.be/abcdefghijk'})).status).toBe(400);
  expect(mocks.completion).not.toHaveBeenCalled();
});
test('paginates creator comments and shapes prompt, response and thumbnail', async () => {
  mocks.comments.mockResolvedValueOnce({data:{items:[comment('owner','First creator step'),comment('other','Private unrelated')],nextPageToken:'next'}})
    .mockResolvedValueOnce({data:{items:[comment('owner','Second creator step')]}});
  const result = await request({url:'https://youtu.be/abcdefghijk',availableTags:['vegan','quick']});
  expect(result.status).toBe(200);
  expect(result.body.data).toEqual({name:'Soup', ingredients:output.ingredients,tags:['vegan'],recipe:{url:'https://youtu.be/abcdefghijk',notes:'Boil carrots',images:[{type:'url',url:snippet.thumbnails.standard.url}]}});
  const prompt = mocks.completion.mock.calls[0][0];
  expect(prompt.response_format).toEqual({type:'json_object'});
  for (const text of ['Video title','Recipe description','video-tag','vegan, quick','First creator step','Second creator step','Return ONLY JSON']) expect(prompt.messages[0].content).toContain(text);
  expect(prompt.messages[0].content).not.toContain('Private unrelated');
  expect(mocks.comments.mock.calls[1][0].pageToken).toBe('next');
});
test('response cache reuses video ID; skipAnyCaching refreshes it; SDK clients reuse synthetic keys', async () => {
  const body = {url:'https://youtu.be/abcdefghijk'};
  await request(body); const cached = await request(body);
  expect(cached.body.modelUsed).toBe('CachedResponse'); expect(mocks.completion).toHaveBeenCalledTimes(1);
  await request({...body,additionalInput:{type:'youtube',skipAnyCaching:true}});
  expect(mocks.completion).toHaveBeenCalledTimes(2); expect(mocks.youtube).toHaveBeenCalledTimes(1); expect(mocks.groq).toHaveBeenCalledTimes(1);
});
test('explicit model selection, unknown model and fallback failures', async () => {
  const body = {url:'https://youtu.be/abcdefghijk',additionalInput:{type:'youtube',skipAnyCaching:true,modelSelection:{client:'Groq',model:'llama-3.3-70b-versatile'}}};
  expect((await request(body)).status).toBe(200);
  expect(mocks.completion.mock.calls[0][0].model).toBe('llama-3.3-70b-versatile');
  expect((await request({...body,additionalInput:{...body.additionalInput,modelSelection:{client:'Groq',model:'unknown'}}})).status).toBe(404);
  mocks.completion.mockRejectedValueOnce(new Error('synthetic unavailable'));
  expect((await request({url:body.url,additionalInput:{type:'youtube',skipAnyCaching:true}})).status).toBe(200);
  expect(mocks.completion.mock.calls.at(-1)[0].model).toBe('moonshotai/kimi-k2-instruct');
  mocks.completion.mockRejectedValue(new Error('synthetic unavailable'));
  expect((await request(body)).status).toBe(500);
});
test('unexpected YouTube failures return a generic message', async () => {
  mocks.videos.mockRejectedValueOnce(new Error('synthetic upstream failure'));
  expect(await request({url:'https://youtu.be/abcdefghijk'})).toEqual({status:500,body:{error:'An unexpected error occurred.'}});
});
