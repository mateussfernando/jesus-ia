/**
 * Build de teste (plano da fase 1, etapas 3 e 4): decidido na compilação pelo empacotador (`rolldown.config.mjs`),
 * nunca em tempo de execução. No bundle de produção a constante vale `false`, e todo `if (TEST_BUILD)` some do
 * código. Nada de `app.isPackaged` nem variável de ambiente para isso: o app instalado não pode virar "de teste".
 */
export const TEST_BUILD: boolean = __JESUS_TEST_BUILD__;
