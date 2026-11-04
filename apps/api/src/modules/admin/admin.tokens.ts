// O relógio das rotas /admin (a data de início da temporada, o mês dos custos, o prazo do reprocesso do ciclo). Um provedor à parte para o
// teste fixar o instante: o prazo das 09:30 e a virada do mês são o que importa provar, e o relógio da máquina não os alcança.
export const ADMIN_CLOCK = Symbol('ADMIN_CLOCK');
export type AdminClock = () => Date;
