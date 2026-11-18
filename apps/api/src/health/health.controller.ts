import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';

/** Public liveness probe (SPEC §6.5): status only, no details. */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
