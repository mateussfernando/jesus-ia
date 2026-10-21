// Textos que só existem no código do build de teste (os ganchos dos testes de ponta a ponta, as variáveis que só ele
// lê e o destino de API de teste). Se algum aparecer no build ou no pacote de produção, o código de teste vazou para
// ele: o build e a conferência do pacote falham.
export const TEST_ONLY_MARKERS = ['__jesusTest', 'JESUS_E2E_USER_DATA', 'JESUS_E2E_IDLE_MS', 'useTestApi'];
