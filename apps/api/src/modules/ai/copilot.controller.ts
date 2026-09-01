// copilot.controller.ts — REST gateway for the DocFlow Co-Pilot
//
// Routes (after the global `api/v1` prefix is applied in main.ts):
//   POST /api/v1/ai/copilot/chat                  → RAG chat with intent routing
//   POST /api/v1/ai/copilot/documents/:id/analyze  → analyze a document
//   POST /api/v1/ai/copilot/documents/batch/duplicates
//   POST /api/v1/ai/copilot/documents/batch/anomalies
//
// Auth: the GLOBAL JwtGuard + TenantGuard APP_GUARDs in app.module.ts
// run for every route by default, so we do NOT add @UseGuards here —
// doing so would double-decode the JWT and (because the local JwtAuthGuard
// runs passport's `validate()` which returns AuthenticatedUser with
// `tenantId` rather than the raw payload's `tenant_id`) overwrite
// request.user and break TenantGuard's claim check.
import {
  Controller,
  Post,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CopilotService } from './copilot.service';
import {
  CopilotQueryDto,
  CopilotResponseDto,
} from './dto/copilot-query.dto';
import {
  DocumentAnalysisRequestDto,
  DocumentAnalysisResponseDto,
} from './dto/document-analysis.dto';

@ApiTags('ai-copilot')
@ApiBearerAuth()
@Controller('ai/copilot')
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  /** Main chat endpoint — RAG-augmented treasury Q&A with intent routing. */
  @Post('chat')
  @ApiOperation({ summary: 'Treasury co-pilot chat (RAG, intent-routed)' })
  async chat(
    @Body() dto: CopilotQueryDto,
    @Req() req: Request,
  ): Promise<CopilotResponseDto> {
    // The global JwtGuard populates request.user with the raw payload
    // (DocFlowJwtPayload: { sub, tenant_id, roles[], sid, jti }). Use
    // `sub` for actor identity and `tenant_id` for tenant scoping.
    const user = req.user as { sub?: string; tenant_id?: string } | undefined;
    return this.copilotService.chat(
      dto.query,
      dto.tenantId ?? user?.tenant_id ?? '',
      dto.history,
      user?.sub ? { userId: user.sub } : undefined,
    );
  }

  /** Analyze a document: classification + extraction via vision/OCR. */
  @Post('documents/:documentId/analyze')
  @ApiOperation({ summary: 'Analyze a document (stubbed vision pipeline)' })
  async analyzeDocument(
    @Param('documentId') documentId: string,
    @Body() dto: DocumentAnalysisRequestDto,
  ): Promise<DocumentAnalysisResponseDto> {
    return this.copilotService.analyzeDocument(documentId, dto);
  }

  /** Check a batch for duplicates */
  @Post('documents/batch/duplicates')
  @ApiOperation({ summary: 'Batch duplicate check' })
  async checkDuplicates(
    @Body('documentIds') documentIds: string[],
    @Query('tenantId') tenantId: string,
  ) {
    return this.copilotService.checkBatchDuplicates(tenantId, documentIds);
  }

  /** Scan a batch for anomalies (fraud signals) */
  @Post('documents/batch/anomalies')
  @ApiOperation({ summary: 'Batch anomaly scan' })
  async scanAnomalies(
    @Body('documentIds') documentIds: string[],
    @Query('tenantId') tenantId: string,
  ) {
    return this.copilotService.scanAnomalies(tenantId, documentIds);
  }
}
