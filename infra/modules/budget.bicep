// Orçamento anual do resource group com alertas de 50, 80 e 100% do gasto real (§5.9 e §5.12).
// Anual porque o crédito do Azure for Students (US$ 100) vale 12 meses: no econômico, um orçamento mensal de US$ 100 nunca
// avisaria que o crédito está acabando (07/11/2026). O alerta de 80% é o aviso para cortar o gasto.
// Só o primeiro deploy cria o orçamento (deployBudget no main.bicep): a Azure só aceita um startDate dentro do
// mês corrente ou até 12 meses à frente, então regravá-lo em outro mês, com a data antiga, seria recusado.
param amount int
@description('Primeiro dia de um mês (AAAA-MM-01): o mês corrente ou um dos próximos 12. Fixo no arquivo de parâmetros, porque um valor que muda a cada deploy quebraria o what-if.')
param startDate string
// Trava tardia, como a senha do Postgres: o e-mail vem do ambiente.
@minLength(3)
param alertEmail string

var thresholds = [50, 80, 100]

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'budget-alvesting'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Annually'
    timePeriod: { startDate: startDate }
    notifications: toObject(
      thresholds,
      threshold => 'actual_${threshold}',
      threshold => {
        enabled: true
        operator: 'GreaterThan'
        threshold: threshold
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
      }
    )
  }
}
