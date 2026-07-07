import { Controller, Get } from '@nestjs/common';

const VERSION = '0.0.1';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, version: VERSION };
  }
}
