import { Module } from '@nestjs/common';
import { CycleViewRepository } from './infrastructure/cycle-view.repository.js';
import { CyclesController } from './presentation/cycles.controller.js';

// Só a leitura pública do ciclo (GET /api/v1/cycles/:id): é o que o papel HTTP carrega da arena. O motor da decisão (gateway,
// handler, agendador) fica no ArenaModule, que só os papéis sem HTTP importam: a api, exposta à internet, não leva o gateway.
@Module({
  controllers: [CyclesController],
  providers: [CycleViewRepository],
  exports: [CycleViewRepository],
})
export class CyclesModule {}
