import { createGmClient } from './gm.js';
import { createApi } from './api.js';

export { createApi, createGmClient };

export async function createClient(options) {
  return createGmClient(options);
}

export async function createThebird(options) {
  return createApi(await createGmClient(options));
}

export default createThebird;
