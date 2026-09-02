import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

const SEED_CATEGORIES = [
  { name: 'Refeições',         slug: 'refeicoes',         color: '#F59E0B', defaultIvaDeductibilityPct: 50 },
  { name: 'Combustível',       slug: 'combustivel',       color: '#EF4444', defaultIvaDeductibilityPct: 50 },
  { name: 'Alojamento',        slug: 'alojamento',        color: '#8B5CF6', defaultIvaDeductibilityPct: 100 },
  { name: 'Deslocações',       slug: 'deslocacoes',       color: '#3B82F6', defaultIvaDeductibilityPct: 100 },
  { name: 'Material de escritório', slug: 'material-escritorio', color: '#10B981', defaultIvaDeductibilityPct: 100 },
  { name: 'Serviços / FSE',    slug: 'servicos-fse',      color: '#6366F1', defaultIvaDeductibilityPct: 100 },
  { name: 'Comunicações',      slug: 'comunicacoes',      color: '#14B8A6', defaultIvaDeductibilityPct: 100 },
  { name: 'Rendas',            slug: 'rendas',            color: '#A855F7', defaultIvaDeductibilityPct: 100 },
  { name: 'Outras',            slug: 'outras',            color: '#64748B', defaultIvaDeductibilityPct: 100 },
];

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSeedForTenant(tenantId: string): Promise<void> {
    const existing = await this.prisma.category.count({ where: { tenantId } });
    if (existing > 0) return;
    await this.prisma.category.createMany({
      data: SEED_CATEGORIES.map((c) => ({ ...c, tenantId })),
    });
  }

  list(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getOrThrow(tenantId: string, id: string) {
    const c = await this.prisma.category.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException(`Category ${id} not found`);
    return c;
  }

  async create(tenantId: string, dto: CreateCategoryDto) {
    const dup = await this.prisma.category.findFirst({ where: { tenantId, slug: dto.slug } });
    if (dup) throw new ConflictException(`Category with slug "${dto.slug}" already exists in this tenant`);
    return this.prisma.category.create({
      data: { ...dto, tenantId },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.getOrThrow(tenantId, id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.getOrThrow(tenantId, id);
    await this.prisma.category.delete({ where: { id } });
  }
}
