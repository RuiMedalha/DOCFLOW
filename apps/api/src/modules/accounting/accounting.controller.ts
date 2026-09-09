import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/guards/rbac.guard';

/**
 * AccountingController — minimal chart-of-accounts surface used by the
 * document detail page (debit/credit account dropdowns).
 *
 * NOTE: This is a static read-only stub for now. The future sprint that
 * introduces the ChartOfAccounts Prisma model will replace this with a
 * real query + per-tenant customization. Until then the list mirrors the
 * Portuguese SNC baseline so the UI can render a non-empty dropdown.
 */
@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  /** GET /accounting/accounts — flat chart-of-accounts list. */
  @Get('accounts')
  @Roles(Role.OPERADOR, Role.ADMIN)
  @ApiOperation({
    summary: 'Chart of accounts (Portuguese SNC baseline)',
    description:
      'Read-only list of accounting accounts for the debit/credit dropdowns. Static until the ChartOfAccounts model lands.',
  })
  @ApiResponse({ status: 200, description: 'List of accounting accounts' })
  listAccounts(): { items: Array<{ code: string; label: string }> } {
    return { items: SNC_BASELINE };
  }
}

/** Portuguese Sistema de Normalização Contabilística (SNC) — common subset. */
const SNC_BASELINE: Array<{ code: string; label: string }> = [
  { code: '11', label: 'Caixa' },
  { code: '12', label: 'Depósitos à ordem' },
  { code: '13', label: 'Outros depósitos bancários' },
  { code: '21', label: 'Clientes' },
  { code: '22', label: 'Fornecedores' },
  { code: '23', label: 'Pessoal' },
  { code: '24', label: 'Estado e outros entes públicos' },
  { code: '25', label: 'Financiamentos obtidos' },
  { code: '27', label: 'Outras contas a receber e a pagar' },
  { code: '28', label: 'Diferimentos' },
  { code: '31', label: 'Compras' },
  { code: '32', label: 'Mercadorias' },
  { code: '33', label: 'Matérias-primas, subsidiárias e de consumo' },
  { code: '41', label: 'Investimentos financeiros' },
  { code: '43', label: 'Ativos fixos tangíveis' },
  { code: '45', label: 'Investimentos em curso' },
  { code: '51', label: 'Capital' },
  { code: '55', label: 'Reservas' },
  { code: '56', label: 'Resultados transitados' },
  { code: '61', label: 'Custo das mercadorias vendidas e das matérias consumidas' },
  { code: '62', label: 'Fornecimentos e serviços externos' },
  { code: '63', label: 'Gastos com o pessoal' },
  { code: '64', label: 'Gastos de depreciação e de amortização' },
  { code: '65', label: 'Perdas por imparidade' },
  { code: '68', label: 'Outros gastos e perdas' },
  { code: '69', label: 'Gastos e perdas de financiamento' },
  { code: '71', label: 'Vendas' },
  { code: '72', label: 'Prestações de serviços' },
  { code: '75', label: 'Subsídios à exploração' },
  { code: '78', label: 'Outros rendimentos e ganhos' },
  { code: '79', label: 'Juros, dividendos e outros rendimentos similares' },
];
