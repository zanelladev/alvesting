import { describe, expect, it } from 'vitest';
import { jobExecutionName } from './promote.js';

// O nome da execução do job do Container Apps (CONTAINER_APP_JOB_EXECUTION_NAME) vai para a auditoria de account:promote e
// account:demote. Vem do ambiente, então só passa o que tem a forma de um nome de recurso do Azure.
describe('jobExecutionName', () => {
  it('lê o nome da execução', () => {
    expect(jobExecutionName({ CONTAINER_APP_JOB_EXECUTION_NAME: 'job-migrate-iwpi4il' })).toBe(
      'job-migrate-iwpi4il',
    );
  });

  it('fora da Azure (sem a variável) não há execução', () => {
    expect(jobExecutionName({})).toBeUndefined();
    expect(jobExecutionName({ CONTAINER_APP_JOB_EXECUTION_NAME: '' })).toBeUndefined();
  });

  it.each([
    'Job Migrate',
    'job_migrate',
    'x'.repeat(65),
    'job\nmigrate',
    'job-migrate\u0000',
    '../x',
  ])('o que não tem a forma de um nome (%j) é ignorado, e não vai para a auditoria', (value) => {
    expect(jobExecutionName({ CONTAINER_APP_JOB_EXECUTION_NAME: value })).toBeUndefined();
  });
});
