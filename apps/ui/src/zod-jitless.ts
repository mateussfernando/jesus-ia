import { z } from 'zod';

/**
 * O Zod 4 testa se pode compilar validadores com `new Function` (fica mais rápido). A CSP da interface proíbe
 * `eval` e afins (seção 3.12; decisão 0013), então esse teste gera uma violação no console. Sem o modo JIT, o
 * Zod valida do jeito normal, e a CSP continua rígida. Importe este módulo antes de qualquer validação.
 */
z.config({ jitless: true });
