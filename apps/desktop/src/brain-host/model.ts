import { createAnthropic } from '@ai-sdk/anthropic';
import type { Experimental_DownloadFunction } from 'ai';
import { API_BASE_URL, BRAIN_KEY_PLACEHOLDER, BRAIN_MODEL_ID } from '../bridge/brain-protocol';

/**
 * O modelo do Cérebro (decisão 0023): o provedor da Anthropic do AI SDK com o endereço fixo, a chave de mentira (o
 * provedor exige uma; o principal a troca pela do cofre) e o `fetch` da ponte. Nada vem do ambiente: o `baseURL` e a
 * chave explícitos vencem `ANTHROPIC_BASE_URL` e `ANTHROPIC_API_KEY`, que o ambiente do Cérebro, montado por lista, nem
 * traz.
 */
export function createBrainModel(fetch: typeof globalThis.fetch) {
  return createAnthropic({ baseURL: API_BASE_URL, apiKey: BRAIN_KEY_PLACEHOLDER, fetch })(BRAIN_MODEL_ID);
}

/**
 * Download do AI SDK (`experimental_download`): o Cérebro recusa. Sem isto, uma URL de imagem ou PDF numa mensagem
 * (que pode ter vindo de conteúdo de fora) seria baixada no Cérebro pelo `undici`, fora do `fetch` da ponte, ou passada
 * à API como fonte por URL, que o principal recusa. Lista vazia (nada a baixar) segue normal.
 */
export const refuseDownload: Experimental_DownloadFunction = (requests) => {
  if (requests.length === 0) return Promise.resolve([]);
  return Promise.reject(new Error('o Jesus não baixa arquivos de endereços para o modelo'));
};
